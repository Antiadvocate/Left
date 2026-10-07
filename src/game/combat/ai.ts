// Layer 1 enemy AI: per-turn utility scoring driven by the current doctrine weights.
// Deterministic and cheap. The Accord sees the battlefield, never the barracks.

import { cheb, coverAgainst, dist, hasLos, occupied, reachable } from "./grid";
import { canAct, canTarget, shotInfo } from "./rules";
import type { CombatState, Pt, Unit } from "./types";

export type EnemyDecision =
  | { kind: "shoot"; target: string }
  | { kind: "move"; to: Pt }
  | { kind: "overwatch" }
  | { kind: "wait" };

const targetsOf = (s: CombatState) => s.units.filter((u) => u.side === "squad" && canAct(u));

function shotScore(s: CombatState, e: Unit, t: Unit, from: Pt): number {
  const d = dist(from, t);
  if (!canTarget(e, t, d)) return 0;
  if (e.weapon === "e-melee" ? cheb(from, t) > 1 : !hasLos(s, from, t)) return 0;
  const info = shotInfo(s, e, t, { from });
  const avg = (e.dmg[0] + e.dmg[1]) / 2;
  const doc = s.doctrine;
  let v = (info.hit / 100) * (avg / 5) * (1 + doc.focusWounded * (1 - t.hp / t.maxHp));
  if (avg >= t.hp) v += 0.3 * (info.hit / 100);
  if (info.flanked) v += 0.1;
  return v;
}

function bestShot(s: CombatState, e: Unit, from: Pt): { target?: Unit; score: number } {
  let best: { target?: Unit; score: number } = { score: 0 };
  for (const t of targetsOf(s)) {
    const v = shotScore(s, e, t, from);
    if (v > best.score) best = { target: t, score: v };
  }
  return best;
}

function positionScore(s: CombatState, e: Unit, p: Pt): number {
  const doc = s.doctrine;
  const ts = targetsOf(s);
  if (!ts.length) return 0;
  let coverSum = 0, seers = 0, danger = 0, flanks = 0, nearest = Infinity;
  for (const t of ts) {
    nearest = Math.min(nearest, dist(p, t));
    if (hasLos(s, t, p)) {
      seers++;
      const c = coverAgainst(s, p, t);
      coverSum += c / 40;
      if (c === 0) danger++;
      if (coverAgainst(s, t, p) === 0) flanks++;
    }
  }
  const cover = seers ? coverSum / seers : 0.6;
  const range = e.weapon === "e-melee" ? 1 : doc.preferredRange;
  const closeness = -Math.abs(nearest - range) / 8;
  return doc.coverSeek * cover - 0.35 * doc.coverSeek * danger + 0.4 * doc.flankSeek * flanks + doc.aggression * closeness;
}

export function decideEnemy(s: CombatState, e: Unit): EnemyDecision {
  if (!e.active || !canAct(e) || e.ap <= 0) return { kind: "wait" };
  if (!targetsOf(s).length) return { kind: "wait" };
  const here = bestShot(s, e, e);
  const opts = reachable(s, e, e.mobility);
  const tiles: Pt[] = [];
  for (const [i] of opts) {
    const p = { x: i % s.w, y: Math.floor(i / s.w) };
    if ((p.x === e.x && p.y === e.y) || occupied(s, p.x, p.y, e)) continue;
    tiles.push(p);
  }

  if (e.weapon === "e-melee") {
    if (here.target) return { kind: "shoot", target: here.target.id };
    // close in: prefer a tile adjacent to the weakest reachable target
    let best: Pt | undefined, bs = -Infinity;
    for (const p of tiles) {
      const sc = bestShot(s, e, p).score * 3 + positionScore(s, e, p);
      if (sc > bs) { bs = sc; best = p; }
    }
    if (e.ap >= 2 && best && bestShot(s, e, best).score === 0) {
      // nothing in reach this action: dash toward the nearest target
      const far = reachable(s, e, e.mobility * 2);
      const tgt = targetsOf(s).sort((a, b) => dist(e, a) - dist(e, b))[0];
      let dp: Pt | undefined, dd = Infinity;
      for (const [i] of far) {
        const p = { x: i % s.w, y: Math.floor(i / s.w) };
        if (occupied(s, p.x, p.y, e)) continue;
        const d = dist(p, tgt);
        if (d < dd) { dd = d; dp = p; }
      }
      if (dp && (dp.x !== e.x || dp.y !== e.y)) return { kind: "move", to: dp };
    }
    return best ? { kind: "move", to: best } : { kind: "wait" };
  }

  const hereVal = positionScore(s, e, e) + here.score * 2;
  if (e.ap >= 2) {
    let best: Pt | undefined, bs = -Infinity;
    for (const p of tiles) {
      const v = positionScore(s, e, p) + bestShot(s, e, p).score * 1.6;
      if (v > bs) { bs = v; best = p; }
    }
    if (here.target && hereVal >= bs - 0.1) return { kind: "shoot", target: here.target.id };
    if (best) return { kind: "move", to: best };
    return here.target ? { kind: "shoot", target: here.target.id } : { kind: "wait" };
  }
  // one action left
  if (here.target && here.score >= 0.15) return { kind: "shoot", target: here.target.id };
  if (e.jammed <= 0 && s.doctrine.overwatchBias > 0.2) return { kind: "overwatch" };
  if (here.target) return { kind: "shoot", target: here.target.id };
  return { kind: "wait" };
}

export function scamperTile(s: CombatState, e: Unit): Pt | undefined {
  let best: Pt | undefined, bs = positionScore(s, e, e);
  for (const [i] of reachable(s, e, e.mobility)) {
    const p = { x: i % s.w, y: Math.floor(i / s.w) };
    if (occupied(s, p.x, p.y, e)) continue;
    const v = positionScore(s, e, p);
    if (v > bs) { bs = v; best = p; }
  }
  return best;
}
