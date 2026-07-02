/** Drive regeneration — NPC autonomy without an author.
 *
 *  A tracked character who has finished their drive (or never had one) is never
 *  left idle: seedDrive() reads their whole self — identity, traits, values, their
 *  edges (warmth/trust toward the player and toward others), the live threads, and
 *  the world's pressure palette — and hands them a concrete new want. It's
 *  deterministic and free, so nobody is ever stranded; the Simulator's
 *  `drives_update` then enriches it into something in-voice on the next tick.
 *
 *  Tracking is opt-in: the player follows a character in the Cast view, or the
 *  Simulator promotes one (diff.track) when a thread makes them matter. Untracked
 *  bit-players recede — no drive, no upkeep — until something elevates them. */
import type { Identity, SaveState } from "./types";
import { epistemicGoal } from "./mind";

const pick = <T,>(xs: T[], rng: () => number): T => xs[Math.floor(rng() * xs.length)];

/** Build a fresh drive for a character from their relational + narrative context.
 *  `dispersion` (0..1) and `avoid` (a char_id the cast is over-focused on) bias the pick
 *  toward self-interested, magnet-avoiding goals so the cast spreads instead of swarming. */
export function seedDrive(state: SaveState, id: string, rng: () => number = Math.random, dispersion = 0, avoid: string | null = null): { goal: string; progress: number; priority: number; updated_turn: number } | null {
  const c = state.characters[id];
  if (!c) return null;
  const turn = state.world.current_turn;
  const nm = (x: string) => state.characters[x]?.name ?? x;

  // strongest feelings this character holds toward others (their outgoing edges)
  const out = state.world.edges.filter((e) => e.from === id && e.to !== id);
  const hottest = [...out].sort((a, b) => Math.abs(b.warmth) - Math.abs(a.warmth))[0];
  const coldest = [...out].sort((a, b) => a.warmth - b.warmth)[0];
  const distrusted = [...out].sort((a, b) => a.trust - b.trust)[0];

  const traits = (c.core_traits ?? []).map((t) => t.toLowerCase()).join(" ");
  const values = (c.values ?? []).map((t) => t.toLowerCase()).join(" ");
  const blob = `${traits} ${values} ${c.background ?? ""}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => blob.includes(w));

  const candidates: string[] = [];

  // 1) relational pulls — the engine of most autonomous behavior
  if (coldest && coldest.warmth <= -20) {
    if (has("protect", "guard", "loyal", "justice", "shield"))
      candidates.push(`keep ${nm(coldest.to)} from doing more harm`);
    if (has("venge", "ruthless", "cruel", "dark", "exploit", "calculating", "possessive"))
      candidates.push(`undermine ${nm(coldest.to)} before they become a problem`);
    candidates.push(`find out what ${nm(coldest.to)} is really doing`);
  }
  if (distrusted && distrusted.trust <= -20)
    candidates.push(`watch ${nm(distrusted.to)} from a careful distance`);
  if (hottest && hottest.warmth >= 25) {
    if (has("possessive", "control", "anchor", "obsess"))
      candidates.push(`make sure ${nm(hottest.to)} needs no one but them`);
    else candidates.push(`look out for ${nm(hottest.to)} without being asked`);
  }

  // 2) live threads they could insert themselves into
  for (const th of state.world.threads.filter((t) => t.status === "active")) {
    if (th.tension >= 4) candidates.push(`get to the bottom of ${th.title.toLowerCase()}`);
  }

  // 3) clocks still running — ambient stakes to push or resist
  for (const k of state.world.clocks.filter((k) => k.status === "running")) {
    if (has("protect", "justice", "guard", "detective", "law"))
      candidates.push(`disrupt ${k.faction}'s plans before they finish`);
  }

  // 4) trait/value-driven standing wants (always available, lowest priority)
  if (has("ambition", "power", "climb", "control")) candidates.push("expand their hold over the territory");
  if (has("justice", "detective", "law", "protect")) candidates.push("chase the case the others are ignoring");
  if (has("survi", "street", "thief", "cat")) candidates.push("line up the next score and stay unseen");
  if (has("heal", "doctor", "care", "mend")) candidates.push("tend to someone the city has written off");
  if (has("chaos", "wild", "unpredict")) candidates.push("stir something up just to see what breaks");
  candidates.push(`pursue what matters most to ${c.name} right now`);

  // SELF-INTEREST set — the antidote to the chorus. These pull a character toward their OWN
  // life instead of the group's shared object. Tagged so dispersion can prefer them.
  const selfStart = candidates.length;
  candidates.push(
    `tend to something of their own that's been neglected`,
    `get what they personally came here for and not much else`,
    `protect their own comfort and patience tonight`,
    `quietly pursue a private want they haven't told anyone`,
  );
  if (has("ambition", "climb", "career", "work")) candidates.push("steal time for their own ambition while everyone's distracted");
  if (has("tired", "weary", "cynic", "jaded")) candidates.push("conserve energy and stop carrying everyone else");

  if (!candidates.length) return null;

  // SELECTION. Normally weight toward the front (relational/thread goals), stochastic.
  // Under high dispersion, bias HARD toward the self-interest tail and re-roll a few times
  // to avoid handing them a goal aimed at the over-focused magnet (the chorus magnet).
  const goalAt = (i: number) => candidates[Math.min(candidates.length - 1, i)];
  const avoidName = avoid ? (state.characters[avoid]?.name ?? "") : "";
  const aimsAtMagnet = (g: string) => !!avoidName && g.toLowerCase().includes(avoidName.toLowerCase());
  let goal: string;
  if (dispersion >= 0.55 && candidates.length > selfStart) {
    // pick from the self-interest tail most of the time
    goal = rng() < 0.78
      ? candidates[selfStart + Math.floor(rng() * (candidates.length - selfStart))]
      : goalAt(Math.floor((rng() ** 1.7) * candidates.length));
  } else {
    goal = goalAt(Math.floor((rng() ** 1.7) * candidates.length));
    // even at moderate dispersion, don't pile onto the magnet — re-roll up to twice
    for (let tries = 0; tries < 2 && aimsAtMagnet(goal) && dispersion >= 0.4; tries++) {
      goal = candidates[selfStart + Math.floor(rng() * (candidates.length - selfStart))];
    }
  }
  return { goal, progress: 0, priority: 1, updated_turn: turn };
}

/** Ensure every TRACKED, offscreen, idle character has a want. Returns world-motion lines.
 *  `epistemicPulls` (from the theory-of-mind layer) lets a character whose model of someone
 *  is uncertain-but-high-stakes seed a "find out" want instead of a generic one — active
 *  inference's epistemic drive, executed by the same machinery. */
export function regenerateDrives(state: SaveState, rng: () => number = Math.random, epistemicPulls: { id: string; target: string }[] = [], opts: { dispersion?: number; sharedTarget?: string | null } = {}): string[] {
  const log: string[] = [];
  const pullFor = new Map(epistemicPulls.map((p) => [p.id, p.target]));
  const dispersion = opts.dispersion ?? 0;
  const magnet = opts.sharedTarget ?? null;
  for (const [id, c] of Object.entries(state.characters) as [string, Identity][]) {
    if (id === "char_player" || !c.tracked) continue;
    if (c.status === "dead" || c.status === "departed") continue;   // the gone don't get new wants
    const present = state.world.present.includes(id);

    const active = c.drive;
    const queue = (c.drive_queue ??= []);

    // PROMOTION — a person doesn't stay glued to one stalled aim. If the active drive
    // is complete, hard-blocked, or has sat without progress, and a higher- or equal-priority
    // backup exists, switch to it and shelve the current one. This runs for PRESENT characters too:
    // a character whose in-scene goal has stalled surfaces a backup want, which the narrator then
    // sees and can act on (raise it, redirect to it, leave to pursue it) — so people in the room
    // don't stay stuck on a dead aim, they move on to the next thing they want.
    if (active && queue.length) {
      const stalled = active.progress >= 100 || !!active.blocker || (state.world.current_turn - active.updated_turn) >= 4;
      if (stalled) {
        // pick the best backup by priority then freshness
        queue.sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1) || (b.updated_turn - a.updated_turn));
        const next = queue.shift()!;
        if (active.progress < 100) { // keep the unfinished one as a backup, lowered
          active.priority = Math.max(0, (active.priority ?? 1) - 1);
          queue.push(active);
        }
        c.drive = { ...next, updated_turn: state.world.current_turn };
        log.push(`${c.name} sets aside "${active.goal}" and turns to: ${next.goal}.`);
        continue;
      }
    }

    // SEEDING a brand-new want is offscreen-only — for a present character with no goal, the
    // narrator and simulator give them one from what's happening in the scene, not this background tick.
    if (present) continue;

    if (active && active.progress < 100) continue;          // still actively wanting something
    // nothing active (or it just completed and queue empty) — seed a fresh want.
    // a live epistemic pull (uncertain about someone who matters) takes the wheel.
    const pull = pullFor.get(id);
    const seeded = pull
      ? { goal: epistemicGoal(state, pull), progress: 0, priority: 2, updated_turn: state.world.current_turn }
      : seedDrive(state, id, rng, dispersion, magnet);
    if (!seeded) continue;
    c.drive = seeded;
    log.push(pull ? `${c.name} can't get a read on ${pull === "char_player" ? "the player" : state.characters[pull]?.name ?? "someone"} — and goes looking.` : `${c.name} turns to something new: ${seeded.goal}.`);
    // occasionally give them a second, lower-priority aim so they have somewhere to go next
    if (queue.length < 2 && rng() < 0.5) {
      const backup = seedDrive(state, id, rng);
      if (backup && backup.goal !== seeded.goal) queue.push({ ...backup, priority: 0 });
    }
  }
  return log;
}
