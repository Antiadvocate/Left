/**
 * Social fabric — the world-reacting layer. All deterministic, zero tokens.
 *
 * Rumor diffusion: independent-cascade on the co-presence graph
 * (Kempe–Kleinberg–Tardos 2003). Each turn, every knower k may transmit to
 * each co-present non-knower j with
 *   p(k→j) = base · (salience/10) · ((greg_k + greg_j)/2)
 * Expected coverage and hop counts verified by Monte Carlo in verify.ts.
 * Inspired by Park et al. information-diffusion findings and Social
 * Simulacra (Park et al. 2022): community texture emerges from cheap local
 * rules, not from asking an LLM to imagine it.
 *
 * Psyche: relaxation r drifts toward capacity at rate ρ, perturbed by
 * Simulator deltas; psyche state derived from thresholds and dwell time.
 */
import type { SaveState, Rumor, SocialEdge, Psyche, AcquiredTrait, Identity, EpisodicMemory, CharMemory } from "./types";

export const RUMOR_BASE_P = 0.45;

export function getEdge(edges: SocialEdge[], from: string, to: string): SocialEdge {
  let e = edges.find((x) => x.from === from && x.to === to);
  if (!e) {
    e = { from, to, warmth: 0, trust: 0, power: 0, notes: "", updated_turn: 0 };
    edges.push(e);
  }
  return e;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function applyEdgeDelta(edges: SocialEdge[], d: { from: string; to: string; warmth_delta: number; trust_delta: number; power_delta: number; note?: string; roles_set?: string[] }, turn: number) {
  const e = getEdge(edges, d.from, d.to);
  e.warmth = clamp(e.warmth + clamp(d.warmth_delta, -15, 15), -100, 100);
  // trust breaks faster than it builds: positive deltas apply at 60% strength, negatives at full.
  // Dampen the DELTA before applying it once (the old version added full then subtracted from the
  // absolute value, which gave wrong results at the clamp ceiling).
  const trustDelta = d.trust_delta > 0 ? d.trust_delta * 0.6 : d.trust_delta;
  e.trust = clamp(e.trust + clamp(trustDelta, -20, 20), -100, 100);
  e.power = clamp(e.power + clamp(d.power_delta, -10, 10), -100, 100);
  if (d.note) e.notes = d.note.slice(0, 140);
  if (d.roles_set) e.roles = d.roles_set.map((r) => r.trim()).filter(Boolean).slice(0, 4);
  e.updated_turn = turn;
}

/** One diffusion step over the co-presence groups. Deterministic given rng. */
export function diffuseRumors(state: SaveState, rng: () => number = Math.random): string[] {
  const log: string[] = [];
  const groups: string[][] = [];
  // group 1: everyone in the player's scene; group 2: offscreen NPCs bucketed by current_activity keyword overlap (cheap co-location proxy)
  groups.push([...state.world.present]);
  const offscreen = Object.keys(state.characters).filter((id) => id !== "char_player" && !state.world.present.includes(id));
  if (offscreen.length > 1) groups.push(offscreen); // village-scale: offscreen cast mingles
  for (const rumor of state.world.rumors) {
    if (rumor.dead) continue;
    const age = state.world.current_turn - rumor.born_turn;
    if (age > 30 || rumor.knowers.length >= Object.keys(state.characters).length) { rumor.dead = true; continue; }
    for (const group of groups) {
      const knowers = group.filter((id) => rumor.knowers.includes(id));
      const naive = group.filter((id) => !rumor.knowers.includes(id) && id !== "char_player");
      for (const k of knowers) {
        const gk = state.characters[k]?.gregariousness ?? 0.5;
        for (const j of naive) {
          if (rumor.knowers.includes(j)) continue;
          const gj = state.characters[j]?.gregariousness ?? 0.5;
          const p = RUMOR_BASE_P * (rumor.salience / 10) * ((gk + gj) / 2);
          if (rng() < p) {
            rumor.knowers.push(j);
            log.push(`${state.characters[j]?.name ?? j} hears: "${rumor.content}" (from ${state.characters[k]?.name ?? k})`);
          }
        }
      }
    }
  }
  return log;
}

/** Per-turn drift of relaxation toward capacity; derive psyche state. */
export function tickPsyche(p: Psyche): void {
  p.relaxation = clamp(p.relaxation + (p.capacity - p.relaxation) * p.recovery, -10, 10);
  if (p.relaxation <= -7) p.consecutive_clenched++;
  else p.consecutive_clenched = 0;
  if (p.state === "intact" && p.consecutive_clenched >= 4) p.state = "fracturing";
  if (p.state === "fracturing" && p.relaxation > -4) { p.state = "intact"; p.break_mode = null; }
  if (p.state === "fracturing" && p.relaxation <= -9) { p.state = "broken"; p.break_mode = p.break_mode ?? "fractured"; }
  if ((p.state === "broken" || p.state === "shattered") && p.relaxation > -2) { p.state = "intact"; p.break_mode = null; }
  p.mood_valence = clamp(Math.round(p.relaxation * 0.8), -10, 10);
}

/** Trait reinforcement-or-decay. Unreinforced acquired traits fade; identity-integrated ones persist. */
/** Consolidation — earned, slow identity change. An acquired trait reinforced into deep
 *  integration (high self_weight AND repeatedly reinforced) stops being a "learned" overlay
 *  and becomes WHO THEY ARE: folded into core_traits, and — if it bears on how they come
 *  across — into the stored speech_pattern, then retired from the acquired list. Never runs
 *  per-turn (only on reflection / time skips), so a single scene can't move the core. */
export function capMemory(episodic: EpisodicMemory[], cap = 60): EpisodicMemory[] {
  if (episodic.length <= cap) return episodic;
  const sacred = episodic.filter((m) => m.importance >= 8 || m.commitment_status === "pending");
  const rest = episodic.filter((m) => !(m.importance >= 8 || m.commitment_status === "pending"));
  const room = Math.max(0, cap - sacred.length);
  // Evict by a keep-score, not pure age: importance matters as much as recency, so a burst of
  // trivial recent memories can't nuke a still-significant older one. Highest scores survive.
  const maxTurn = Math.max(1, ...episodic.map((m) => m.turn));
  const keepScore = (m: EpisodicMemory) => (m.importance / 10) * 0.6 + (m.turn / maxTurn) * 0.4;
  const keptRest = rest.slice().sort((a, b) => keepScore(b) - keepScore(a)).slice(0, room);
  const keep = new Set<EpisodicMemory>([...sacred, ...keptRest]);
  return episodic.filter((m) => keep.has(m));
}

export function consolidateBackground(ident: Identity, mem: CharMemory): string[] {
  const log: string[] = [];
  const defining = mem.episodic.filter((m) => m.importance >= 8 && !m.folded);
  if (!defining.length) return log;
  const facts = defining
    .slice()
    .sort((a, b) => a.turn - b.turn)
    .map((m) => m.content.trim())
    .filter((c) => c && !(ident.life_history ?? "").includes(c) && !ident.background.includes(c));
  if (facts.length) {
    // fold into the ACCRETED layer, never the bedrock forge background
    ident.life_history = `${ident.life_history ?? ""} ${facts.join(" ")}`.trim();
    // deterministic light trim: keep the most recent ~1100 chars on a sentence boundary
    const SOFT = 1100;
    if (ident.life_history.length > SOFT) {
      const tail = ident.life_history.slice(-SOFT);
      const firstStop = tail.search(/[.!?]\s/);
      ident.life_history = (firstStop >= 0 ? tail.slice(firstStop + 2) : tail).trim();
    }
    log.push(`${ident.name}'s history now carries ${facts.length} defining moment${facts.length > 1 ? "s" : ""}.`);
  }
  for (const m of defining) m.folded = true;
  return log;
}

/** When life_history has grown past where deterministic trimming reads cleanly, an LLM should
 *  re-summarize it into tighter prose (preserve the shape, lose verbatim detail). The actual
 *  rewrite is async, done by the turn loop — rare and cheap. Bedrock background is never touched. */
export function needsHistoryCompaction(ident: Identity): boolean {
  return (ident.life_history?.length ?? 0) > 1400;
}

export function consolidateTraits(ident: Identity, traits: AcquiredTrait[], _turn: number): { kept: AcquiredTrait[]; log: string[] } {
  const log: string[] = [];
  const SPEECHY = /(mean|cruel|harsh|cold|gentle|warm|tender|curt|terse|sharp|bitter|guarded|open|cheerful|grim|sardonic|formal|crude|profane|soft-spoken|aggressive|meek|commanding|timid|sarcastic|kind)/i;
  const kept = traits.filter((t) => {
    const integrated = t.self_weight >= 6 && t.reinforcement_count >= 8 && t.intensity >= 5;
    if (!integrated) return true;
    const already = ident.core_traits.some((c) => c.toLowerCase().includes(t.label.toLowerCase()) || t.label.toLowerCase().includes(c.toLowerCase()));
    if (!already) {
      ident.core_traits = [...ident.core_traits, t.label].slice(-8);
      log.push(`${ident.name} is changed at the root: "${t.label}" is now part of who they are.`);
    }
    if (SPEECHY.test(t.label) || SPEECHY.test(t.behavioral_impact)) {
      const add = t.label.toLowerCase();
      if (!ident.speech_pattern.toLowerCase().includes(add)) {
        ident.speech_pattern = `${ident.speech_pattern}; has become ${add}`.replace(/^;\s*/, "");
      }
    }
    return false; // retire from acquired — it's core now
  });
  return { kept, log };
}

export function decayTraits(traits: AcquiredTrait[], currentTurn: number): { kept: AcquiredTrait[]; log: string[] } {
  const log: string[] = [];
  const kept = traits.filter((t) => {
    const idle = currentTurn - t.last_reinforced_turn;
    if (idle <= 6) return true;
    const decay = 0.15 * Math.sqrt(idle - 6) * (1 - Math.min(0.9, t.self_weight / 10));
    t.intensity = Math.max(0, t.intensity - decay);
    if (t.intensity < 0.8 && t.self_weight < 3) {
      log.push(`trait dissolved: "${t.label}" (disuse)`);
      return false;
    }
    return true;
  });
  return { kept, log };
}

export function reinforceOrMergeTrait(traits: AcquiredTrait[], incoming: { label: string; origin: string; behavioral_impact: string; intensity: number }, turn: number): void {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const existing = traits.find((t) => {
    const a = new Set(norm(t.label).split(" ")), b = norm(incoming.label).split(" ");
    return b.filter((w) => a.has(w)).length / Math.max(1, b.length) > 0.5;
  });
  if (existing) {
    existing.intensity = clamp(existing.intensity + 0.7, 1, 10);
    existing.self_weight = clamp(existing.self_weight + 0.5, 0, 10);
    existing.reinforcement_count++;
    existing.last_reinforced_turn = turn;
  } else {
    traits.push({
      id: `trait_${Math.random().toString(36).slice(2, 8)}`,
      label: incoming.label,
      origin: incoming.origin,
      behavioral_impact: incoming.behavioral_impact,
      intensity: clamp(incoming.intensity, 1, 6), // new traits start modest
      self_weight: 1,
      last_reinforced_turn: turn,
      reinforcement_count: 1,
    });
    if (traits.length > 8) {
      traits.sort((a, b) => b.self_weight * b.intensity - a.self_weight * a.intensity);
      traits.length = 8;
    }
  }
}

/** Offscreen NPC drives advance stochastically; produces world-motion lines without an LLM. */
export function tickDrives(state: SaveState, rng: () => number = Math.random): string[] {
  const log: string[] = [];
  for (const [id, c] of Object.entries(state.characters) as [string, Identity][]) {
    if (id === "char_player" || state.world.present.includes(id) || !c.drive) continue;
    if (c.drive.progress >= 100) {
      // completion is an EVENT, not a frozen meter: it becomes a memory and the slot clears
      log.push(`${c.name} got what they wanted: ${c.drive.goal}. It shows.`);
      state.memory[id]?.episodic.push({
        turn: state.world.current_turn,
        content: `Achieved: ${c.drive.goal}.`,
        importance: 7, emotional_charge: "satisfaction",
        last_accessed_turn: state.world.current_turn,
      });
      if (c.current_goal === c.drive.goal) c.current_goal = undefined;
      c.drive = undefined; // the Simulator assigns the next want via drives_update
      continue;
    }
    // movement now comes from the Undertow's QRE stances; this tick is the safety
    // net for worlds whose undertow hasn't run this turn (e.g. plain time skips)
    if (c.drive.updated_turn < state.world.current_turn) {
      const step = c.drive.blocker ? 2 : 6 + Math.floor(rng() * 8);
      c.drive.progress = Math.min(100, c.drive.progress + step);
      c.drive.updated_turn = state.world.current_turn;
    }
    if (c.drive.progress >= 100) log.push(`${c.name} completes their aim offscreen: ${c.drive.goal}`);
    else if (rng() < 0.18) log.push(`${c.name} works toward "${c.drive.goal}" (${c.drive.progress}%)${c.drive.blocker ? ` — blocked by ${c.drive.blocker}` : ""}`);
  }
  return log;
}

/** Player-facing edges for telemetry snapshots. */
export function playerEdgeSnapshot(state: SaveState): { pair: string; warmth: number; trust: number }[] {
  return state.world.edges
    .filter((e) => e.to === "char_player" && state.characters[e.from])
    .map((e) => ({ pair: state.characters[e.from].name, warmth: e.warmth, trust: e.trust }));
}
