/**
 * WEFT — world-loom engine types.
 * The world model: a social fabric that reacts, remembers, and moves offscreen.
 */

export interface DifficultyProfile {
  lethality: "low" | "medium" | "high";
  friction_density: "sparse" | "balanced" | "dense";
  antagonist_aggression: "slow_burn" | "active" | "hostile";
  protagonist_competence: "soft" | "average" | "hardened";
}

export interface ModelSettings {
  narrator_model: string;
  simulator_model: string;
  forge_model: string;
  fallback_model: string;
  image_model: string;            // model used for portraits & scene illustrations
  context_memories_k: number;     // top-k memories per present NPC
  reflection_cadence: number;     // turns between reflection compactions
  history_window: number;         // raw recent turns kept verbatim in context
  lean_mode?: boolean;            // compressed system prompts + present/tracked-only cast (lower tokens, slightly less rich)
  token_budget?: number;          // when set (>0), trim the per-turn context to roughly this many input tokens, shedding least-relevant first
  tension?: number;               // 0–10 master dial for how much the world throws at you. 0 = the engine originates NOTHING new (no new threads/consequences/clocks/drives); the world only responds to what you do. Higher = more friction, faster escalation. Default 5.
  max_central_characters?: number; // cap on CENTRAL (full-fidelity, tracked) characters. Default 6. Beyond this, new characters become "non-central" — minimal-footprint background figures (environment-like) with simple handling, unless promoted. Tunable.
  context_mode?: "digest" | "chatlog"; // chatlog = append-only conversation context (I-frame anchor + per-turn deltas) so providers cache nearly the whole input; digest = classic rebuilt-each-turn context
  iframe_cadence?: number;        // chatlog mode: turns between full state re-anchors (default 6)
  route_by_price?: boolean;       // OpenRouter provider sort: price — route each call to the cheapest healthy provider
  daily_budget_usd?: number;      // cost governor: soft daily budget; past 70% the engine auto-runs eco (lean + tight context)
  chapter_cadence?: number;       // auto-chapter every N turns (0 = off, default 25) — one cheap call, shown in Chronicle + one line each in context
  paging?: boolean;               // MemGPT-style paging: cold central characters' identity cards page out of the prefix to one-line stubs until they matter again
}

/** An auto-generated chapter of the story — one cheap summarization call every chapter_cadence
 *  turns. Lets the verbatim history window stay small without losing arc awareness. */
export interface Chapter {
  idx: number;
  from_turn: number;
  to_turn: number;
  title: string;
  summary: string;
  on_contract?: boolean;      // did this chapter honor the standing direction (story contract)?
  drift?: string;             // one-line description of the drift, when off contract
}

export interface WorldBible {
  name: string;
  era: string;
  art_direction?: string;       // visual style for portraits & scenes ("muted painterly chiaroscuro", "90s anime cel", "gritty photoreal")
  technology_level: string;
  magic_rules: string;
  forbidden: string;
  what_people_fear: string;
  cultures_and_languages: string;
  climate_and_geography: string;
  calendar_and_currency: string;
  political_situation: string;
  narrator_direction?: string;
  god_mode?: boolean;          // the player is sovereign: powers succeed completely, cost nothing; world still reacts
  era_theme?: string; // ui palette: auto | ember | verdigris | rust | frost
  difficulty_profile: DifficultyProfile;
  pressure_palette?: string[];        // allowed pressure sources, genre-bound
  forbidden_as_primary?: string[];    // never the primary engine of a scene
}

// ───────────────────────────── social fabric ─────────────────────────────

/** Directed edge a→b. Axes in [-100, 100]. */
export interface SocialEdge {
  from: string;
  to: string;
  warmth: number;   // affection ↔ hostility
  trust: number;    // reliance ↔ suspicion
  power: number;    // a's perceived standing over b (deference if negative)
  roles?: string[]; // labeled relationship(s) A holds toward B — can be multiple at once ("boss", "girlfriend"); structured facts, not just temperature
  notes: string;    // qualitative texture ("owes him for the winter", "old rivals")
  updated_turn: number;
}

/** A unit of information moving through the social graph at zero token cost. */
export interface Rumor {
  id: string;
  content: string;
  truth: "true" | "distorted" | "false";
  salience: number;          // 1–10, drives spread probability
  origin_char: string;
  knowers: string[];         // char_ids who currently hold it
  born_turn: number;
  about_char?: string;
  dead?: boolean;            // fully diffused or decayed out
}

export interface FactionClock {
  id: string;
  faction: string;
  objective: string;
  segments: number;          // total
  filled: number;            // progress
  consequence: string;       // what fires at completion
  visible_signs: string[];   // what leaks into scenes as it advances
  status: "running" | "fired" | "stalled";
}

export interface Norm {
  id: string;
  rule: string;              // "no open flame after the horn sounds"
  enforcement: "gossip" | "shunning" | "fine" | "violence" | "exile";
  holders: string;           // who cares ("the dock elders", "everyone")
}

// ───────────────────────────── characters ─────────────────────────────

export interface NPCDrive {
  goal: string;
  progress: number;          // 0–100
  blocker?: string;
  priority?: number;         // higher = more important; ties broken by progress. default 1
  updated_turn: number;
}

export interface Identity {
  character_id: string;
  paged?: boolean;            // MemGPT-style: identity card paged out of the cached prefix (cold character); rehydrates on presence/mention
  name: string;
  age: number;
  pronouns?: string;          // "she/her", "he/him", "they/them" — pinned so the narrator never has to guess gender
  appearance_facts: string;    // BEDROCK look — face, eyes, hair, build, skin. Set at creation, appended-to only by permanent bodily events, replaced only by the player. The engine must never overwrite this.
  appearance_now?: string;     // CURRENT presentation — clothes, grime, visible state. Freely rewritten by the simulator each time it changes.
  background: string;         // BEDROCK: the original forge identity — who they fundamentally are. Never trimmed or rewritten by the engine.
  life_history?: string;      // ACCRETED: defining moments that have happened in play, folded in over time. Compressed when it grows long; bedrock is never touched.
  core_traits: string[];
  values: string[];
  speech_pattern: string;
  texture?: string[];         // a few standing interests/quirks/sensitivities — small enduring things that make them a person between plot beats ("loves trees on a quiet walk", "always cold", "knows too much about rocks"). Surfaced sparingly, never made central.
  skills: Record<string, string>;
  intelligence: "low" | "below-average" | "average" | "sharp" | "brilliant";
  gregariousness: number;    // 0–1, drives rumor spread + social initiative
  current_goal?: string;
  current_activity?: string;
  drive?: NPCDrive;           // the ACTIVE pursuit
  drive_queue?: NPCDrive[];   // up to 2 backup goals; promoted when the active one stalls/completes and the scene is calm
  tracked?: boolean;          // followed in the long game: keeps regenerating drives, persists offscreen
  central?: boolean;          // a CENTRAL character: full fidelity (memory, traits, drives, portrait, theory-of-mind). When false, the character is "non-central" — a background/environment figure with minimal token footprint and simple handling. The cap (max_central_characters, default 6) governs how many can be central at once; overflow registers as non-central until promoted.
  status?: "active" | "dead" | "departed"; // dead = killed/gone for good; departed = left the story (moved away, exiled). active is default.
  exit_turn?: number;         // when they died/left
  exit_note?: string;         // how they exited ("killed by the blast", "fled the city")
  location?: string;          // place id (or free name) where this character currently is
  portrait_url?: string;
}

export interface AcquiredTrait {
  id: string;
  label: string;
  origin: string;
  behavioral_impact: string;
  intensity: number;          // 1–10
  self_weight: number;        // identity integration, grows with reinforcement
  last_reinforced_turn: number;
  reinforcement_count: number;
}

export interface Injury {
  id: string;
  type: string;
  cause: string;
  permanent: boolean;
  functional_impact: string;
}

export interface Psyche {
  relaxation: number;          // -10 (clenched) .. +10 (open); player never gets this rendered as numbers
  capacity: number;            // resting point relaxation drifts toward
  recovery: number;            // 0.01–0.45 drift rate per turn
  state: "intact" | "fracturing" | "broken" | "shattered";
  break_mode: "dissociative" | "fawning" | "mirror" | "fractured" | null;
  consecutive_clenched: number;
  mood: string;                // one-word weather
  mood_valence: number;        // -10..10 derived
  active_states: string[];     // "grief", "infatuated"
}

export interface Condition {
  injuries: Injury[];
  conditions: string[];
  condition_age?: Record<string, number>; // turn each condition was added — fuels deterministic decay
  fatigue: "fresh" | "tired" | "exhausted";
  hunger: "fed" | "peckish" | "hungry" | "starving";
  inventory: { id: string; name: string; notes?: string }[];
  wearing: string[];
  psyche: Psyche;
}

// ───────────────────────────── memory (Park et al.) ─────────────────────────────

export interface EpisodicMemory {
  turn: number;
  content: string;             // the current (possibly degraded) recollection — rewritten as it fades
  full_content?: string;       // the original vivid recollection, kept once so degradation has a source
  importance: number;          // 1–10 (poignancy) — high importance decays slower
  emotional_charge: string;
  when_label?: string;         // in-world time it happened ("Day 5, 18:30") — gives memories real temporal distance
  where?: string;              // place name where it happened — drops out as the memory fades (reconstructable from neighbors)
  decay_stage?: 0 | 1 | 2 | 3; // 0 vivid (somatic detail) → 1 gist+person+place → 2 gist+person (place lost) → 3 person+bare gist
  scheduled_time?: string;     // commitments: "Day 3, 19:00"
  commitment_status?: "pending" | "fulfilled" | "missed" | "cancelled";
  folded?: boolean;            // a high-salience memory already folded into the character's background (identity consolidation)
  last_accessed_turn: number;
}

export interface Belief {
  content: string;             // reflection output: compressed conviction
  evidence_turns: number[];
  formed_turn: number;
  confidence: number;          // 0–1
}

/** A durable declarative fact this character knows (semantic memory, split from episodic).
 *  Verbatim-anchored at write time, never decayed, never paraphrased by a model again.
 *  This is where "the player is from Seattle" lives — immune to bookkeeper drift. */
export interface DurableFact {
  content: string;             // the fact, as verified against the turn's source text
  turn: number;
  quote?: string;              // the verbatim source span that grounded it
}

export interface CharMemory {
  character_id: string;
  core: string[];              // immutable autobiography
  episodic: EpisodicMemory[];
  beliefs: Belief[];           // semantic layer from reflection
  facts?: DurableFact[];       // verified declarative knowledge — the fact ledger
  knows: string[];             // char_ids known
}

// ───────────────────────────── theory of mind (active-inference belief layer) ─────────────────────────────

/** What character A privately believes about character B — a model that can be WRONG.
 *  Behavior is driven off this model, not ground truth; the GAP between prediction and
 *  what actually happens (prediction error) is the dramatic resource: it feeds the cusp
 *  load term, surfaces to the narrator, and biases idle drives toward finding out. */
export interface BeliefAbout {
  target: string;              // char_id this is a model OF (often "char_player")
  predicted_warmth: number;    // what A expects B feels toward A, [-100,100] — may diverge from the true edge
  predicted_stance: "ally" | "rival" | "unknown"; // A's read of where B stands
  held_false?: string;         // ONE concrete thing A wrongly believes about B ("thinks I betrayed them") — the misunderstanding that can drive a scene
  surprise: number;            // 0..1 running prediction-error magnitude; decays in calm, spikes on violated expectation
  confidence: number;          // 0..1 how sure A is of this model; low confidence + high stakes → epistemic drive
  updated_turn: number;
}

/** A's whole theory of mind: sparse — only the people A actually models (player + sharpest tie). */
export interface MindModel {
  character_id: string;        // the BELIEVER
  about: BeliefAbout[];
}

// ───────────────────────────── world ─────────────────────────────

export interface Thread {
  id: string;
  title: string;
  status: "active" | "resolved" | "abandoned";
  description: string;
  turn_started: number;
  turn_resolved?: number;
  tension: number;             // 0–10 how due it is; pressure controller reads this
}

export interface ConsequenceEvent {
  id: string;
  description: string;
  fire_turn: number;          // earliest turn it may fire (kept as a floor)
  fire_time?: string;         // in-world time it should fire ("Day 5, 14:00") — the real schedule
  location_trigger?: string;
  severity: "minor" | "notable" | "major";
  source_char?: string;
  status: "pending" | "fired" | "cancelled";
}

export interface Place {
  id: string;
  name: string;
  description_facts: string;
  contains: string[];
}

/** The convergence/phase system. A phase shapes the tension curve toward (or around) an event,
 *  and can auto-advance into a next phase when its linked consequence fires (e.g. build-up → the war).
 *  Fully generic: "label"/"next_label" are whatever the story is about; the engine only reads the mode. */
export interface FocusPhase {
  label: string;                       // what we're converging on / in ("prepare for war", "the siege")
  mode: "build" | "active";            // build = suppress new chaos, carry toward the event; active = high-tension default, let it rip within the event
  linked_consequence_id?: string;      // when this scheduled event fires, the phase advances
  next_label?: string;                 // the phase to become when it fires ("fighting the war")
  next_mode?: "build" | "active";      // its mode (usually "active")
}

export interface WorldState {
  canon: string[];             // world-altering facts EVERYONE knows, forever — never pruned, always in context
  current_turn: number;
  current_time: string;        // "Day 2, 14:30"
  weather: string;
  player_location: string;
  money: string;               // freeform ("14 chits", "3 silver 20 copper")
  present: string[];           // NPC ids in scene
  places: Record<string, Place>;
  threads: Thread[];
  consequences: ConsequenceEvent[];
  clocks: FactionClock[];
  norms: Norm[];
  rumors: Rumor[];
  edges: SocialEdge[];
  focus?: FocusPhase | null;    // the convergence/phase system: shapes the tension curve toward an event, then auto-advances when it fires
}

// ───────────────────────────── telemetry & history ─────────────────────────────

export interface TurnTelemetry {
  turn: number;
  pressure: number;
  pressure_source: string;
  narrator_tokens_in: number;
  cached_tokens?: number;      // input tokens served from prompt cache (billed ~0.25x) — measures cache effectiveness
  turn_cost?: number;          // actual $ cost of this turn from the provider, when reported
  narrator_tokens_out: number;
  simulator_tokens_in: number;
  simulator_tokens_out: number;
  reflection_tokens: number;
  duration_ms: number;
  ts?: number;                 // wall-clock ms — fuels the daily cost governor
  word_count: number;
  player_mood_valence: number;
  present: string[];
  time_label: string;
  edge_snapshot: { pair: string; warmth: number; trust: number }[]; // player edges
  lyapunov?: number;           // λ̂ of the social map this turn
  coherence?: number;          // Kuramoto order parameter R
  regime?: "damped" | "critical" | "cascading";
  early_warning?: boolean;
}

export type ActionMode = "do" | "say" | "think" | "story";

/** The four QRE stances an agent can play in the strategy layer. Canonical home here so
 *  both the undertow (which computes them) and the mind layer (which reads them) can import. */
export type Stance = "press" | "maneuver" | "hold" | "yield";

export interface TurnHistoryEntry {
  turn: number;
  kind?: "turn" | "interlude" | "opening";   // opening = the scene you start in (editable, pre turn-1)
  span_label?: string;           // "three days pass"
  player_action: string;
  action_mode?: ActionMode;
  shifts?: string[];           // humanized per-turn deltas ("Ettel will remember that")
  directive?: string;          // the exact direction the narrator received — nothing hidden
  illustration_url?: string;
  narrator_prose: string;
  summary: string;             // simulator one-liner, used for context
  offscreen: string[];         // world-motion log lines
  weather?: string;
  time_label: string;
}

export interface SaveState {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  world_bible: WorldBible;
  model_settings: ModelSettings;
  world: WorldState;
  characters: Record<string, Identity>;
  traits: Record<string, AcquiredTrait[]>;
  condition: Record<string, Condition>;
  memory: Record<string, CharMemory>;
  minds?: Record<string, MindModel>;   // theory-of-mind: per-character private models of others (active-inference belief layer)
  history: TurnHistoryEntry[];
  vessel_history?: { turn: number; from_name: string; to_name: string; time_label: string }[]; // bodies the player has worn
  undertow?: unknown;          // continuous substrate state (phases, tangent, cusps) — engine-internal
  telemetry: TurnTelemetry[];
  pressure_trace: number[];    // controller history
  records: { id: string; type: string; title: string; contents: string; location: string }[];
  chapters?: Chapter[];        // auto-generated story chapters (see Chapter)
  context_anchor?: { turn: number; digest: string; cast_sig: string }; // chatlog mode I-frame: the full state snapshot the conversation is anchored to
  contract_drift?: string | null; // CONTRACT GOVERNOR: set when the chapter check finds the story drifting from the standing direction; injects a course-correction directive until the next check passes
  snapshots: { turn: number; blob: string; z?: boolean }[]; // rollback ring, max 7; z = gzip+base64 compressed
}

// ───────────────────────────── simulator contract ─────────────────────────────

export interface SimulatorDiff {
  scene_summary: string;
  elapsed_minutes: number;
  weather?: string;
  player_location?: string;       // a place id, OR a free-text place name (auto-created if new) — where the PLAYER now is
  locations?: { char_id: string; place: string }[]; // move characters between places; place is an id or a name (auto-created). Use when anyone moves, is teleported, arrives, or leaves.
  money?: string;
  present?: string[];             // optional hint; the engine derives the real scene from co-location with the player
  facts: { char_id: string; field: "fatigue" | "hunger" | "condition_add" | "condition_remove" | "inventory_add" | "inventory_remove" | "wearing_add" | "wearing_remove" | "injury" | "injury_remove"; value: string }[];
  psyche: { char_id: string; relaxation_delta: number; mood: string; states_add?: string[]; states_remove?: string[] }[];
  edges: { from: string; to: string; warmth_delta: number; trust_delta: number; power_delta: number; note?: string; roles_set?: string[] }[];
  memories: { char_id: string; content: string; importance: number; emotional_charge: string; scheduled_time?: string; anchor?: string }[];
  facts_learned?: { char_id: string; fact: string; quote?: string }[]; // durable declarative facts, verbatim-quoted — verified by the engine before storage
  traits: { char_id: string; label: string; origin: string; behavioral_impact: string; intensity: number }[];
  canon_add?: string[];        // world-altering public facts: new faiths, regime changes, public miracles, wars — broadcast to every mind
  track?: string[];            // promote these characters to the long game (they matter to a thread now)
  appearance: { char_id: string; value: string; permanent?: boolean }[]; // default: replaces appearance_now (presentation). permanent:true = ONE sentence APPENDED to the bedrock appearance_facts; bedrock is never replaced by the engine
  drives_update: { char_id: string; goal: string; progress?: number; blocker?: string; priority?: number }[]; // new or revised offscreen want
  threads_update: { id?: string; title: string; status: "active" | "resolved"; description?: string; tension?: number }[];
  character_exits?: { char_id: string; kind: "dead" | "departed"; note?: string }[]; // someone died or left the story for good
  texture_add?: { char_id: string; item: string }[]; // a small standing interest/quirk the story has earned (e.g. "has taken to fishing")
  rumors_new: { content: string; truth: "true" | "distorted" | "false"; salience: number; origin_char: string; about_char?: string }[];
  consequences_new: { description: string; fire_in_turns?: number; fire_in_days?: number; fire_in_hours?: number; severity: "minor" | "notable" | "major"; source_char?: string; location_trigger?: string }[];
  clocks_advance: { id: string; segments: number }[];
  new_characters: { name: string; age: number; appearance_facts: string; background: string; core_traits: string[]; speech_pattern: string; gregariousness: number }[];
  new_places: { name: string; description_facts: string }[];
  offscreen: string[];          // world-motion lines (the merged world tick)
}

export const DEFAULT_MODELS: ModelSettings = {
  narrator_model: "deepseek/deepseek-v4-pro",
  simulator_model: "google/gemini-3.1-flash-lite",
  forge_model: "anthropic/claude-opus-4.8",
  fallback_model: "google/gemini-3.1-flash-lite",
  image_model: "google/gemini-2.5-flash-image",
  context_memories_k: 6,
  reflection_cadence: 10,
  history_window: 5,
  lean_mode: false,
  token_budget: 0,
  tension: 5,
};
