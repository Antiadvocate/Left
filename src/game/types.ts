// Core data model. Every number here is owned by deterministic code; the LLM only
// proposes events that the rules engine validates, clamps and applies.

export type SoldierKind = "human" | "ai";
export type ClassId = "heavy" | "assault" | "scout" | "sniper" | "support" | "ew";
export type Loadout = "heavy" | "light";
export type Attachment = "secure" | "anxious" | "avoidant" | "disorganized";
export type FearState = "steady" | "shaken" | "terrified";
export type Tier = "stranger" | "familiar" | "bonded" | "deep";
export type SoldierStatus = "active" | "injured" | "repair" | "base-duty" | "dead" | "discharged" | "defected";
export type Location = "bunks" | "mess" | "medbay" | "maintenance" | "memorial" | "range";

/** Reactive behaviours a habit can fire in combat. Implemented in code only. */
export type CombatEffect =
  | "steady-under-fire"   // +aim while wounded
  | "freeze-when-flanked" // loses an action when a turn starts flanked
  | "shoot-first"         // free reaction shot at the first enemy that comes into view
  | "double-check"        // -1 mobility, +5 defense
  | "take-dead-position"  // deploys in a dead partner's slot
  | "break-toward"        // moves toward a specific person when they go down
  | "hold-fire-on"        // overwatch never fires on one enemy type
  | "flinch-at";          // fear rises whenever one enemy type is in view

export interface Habit {
  id: string;
  text: string;
  valence: "hinder" | "help";
  wound?: boolean; // from before the war; never stated as backstory
  trigger?: { kind: "terrain" | "position" | "enemy" | "person" | "event"; value: string };
  combatEffect?: CombatEffect;
  sourceMemoryId?: string;
}

export interface Memory {
  id: string;
  ownerId: string;
  day: number;
  significance: number; // 0..100, drives retrieval and decay
  core: string;         // stays sharp
  peripheral: string[]; // fades
  anchor: string;       // landmark, e.g. "the night after the Tacoma raid"
  participants: string[];
  feeling: string;      // one word, used for mood-gated recall; never shown as an interior
  valence: number;      // -1..1, mood congruence
}

export interface Stats {
  aim: number;
  hp: number;
  mobility: number;
  defense: number;
  tech: number;
  will?: number; // humans only
}

export type BarkTag = "flanked" | "partnerHit" | "kill" | "refusal" | "rescue" | "miss" | "deploy" | "downed" | "terrified";
export type BarkBank = Partial<Record<BarkTag, string[]>>;

export interface Soldier {
  id: string;
  name: string;
  callsign: string;
  kind: SoldierKind;
  class: ClassId;
  loadout: Loadout;
  rank: number;
  xp: number;
  stats: Stats;
  talents: string[];
  traits: Habit[];
  voice: VoiceId;
  attachment: Attachment;
  relaxation: number;   // -10..10
  braced: boolean;      // bistable attractor: braced vs settled
  capacity: number;     // the settled set point
  commandTrust: number; // -100..100
  wasTerrified: boolean;
  memories: Memory[];
  status: SoldierStatus;
  recoveryDays: number;
  bunkId?: string;
  kills: number;
  missions: number;
  barks: BarkBank;
  pendingRefusalReview?: boolean;
  joinedDay: number;
}

export type VoiceId =
  | "clipped" | "counter" | "questioner" | "profane" | "formal" | "trailing" | "surnames" | "joker"
  | "ai-precise" | "ai-echo" | "ai-literal";

export interface Relationship {
  from: string;
  to: string;
  warmth: number;     // -100..100
  trust: number;      // -100..100
  attraction: number; // 0..100
  spark: number;      // 0..1, fixed chemistry; most pairs are 0 and never feel attraction
  compat: number;     // -1..1, fixed, directional: how A takes B's company day to day
  tier: Tier;
  streak: number;     // consecutive days meeting the next tier
  slip: number;       // consecutive days below the current tier
  missionsTogether: number;
  missionsApart: number;
  crises: number;     // rescues, near-deaths, partner downs shared
  adjacentTurns: number;
  unlockedActions: string[];
  today: { warmth: number; trust: number; attraction: number };
  rivalCount: number; // times the other deployed/bunked with someone else lately
  lastEventDay: number;
}

export interface BondAction {
  id: string;
  name: string;
  tier: "familiar" | "bonded" | "deep";
  effect: string;
}

export interface DoctrineProfile {
  armorWeight: number;
  rangeMix: number;
  aggression: number;
  flankRate: number;
  overwatchRate: number;
  classMix: Record<ClassId, number>;
  confidence: number;
}

export interface Doctrine {
  name: string;
  coverSeek: number;     // weight on taking cover
  aggression: number;    // weight on closing distance
  flankSeek: number;     // weight on flanking positions
  focusWounded: number;  // weight on finishing weak targets
  overwatchBias: number; // weight on overwatch when no good shot
  preferredRange: number;
}

// ---------- night pass ----------

export interface BarkLine { speaker: string; text: string }

export interface EdgeDelta { from: string; to: string; warmth?: number; trust?: number; attraction?: number }

export interface NightEvent {
  id: string;
  day: number;
  participants: string[];
  location: Location;
  scene: string;
  lines: BarkLine[];
  deltas: EdgeDelta[];
  relaxation: { id: string; delta: number }[];
  memory?: Omit<Memory, "id" | "ownerId" | "day" | "anchor"> & { ownerId: string };
  habit?: { ownerId: string; text: string; valence: "hinder" | "help"; trigger?: Habit["trigger"]; combatEffect?: CombatEffect };
  bondUnlock?: { pair: [string, string]; actionId: string };
  source: "llm" | "template" | "rules";
}

export interface NightReport {
  day: number;
  events: NightEvent[];
  source: "llm" | "template";
  error?: string;
  log: string[]; // rule-engine notes (tier changes, clamps, rejections)
}

// ---------- missions ----------

export type MissionType = "raid" | "defense" | "rescue" | "data recovery" | "sabotage" | "retaliation";

export interface MissionSpec {
  id: string;
  day: number;
  type: MissionType;
  place: string;
  name: string;     // landmark name used by memory anchors, e.g. "the Tacoma raid"
  seed: number;
  difficulty: number;
}

export type MissionEventKind =
  | "kill" | "rescue" | "drag" | "downed" | "died" | "near-death" | "refusal" | "acted-afraid"
  | "flanked" | "suicide-order" | "lunge" | "evac" | "terrified" | "habit";

export interface MissionEvent {
  kind: MissionEventKind;
  turn: number;
  actor: string;
  target?: string;
  note?: string;
}

export interface MissionResult {
  missionId: string;
  outcome: "victory" | "evacuated" | "wiped";
  deployed: string[];
  slots: Record<string, number>; // soldier id -> deployment slot index
  events: MissionEvent[];
  adjacency: Record<string, number>; // "a|b" -> turns ended adjacent
  damageTaken: Record<string, number>;
  finalHp: Record<string, number>;
  deadIds: string[];
  willGains: Record<string, number>;
  kills: Record<string, number>;
  turns: number;
}

// ---------- campaign ----------

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  useLLM: boolean;
  analyst: boolean; // debug overlay: show relationship numbers
}

export interface RefusalReview { soldierId: string; missionId: string }

export type Phase = "command" | "deploy" | "combat" | "debrief" | "night";

export interface CampaignState {
  version: 1;
  seed: number;
  day: number;
  act: 1 | 2 | 3 | 4 | 5;
  funds: number;
  haldenContract: boolean;
  dataSharing: boolean;
  monolithTraining: number;
  regionPanic: Record<string, number>;
  history: DoctrineProfile[];
  soldiers: Record<string, Soldier>;
  edges: Record<string, Relationship>; // key "from|to"
  bunks: string[][];                    // pods of bunk ids
  missions: MissionSpec[];              // upcoming
  pastMissions: { spec: MissionSpec; result: MissionResult }[];
  nightLog: NightReport[];
  memorial: { id: string; name: string; day: number; mission: string }[];
  refusalReviews: RefusalReview[];
  recentBunkChanges: { day: number; a: string; b: string }[];
  rngState: number;
}
