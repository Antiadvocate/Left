// Tactical combat. Fully deterministic given the seed: no LLM calls anywhere in here.
// Barks come from banks written during the night pass; selection is by event tag.

import { BARKS, ENEMY_TYPES, type EnemyTypeId } from "../content";
import { Rng, clamp } from "../rng";
import type { BarkTag, Doctrine, MissionEventKind, MissionSpec, Soldier, Tier } from "../types";
import { decideEnemy, scamperTile } from "./ai";
import { cheb, coverAgainst, dist, DIRS8, generateMap, hasLos, idx, inBounds, occupied, pathTo, reachable, SIGHT, tileAt } from "./grid";
import { alive, canAct, canTarget, enemyUnit, shotInfo, squadUnit, WEAPONS, type ShotInfo } from "./rules";
import type { CombatState, Fx, LogEntry, PairInfo, Pt, Unit } from "./types";

export const TIER_RANK: Record<Tier, number> = { stranger: 0, familiar: 1, bonded: 2, deep: 3 };
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const DEFAULT_DOCTRINE: Doctrine = {
  name: "Standard Suppression",
  coverSeek: 1,
  aggression: 0.6,
  flankSeek: 0.8,
  focusWounded: 0.5,
  overwatchBias: 0.3,
  preferredRange: 6,
};

export interface StartOptions {
  mission: MissionSpec;
  squad: Soldier[];
  pairs: Record<string, PairInfo>;
  doctrine?: Doctrine;
  squadMood: number;
}

// ---------- helpers ----------

function roll(s: CombatState): number {
  const r = new Rng(s.rng);
  const v = r.next();
  s.rng = r.state;
  return v;
}
function rollInt(s: CombatState, lo: number, hi: number): number {
  return lo + Math.floor(roll(s) * (hi - lo + 1));
}
export function log(s: CombatState, kind: LogEntry["kind"], text: string, speaker?: string) {
  s.log.push({ turn: s.turn, kind, text, speaker });
}
export function fx(s: CombatState, f: Fx) {
  (s.fx ??= []).push(f);
}
const fxUnit = (s: CombatState, u: Unit) => fx(s, { k: "unit", id: u.id, hp: u.hp, downed: u.downed, dead: u.dead, evacuated: u.evacuated });
const float = (s: CombatState, u: Unit, text: string, tone: "warn" | "bond" | "habit" | "info" = "info") => fx(s, { k: "float", id: u.id, text, tone });

function event(s: CombatState, kind: MissionEventKind, actor: Unit, target?: Unit, note?: string) {
  s.events.push({ kind, turn: s.turn, actor: actor.soldierId ?? actor.id, target: target ? target.soldierId ?? target.id : undefined, note });
}
export function bark(s: CombatState, u: Unit, tag: BarkTag, partner?: Unit) {
  if (u.side !== "squad" || !u.voice) return;
  const lines = u.barks?.[tag]?.length ? u.barks[tag]! : BARKS[u.voice][tag];
  if (!lines?.length) return;
  const line = lines[Math.floor(roll(s) * lines.length)].replaceAll("{p}", partner?.name ?? "them");
  log(s, "bark", line, u.name);
  fx(s, { k: "bark", id: u.id, text: line });
}

export const squadUnits = (s: CombatState) => s.units.filter((u) => u.side === "squad");
export const enemyUnits = (s: CombatState) => s.units.filter((u) => u.side === "accord");
export const unitById = (s: CombatState, id: string) => s.units.find((u) => u.id === id);

export function pairOf(s: CombatState, a: Unit, b: Unit): PairInfo | undefined {
  if (!a.soldierId || !b.soldierId) return undefined;
  return s.pairs[pairKey(a.soldierId, b.soldierId)];
}

/** Partners of u with at least the given mutual tier (and optionally a given unlocked bond action). */
export function partnersOf(s: CombatState, u: Unit, minTier: Tier, action?: string): { p: Unit; info: PairInfo }[] {
  const out: { p: Unit; info: PairInfo }[] = [];
  for (const p of squadUnits(s)) {
    if (p === u || !alive(p)) continue;
    const info = pairOf(s, u, p);
    if (!info || TIER_RANK[info.tier] < TIER_RANK[minTier]) continue;
    if (action && !info.actions.includes(action)) continue;
    out.push({ p, info });
  }
  return out;
}

const bondScale = (info: PairInfo, u: Unit) => (u.kind === "ai" ? 1 : info.scale[u.soldierId!] ?? 0.6);

export function visibleToSquad(s: CombatState, e: Unit): boolean {
  return squadUnits(s).some((u) => canAct(u) && hasLos(s, u, e));
}

// ---------- setup ----------

function rollEnemies(rng: Rng, difficulty: number): EnemyTypeId[] {
  const count = clamp(3 + difficulty, 4, 9);
  const out: EnemyTypeId[] = [];
  let wardens = 0;
  for (let i = 0; i < count; i++) {
    const t = rng.weighted<EnemyTypeId>(["drone", "stalker", "hound", "warden"], (k) =>
      k === "drone" ? 3 : k === "stalker" ? 3 : k === "hound" ? (difficulty >= 2 ? 2 : 0) : difficulty >= 2 && wardens < Math.floor(difficulty / 2) ? 1.2 : 0,
    )!;
    if (t === "warden") wardens++;
    out.push(t);
  }
  return out;
}

export function startCombat(o: StartOptions): CombatState {
  const rng = new Rng(o.mission.seed);
  const types = rollEnemies(rng, o.mission.difficulty);
  const pods = Math.min(4, Math.ceil(types.length / 2.5));
  const map = generateMap(o.mission.seed, pods);
  const s: CombatState = {
    missionId: o.mission.id,
    missionName: o.mission.name,
    w: map.w,
    h: map.h,
    tiles: map.tiles,
    evac: map.evac,
    units: [],
    turn: 1,
    side: "squad",
    rng: rng.state,
    log: [],
    events: [],
    adjacency: {},
    damageTaken: {},
    pairs: o.pairs,
    doctrine: o.doctrine ?? DEFAULT_DOCTRINE,
    squadMood: o.squadMood,
    seenEnemies: [],
    fx: [],
  };
  // squad slots, honouring "take-dead-position" habits
  const order = o.squad.slice(0, 6);
  const slots = order.map((_, i) => i);
  order.forEach((sol, i) => {
    const want = sol.traits.find((t) => t.combatEffect === "take-dead-position" && t.trigger?.kind === "position");
    if (!want) return;
    const target = Number(want.trigger!.value);
    if (Number.isNaN(target) || target >= map.squadSpawns.length) return;
    const j = slots.indexOf(target);
    if (j >= 0) [slots[i], slots[j]] = [slots[j], slots[i]];
    else slots[i] = target;
  });
  order.forEach((sol, i) => {
    const u = squadUnit(sol, slots[i], map.squadSpawns[slots[i]]);
    s.units.push(u);
    const habit = sol.traits.find((t) => t.combatEffect === "take-dead-position");
    if (habit) log(s, "habit", `${u.name} ${habit.text}.`);
  });
  // the ace: highest rank, then kills
  const ranked = order.slice().sort((a, b) => b.rank - a.rank || b.kills - a.kills);
  if (ranked[0] && ranked[0].rank > 0) s.aceId = ranked[0].id;
  // enemies
  let k = 0;
  map.enemySpawns.forEach((pod, p) => {
    const perPod = Math.ceil((types.length - k) / (map.enemySpawns.length - p));
    for (let i = 0; i < perPod && k < types.length && i < pod.length; i++) {
      const e = enemyUnit(types[k], `e${k}`, pod[i], o.mission.difficulty);
      e.slot = p;
      s.units.push(e);
      k++;
    }
  });
  // starting fear
  for (const u of squadUnits(s)) {
    if (u.kind !== "human") continue;
    const will = u.will ?? 40;
    let f = 10 + Math.max(0, 50 - will) / 2 + ((u.commandTrust ?? 0) < 0 ? -(u.commandTrust ?? 0) / 4 : 0);
    if (u.talents.includes("cool-head")) f -= 10;
    if (s.squadMood < 0) f += 10;
    setFear(s, u, f, true);
  }
  const first = squadUnits(s)[0];
  if (first) bark(s, first, "deploy");
  log(s, "info", `${o.mission.name}. Eliminate all hostiles, or evac from the marked zone.`);
  beginPlayerTurn(s, true);
  return s;
}

// ---------- fear ----------

function holdLineCap(s: CombatState, u: Unit): boolean {
  return partnersOf(s, u, "deep", "hold-line").some(({ p, info }) => canAct(p) && cheb(p, u) <= 1 && bondScale(info, u) >= 0.5);
}

export function setFear(s: CombatState, u: Unit, v: number, silent = false) {
  if (u.kind !== "human" || !alive(u)) return;
  const cap = holdLineCap(s, u) ? 69 : 100;
  u.fear = clamp(Math.round(v), 0, cap);
  const prev = u.fearState;
  u.fearState = u.fear < 35 ? "steady" : u.fear < 70 ? "shaken" : "terrified";
  if (silent || prev === u.fearState) return;
  if (u.fearState === "terrified") {
    u.terrifiedEver = true;
    event(s, "terrified", u);
    log(s, "warn", `${u.name} is terrified.`);
    float(s, u, "TERRIFIED", "warn");
    bark(s, u, "terrified");
  } else if (u.fearState === "shaken" && prev === "steady") {
    log(s, "warn", `${u.name} is shaken.`);
    float(s, u, "SHAKEN", "warn");
  } else if (prev === "terrified") {
    log(s, "info", `${u.name} steadies, a little.`);
  }
}
const addFear = (s: CombatState, u: Unit, d: number) => setFear(s, u, u.fear + d);

function turnStartFear(s: CombatState, u: Unit) {
  if (u.kind !== "human" || !canAct(u)) return;
  let d = 0;
  const seen = enemyUnits(s).filter((e) => canAct(e) && e.active && hasLos(s, e, u));
  if (seen.some((e) => coverAgainst(s, u, e) === 0)) d += 15;
  if (enemyUnits(s).some((e) => canAct(e) && e.enemyType && ENEMY_TYPES[e.enemyType].heavy && hasLos(s, u, e))) d += 8;
  for (const eff of u.effects) {
    if (eff.effect === "flinch-at" && enemyUnits(s).some((e) => canAct(e) && e.enemyType === eff.value && hasLos(s, u, e))) d += 12;
  }
  const allies = squadUnits(s).filter((p) => p !== u && canAct(p));
  if (!allies.some((p) => cheb(p, u) <= 3)) d += 8;
  if (partnersOf(s, u, "bonded").some(({ p }) => canAct(p) && cheb(p, u) <= 1)) d -= 10;
  const ace = s.aceId && squadUnits(s).find((p) => p.soldierId === s.aceId);
  if (ace && ace !== u && canAct(ace) && cheb(ace, u) <= 3) d -= 6;
  d -= (u.will ?? 40) / 20;
  addFear(s, u, d);
}

// ---------- turn flow ----------

function beginPlayerTurn(s: CombatState, first = false) {
  s.side = "squad";
  if (!first) fx(s, { k: "turn", side: "squad" });
  for (const u of squadUnits(s)) {
    if (!alive(u)) continue;
    u.overwatch = false;
    u.spot = undefined;
    if (u.rageTurns > 0) u.rageTurns--;
    if (u.downed) {
      u.ap = 0;
      if (!u.stabilized) {
        u.bleed--;
        if (u.bleed <= 0) killUnit(s, u, "bled out");
        else log(s, "warn", `${u.name} is bleeding out: ${u.bleed} turn${u.bleed > 1 ? "s" : ""}.`);
      }
      continue;
    }
    u.ap = 2;
    if (!first) turnStartFear(s, u);
  }
  // habits that fire before Command gets control
  for (const u of squadUnits(s)) {
    if (!canAct(u)) continue;
    for (const eff of u.effects) {
      if (eff.effect === "freeze-when-flanked") {
        const flankers = enemyUnits(s).filter((e) => canAct(e) && e.active && hasLos(s, e, u) && coverAgainst(s, u, e) === 0);
        if (flankers.length && u.ap > 1) {
          u.ap = 1;
          log(s, "habit", `${u.name} ${eff.text}. Loses a beat.`);
          float(s, u, "FREEZES", "habit");
          event(s, "habit", u, undefined, eff.text);
        }
      }
      if (eff.effect === "break-toward" && eff.value) {
        const them = squadUnits(s).find((p) => p.soldierId === eff.value);
        if (them && them.downed && alive(them) && cheb(them, u) > 1 && u.ap > 0) {
          const opts = reachable(s, u, u.mobility);
          let best: Pt | undefined, bd = Infinity;
          for (const [i] of opts) {
            const p = { x: i % s.w, y: Math.floor(i / s.w) };
            if (occupied(s, p.x, p.y, u)) continue;
            const d = dist(p, them);
            if (d < bd) { bd = d; best = p; }
          }
          if (best) {
            log(s, "habit", `${u.name} breaks cover toward ${them.name} before anyone gives the order.`);
            float(s, u, `→ ${them.name}`, "habit");
            event(s, "habit", u, them, eff.text);
            u.ap -= 1;
            walk(s, u, pathTo(s, opts, best.x, best.y));
          }
        }
      }
    }
  }
  checkActivation(s);
  checkOutcome(s);
}

export function endTurn(s: CombatState) {
  if (s.outcome || s.side !== "squad") return;
  // adjacency: bonds form between people who hold the same wall
  const sq = squadUnits(s).filter(canAct);
  for (let i = 0; i < sq.length; i++)
    for (let j = i + 1; j < sq.length; j++)
      if (cheb(sq[i], sq[j]) <= 1 && sq[i].soldierId && sq[j].soldierId) {
        const k = pairKey(sq[i].soldierId!, sq[j].soldierId!);
        s.adjacency[k] = (s.adjacency[k] ?? 0) + 1;
      }
  for (const u of squadUnits(s)) u.ap = 0;
  enemyTurn(s);
  if (s.outcome) return;
  s.turn++;
  beginPlayerTurn(s);
}

function enemyTurn(s: CombatState) {
  s.side = "accord";
  fx(s, { k: "turn", side: "accord" });
  checkActivation(s);
  for (const e of enemyUnits(s)) {
    if (s.outcome) return;
    if (!canAct(e) || !e.active) continue;
    e.overwatch = false;
    e.ap = 2;
    if (e.scamper) {
      // first sight of the squad: scramble to cover, no shooting this turn
      e.scamper = false;
      const to = scamperTile(s, e);
      if (to) {
        const opts = reachable(s, e, e.mobility);
        walk(s, e, pathTo(s, opts, to.x, to.y));
      }
      e.ap = 0;
      continue;
    }
    for (let guard = 0; guard < 5 && e.ap > 0 && canAct(e) && !s.outcome; guard++) {
      const d = decideEnemy(s, e);
      if (d.kind === "shoot") fire(s, e, unitById(s, d.target)!);
      else if (d.kind === "move") {
        const opts = reachable(s, e, e.mobility * e.ap);
        const c = opts.get(idx(s, d.to.x, d.to.y));
        if (!c) { e.ap = 0; break; }
        e.ap -= c.cost <= e.mobility ? 1 : 2;
        walk(s, e, pathTo(s, opts, d.to.x, d.to.y));
      } else if (d.kind === "overwatch") {
        e.overwatch = true;
        e.ap = 0;
      } else e.ap = 0;
    }
    checkActivation(s);
  }
  for (const e of enemyUnits(s)) if (e.jammed > 0) e.jammed--;
  checkOutcome(s);
}

function checkActivation(s: CombatState) {
  for (const e of enemyUnits(s)) {
    if (!canAct(e)) continue;
    const seen = squadUnits(s).some((u) => canAct(u) && (hasLos(s, u, e) || hasLos(s, e, u)));
    if (seen && !e.active) {
      for (const m of enemyUnits(s)) if (m.slot === e.slot && !m.active && canAct(m)) { m.active = true; m.scamper = true; }
    }
    if (seen && !s.seenEnemies.includes(e.id) && visibleToSquad(s, e)) {
      s.seenEnemies.push(e.id);
      log(s, "info", `Contact: ${e.name}.`);
      onEnemySighted(s, e);
    }
  }
}

function onEnemySighted(s: CombatState, e: Unit) {
  for (const u of squadUnits(s)) {
    if (!canAct(u) || u.shootFirstUsed || u.ammo <= 0) continue;
    if (!u.effects.some((x) => x.effect === "shoot-first")) continue;
    if (!hasLos(s, u, e) || !canTarget(u, e, dist(u, e))) continue;
    u.shootFirstUsed = true;
    log(s, "habit", `${u.name} fires before anyone finishes the callout.`);
    float(s, u, "FIRES FIRST", "habit");
    event(s, "habit", u, e, "shoot-first");
    fire(s, u, e, { reaction: true, free: true });
    if (!canAct(e)) return;
  }
}

function checkOutcome(s: CombatState) {
  if (s.outcome) return;
  if (enemyUnits(s).every((e) => e.dead)) {
    s.outcome = "victory";
    log(s, "info", "All hostiles down. Mission complete.");
    return;
  }
  const sq = squadUnits(s);
  if (sq.every((u) => !canAct(u))) {
    if (sq.some((u) => u.evacuated)) {
      for (const u of sq) if (u.downed && !u.dead && !u.evacuated) killUnit(s, u, "left behind");
      s.outcome = "evacuated";
      log(s, "info", "Squad evacuated. The Accord holds the field.");
    } else {
      s.outcome = "wiped";
      for (const u of sq) if (u.downed && !u.dead) killUnit(s, u, "left behind");
      log(s, "warn", "Squad lost.");
    }
  }
}

// ---------- movement ----------

/** Walk a path step by step, giving overwatch and habits a chance to fire on each tile. */
function walk(s: CombatState, u: Unit, path: Pt[]) {
  for (let i = 1; i < path.length; i++) {
    u.x = path[i].x;
    u.y = path[i].y;
    fx(s, { k: "step", id: u.id, x: u.x, y: u.y });
    reactTo(s, u);
    if (!canAct(u) || s.outcome) return;
    if (u.side === "squad") checkActivation(s);
  }
  if (u.side === "accord") checkActivation(s);
}

function reactTo(s: CombatState, mover: Unit) {
  for (const w of s.units) {
    if (w.side === mover.side || !canAct(w) || !w.overwatch || w.jammed > 0) continue;
    if (w.side === "accord" && !w.active) continue;
    if (!hasLos(s, w, mover) || !canTarget(w, mover, dist(w, mover))) continue;
    if (w.weapon === "e-melee" && cheb(w, mover) > 1) continue;
    const hold = w.effects.find((e) => e.effect === "hold-fire-on" && e.value === mover.enemyType);
    if (hold) {
      log(s, "habit", `${w.name} holds fire as the ${mover.name.toLowerCase()} crosses. ${w.name} ${hold.text}.`);
      float(s, w, "HOLDS FIRE", "habit");
      w.overwatch = false;
      continue;
    }
    w.overwatch = false;
    log(s, "info", `${w.name} — overwatch.`);
    float(s, w, "OVERWATCH", "info");
    fire(s, w, mover, { reaction: true, free: true });
    // shared overwatch: a bonded partner fires on the same trigger
    if (w.side === "squad") {
      for (const { p, info } of partnersOf(s, w, "bonded", "shared-overwatch")) {
        if (!canAct(mover) || !canAct(p) || p.ammo <= 0 || p.sharedTurn === s.turn) continue;
        if (!hasLos(s, p, mover) || !canTarget(p, mover, dist(p, mover))) continue;
        p.sharedTurn = s.turn;
        p.overwatch = false;
        log(s, "bond", `${p.name} fires on ${w.name}'s trigger.`);
        float(s, p, "SHARED OVERWATCH", "bond");
        fire(s, p, mover, { reaction: true, free: true, extraAim: -Math.round((1 - bondScale(info, p)) * 20) });
      }
    }
    if (!canAct(mover)) return;
  }
  if (mover.side === "accord" && !s.seenEnemies.includes(mover.id) && visibleToSquad(s, mover)) {
    s.seenEnemies.push(mover.id);
    log(s, "info", `Contact: ${mover.name}.`);
    onEnemySighted(s, mover);
  }
}

export interface MoveOption { x: number; y: number; cost: number; ap: 1 | 2 }

export function moveOptions(s: CombatState, u: Unit): MoveOption[] {
  if (!canAct(u) || u.ap <= 0) return [];
  const budget = u.mobility * u.ap;
  const map = reachable(s, u, budget);
  const out: MoveOption[] = [];
  for (const [i, v] of map) {
    const x = i % s.w, y = Math.floor(i / s.w);
    if ((x === u.x && y === u.y) || occupied(s, x, y, u)) continue;
    out.push({ x, y, cost: v.cost, ap: v.cost <= u.mobility ? 1 : 2 });
  }
  return out;
}

export interface Risk { highRisk: boolean; suicide: boolean; seers: number; exposedTo: number }

export function assessRisk(s: CombatState, u: Unit, dest: Pt): Risk {
  let seers = 0, exposedTo = 0, close = false;
  for (const e of enemyUnits(s)) {
    if (!canAct(e) || !e.active || !s.seenEnemies.includes(e.id)) continue;
    if (cheb(e, dest) <= 2) close = true;
    if (!hasLos(s, e, dest)) continue;
    seers++;
    if (coverAgainst(s, dest, e) === 0) exposedTo++;
  }
  return { highRisk: exposedTo >= 1 || close, suicide: exposedTo >= 2 || (seers >= 3 && exposedTo >= 1), seers, exposedTo };
}

function courage(s: CombatState, u: Unit): number {
  let c = (u.will ?? 40) + (u.commandTrust ?? 0) * 0.3;
  if (partnersOf(s, u, "bonded").some(({ p }) => canAct(p) && cheb(p, u) <= 1)) c += 15;
  const ace = s.aceId && squadUnits(s).find((p) => p.soldierId === s.aceId);
  if (ace && ace !== u && canAct(ace) && cheb(ace, u) <= 3) c += 10;
  if (s.squadMood < 0) c -= 10;
  return c;
}

/** The UI warns before confirming; it never shows the numbers. */
export function mayRefuse(u: Unit, risk: Risk): boolean {
  return u.kind === "human" && u.fearState === "terrified" && risk.highRisk;
}

/** Returns true if the order was refused. Refusal spends one action holding position. */
function checkRefusal(s: CombatState, u: Unit, risk: Risk, what: string): boolean {
  if (!mayRefuse(u, risk)) return false;
  if (u.fear - courage(s, u) <= 20) return false;
  u.ap = Math.max(0, u.ap - 1);
  bark(s, u, "refusal");
  log(s, "warn", `${u.name} refuses to ${what}. Holds position.`);
  float(s, u, "REFUSES", "warn");
  event(s, "refusal", u, undefined, what);
  return true;
}

function noteCourage(s: CombatState, u: Unit) {
  if (u.kind !== "human" || u.fearState === "steady") return;
  const gain = u.fearState === "terrified" ? 2 : 1;
  if (u.willGain === 0) event(s, "acted-afraid", u, undefined, u.fearState);
  u.willGain = Math.min(6, u.willGain + gain);
}

function flagSuicide(s: CombatState, u: Unit, risk: Risk) {
  if (u.kind !== "ai" || !risk.suicide || u.suicideFlagged) return;
  u.suicideFlagged = true;
  event(s, "suicide-order", u);
  log(s, "warn", `${u.name} moves into the open without a word. The squad watches Command send it.`);
}

export interface OrderResult { ok: boolean; refused?: boolean; msg?: string }

export function orderMove(s: CombatState, u: Unit, x: number, y: number): OrderResult {
  if (s.side !== "squad" || s.outcome || !canAct(u) || u.side !== "squad") return { ok: false, msg: "can't act" };
  const opt = moveOptions(s, u).find((o) => o.x === x && o.y === y);
  if (!opt || opt.ap > u.ap) return { ok: false, msg: "out of reach" };
  const risk = assessRisk(s, u, { x, y });
  if (risk.highRisk && checkRefusal(s, u, risk, "move into the open")) return { ok: true, refused: true };
  flagSuicide(s, u, risk);
  if (risk.highRisk) noteCourage(s, u);
  u.ap -= opt.ap;
  const map = reachable(s, u, u.mobility * (opt.ap));
  walk(s, u, pathTo(s, map, x, y));
  checkOutcome(s);
  return { ok: true };
}

// ---------- shooting ----------

export interface Target { unit: Unit; info: ShotInfo }

export function targetsFor(s: CombatState, u: Unit): Target[] {
  if (!canAct(u)) return [];
  const foes = u.side === "squad" ? enemyUnits(s) : squadUnits(s);
  const out: Target[] = [];
  for (const t of foes) {
    if (!canAct(t)) continue;
    const d = dist(u, t);
    if (!canTarget(u, t, d) || !hasLos(s, u, t, Math.max(SIGHT, WEAPONS[u.weapon].maxRange))) continue;
    if (u.weapon === "e-melee" && cheb(u, t) > 1) continue;
    if (u.side === "squad" && !s.seenEnemies.includes(t.id)) continue;
    out.push({ unit: t, info: shotInfo(s, u, t) });
  }
  return out.sort((a, b) => b.info.hit - a.info.hit);
}

function fire(s: CombatState, a: Unit, t: Unit, o: { reaction?: boolean; free?: boolean; extraAim?: number } = {}) {
  if (!canAct(a) || !canAct(t)) return;
  // covering lunge: a bonded partner steps into the shot
  if (a.side === "accord" && t.side === "squad") {
    for (const { p, info } of partnersOf(s, t, "bonded", "lunge")) {
      if (p.lungeUsed || !canAct(p) || cheb(p, t) > 2 || bondScale(info, p) < 0.5) continue;
      let spot: Pt = { x: p.x, y: p.y }, best = dist(p, a);
      for (const d of DIRS8) {
        const q = { x: t.x + d.x, y: t.y + d.y };
        if (!inBounds(s, q.x, q.y) || tileAt(s, q.x, q.y) !== "floor" || occupied(s, q.x, q.y, p)) continue;
        const dq = dist(q, a);
        if (dq < dist(t, a) && dq < best + 2) { spot = q; best = dq; }
      }
      p.x = spot.x; p.y = spot.y;
      fx(s, { k: "place", id: p.id, x: p.x, y: p.y });
      float(s, p, "COVERING LUNGE", "bond");
      p.lungeUsed = true;
      log(s, "bond", `${p.name} throws themself between ${t.name} and the shot.`);
      event(s, "lunge", p, t);
      t = p;
      break;
    }
  }
  const info = shotInfo(s, a, t, { reaction: o.reaction, extraAim: o.extraAim });
  if (a.side === "squad") {
    a.ammo = Math.max(0, a.ammo - 1);
    noteCourage(s, a);
  }
  if (!o.free) a.ap = 0;
  const r = roll(s) * 100;
  if (r < info.hit) {
    let dmg = rollInt(s, a.dmg[0], a.dmg[1]);
    const crit = roll(s) * 100 < info.crit;
    if (crit) dmg = Math.round(dmg * 1.5);
    fx(s, { k: "shot", from: a.id, to: t.id, hit: true, dmg, crit });
    log(s, "hit", `${a.name} hits ${t.name} for ${dmg}${crit ? " (critical)" : ""}. [${info.hit}%]`);
    damage(s, t, dmg, a, info.flanked);
  } else {
    fx(s, { k: "shot", from: a.id, to: t.id, hit: false, dmg: 0, crit: false });
    log(s, "miss", `${a.name} misses ${t.name}. [${info.hit}%]`);
    if (a.side === "squad" && roll(s) < 0.3) bark(s, a, "miss");
  }
  checkOutcome(s);
}

function damage(s: CombatState, t: Unit, dmg: number, src: Unit | null, exposed: boolean) {
  applyDamage(s, t, dmg, src, exposed);
  fxUnit(s, t);
}

function applyDamage(s: CombatState, t: Unit, dmg: number, src: Unit | null, exposed: boolean) {
  t.hp -= dmg;
  if (t.side === "squad") {
    s.damageTaken[t.soldierId!] = (s.damageTaken[t.soldierId!] ?? 0) + dmg;
    if (exposed && src) event(s, "flanked", t, src);
  }
  if (t.side === "accord") {
    if (t.hp <= 0) {
      t.hp = 0;
      t.dead = true;
      log(s, "info", `${t.name} destroyed.`);
      if (src && src.side === "squad") {
        src.kills++;
        event(s, "kill", src, undefined, t.enemyType);
        addFear(s, src, -15);
        if (roll(s) < 0.6) bark(s, src, "kill");
      }
    }
    return;
  }
  if (t.hp > 0) {
    addFear(s, t, 10);
    if (t.hp <= 2) event(s, "near-death", t, src ?? undefined);
    const partner = partnersOf(s, t, "familiar").find(({ p }) => canAct(p));
    if (partner && roll(s) < 0.5) bark(s, partner.p, "partnerHit", t);
    return;
  }
  const overkill = -t.hp;
  t.hp = 0;
  if (overkill >= t.maxHp) {
    killUnit(s, t, "killed outright");
    return;
  }
  t.downed = true;
  t.bleed = 3;
  t.overwatch = false;
  t.ap = 0;
  bark(s, t, "downed");
  log(s, "warn", `${t.name} is down and bleeding.`);
  event(s, "downed", t, src ?? undefined);
  onAllyDown(s, t, 20, 30);
}

function onAllyDown(s: CombatState, t: Unit, fearAll: number, fearPartner: number) {
  let barked = false;
  for (const u of squadUnits(s)) {
    if (u === t || !canAct(u)) continue;
    const info = pairOf(s, u, t);
    const isPartner = !!info && TIER_RANK[info.tier] >= 1;
    if (isPartner || hasLos(s, u, t) || cheb(u, t) <= 2) addFear(s, u, isPartner ? fearPartner : fearAll);
    if (isPartner && !barked) { bark(s, u, "partnerHit", t); barked = true; }
    if (info && TIER_RANK[info.tier] >= 3 && info.actions.includes("rage-reload") && !t.dead) {
      u.rageTurns = 2;
      u.ammo = u.clip;
      log(s, "bond", `${u.name} slams a fresh magazine home and stops taking cover.`);
      float(s, u, "RAGE RELOAD", "bond");
    }
  }
}

function killUnit(s: CombatState, u: Unit, how: string) {
  if (u.dead) return;
  u.dead = true;
  u.downed = false;
  u.hp = 0;
  log(s, "warn", `${u.name} is dead (${how}).`);
  fxUnit(s, u);
  event(s, "died", u, undefined, how);
  if (how !== "left behind") onAllyDown(s, u, 15, 25);
}

export function orderShoot(s: CombatState, u: Unit, t: Unit): OrderResult {
  if (s.side !== "squad" || s.outcome || !canAct(u) || u.ap <= 0) return { ok: false, msg: "can't act" };
  if (u.ammo <= 0) return { ok: false, msg: "out of ammo" };
  if (!targetsFor(s, u).some((x) => x.unit === t)) return { ok: false, msg: "no shot" };
  fire(s, u, t);
  return { ok: true };
}

// ---------- other actions ----------

function spend(s: CombatState, u: Unit, ap = 1): boolean {
  if (s.side !== "squad" || s.outcome || !canAct(u) || u.ap < ap) return false;
  u.ap -= ap;
  return true;
}

export function orderOverwatch(s: CombatState, u: Unit): OrderResult {
  if (u.ammo <= 0) return { ok: false, msg: "out of ammo" };
  if (!spend(s, u)) return { ok: false };
  u.ap = 0;
  u.overwatch = true;
  log(s, "info", `${u.name} on overwatch.`);
  float(s, u, "OVERWATCH", "info");
  return { ok: true };
}

export function orderReload(s: CombatState, u: Unit): OrderResult {
  if (u.ammo >= u.clip) return { ok: false, msg: "full" };
  if (!spend(s, u)) return { ok: false };
  u.ammo = u.clip;
  log(s, "info", `${u.name} reloads.`);
  float(s, u, "RELOAD", "info");
  return { ok: true };
}

export function orderEvac(s: CombatState, u: Unit): OrderResult {
  if (!s.evac.some((p) => p.x === u.x && p.y === u.y)) return { ok: false, msg: "not in the evac zone" };
  if (!spend(s, u)) return { ok: false };
  u.evacuated = true;
  u.ap = 0;
  log(s, "info", `${u.name} evacuates.`);
  fxUnit(s, u);
  event(s, "evac", u);
  checkOutcome(s);
  return { ok: true };
}

const rescueRisk = (s: CombatState, target: Unit): Risk => {
  const r = assessRisk(s, target, target);
  return { ...r, highRisk: r.seers > 0 };
};

export function stabilizeTargets(s: CombatState, u: Unit): Unit[] {
  const range = u.cls === "support" || u.talents.includes("field-medic") ? 2 : 1;
  return squadUnits(s).filter((t) => t !== u && t.downed && alive(t) && !t.stabilized && cheb(u, t) <= range);
}

export function orderStabilize(s: CombatState, u: Unit, t: Unit): OrderResult {
  if (!stabilizeTargets(s, u).includes(t)) return { ok: false, msg: "can't reach" };
  if (u.ap < 1) return { ok: false };
  if (checkRefusal(s, u, rescueRisk(s, t), `go to ${t.name} under fire`)) return { ok: true, refused: true };
  spend(s, u);
  t.stabilized = true;
  log(s, "info", `${u.name} stabilizes ${t.name}.`);
  float(s, t, "STABLE", "bond");
  bark(s, u, "rescue", t);
  event(s, "rescue", u, t, "stabilized");
  noteCourage(s, u);
  addFear(s, u, -20);
  return { ok: true };
}

export function medkitTargets(s: CombatState, u: Unit): Unit[] {
  if (u.medkits <= 0) return [];
  return squadUnits(s).filter((t) => alive(t) && cheb(u, t) <= 1 && (t.downed || t.hp < t.maxHp));
}

export function orderMedkit(s: CombatState, u: Unit, t: Unit): OrderResult {
  if (!medkitTargets(s, u).includes(t)) return { ok: false, msg: "no target" };
  if (u.ap < 1) return { ok: false };
  if (t.downed && t !== u && checkRefusal(s, u, rescueRisk(s, t), `go to ${t.name} under fire`)) return { ok: true, refused: true };
  spend(s, u);
  u.medkits--;
  if (t.downed) {
    t.downed = false;
    t.stabilized = false;
    t.hp = 2;
    t.ap = 0;
    log(s, "info", `${u.name} gets ${t.name} back on their feet.`);
    fxUnit(s, t);
    float(s, t, "REVIVED", "bond");
    bark(s, u, "rescue", t);
    event(s, "rescue", u, t, "revived");
    addFear(s, u, -20);
    noteCourage(s, u);
  } else {
    t.hp = Math.min(t.maxHp, t.hp + 4);
    log(s, "info", `${u.name} patches up ${t === u ? "themself" : t.name}.`);
    fxUnit(s, t);
    float(s, t, "+4", "bond");
  }
  return { ok: true };
}

export function dragTargets(s: CombatState, u: Unit): Unit[] {
  return partnersOf(s, u, "familiar", "drag").map(({ p }) => p).filter((p) => p.downed && alive(p) && cheb(u, p) <= 1);
}

/** Bond action: pull a downed partner one tile into the best available cover. */
export function orderDrag(s: CombatState, u: Unit, t: Unit): OrderResult {
  if (!dragTargets(s, u).includes(t) || u.ap < 1) return { ok: false, msg: "can't reach" };
  if (checkRefusal(s, u, rescueRisk(s, t), `drag ${t.name} under fire`)) return { ok: true, refused: true };
  const foes = enemyUnits(s).filter((e) => canAct(e) && e.active);
  let best: Pt | undefined, bs = -Infinity;
  for (const d of DIRS8) {
    const q = { x: t.x + d.x, y: t.y + d.y };
    if (!inBounds(s, q.x, q.y) || tileAt(s, q.x, q.y) !== "floor" || occupied(s, q.x, q.y)) continue;
    const score = foes.reduce((acc, e) => acc + (hasLos(s, e, q) ? coverAgainst(s, q, e) - 40 : 10), 0);
    if (score > bs) { bs = score; best = q; }
  }
  if (!best) return { ok: false, msg: "nowhere to drag" };
  spend(s, u);
  t.x = best.x; t.y = best.y;
  fx(s, { k: "place", id: t.id, x: t.x, y: t.y });
  float(s, u, "DRAG TO COVER", "bond");
  log(s, "bond", `${u.name} grabs ${t.name} by the harness and hauls them into cover.`);
  bark(s, u, "rescue", t);
  event(s, "drag", u, t);
  event(s, "rescue", u, t, "dragged");
  addFear(s, u, -20);
  noteCourage(s, u);
  return { ok: true };
}

export function spotTargets(s: CombatState, u: Unit): { target: Unit; partner: Unit; bonus: number }[] {
  const out: { target: Unit; partner: Unit; bonus: number }[] = [];
  for (const { p, info } of partnersOf(s, u, "familiar", "spotter")) {
    if (!canAct(p) || p.ap <= 0) continue;
    for (const t of targetsFor(s, u)) out.push({ target: t.unit, partner: p, bonus: Math.round(15 * bondScale(info, p)) });
  }
  return out;
}

export function orderSpot(s: CombatState, u: Unit, partner: Unit, t: Unit): OrderResult {
  const opt = spotTargets(s, u).find((o) => o.partner === partner && o.target === t);
  if (!opt || !spend(s, u)) return { ok: false };
  partner.spot = { targetId: t.id, bonus: opt.bonus };
  log(s, "bond", `${u.name} calls the ${t.name.toLowerCase()} for ${partner.name}. (+${opt.bonus} Aim)`);
  float(s, t, `SPOTTED +${opt.bonus}`, "bond");
  return { ok: true };
}

export function jamTargets(s: CombatState, u: Unit): Unit[] {
  if (u.jams <= 0) return [];
  return enemyUnits(s).filter((e) => canAct(e) && s.seenEnemies.includes(e.id) && dist(u, e) <= 10 && hasLos(s, u, e));
}

export function orderJam(s: CombatState, u: Unit, t: Unit): OrderResult {
  if (!jamTargets(s, u).includes(t) || !spend(s, u)) return { ok: false };
  u.jams--;
  t.jammed = 1;
  t.overwatch = false;
  log(s, "info", `${u.name} jams the ${t.name.toLowerCase()}'s targeting.`);
  float(s, t, "JAMMED", "info");
  return { ok: true };
}

export function orderGrenade(s: CombatState, u: Unit, x: number, y: number): OrderResult {
  if (u.grenades <= 0 || dist(u, { x, y }) > 8) return { ok: false, msg: "out of range" };
  if (!spend(s, u)) return { ok: false };
  u.grenades--;
  u.ap = 0;
  log(s, "info", `${u.name} throws a grenade.`);
  fx(s, { k: "blast", x, y });
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx, py = y + dy;
      if (!inBounds(s, px, py)) continue;
      if (s.tiles[idx(s, px, py)] === "half") s.tiles[idx(s, px, py)] = "floor";
      const victim = s.units.find((v) => alive(v) && v.x === px && v.y === py);
      if (victim) {
        log(s, "hit", `Blast hits ${victim.name} for 3.`);
        damage(s, victim, 3, u, false);
      }
    }
  checkActivation(s);
  checkOutcome(s);
  return { ok: true };
}
