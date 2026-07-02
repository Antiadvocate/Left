/**
 * EXTRACT — regex-first bookkeeping. Zero tokens.
 *
 * A large share of the Simulator's job is mechanical transcription of highly patterned
 * prose: movement, hand-offs, conditions subsiding, time cues. A deterministic extractor
 * catches these for free. It runs as BACKFILL: the LLM diff always wins on any key it
 * populated; heuristics only fill what the LLM missed (or everything, when the diff came
 * back unusable — turning the old "silent amnesia" turn into a "basics still recorded" turn).
 *
 * Conservatism is the design rule here: every pattern is second-person or names a known
 * character, and anything ambiguous is left for the LLM. A wrong deterministic write is
 * worse than a missing one.
 */
import type { SaveState, SimulatorDiff } from "./types";

/** Names come from the simulator and can contain anything — "(unnamed taller woman)" is real
 *  save data. Everything interpolated into a RegExp gets escaped, no exceptions. */
const escRe = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface HeuristicDiff {
  elapsed_minutes?: number;
  player_location?: string;
  locations: { char_id: string; place: string }[];
  facts: SimulatorDiff["facts"];
  memories: SimulatorDiff["memories"];
}

/** Map of lowercase first-names → char ids for the present cast (cheap named-entity resolution). */
function presentNameMap(state: SaveState): Map<string, string> {
  const m = new Map<string, string>();
  for (const id of state.world.present) {
    const n = state.characters[id]?.name;
    if (!n) continue;
    m.set(n.toLowerCase(), id);
    m.set(n.split(/\s+/)[0].toLowerCase(), id);
  }
  return m;
}

const TIME_CUES: [RegExp, number][] = [
  [/\b(the next morning|by morning|come morning)\b/i, 8 * 60],
  [/\bhours (later|pass)\b/i, 150],
  [/\ban hour (later|passes)\b/i, 60],
  [/\bby (nightfall|evening|dusk)\b/i, 5 * 60],
  [/\bby dawn\b/i, 7 * 60],
  [/\bafter a long (day|night)\b/i, 8 * 60],
];

export function extractHeuristics(state: SaveState, action: string, prose: string): HeuristicDiff {
  const out: HeuristicDiff = { locations: [], facts: [], memories: [] };
  const text = prose;
  const names = presentNameMap(state);

  // ── elapsed time (largest cue wins; the LLM's estimate still overrides)
  for (const [re, mins] of TIME_CUES) if (re.test(text)) out.elapsed_minutes = Math.max(out.elapsed_minutes ?? 0, mins);

  // ── player movement: strictly second-person arrival phrasing with a capitalized destination
  const mv = /\b[Yy]ou (?:walk|head|step|go|climb|descend|make your way|push|slip|arrive)\s+(?:back\s+)?(?:in|out|up|down)?\s*(?:in)?to\s+(?:the\s+)?([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,3})(?=[,.;:!?\s])/;
  const mvm = mv.exec(text);
  if (mvm) out.player_location = mvm[1].trim();

  // ── inventory hand-offs (player side only — the unambiguous cases)
  const takes = [...text.matchAll(/\byou (?:take|pick up|pocket|grab|accept|catch|lift|retrieve)\s+(?:the|a|an|his|her|their)\s+([\w'’ -]{3,32}?)(?=[,.;:!?])/gi)];
  for (const t of takes) out.facts!.push({ char_id: "char_player", field: "inventory_add", value: t[1].trim() });
  const gives = [...text.matchAll(/\b(?:hands?|passes|gives|tosses|offers)\s+you\s+(?:the|a|an|his|her|their)\s+([\w'’ -]{3,32}?)(?=[,.;:!?])/gi)];
  for (const g of gives) out.facts!.push({ char_id: "char_player", field: "inventory_add", value: g[1].trim() });
  const drops = [...text.matchAll(/\byou (?:drop|set down|put down|hand (?:over|back)|toss aside|discard|leave behind)\s+(?:the|a|an|your)\s+([\w'’ -]{3,32}?)(?=[,.;:!?])/gi)];
  for (const d of drops) out.facts!.push({ char_id: "char_player", field: "inventory_remove", value: d[1].trim() });

  // ── conditions subsiding: "the bleeding stops", "X catches her breath"
  if (/\b(the\s+)?bleeding (stops|slows|has stopped)\b/i.test(text)) {
    for (const id of ["char_player", ...state.world.present]) {
      const c = state.condition[id];
      if (c?.conditions.some((x) => /bleed|blood/i.test(x))) out.facts!.push({ char_id: id, field: "condition_remove", value: "bleeding" });
    }
  }
  for (const [lower, id] of names) {
    const re = new RegExp(`\\b${escRe(lower)}\\b[^.!?]{0,40}\\bcatches (his|her|their) breath\\b`, "i");
    if (re.test(text)) {
      const c = state.condition[id];
      if (c?.conditions.some((x) => /winded|breathless|out of breath/i.test(x))) out.facts!.push({ char_id: id, field: "condition_remove", value: "winded" });
    }
  }

  // ── named-character arrival/departure: "Mara enters/arrives", "Mara leaves/storms out"
  for (const [lower, id] of names) {
    if (new RegExp(`\\b${escRe(lower)}\\b[^.!?]{0,24}\\b(leaves|walks out|storms out|departs|slips away|heads out)\\b`, "i").test(text)) {
      out.locations.push({ char_id: id, place: "elsewhere nearby" });
    }
  }
  for (const [cid, c] of Object.entries(state.characters)) {
    if (cid === "char_player" || state.world.present.includes(cid) || c.status === "dead" || c.status === "departed") continue;
    const first = c.name.split(/\s+/)[0];
    if (!first || first.length < 3) continue;
    if (new RegExp(`\\b${escRe(first)}\\b[^.!?]{0,24}\\b(enters|arrives|walks in|steps in(?:to)?|appears at the door|joins you)\\b`, "i").test(text)) {
      out.locations.push({ char_id: cid, place: state.world.places[state.world.player_location]?.name ?? "here" });
    }
  }

  return out;
}

/** Merge heuristics UNDER the LLM diff: only keys/entries the model didn't already cover. */
export function backfillDiff(diff: SimulatorDiff, h: HeuristicDiff): SimulatorDiff {
  const d = { ...diff };
  if ((!d.elapsed_minutes || d.elapsed_minutes <= 0) && h.elapsed_minutes) d.elapsed_minutes = h.elapsed_minutes;
  if (!d.player_location && h.player_location) d.player_location = h.player_location;
  const movedIds = new Set((d.locations ?? []).map((l) => l.char_id));
  d.locations = [...(d.locations ?? []), ...h.locations.filter((l) => !movedIds.has(l.char_id))];
  const factKey = (f: { char_id: string; field: string; value: string }) => `${f.char_id}|${f.field}|${f.value.toLowerCase()}`;
  const seen = new Set((d.facts ?? []).map(factKey));
  d.facts = [...(d.facts ?? []), ...(h.facts ?? []).filter((f) => !seen.has(factKey(f)))];
  return d;
}
