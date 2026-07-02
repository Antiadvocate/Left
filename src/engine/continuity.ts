/**
 * CONTINUITY — the world does not need you.
 *
 *   simulateForward(state, days)  — pure deterministic world-advance, no tokens:
 *       drives tick (and complete), rumors cascade to saturation, psyche drifts
 *       home, traits fade, conditions heal, clocks fill and FIRE, due
 *       consequences come due. Returns a report of everything that moved.
 *
 *   runInterlude(...)             — ONE LLM call turns the report into 2–3
 *       paragraphs of world-scale passage-of-time prose + grounded memories.
 *
 *   embodyCharacter(state, id)    — the player leaves their vessel and steps
 *       into another. Full id-swap across every ledger: you inherit their
 *       memories, bonds, wounds, traits, wants. Your old self remains in the
 *       world as a person the world remembers.
 */
import type { SaveState, TurnTelemetry, Identity, CharMemory, AcquiredTrait } from "./types";
import { absMinutes, advance } from "./time";
import { consolidateBackground, consolidateTraits, decayTraits, diffuseRumors, tickDrives, tickPsyche } from "./social";
import { regenerateDrives } from "./drives";
import { addCondition } from "./turn";
import { buildMessages, complete, safeJson } from "../llm";
import { stablePrefix } from "./prompts";
import { pushSnapshot, uid } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface ForwardReport {
  days: number;
  drive_log: string[];        // progress + completions
  rumor_log: string[];        // diffusion notes
  clocks_fired: string[];     // consequences unleashed
  clocks_moved: string[];
  consequences_due: string[]; // pending things now at the door
  conditions_healed: string[];
  traits_faded: string[];
}

/** Pure, deterministic, zero tokens. One call advances the world `days` days. */
export function simulateForward(state: SaveState, days: number, rng: () => number = Math.random): ForwardReport {
  const report: ForwardReport = {
    days, drive_log: [], rumor_log: [], clocks_fired: [], clocks_moved: [],
    consequences_due: [], conditions_healed: [], traits_faded: [],
  };
  const turn = state.world.current_turn;

  // nobody stands in one room for a week — the scene disperses
  state.world.present = [];

  const rounds = Math.max(1, Math.round(days * 2)); // two world-rounds per day
  for (let r = 0; r < rounds; r++) {
    for (const id of Object.keys(state.condition)) tickPsyche(state.condition[id].psyche); // kernel drift, per character
    report.drive_log.push(...tickDrives(state, rng));
    report.drive_log.push(...regenerateDrives(state, rng)); // tracked idle NPCs get fresh wants across the days
    report.rumor_log.push(...diffuseRumors(state, rng));
  }
  // psyche valence resettles
  for (const id of Object.keys(state.condition)) {
    const ps = state.condition[id].psyche;
    ps.mood_valence = Math.round(ps.relaxation);
  }

  // bodies recover across days
  for (const [id, c] of Object.entries(state.condition)) {
    c.fatigue = "fresh"; c.hunger = "fed";
    const healed = c.conditions.filter(() => true); // all transient conditions resolve over multi-day spans
    if (days >= 2 && healed.length) {
      report.conditions_healed.push(...healed.map((h) => `${state.characters[id]?.name}: ${h}`));
      c.conditions = []; c.condition_age = {};
    }
    // non-permanent injuries close over a week+
    if (days >= 7) {
      const closed = c.injuries.filter((i) => !i.permanent);
      if (closed.length) report.conditions_healed.push(...closed.map((i) => `${state.characters[id]?.name}: ${i.type} (healed)`));
      c.injuries = c.injuries.filter((i) => i.permanent);
    }
  }

  // traits fade with disuse, and long stretches can consolidate deeply-held ones into identity
  for (const id of Object.keys(state.traits)) {
    const { kept, log } = decayTraits(state.traits[id] ?? [], turn + Math.ceil(days / 2));
    state.traits[id] = kept;
    report.traits_faded.push(...log.map((l) => `${state.characters[id]?.name}: ${l}`));
    if (state.characters[id]) {
      const { kept: ck, log: clog } = consolidateTraits(state.characters[id], state.traits[id], turn);
      state.traits[id] = ck;
      report.traits_faded.push(...clog);
      if (state.memory[id]) report.traits_faded.push(...consolidateBackground(state.characters[id], state.memory[id]));
    }
  }

  // faction clocks fill on their own schedule: one segment per ~2 days
  for (const c of state.world.clocks) {
    if (c.status !== "running") continue;
    const fill = Math.floor(days / 2) + (rng() < (days % 2) / 2 ? 1 : 0);
    if (fill > 0) {
      c.filled = clamp(c.filled + fill, 0, c.segments);
      report.clocks_moved.push(`${c.faction}: ${c.filled}/${c.segments} toward "${c.objective}"`);
      if (c.filled >= c.segments) {
        c.status = "fired";
        report.clocks_fired.push(`${c.faction} ACHIEVED IT: ${c.consequence}`);
      }
    }
  }

  // the calendar moves
  const newTime = advance(state.world.current_time, days * 24 * 60);

  // consequences whose moment arrives inside the skip come due NOW.
  // time-scheduled ones fire when the post-skip clock has reached their fire_time;
  // legacy turn-only ones fall back to the turn floor.
  for (const cq of state.world.consequences) {
    if (cq.status !== "pending") continue;
    const arrived = cq.fire_time
      ? absMinutes(newTime) >= absMinutes(cq.fire_time)
      : cq.fire_turn <= turn + 1;
    if (arrived) {
      report.consequences_due.push(cq.description);
      cq.status = "fired";
    }
  }

  state.world.current_time = newTime;
  return report;
}

const INTERLUDE_SYSTEM = `You are the Narrator writing a PASSAGE-OF-TIME interlude for a world simulation. The player stepped away; the world kept moving. You receive a deterministic report of what actually happened (drives, clocks, rumors, healing). Write from it — invent texture, never contradict it.

Output ONLY strict JSON:
{"interlude":"2-3 paragraphs of world-scale prose. Days passing, seasons of small life, the report's events landing among real people. NO player interiority — they were absent. End on the player's return: where they are as the world comes back into focus.",
"events":["3-6 one-line happenings drawn from the report, plain statements"],
"memories":[{"char_id":"","content":"what this character will remember from these days","importance":4}],
"present_on_return":["names of 0-3 characters plausibly near the player when play resumes"],
"weather":"the weather on the day of return"}`;

export async function runInterlude(state: SaveState, days: number, ev: { onPhase: (p: string) => void }): Promise<void> {
  const t0 = Date.now();
  const turn = state.world.current_turn;
  await pushSnapshot(state);

  ev.onPhase("world-turning");
  const report = simulateForward(state, days);

  ev.onPhase("interlude");
  const spanLabel = days === 1 ? "a day passes" : days < 7 ? `${days} days pass` : days === 7 ? "a week passes" : `${days} days pass`;
  const reportText = [
    `SPAN: ${spanLabel} (now ${state.world.current_time})`,
    report.drive_log.length ? `DRIVES:\n${report.drive_log.slice(0, 10).join("\n")}` : "",
    report.clocks_fired.length ? `CLOCKS FIRED (these HAPPENED):\n${report.clocks_fired.join("\n")}` : "",
    report.clocks_moved.length ? `CLOCKS MOVING:\n${report.clocks_moved.join("\n")}` : "",
    report.consequences_due.length ? `NOW AT THE DOOR:\n${report.consequences_due.join("\n")}` : "",
    report.rumor_log.length ? `TALK SPREADING:\n${report.rumor_log.slice(0, 6).join("\n")}` : "",
    report.conditions_healed.length ? `HEALED: ${report.conditions_healed.slice(0, 6).join("; ")}` : "",
  ].filter(Boolean).join("\n\n");

  let interlude = "";
  let usage = { prompt_tokens: 0, completion_tokens: 0 };
  let parsed: { interlude?: string; events?: string[]; memories?: { char_id: string; content: string; importance?: number }[]; present_on_return?: string[]; weather?: string } = {};
  try {
    const msgs = buildMessages(INTERLUDE_SYSTEM, stablePrefix(state), reportText, state.model_settings.simulator_model);
    const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 2500);
    usage = res.usage;
    parsed = safeJson(res.text, {});
    interlude = parsed.interlude ?? "";
  } catch { /* deterministic fallback below */ }
  if (!interlude) {
    const uniq = [...new Set([...report.clocks_fired, ...report.drive_log])].slice(0, 4);
    interlude = `${spanLabel[0].toUpperCase()}${spanLabel.slice(1)}. ${uniq.join(" ")}`.trim()
      || `${spanLabel[0].toUpperCase()}${spanLabel.slice(1)}. The world kept its own books.`;
  }

  // apply grounded memories
  for (const m of parsed.memories ?? []) {
    const id = state.characters[m.char_id] ? m.char_id
      : Object.entries(state.characters).find(([, c]) => c.name.toLowerCase() === String(m.char_id).toLowerCase())?.[0];
    if (!id || !m.content) continue;
    state.memory[id]?.episodic.push({
      turn, content: m.content, importance: clamp(m.importance ?? 4, 1, 10),
      emotional_charge: "", last_accessed_turn: turn,
    });
  }
  if (parsed.weather) state.world.weather = parsed.weather;
  const back = (parsed.present_on_return ?? [])
    .map((nm) => Object.entries(state.characters).find(([id, c]) => id !== "char_player" && c.name.toLowerCase() === String(nm).toLowerCase())?.[0])
    .filter((x): x is string => !!x);
  state.world.present = [...new Set(back)];

  const shifts = [
    ...report.clocks_fired.map((c) => `While you were away: ${c}`),
    ...report.consequences_due.map((c) => `Waiting for you: ${c}`),
  ].slice(0, 8);

  state.history.push({
    turn, kind: "interlude", span_label: spanLabel,
    player_action: `— ${spanLabel} —`, action_mode: "story",
    narrator_prose: interlude,
    summary: `Interlude: ${spanLabel}.`,
    shifts,
    offscreen: (parsed.events ?? report.drive_log).slice(0, 6),
    weather: state.world.weather,
    time_label: state.world.current_time,
  });

  const tel: TurnTelemetry = {
    turn, pressure: 1, pressure_source: `interlude — ${spanLabel}`,
    narrator_tokens_in: 0, narrator_tokens_out: 0,
    simulator_tokens_in: usage.prompt_tokens, simulator_tokens_out: usage.completion_tokens,
    reflection_tokens: 0, duration_ms: Date.now() - t0,
    word_count: interlude.split(/\s+/).filter(Boolean).length,
    player_mood_valence: state.condition["char_player"]?.psyche.mood_valence ?? 0,
    present: [...state.world.present], time_label: state.world.current_time,
    edge_snapshot: state.world.edges
      .filter((e) => e.to === "char_player" && state.characters[e.from])
      .map((e) => ({ pair: state.characters[e.from].name, warmth: e.warmth, trust: e.trust })),
  };
  state.telemetry.push(tel);
  state.pressure_trace.push(1);
  state.world.current_turn++;
}

/**
 * NEW-CHAPTER CONDENSATION — carry who a character BECAME into the next chapter.
 *
 * The new-chapter flow used to drop acquired traits entirely and replace each character's
 * whole memory with a single line of background. This distills the real thing: a character's
 * traits, the heaviest episodic memories, their formed beliefs, and any accreted life_history
 * are folded into (a) a compact durable BACKGROUND paragraph and (b) a small set of preserved
 * high-self-weight traits — the parts of identity that are load-bearing enough to persist a
 * time-skip. Deterministic, zero tokens; the prose recap stays the player-facing layer, this is
 * the mechanical inheritance underneath it.
 */
export function condenseForNewChapter(ident: Identity, mem: CharMemory | undefined, traits: AcquiredTrait[] | undefined): {
  carried_memory: CharMemory;      // the COMPLETE memory, carried intact — nothing dropped, nothing sanitized
  carried_traits: AcquiredTrait[]; // the COMPLETE trait list, carried intact
} {
  // A new chapter is a time-skip, not a personality wipe. Who a character BECAME — every memory,
  // every acquired trait, including the violent, the carnal, the dark, the appetites they developed
  // — is exactly what should persist. We carry the full memory and full traits forward UNCHANGED.
  // The only adjustment is resetting the trait reinforcement clock so decay measures from the new
  // chapter's start rather than instantly aging everything across the skip.
  const carried_traits = (traits ?? []).map((t) => ({ ...t, last_reinforced_turn: 1 }));
  const carried_memory: CharMemory = mem
    ? { ...mem, episodic: mem.episodic.map((m) => ({ ...m, last_accessed_turn: 1 })) }
    : { character_id: ident.character_id, core: [], episodic: [], beliefs: [], knows: [] };
  return { carried_memory, carried_traits };
}

export async function embodyCharacter(state: SaveState, targetId: string): Promise<{ ok: boolean; error?: string }> {
  if (targetId === "char_player") return { ok: false, error: "you are already wearing this one" };
  if (!state.characters[targetId]) return { ok: false, error: "no such character" };

  await pushSnapshot(state); // unravel-able, like everything else

  const turn = state.world.current_turn;
  const oldId = uid("char");
  const swap = (id: string): string =>
    id === "char_player" ? oldId : id === targetId ? "char_player" : id;

  const fromName = state.characters["char_player"].name;
  const toName = state.characters[targetId].name;

  // re-key the three per-character ledgers + identity card ids
  for (const map of [state.characters, state.condition, state.memory, state.traits] as Record<string, any>[]) {
    const a = map["char_player"], b = map[targetId];
    delete map["char_player"]; delete map[targetId];
    if (a !== undefined) map[oldId] = a;
    if (b !== undefined) map["char_player"] = b;
  }
  state.characters[oldId].character_id = oldId;
  state.characters["char_player"].character_id = "char_player";

  // the abandoned vessel becomes a full citizen: needs a social pulse + a want
  state.characters[oldId].gregariousness ??= 0.5;
  state.characters[oldId].drive ??= {
    goal: `make sense of what just happened to ${fromName}`, progress: 0, updated_turn: turn,
  };

  // every reference in the world graph
  for (const e of state.world.edges) { e.from = swap(e.from); e.to = swap(e.to); }
  // collapse any duplicate edges created by the swap (keep latest)
  const seen = new Set<string>();
  state.world.edges = state.world.edges.filter((e) => {
    const k = `${e.from}→${e.to}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  for (const r of state.world.rumors) {
    r.origin_char = swap(r.origin_char);
    if (r.about_char) r.about_char = swap(r.about_char);
    r.knowers = [...new Set(r.knowers.map(swap))];
  }
  for (const cq of state.world.consequences) if (cq.source_char) cq.source_char = swap(cq.source_char);
  // the player now inhabits the target's body → the world's player_location is wherever that body is
  state.world.player_location = state.characters["char_player"].location ?? state.world.player_location;
  // rebuild room occupancy + scene from locations
  for (const p of Object.values(state.world.places)) p.contains = [];
  for (const [id, c] of Object.entries(state.characters)) {
    if (c.location && state.world.places[c.location]) state.world.places[c.location].contains.push(id);
  }
  state.world.present = Object.entries(state.characters)
    .filter(([id, c]) => id !== "char_player" && c.location === state.world.player_location)
    .map(([id]) => id);

  // both souls keep the moment — written neutrally; the fiction is yours to define
  state.memory["char_player"]?.episodic.push({
    turn, content: `Perspective changed hands: this body now carries the chronicle. ${fromName} walks elsewhere.`,
    importance: 7, emotional_charge: "vertigo", last_accessed_turn: turn,
  });
  state.memory[oldId]?.episodic.push({
    turn, content: `Something that was looking out through these eyes has gone. The body is ${fromName}'s own again.`,
    importance: 7, emotional_charge: "unmoored", last_accessed_turn: turn,
  });

  (state.vessel_history ??= []).push({ turn, from_name: fromName, to_name: toName, time_label: state.world.current_time });
  return { ok: true };
}
