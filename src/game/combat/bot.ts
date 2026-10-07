// A simple autoplayer for the squad side. Used by tests and the headless campaign sim;
// it issues orders through the same API the UI uses, so refusals and habits still happen.

import { endTurn, enemyUnits, medkitTargets, moveOptions, orderMedkit, orderMove, orderOverwatch, orderReload, orderShoot, orderStabilize, dragTargets, orderDrag, squadUnits, stabilizeTargets, targetsFor } from "./engine";
import { coverAgainst, dist, hasLos } from "./grid";
import { canAct, shotInfo, WEAPONS } from "./rules";
import type { CombatState, Unit } from "./types";

function placeScore(s: CombatState, u: Unit, p: { x: number; y: number }): number {
  const foes = enemyUnits(s).filter((e) => canAct(e) && s.seenEnemies.includes(e.id));
  let score = 0;
  if (foes.length) {
    for (const e of foes) {
      const sees = hasLos(s, e, p);
      if (sees) score += coverAgainst(s, p, e) === 0 ? -1.2 : coverAgainst(s, p, e) / 40;
      const d = dist(p, e);
      if (hasLos(s, p, e) && d <= WEAPONS[u.weapon].maxRange) score += shotInfo(s, u, e, { from: p }).hit / 100;
    }
    const nearest = Math.min(...foes.map((e) => dist(p, e)));
    score -= Math.abs(nearest - (u.weapon === "shotgun" ? 3 : u.weapon === "rifle" ? 9 : 6)) * 0.08;
  } else {
    // advance toward the enemy side, prefer cover
    score -= p.y * 0.25;
    score += [0, 1, 2, 3].some((k) => {
      const d = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }][k];
      const t = s.tiles[(p.y + d.y) * s.w + (p.x + d.x)];
      return t === "half" || t === "full";
    }) ? 0.6 : 0;
  }
  const allies = squadUnits(s).filter((a) => a !== u && canAct(a));
  if (allies.some((a) => Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= 2)) score += 0.2;
  return score;
}

export function botTurn(s: CombatState) {
  for (const u of squadUnits(s)) {
    for (let guard = 0; guard < 6 && canAct(u) && u.ap > 0 && !s.outcome && s.side === "squad"; guard++) {
      const apBefore = u.ap;
      const downed = stabilizeTargets(s, u)[0];
      const drag = dragTargets(s, u)[0];
      const med = medkitTargets(s, u).find((t) => t.downed);
      if (med) { orderMedkit(s, u, med); continue; }
      if (drag) { orderDrag(s, u, drag); if (u.ap === apBefore) break; continue; }
      if (downed) { orderStabilize(s, u, downed); if (u.ap === apBefore) break; continue; }
      if (u.ammo <= 0) { orderReload(s, u); continue; }
      const shots = targetsFor(s, u);
      const best = shots[0];
      if (best && best.info.hit >= 55) { orderShoot(s, u, best.unit); continue; }
      if (u.ap >= 2 || !best) {
        const opts = moveOptions(s, u).filter((o) => o.ap === 1);
        let pick = opts[0], ps = -Infinity;
        for (const o of opts) {
          const v = placeScore(s, u, o);
          if (v > ps) { ps = v; pick = o; }
        }
        if (pick && ps > placeScore(s, u, u) + 0.05) {
          orderMove(s, u, pick.x, pick.y);
          if (u.ap === apBefore) break;
          continue;
        }
      }
      if (best && best.info.hit >= 25) { orderShoot(s, u, best.unit); continue; }
      orderOverwatch(s, u);
      if (u.ap === apBefore) break;
    }
  }
  if (!s.outcome) endTurn(s);
}

export function autoplay(s: CombatState, maxTurns = 40): CombatState {
  while (!s.outcome && s.turn <= maxTurns) botTurn(s);
  if (!s.outcome) {
    // stalemate: pull out
    s.outcome = "evacuated";
    for (const u of squadUnits(s)) if (canAct(u)) u.evacuated = true;
    for (const u of squadUnits(s)) if (u.downed && !u.dead) { u.dead = true; s.events.push({ kind: "died", turn: s.turn, actor: u.soldierId!, note: "left behind" }); }
  }
  return s;
}
