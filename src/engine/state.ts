/** Save-state lifecycle (browser): init, sanitize, snapshot ring. Persistence lives in src/store.ts. */
import type { SaveState, Identity, Condition, CharMemory, WorldBible } from "./types";
import { DEFAULT_MODELS } from "./types";

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function blankCondition(capacity = 2): Condition {
  return {
    injuries: [], conditions: [], fatigue: "fresh", hunger: "fed", inventory: [], wearing: [],
    psyche: { relaxation: capacity, capacity, recovery: 0.18, state: "intact", break_mode: null, consecutive_clenched: 0, mood: "even", mood_valence: capacity, active_states: [] },
  };
}

export function blankMemory(id: string): CharMemory {
  return { character_id: id, core: [], episodic: [], beliefs: [], facts: [], knows: [] };
}

export function registerCharacter(state: SaveState, ident: Partial<Identity> & { name: string }): string {
  const id = ident.character_id ?? uid("char");
  state.characters[id] = {
    character_id: id, name: ident.name, age: ident.age ?? 30,
    appearance_facts: ident.appearance_facts ?? "", background: ident.background ?? "",
    core_traits: ident.core_traits ?? [], values: ident.values ?? [],
    speech_pattern: ident.speech_pattern ?? "plain", skills: ident.skills ?? {},
    texture: ident.texture ?? [],
    pronouns: ident.pronouns,
    intelligence: ident.intelligence ?? "average",
    gregariousness: ident.gregariousness ?? 0.5,
    current_goal: ident.current_goal, current_activity: ident.current_activity,
    drive: ident.drive, drive_queue: ident.drive_queue,
    tracked: ident.tracked, status: ident.status, location: ident.location, portrait_url: ident.portrait_url,
  };
  state.condition[id] = blankCondition((ident as any).capacity ?? 2);
  state.traits[id] = [];
  state.memory[id] = blankMemory(id);
  return id;
}

export function newSave(name: string, bible: WorldBible): SaveState {
  const now = new Date().toISOString();
  return {
    id: uid("save"), name, created_at: now, updated_at: now,
    world_bible: bible,
    model_settings: { ...DEFAULT_MODELS },
    world: {
      current_turn: 1, current_time: "Day 1, 09:00 (Morning)", weather: "",
      player_location: "", money: "", present: [], places: {}, canon: [],
      threads: [], consequences: [], clocks: [], norms: [], rumors: [], edges: [],
    },
    characters: {}, traits: {}, condition: {}, memory: {}, minds: {},
    history: [], telemetry: [], pressure_trace: [], records: [], snapshots: [],
  };
}

/** Snapshot ring for rollback (plain JSON; IndexedDB handles the size). Origin (turn 1) is pinned forever.
 *  Image data URLs are stripped from snapshots — a rollback point doesn't need the portrait/scene bytes,
 *  and keeping them would multiply megabytes across the ring (the old 17 MB-save culprit). */
export function pushSnapshot(state: SaveState): void {
  if (state.snapshots.some((s) => s.turn === state.world.current_turn)) return;
  const { snapshots, ...rest } = state;
  const lean = JSON.parse(JSON.stringify(rest)) as Omit<SaveState, "snapshots">;
  for (const c of Object.values(lean.characters)) if (c.portrait_url?.startsWith("data:")) delete c.portrait_url;
  for (const h of lean.history) if ((h as any).illustration_url?.startsWith?.("data:")) delete (h as any).illustration_url;
  const blob = JSON.stringify(lean);
  state.snapshots.push({ turn: state.world.current_turn, blob });
  while (state.snapshots.length > 7) state.snapshots.splice(1, 1);
}

export function rollback(state: SaveState, toTurn: number): SaveState | null {
  const snap = [...state.snapshots].reverse().find((s) => s.turn <= toTurn);
  if (!snap) return null;
  const restored = JSON.parse(snap.blob) as SaveState;
  restored.snapshots = state.snapshots.filter((s) => s.turn < snap.turn);
  return restored;
}

export function sanitize(state: SaveState): SaveState {
  state.model_settings = { ...DEFAULT_MODELS, ...state.model_settings };
  state.world.rumors ??= []; state.world.edges ??= []; state.world.clocks ??= [];
  state.world.norms ??= []; state.world.threads ??= []; state.world.consequences ??= []; state.world.canon ??= [];
  state.world.focus ??= null;
  for (const c of Object.values(state.condition ?? {})) (c as any).condition_age ??= {};
  state.telemetry ??= []; state.pressure_trace ??= []; state.snapshots ??= []; state.records ??= [];
  state.minds ??= {};
  for (const id of Object.keys(state.characters)) {
    state.condition[id] ??= blankCondition();
    state.traits[id] ??= [];
    state.memory[id] ??= blankMemory(id);
    state.memory[id].facts ??= [];   // fact-ledger backfill for older saves
    state.condition[id].psyche ??= blankCondition().psyche;
  }
  // backfill the location model for saves made before it existed
  const placeIds = Object.keys(state.world.places);
  if (!state.world.player_location && placeIds.length) state.world.player_location = placeIds[0];
  if (state.characters["char_player"] && !state.characters["char_player"].location) {
    state.characters["char_player"].location = state.world.player_location;
  }
  const anyMissing = Object.entries(state.characters).some(([id, c]) => id !== "char_player" && !c.location);
  if (anyMissing) {
    const wasPresent = new Set(state.world.present ?? []);
    const others = placeIds.filter((p) => p !== state.world.player_location);
    let scatter = 0;
    for (const [id, c] of Object.entries(state.characters)) {
      if (id === "char_player" || c.location) continue;
      c.location = wasPresent.has(id)
        ? state.world.player_location
        : (others.length ? others[scatter++ % others.length] : state.world.player_location);
    }
  }
  // recompute room occupancy + scene from the source of truth
  if (placeIds.length && state.characters["char_player"]) {
    for (const p of Object.values(state.world.places)) p.contains = [];
    for (const [id, c] of Object.entries(state.characters)) {
      if (c.location && state.world.places[c.location]) state.world.places[c.location].contains.push(id);
    }
    state.world.present = Object.entries(state.characters)
      .filter(([id, c]) => id !== "char_player" && c.location === state.world.player_location)
      .map(([id]) => id);
  }
  return state;
}
