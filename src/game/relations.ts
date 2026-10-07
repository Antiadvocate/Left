// Relationship engine. Deterministic numbers moved by events: the LLM proposes, this clamps.
// Friction is the content: daily caps, sustained conditions for tiers, separation decay.

import { BOND_ACTIONS } from "./content";
import { Rng, clamp } from "./rng";
import type { CampaignState, EdgeDelta, Relationship, Soldier, Tier } from "./types";

export const TIERS: Tier[] = ["stranger", "familiar", "bonded", "deep"];
export const tierRank = (t: Tier) => TIERS.indexOf(t);

// Per-day movement caps on any one directed edge.
export const CAPS = {
  warmthUp: 10, warmthDown: 15,
  trustUp: 8, trustDown: 15,
  attractionUp: 6, attractionDown: 10,
  relaxation: 4,
};

interface TierReq { warmth: number; trust: number; together: number; crises: number; days: number }
export const TIER_REQ: Record<Exclude<Tier, "stranger">, TierReq> = {
  familiar: { warmth: 15, trust: 6, together: 0, crises: 0, days: 2 },
  bonded: { warmth: 40, trust: 25, together: 2, crises: 0, days: 3 },
  deep: { warmth: 68, trust: 58, together: 4, crises: 1, days: 4 },
};

export const edgeKey = (from: string, to: string) => `${from}|${to}`;

export function newEdge(from: string, to: string, rng: Rng): Relationship {
  return {
    from, to,
    warmth: rng.int(-6, 6),
    trust: rng.int(-6, 4),
    attraction: 0,
    spark: rng.chance(0.3) ? Math.round(rng.next() * 100) / 100 : 0,
    compat: Math.round(((rng.next() + rng.next() + rng.next()) / 1.5 - 1 + 0.1) * 100) / 100,
    tier: "stranger",
    streak: 0,
    slip: 0,
    missionsTogether: 0,
    missionsApart: 0,
    crises: 0,
    adjacentTurns: 0,
    unlockedActions: [],
    today: { warmth: 0, trust: 0, attraction: 0 },
    rivalCount: 0,
    lastEventDay: 0,
  };
}

export function edge(st: CampaignState, from: string, to: string): Relationship {
  const k = edgeKey(from, to);
  if (!st.edges[k]) st.edges[k] = newEdge(from, to, new Rng(st.rngState ^ hash(k)));
  return st.edges[k];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const living = (st: CampaignState) =>
  Object.values(st.soldiers).filter((s) => s.status !== "dead" && s.status !== "discharged" && s.status !== "defected");

export function mutualTier(st: CampaignState, a: string, b: string): Tier {
  const t1 = tierRank(edge(st, a, b).tier), t2 = tierRank(edge(st, b, a).tier);
  return TIERS[Math.min(t1, t2)];
}

export function resetDaily(st: CampaignState) {
  for (const e of Object.values(st.edges)) e.today = { warmth: 0, trust: 0, attraction: 0 };
}

/** Attachment style colours how events land on the person feeling them. */
function attachmentScale(s: Soldier, axis: "warmth" | "trust", v: number, rng: Rng): number {
  switch (s.attachment) {
    case "anxious": return v > 0 ? v * 1.15 : v * 1.4;
    case "avoidant": return v > 0 ? v * (axis === "warmth" ? 0.6 : 0.7) : v * 0.9;
    case "disorganized": return v > 0 && rng.chance(0.15) ? -v * 0.5 : v * 1.1;
    default: return v;
  }
}

function capped(cur: number, add: number, up: number, down: number): number {
  if (add > 0) return Math.max(0, Math.min(add, up - Math.max(0, cur)));
  return Math.min(0, Math.max(add, -down - Math.min(0, cur)));
}

/** Apply a proposed delta to a directed edge, through attachment, caps and clamps. */
export function applyDelta(st: CampaignState, d: EdgeDelta, rng: Rng, log?: string[]): { warmth: number; trust: number; attraction: number } {
  const out = { warmth: 0, trust: 0, attraction: 0 };
  if (d.from === d.to) return out;
  const feeler = st.soldiers[d.from];
  if (!feeler || !st.soldiers[d.to]) return out;
  const e = edge(st, d.from, d.to);
  if (d.warmth) {
    let v = attachmentScale(feeler, "warmth", clamp(d.warmth, -20, 20), rng);
    const c = capped(e.today.warmth, v, CAPS.warmthUp, CAPS.warmthDown);
    if (log && Math.abs(c) + 0.5 < Math.abs(v)) log.push(`clamped ${feeler.callsign}→${st.soldiers[d.to].callsign} warmth ${v.toFixed(0)}→${c.toFixed(0)}`);
    v = c;
    e.warmth = clamp(e.warmth + v, -100, 100);
    e.today.warmth += v;
    out.warmth = v;
  }
  if (d.trust) {
    // trust breaks faster than it builds
    let v = attachmentScale(feeler, "trust", clamp(d.trust > 0 ? d.trust * 0.8 : d.trust, -25, 20), rng);
    v = capped(e.today.trust, v, CAPS.trustUp, CAPS.trustDown);
    e.trust = clamp(e.trust + v, -100, 100);
    e.today.trust += v;
    out.trust = v;
  }
  if (d.attraction) {
    // chemistry is fixed per pair: most pairs never feel anything, whatever happens
    let v = d.attraction > 0 ? d.attraction * e.spark : d.attraction;
    v = capped(e.today.attraction, v, CAPS.attractionUp, CAPS.attractionDown);
    e.attraction = clamp(e.attraction + v, 0, 100);
    e.today.attraction += v;
    out.attraction = v;
  }
  return out;
}

export function nudgeRelaxation(s: Soldier, d: number, budget: Map<string, number>) {
  const used = budget.get(s.id) ?? 0;
  const v = d > 0 ? Math.min(d, CAPS.relaxation - used) : Math.max(d, -CAPS.relaxation - used);
  if ((d > 0 && v <= 0) || (d < 0 && v >= 0)) return;
  s.relaxation = clamp(s.relaxation + v, -10, 10);
  budget.set(s.id, used + v);
}

/** Tiers need sustained conditions over several days, and slip after sustained neglect. */
export function updateTiers(st: CampaignState, log: string[]) {
  for (const e of Object.values(st.edges)) {
    const a = st.soldiers[e.from], b = st.soldiers[e.to];
    if (!a || !b || a.status === "dead" || b.status === "dead") continue;
    const cur = tierRank(e.tier);
    const next = TIERS[cur + 1] as Exclude<Tier, "stranger"> | undefined;
    if (next) {
      const r = TIER_REQ[next];
      const meets = e.warmth >= r.warmth && e.trust >= r.trust && e.missionsTogether >= r.together && e.crises >= r.crises;
      e.streak = meets ? e.streak + 1 : 0;
      if (e.streak >= r.days) {
        e.tier = next;
        e.streak = 0;
        e.slip = 0;
        log.push(`${a.callsign} → ${b.callsign}: ${next}`);
      }
    }
    if (cur > 0) {
      const r = TIER_REQ[e.tier as Exclude<Tier, "stranger">];
      const holding = e.warmth >= r.warmth - 12 && e.trust >= r.trust - 12;
      e.slip = holding ? 0 : e.slip + 1;
      if (e.slip >= 3) {
        e.tier = TIERS[cur - 1];
        e.slip = 0;
        log.push(`${a.callsign} → ${b.callsign}: slipped to ${e.tier}`);
      }
    }
  }
}

/** Bistable relaxation: settled soldiers drift to their set point, braced ones to a low trap.
 *  Hysteresis means it takes real calm to come out of braced, and real damage to fall in. */
export function relaxationDynamics(st: CampaignState, coLocated: string[][], log: string[]) {
  const alive = living(st);
  for (const s of alive) {
    const target = s.braced ? -4 : s.capacity;
    s.relaxation = clamp(s.relaxation + (target - s.relaxation) * 0.25, -10, 10);
  }
  // co-regulation: a bonded partner nearby pulls toward the calmer of the two
  for (const group of coLocated) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const a = st.soldiers[group[i]], b = st.soldiers[group[j]];
        if (!a || !b || tierRank(mutualTier(st, a.id, b.id)) < 2) continue;
        const [lo, hi] = a.relaxation < b.relaxation ? [a, b] : [b, a];
        lo.relaxation = clamp(lo.relaxation + (hi.relaxation - lo.relaxation) * 0.3, -10, 10);
      }
  }
  for (const s of alive) {
    if (s.braced && s.relaxation >= 1) { s.braced = false; log.push(`${s.callsign} has settled`); }
    else if (!s.braced && s.relaxation <= -4) { s.braced = true; log.push(`${s.callsign} is braced`); }
  }
}

/** How fully a human feels a bond right now (AI soldiers always get the full effect). */
export function bondScale(st: CampaignState, self: Soldier, other: string): number {
  if (self.kind === "ai") return 1;
  const e = edge(st, self.id, other);
  let v = clamp(0.4 + e.trust / 200 + self.relaxation / 40, 0.3, 1);
  if (e.missionsApart >= 3) v *= 0.7;
  return Math.round(v * 100) / 100;
}

/** Bond actions the pair has earned by tier but not yet unlocked. */
export function eligibleActions(st: CampaignState, a: string, b: string): string[] {
  const t = tierRank(mutualTier(st, a, b));
  const have = new Set([...edge(st, a, b).unlockedActions, ...edge(st, b, a).unlockedActions]);
  return BOND_ACTIONS.filter((x) => tierRank(x.tier) <= t && !have.has(x.id)).map((x) => x.id);
}

export function unlockAction(st: CampaignState, a: string, b: string, id: string): boolean {
  if (!eligibleActions(st, a, b).includes(id)) return false;
  edge(st, a, b).unlockedActions.push(id);
  edge(st, b, a).unlockedActions.push(id);
  return true;
}

export function pairActions(st: CampaignState, a: string, b: string): string[] {
  const t = tierRank(mutualTier(st, a, b));
  const have = new Set([...edge(st, a, b).unlockedActions, ...edge(st, b, a).unlockedActions]);
  return BOND_ACTIONS.filter((x) => have.has(x.id) && tierRank(x.tier) <= t).map((x) => x.id);
}

export function isDeepRomantic(st: CampaignState, a: string, b: string): boolean {
  return mutualTier(st, a, b) === "deep" && edge(st, a, b).attraction >= 50 && edge(st, b, a).attraction >= 50;
}

/** Day-to-day proximity: people sharing a room drift by their fixed, directional chemistry.
 *  Some pairs warm, some sour, most barely move. This is what makes pairs uneven. */
export function proximityDrift(st: CampaignState, groups: string[][], rng: Rng) {
  const seen = new Set<string>();
  for (const g of groups)
    for (const a of g)
      for (const b of g) {
        if (a === b || seen.has(`${a}|${b}`)) continue;
        seen.add(`${a}|${b}`);
        const e = edge(st, a, b);
        applyDelta(st, { from: a, to: b, warmth: e.compat * 1.2, trust: e.compat * 0.8 }, rng);
      }
}
