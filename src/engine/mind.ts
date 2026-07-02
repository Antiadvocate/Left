/**
 * THEORY OF MIND — the active-inference belief layer.
 *
 * The engine was, until now, OMNISCIENT: every character's true state sat in the
 * prompt, so no one could be wrong about anyone. The position papers on LLM social
 * simulation are blunt that this is exactly the regime where models look deceptively
 * good and believability quietly dies — real social life runs on information
 * asymmetry. This layer fixes that. Each tracked character holds a PRIVATE model of
 * the people who matter to them (the player, and their sharpest tie). The model can
 * diverge from ground truth, and the GAP is the point.
 *
 * Active inference, stripped of the math: an agent acts to (a) get what it wants and
 * (b) reduce its own uncertainty. Surprise — the error between what it predicted and
 * what actually happened — is the master signal. Here:
 *
 *   • predicted_warmth / predicted_stance = the agent's generative model of the other.
 *   • each turn we compare the model to what the diff ACTUALLY did (the edge moves,
 *     the stance the QRE layer sampled) and compute prediction error.
 *   • error magnitude → `surprise`, which (1) feeds the cusp load term `a` in the
 *     undertow (surprise IS the body bracing against an unpredictable world — the
 *     clench model and the cognition model turn out to be the same thing measured
 *     twice), (2) surfaces as a narrator-renderable shift ("she didn't expect that
 *     from you"), and (3) when uncertainty about someone important is high, biases
 *     the drive system toward an EPISTEMIC goal — go find out — which the existing
 *     QRE stance layer then executes.
 *   • the model then UPDATES toward what it observed (precision-weighted: confident
 *     models move less, surprised models move more — Bayesian-flavored, deterministic).
 *
 * All zero-token. A few scalars per tracked character, updated like the rest of the
 * undertow. The `held_false` belief — one concrete thing the agent is WRONG about —
 * is the only string, and it's the dramatic seed the narrator can spend.
 */
import type { SaveState, BeliefAbout, MindModel, Stance } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Who does character A model? The player (always, if A has ever met them) plus A's
 *  single sharpest tie (largest |warmth|+|trust| edge to a present/tracked other).
 *  Kept sparse on purpose — a theory of mind about everyone is neither realistic nor cheap. */
function modeledTargets(state: SaveState, id: string): string[] {
  const targets = new Set<string>();
  // the player, if there's any relationship at all (they've interacted)
  const pe = state.world.edges.find((e) => e.from === id && e.to === "char_player");
  if (pe) targets.add("char_player");
  // sharpest non-player tie
  let best: string | null = null, bestMag = 12; // threshold: must be a real tie
  for (const e of state.world.edges) {
    if (e.from !== id || e.to === "char_player" || e.to === id) continue;
    if (!state.characters[e.to] || state.characters[e.to].status === "dead" || state.characters[e.to].status === "departed") continue;
    const mag = Math.abs(e.warmth) + Math.abs(e.trust);
    if (mag > bestMag) { bestMag = mag; best = e.to; }
  }
  if (best) targets.add(best);
  return [...targets];
}

function blankBelief(target: string, turn: number, trueWarmth: number): BeliefAbout {
  return {
    target,
    // first read is a noisy, attenuated version of the truth — people start with a rough guess
    predicted_warmth: clamp(Math.round(trueWarmth * 0.5), -100, 100),
    predicted_stance: trueWarmth > 20 ? "ally" : trueWarmth < -20 ? "rival" : "unknown",
    surprise: 0,
    confidence: 0.3,
    updated_turn: turn,
  };
}

const stanceWarmthHint: Record<Stance, number> = { press: -8, maneuver: -3, hold: 0, yield: 6 };

/**
 * Update one believer's whole theory of mind against ground truth this turn.
 * Returns humanized surprise lines (for shifts) and the peak surprise scalar (for the cusp).
 */
export function updateMind(
  state: SaveState,
  id: string,
  observedStances: Record<string, Stance>, // char_id -> the stance the QRE layer sampled for them this turn
  turn: number,
  dispersion = 0, // 0..1 from the undertow: how hard the cast is pulling apart — erodes settled confidence
): { lines: string[]; peakSurprise: number; epistemicTarget: string | null } {
  const minds: Record<string, MindModel> = (state.minds ??= {});
  const model = (minds[id] ??= { character_id: id, about: [] });
  const targets = modeledTargets(state, id);

  // prune models of people no longer relevant
  model.about = model.about.filter((b) => targets.includes(b.target));

  const lines: string[] = [];
  let peakSurprise = 0;
  let epistemicTarget: string | null = null;
  let epistemicGap = 0;

  for (const target of targets) {
    const trueEdge = state.world.edges.find((e) => e.to === target && e.from === id);
    const trueWarmth = trueEdge?.warmth ?? 0;
    let b = model.about.find((x) => x.target === target);
    if (!b) { b = blankBelief(target, turn, trueWarmth); model.about.push(b); continue; } // first sighting: no surprise yet

    // ── PREDICTION ERROR ──
    // warmth error: how far the agent's model was from the truth, normalized to 0..1
    const warmthErr = Math.abs(trueWarmth - b.predicted_warmth) / 200;
    // stance error: did the target act against the agent's read? (the target's stance vs THIS agent, if any)
    const targetStance = observedStances[target];
    let stanceErr = 0;
    if (targetStance) {
      const expected = b.predicted_stance === "ally" ? 6 : b.predicted_stance === "rival" ? -6 : 0;
      stanceErr = Math.abs(stanceWarmthHint[targetStance] - expected) / 14;
    }
    const err = clamp(warmthErr * 0.7 + stanceErr * 0.3, 0, 1);

    // precision-weighting: a confident model is more surprised by the same error (it expected to be right)
    const weightedErr = clamp(err * (0.6 + b.confidence * 0.8), 0, 1);
    // surprise is a leaky accumulator — decays in calm, spikes on violation
    b.surprise = clamp(b.surprise * 0.55 + weightedErr, 0, 1);
    peakSurprise = Math.max(peakSurprise, b.surprise);

    // a genuinely violated expectation is a beat the narrator can render
    if (weightedErr > 0.28 && trueEdge) {
      const tname = target === "char_player" ? "the player" : state.characters[target]?.name ?? "them";
      const sname = state.characters[id]?.name ?? id;
      if (trueWarmth > b.predicted_warmth + 25) lines.push(`${sname} is recalibrating: ${tname} is warmer than they'd assumed.`);
      else if (trueWarmth < b.predicted_warmth - 25) lines.push(`${sname} feels a read curdle — ${tname} is colder than they thought.`);
      else lines.push(`${sname} didn't expect that from ${tname}.`);
    }

    // ── EPISTEMIC PULL ── low confidence about someone who matters → a want to FIND OUT
    const stakes = Math.abs(trueWarmth) + (target === "char_player" ? 30 : 0);
    const gap = (1 - b.confidence) * (stakes / 130);
    if (gap > epistemicGap) { epistemicGap = gap; if (gap > 0.4) epistemicTarget = target; }

    // ── BELIEF UPDATE ── move the model toward what was observed; surprised models move more,
    //    confident models resist (Bayesian precision). Confidence rises when predictions land, falls on shock.
    const lr = clamp(0.25 + b.surprise * 0.5, 0, 0.85);
    b.predicted_warmth = clamp(Math.round(b.predicted_warmth + (trueWarmth - b.predicted_warmth) * lr), -100, 100);
    b.predicted_stance = b.predicted_warmth > 20 ? "ally" : b.predicted_warmth < -20 ? "rival" : "unknown";
    // confidence rises when predictions land, falls on shock — but the GAIN is capped low when the
    // cast is fracturing: under social pressure you don't get to feel certain about people just
    // because they were briefly legible. Dispersion both caps the gain and erodes the stock.
    const confGain = (0.12 - weightedErr * 0.45) * (1 - dispersion * 0.7);
    b.confidence = clamp(b.confidence + confGain, 0.05, 0.98);
    // DISPERSION erodes settled certainty: a cast that's pulling apart stops reading each other
    // perfectly. This is what breaks the omniscient-chorus fixed point — confidence can no longer
    // ratchet to 0.98 and stay there. Strongest on the most certain models; scales with diversification.
    b.confidence = clamp(b.confidence - dispersion * 0.22 * b.confidence, 0.05, 0.98);
    b.updated_turn = turn;

    // a large, sustained warmth gap that the agent keeps NOT resolving crystallizes into a
    // concrete false belief — the misunderstanding that can drive a scene. cleared when the gap closes.
    if (b.surprise > 0.6 && Math.abs(trueWarmth - b.predicted_warmth) > 35 && !b.held_false) {
      const tname = target === "char_player" ? "the player" : state.characters[target]?.name ?? "them";
      b.held_false = trueWarmth < b.predicted_warmth
        ? `is convinced ${tname} has turned on them`
        : `can't believe ${tname} actually means them well`;
    } else if (b.held_false && Math.abs(trueWarmth - b.predicted_warmth) < 12 && b.surprise < 0.25) {
      const tname = target === "char_player" ? "the player" : state.characters[target]?.name ?? "them";
      const sname = state.characters[id]?.name ?? id;
      lines.push(`${sname} finally sees ${tname} clearly — the misread dissolves.`);
      b.held_false = undefined;
    }
  }

  return { lines, peakSurprise, epistemicTarget };
}

/** The narrator's window into a present character's HEAD: what they believe (possibly
 *  wrongly) about the player, and any misread they're carrying. This is what makes a
 *  scene play on the character's model instead of the truth. Returns "" when the model
 *  matches reality closely (no divergence worth spending words on). */
export function mindDigest(state: SaveState, id: string): string {
  const model = state.minds?.[id];
  if (!model) return "";
  const out: string[] = [];
  for (const b of model.about) {
    if (b.target !== "char_player") continue; // narrator block is player-facing; lateral models stay internal
    const trueEdge = state.world.edges.find((e) => e.to === "char_player" && e.from === id);
    const trueWarmth = trueEdge?.warmth ?? 0;
    const divergence = Math.abs(trueWarmth - b.predicted_warmth);
    // only surface the model when it MEANINGFULLY differs from truth, or there's a held misread / live surprise
    if (b.held_false) out.push(`believes (wrongly) the player ${b.held_false} — act on this misread, not the truth`);
    else if (divergence > 25) out.push(`misreads the player as ${b.predicted_stance === "unknown" ? "an unknown quantity" : b.predicted_stance === "ally" ? "warmer than they are" : "more hostile than they are"} (their read, act on it)`);
    if (b.surprise > 0.45) out.push(`is freshly thrown — the player just acted against expectation`);
    if (b.confidence < 0.25 && Math.abs(trueWarmth) > 25) out.push(`can't get a clean read on the player and it nags`);
  }
  return out.length ? `believes about you: ${out.join("; ")}` : "";
}

/** An epistemic drive goal-string: A wants to resolve uncertainty about `target`. The
 *  existing drive/QRE machinery executes it like any other want. */
export function epistemicGoal(state: SaveState, target: string): string {
  const tname = target === "char_player" ? "the player" : state.characters[target]?.name ?? "them";
  return `find out where ${tname} really stands — test them, probe, get a read`;
}
