import type { EnemyTypeId } from "../content";
import type { BarkBank, ClassId, CombatEffect, Doctrine, FearState, Loadout, MissionEvent, SoldierKind, Tier, VoiceId } from "../types";

export type TileKind = "floor" | "half" | "full" | "wall";
export type Side = "squad" | "accord";
export type WeaponId = "cannon" | "shotgun" | "smg" | "rifle" | "carbine" | "sidearm" | "e-mid" | "e-long" | "e-melee";

export interface Pt { x: number; y: number }

export interface Unit {
  id: string;
  side: Side;
  name: string;
  soldierId?: string;
  kind?: SoldierKind;
  cls?: ClassId;
  loadout?: Loadout;
  voice?: VoiceId;
  barks?: BarkBank;
  enemyType?: EnemyTypeId;
  x: number;
  y: number;
  slot: number;
  hp: number;
  maxHp: number;
  ap: number;
  aim: number;
  defense: number;
  mobility: number;
  weapon: WeaponId;
  dmg: [number, number];
  ammo: number;
  clip: number;
  overwatch: boolean;
  downed: boolean;
  bleed: number;
  stabilized: boolean;
  dead: boolean;
  evacuated: boolean;
  active: boolean; // enemies: alerted
  scamper?: boolean; // newly alerted: moves to cover instead of acting
  // humans only
  will?: number;
  commandTrust?: number;
  fear: number;
  fearState: FearState;
  willGain: number;
  terrifiedEver: boolean;
  // kit
  grenades: number;
  medkits: number;
  jams: number;
  jammed: number;
  spot?: { targetId: string; bonus: number };
  rageTurns: number;
  lungeUsed: boolean;
  shootFirstUsed: boolean;
  sharedTurn?: number; // last enemy turn this unit fired a shared-overwatch shot
  suicideFlagged: boolean;
  talents: string[];
  effects: { effect: CombatEffect; value?: string; text: string }[];
  rank: number;
  kills: number;
}

export interface LogEntry {
  turn: number;
  kind: "bark" | "info" | "hit" | "miss" | "warn" | "bond" | "habit";
  text: string;
  speaker?: string;
}

export interface PairInfo {
  tier: Tier; // mutual tier (min of both directions)
  actions: string[];
  scale: Record<string, number>; // per soldier id: how fully a human feels the bond right now (AI = 1)
}

/** Animation stream: the engine resolves instantly; the board replays these in order. */
export type Fx =
  | { k: "step"; id: string; x: number; y: number }
  | { k: "place"; id: string; x: number; y: number }
  | { k: "shot"; from: string; to: string; hit: boolean; dmg: number; crit: boolean }
  | { k: "unit"; id: string; hp: number; downed: boolean; dead: boolean; evacuated: boolean }
  | { k: "bark"; id: string; text: string }
  | { k: "float"; id: string; text: string; tone: "warn" | "bond" | "habit" | "info" }
  | { k: "blast"; x: number; y: number }
  | { k: "turn"; side: Side };

export interface CombatState {
  fx: Fx[];
  missionId: string;
  missionName: string;
  w: number;
  h: number;
  tiles: TileKind[];
  evac: Pt[];
  units: Unit[];
  turn: number;
  side: Side;
  rng: number;
  log: LogEntry[];
  events: MissionEvent[];
  adjacency: Record<string, number>;
  damageTaken: Record<string, number>;
  pairs: Record<string, PairInfo>; // key: sorted "a|b" of soldier ids
  doctrine: Doctrine;
  squadMood: number; // average command trust
  outcome?: "victory" | "evacuated" | "wiped";
  seenEnemies: string[];
  aceId?: string;
}
