import { absMinutes } from "./time";
/**
 * Pressure controller — replaces the Threat Director LLM call. Zero tokens.
 *
 * Model: scene pressure P_t ∈ [0,10] drawn from a difficulty-defined target
 * mixture, corrected by a proportional controller on the rolling empirical
 * mean (so long-run distribution converges to target — verified by Monte
 * Carlo in verify/verify.ts), with hard constraints:
 *   C1 opening grace:        t ≤ 2 ⇒ P ≤ 2
 *   C2 breath rule:          mean(P_{t-2}, P_{t-1}) ≥ 7 ⇒ P ≤ 4
 *   C3 lethality ceiling:    lethality=low ⇒ P ≤ 9; medium ⇒ ≤ 10 with cause
 *   C4 earned danger:        P ≥ 8 requires max(thread tension, clock heat) ≥ 6
 *   C5 mundane default:      restful intents bias the draw down 2 bands
 *
 * The fiction-awareness the old LLM director provided is recovered from
 * state: thread tension (set by the Simulator), due consequences, and
 * faction clock heat feed an additive "fiction heat" term — so pressure is
 * still earned by the story, just computed instead of asked for.
 */
import type { DifficultyProfile, Thread, ConsequenceEvent, FactionClock } from "./types";

export interface PressureInput {
  turn: number;
  now?: string;                    // current in-world time ("Day N, HH:MM") — gates time-scheduled consequences
  trace: number[];                 // prior pressures
  difficulty: DifficultyProfile;
  threads: Thread[];
  consequences: ConsequenceEvent[];
  clocks: FactionClock[];
  action: string;                  // player's typed intent
  instability?: number;            // 0..1 from the Undertow — chaotic regimes run hotter
  focusMode?: "build" | "active" | null;  // phase: build suppresses new chaos, active runs hot
  focusLabel?: string | null;      // what we're converging on / in (for the directive text)
  tension?: number;                // 0-10 master dial; 0 = engine originates nothing new
  rng?: () => number;              // injectable for verification
}

/** A consequence is due only when BOTH its turn floor has passed AND, if it has an in-world
 *  fire_time, the clock has actually reached it. This is what stops "in 2 days" from firing
 *  in minutes: turns may fly by in a fast conversation, but the calendar hasn't moved. */
export function isDue(c: ConsequenceEvent, turn: number, now?: string): boolean {
  if (c.status !== "pending") return false;
  if (c.fire_turn > turn) return false;
  if (c.fire_time && now && absMinutes(now) < absMinutes(c.fire_time)) return false;
  return true;
}

export interface PressureVerdict {
  pressure: number;
  band: "calm" | "friction" | "obstacle" | "danger" | "lethal";
  source: string;                  // one-line rationale traceable to state
  due_consequence?: ConsequenceEvent;
  focus_event?: string | null;     // echoed so the directive can surface it
  focus_mode?: "build" | "active" | null;
}

/** Target band probabilities by friction density: [calm, friction, obstacle, danger, lethal] */
export const TARGETS: Record<DifficultyProfile["friction_density"], number[]> = {
  sparse:   [0.50, 0.35, 0.12, 0.025, 0.005],
  balanced: [0.30, 0.40, 0.20, 0.08, 0.02],
  dense:    [0.15, 0.40, 0.30, 0.12, 0.03],
};
export const BAND_RANGES: [number, number][] = [[0, 2], [3, 5], [6, 7], [8, 9], [10, 10]];
export const BAND_NAMES = ["calm", "friction", "obstacle", "danger", "lethal"] as const;

const RESTFUL = /\b(rest|sleep|eat|drink|sit|relax|talk|chat|walk|stroll|read|wash|bathe|cook|tend|mend|browse|listen|watch|wait)\b/i;

export function bandMean(target: number[]): number {
  return target.reduce((s, p, i) => s + p * ((BAND_RANGES[i][0] + BAND_RANGES[i][1]) / 2), 0);
}

export function fictionHeat(threads: Thread[], clocks: FactionClock[], consequences: ConsequenceEvent[], turn: number, now?: string): { heat: number; source: string } {
  let heat = 0;
  let source = "ambient world texture";
  const hot = threads.filter((t) => t.status === "active").sort((a, b) => b.tension - a.tension)[0];
  if (hot && hot.tension > heat) { heat = hot.tension; source = `thread: ${hot.title}`; }
  for (const c of clocks) {
    if (c.status !== "running" || c.segments === 0) continue;
    const h = (c.filled / c.segments) * 8;
    if (h > heat) { heat = h; source = `clock: ${c.faction} — ${c.objective}`; }
  }
  const due = consequences.find((c) => isDue(c, turn, now));
  if (due) {
    const h = due.severity === "major" ? 8 : due.severity === "notable" ? 6 : 4;
    if (h >= heat) { heat = h; source = `consequence due: ${due.description}`; }
  }
  return { heat, source };
}

export function decidePressure(input: PressureInput): PressureVerdict {
  const rng = input.rng ?? Math.random;
  const target = TARGETS[input.difficulty.friction_density];

  // proportional correction: shift band probabilities toward target mean
  const window = input.trace.slice(-12);
  const mean = window.length ? window.reduce((a, b) => a + b, 0) / window.length : bandMean(target);
  let err = bandMean(target) - mean;                   // >0 ⇒ we've been too quiet
  // PHASE: in a "build" phase the player is converging on an event — do not manufacture friction
  // to hit a quota (a quiet stretch is fine). In an "active" phase the event has arrived and the
  // world runs hot — allow the upward correction (don't damp it).
  if (input.focusMode === "build" && err > 0) err = 0;
  const kP = 0.10;                                     // gentle gain (stability proven in verify)
  const tilt = Math.max(-0.3, Math.min(0.3, kP * err));

  // tilted band distribution: move mass between calm and {obstacle,danger}
  const p = [...target];
  const shift = Math.abs(tilt);
  if (tilt > 0) { const take = Math.min(p[0], shift); p[0] -= take; p[2] += take * 0.7; p[3] += take * 0.3; }
  else if (tilt < 0) { const take = Math.min(p[2] + p[3], shift); const t2 = Math.min(p[2], take * 0.7), t3 = Math.min(p[3], take * 0.3); p[2] -= t2; p[3] -= t3; p[0] += t2 + t3; }

  // sample band
  let r = rng(), band = 0;
  for (let i = 0; i < p.length; i++) { r -= p[i]; if (r <= 0) { band = i; break; } if (i === p.length - 1) band = i; }

  // fiction heat: pressure ≥ 8 must be earned (C4); heat also pulls band up
  let { heat, source } = fictionHeat(input.threads, input.clocks, input.consequences, input.turn, input.now);
  if (input.instability) {
    heat = Math.min(10, heat + input.instability * 2);
    if (input.instability >= 1) source = source === "quiet — the world breathes" ? "the undertow — the world is primed" : source + " (amplified by the undertow)";
  }
  const due = input.consequences.find((c) => isDue(c, input.turn, input.now));
  if (due && due.severity !== "minor") band = Math.max(band, due.severity === "major" ? 3 : 2);
  if (band >= 3 && heat < 6) band = 2;                 // C4: unearned danger demoted to obstacle
  if (band === 4 && (input.difficulty.lethality === "low" || heat < 8)) band = 3; // C3 + earned-lethal

  // restful intent bias (C5): drop up to 2 bands when nothing is due
  if (RESTFUL.test(input.action) && !due && heat < 5) band = Math.max(0, band - 2);

  // PHASE shaping of the band:
  if (input.focusMode === "build" && !due) band = Math.min(band, 1);   // converge: keep it from spiking sideways
  if (input.focusMode === "active") band = Math.max(band, 2);          // the event is here: the world runs hot (still gated by heat/lethality below)

  // breath rule (C2)
  const last2 = input.trace.slice(-2);
  if (last2.length === 2 && (last2[0] + last2[1]) / 2 >= 7) band = Math.min(band, 1);

  // opening grace (C1)
  if (input.turn <= 2) band = 0;

  // MASTER TENSION DIAL (0–10, default 5). Scales the whole band down as it drops; at 0 the world
  // never escalates on its own — only a consequence the player themselves set in motion can raise it,
  // and even then it stays an obstacle, not danger. This is the global "let me breathe" control.
  const tension = input.tension ?? 5;
  if (tension <= 0) {
    band = due ? Math.min(band, 2) : 0;          // nothing the engine originated; calm unless the player's own due event lands
  } else if (tension < 5) {
    // below midpoint: pull the band toward calm. A due consequence may still LAND, but the dial
    // throttles how hard — it no longer gets a free pass to danger. This is what lets a player turn
    // tension down to escape a runaway plot whose consequence queue would otherwise keep firing
    // high pressure regardless of the dial. tension 1–2 → cap friction, 3 → friction (due: obstacle),
    // 4 → obstacle. The due event still happens; it just arrives proportionate to the calm setting.
    const baseCap = tension <= 3 ? 1 : 2;
    const dueCap = tension <= 2 ? 1 : 2;          // even a due event stays an obstacle at most when calm
    band = Math.min(band, due ? dueCap : baseCap);
  } else if (tension > 5) {
    // above midpoint: allow a modest upward nudge in how hot it can run
    if (heat >= 5 && band < 4) band = Math.min(4, band + (tension >= 8 ? 1 : 0));
  }

  // pressure within band, leaning low
  const [lo, hi] = BAND_RANGES[band];
  const pressure = Math.min(hi, lo + Math.floor(rng() * (hi - lo + 1) * 0.9));
  // lethality cap (C3)
  const capped = input.difficulty.lethality === "low" ? Math.min(9, pressure) : pressure;

  return {
    pressure: capped,
    band: BAND_NAMES[band],
    source: band === 0 ? "quiet — the world breathes" : source,
    due_consequence: due,
    focus_event: input.focusLabel ?? null,
    focus_mode: input.focusMode ?? null,
  };
}

/** Compact directive injected into the narrator's volatile digest. */
export function pressureDirective(v: PressureVerdict, palette?: string[], tension?: number, tier: PowerTier = "mortal"): string {
  const lines = [`PRESSURE ${v.pressure}/10 (${v.band}) — source: ${v.source}.`];
  if ((tension ?? 5) <= 0) {
    lines.push("TENSION 0 — THE WORLD IS AT REST. Do NOT introduce any new threat, problem, complication, arrival, or background development. Nothing new presses on the player this turn. Render the scene and the people in it responding naturally to what the player does — let it breathe. A quiet, uneventful beat is not only allowed, it is correct. Only continue something the player themselves set in motion.");
  } else {
    if (v.pressure <= 2) lines.push("No threat or hostile interest — but the scene must still MOVE: a discovery, an arrival, a choice, a shift in what someone wants. Calm is not stillness; something develops.");
    if (v.pressure >= 3 && v.pressure <= 5) lines.push("Minor friction: a small cost, a social wrinkle, weather, a tool failing, an interruption. No injury. Keep a beat moving.");
    if (v.pressure >= 6 && v.pressure <= 7) lines.push("A real obstacle to work through — social, emotional, or practical — that forces action this turn. No physical danger yet.");
    if (v.pressure >= 8) lines.push("Real danger with built-up cause already in the state. Things happen fast and physically. Nothing arrives from thin air.");
  }
  if (v.due_consequence) lines.push(`A scheduled consequence reaches the scene NOW: ${v.due_consequence.description}`);
  if (v.focus_event && v.focus_mode === "build") lines.push(`FOCUS (building toward "${v.focus_event}"): bend this scene toward it; keep motion moving steadily in its direction. Do NOT introduce new unrelated threats, subplots, or chaos that would sideline it; let smaller frictions resolve quickly so the throughline stays clear. The player is driving toward this — honor it.`);
  if (v.focus_event && v.focus_mode === "active") lines.push(`FOCUS (now inside "${v.focus_event}"): the event has arrived — this is the situation now. Stakes are high and immediate; let consequences hit hard and fast within this event. Keep the scene centered on it; do not wander off into unrelated calm.`);
  // Tier nudge (NOT a behavior script): at high power, a martial/institutional threat against the
  // protagonist is a category error. We don't prescribe how mortals act — that emerges from their
  // own state (terror pins relaxation low; a clenched person flatters, lies, schemes, capitulates
  // through the perception gate). We only steer the narrator off the wrong reflex.
  if ((tension ?? 5) > 0) {
    if (tier === "cosmic") {
      lines.push(`The protagonist is beyond any threat this world can field, and everyone present knows it. Do not invent martial or institutional threats against them (no troops sent, no hunters dispatched, no "the Empire is coming") — that is a category error. Pressure here is the mortals' own reaction to power they cannot resist; let that reaction come from each character's state and relationship to the player, not from a script.`);
    } else if (tier === "mythic") {
      lines.push(`The protagonist outclasses ordinary threats and the people near them sense it. A direct martial challenge should be rare and only if genuinely novel; otherwise pressure is consequence and reaction, drawn from each character's own state.`);
    } else if (palette?.length) {
      lines.push(`Draw pressure only from: ${palette.join("; ")}.`);
    }
  } else if (palette?.length) {
    lines.push(`Draw pressure only from: ${palette.join("; ")}.`);
  }
  return lines.join(" ");
}

export type PowerTier = "mortal" | "empowered" | "mythic" | "cosmic";

/** How far past mortal the protagonist has scaled. A light gate on the tier nudge above — NOT a
 *  behavior driver (behavior emerges from the relaxation kernel). god_mode lifts you above
 *  ordinary threat; visible reality-breaking acts read as cosmic. */
export function detectPowerTier(godMode: boolean, recentText: string): PowerTier {
  const t = recentText.toLowerCase();
  const cosmic = [
    /transcend\w* (its|their|the)? ?(own )?universe/, /\bxeelee\b/, /unm?ade? (a|the) (sun|star|world|planet|galaxy)/,
    /destroy(ed|s)? (a|the) (sun|star|planet|galaxy)/, /stopped time/, /across the galaxy/, /every imperial/,
    /folded space/, /reality (itself )?(bent|obeyed|reshaped)/, /\bgodlike\b|\bomnipotent\b|like a god\b/,
    /rewrote? (reality|the world|physics)/, /beyond (mortal|human) (comprehension|category)/,
  ].some((re) => re.test(t));
  const mythic = [
    /killed everyone/, /raised the dead/, /mass(acre|-kill)/, /levitat\w+ the/,
    /leveled (a|the) (building|city|block)/, /with (a|his|her|their) (mind|hand|will)/,
    /no one could (stop|touch|harm) (him|her|them)/, /impervious|invulnerable|untouchable/,
  ].some((re) => re.test(t));
  if (cosmic) return "cosmic";
  if (mythic) return godMode ? "cosmic" : "mythic";
  if (godMode) return "mythic";
  return "mortal";
}
