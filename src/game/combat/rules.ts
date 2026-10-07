import { ENEMY_TYPES, type EnemyTypeId } from "../content";
import { clamp } from "../rng";
import type { ClassId, Soldier } from "../types";
import { coverAgainst, dist, hasAnyCover } from "./grid";
import type { CombatState, Unit, WeaponId } from "./types";

export const WEAPONS: Record<WeaponId, { name: string; dmg: [number, number]; clip: number; rangeMod: (d: number) => number; maxRange: number }> = {
  cannon: { name: "Cannon", dmg: [4, 6], clip: 3, rangeMod: (d) => (d > 10 ? -5 : 0), maxRange: 11 },
  shotgun: { name: "Shotgun", dmg: [4, 6], clip: 4, rangeMod: (d) => (d <= 2 ? 30 : d <= 4 ? 15 : d <= 7 ? 0 : -25), maxRange: 11 },
  smg: { name: "SMG", dmg: [2, 4], clip: 5, rangeMod: (d) => (d <= 4 ? 10 : d <= 8 ? 0 : -15), maxRange: 11 },
  rifle: { name: "Rifle", dmg: [4, 6], clip: 3, rangeMod: (d) => (d <= 3 ? -20 : d >= 8 ? 10 : 0), maxRange: 14 },
  carbine: { name: "Carbine", dmg: [3, 5], clip: 4, rangeMod: (d) => (d <= 5 ? 5 : 0), maxRange: 11 },
  sidearm: { name: "Sidearm", dmg: [2, 4], clip: 6, rangeMod: (d) => (d <= 5 ? 5 : d > 8 ? -15 : 0), maxRange: 10 },
  "e-mid": { name: "Pulse", dmg: [3, 5], clip: 99, rangeMod: (d) => (d <= 5 ? 5 : d > 9 ? -10 : 0), maxRange: 11 },
  "e-long": { name: "Rail", dmg: [4, 7], clip: 99, rangeMod: (d) => (d >= 7 ? 5 : 0), maxRange: 13 },
  "e-melee": { name: "Blades", dmg: [4, 6], clip: 99, rangeMod: () => 0, maxRange: 1.5 },
};

const CLASS_WEAPON: Record<ClassId, WeaponId> = {
  heavy: "cannon", assault: "shotgun", scout: "smg", sniper: "rifle", support: "carbine", ew: "sidearm",
};

export function squadUnit(s: Soldier, slot: number, pos: { x: number; y: number }): Unit {
  const weapon = CLASS_WEAPON[s.class];
  const w = WEAPONS[weapon];
  const heavy = s.loadout === "heavy";
  const effects = s.traits.filter((t) => t.combatEffect).map((t) => ({ effect: t.combatEffect!, value: t.trigger?.value, text: t.text }));
  const has = (t: string) => s.talents.includes(t);
  let mobility = s.stats.mobility + (heavy ? -1 : 1) + (has("quick") ? 1 : 0);
  let defense = s.stats.defense + (heavy ? 5 : 0);
  if (effects.some((e) => e.effect === "double-check")) { mobility -= 1; defense += 5; }
  const maxHp = s.stats.hp + (heavy ? 2 : -1) + (has("hardened") ? 1 : 0);
  return {
    id: `u_${s.id}`,
    side: "squad",
    name: s.callsign,
    soldierId: s.id,
    kind: s.kind,
    cls: s.class,
    loadout: s.loadout,
    voice: s.voice,
    barks: s.barks,
    x: pos.x,
    y: pos.y,
    slot,
    hp: maxHp,
    maxHp,
    ap: 2,
    aim: s.stats.aim + (heavy ? 0 : 5) + (has("steady-aim") ? 5 : 0),
    defense,
    mobility,
    weapon,
    dmg: w.dmg,
    ammo: w.clip,
    clip: w.clip,
    overwatch: false,
    downed: false,
    bleed: 0,
    stabilized: false,
    dead: false,
    evacuated: false,
    active: true,
    will: s.kind === "human" ? s.stats.will : undefined,
    commandTrust: s.commandTrust,
    fear: 0,
    fearState: "steady",
    willGain: 0,
    terrifiedEver: false,
    grenades: s.class === "heavy" ? 1 + (has("deep-pockets") ? 1 : 0) : 0,
    medkits: s.class === "support" ? 2 + (has("deep-pockets") ? 1 : 0) : 0,
    jams: s.class === "ew" ? 2 + (has("deep-pockets") ? 1 : 0) : 0,
    jammed: 0,
    rageTurns: 0,
    lungeUsed: false,
    shootFirstUsed: false,
    suicideFlagged: false,
    talents: s.talents,
    effects,
    rank: s.rank,
    kills: 0,
  };
}

export function enemyUnit(type: EnemyTypeId, id: string, pos: { x: number; y: number }, difficulty: number): Unit {
  const t = ENEMY_TYPES[type];
  const weapon: WeaponId = t.range === "melee" ? "e-melee" : t.range === "long" ? "e-long" : "e-mid";
  const hp = t.hp + Math.floor((difficulty - 1) / 2);
  return {
    id, side: "accord", name: t.name, enemyType: type, x: pos.x, y: pos.y, slot: -1,
    hp, maxHp: hp, ap: 2, aim: t.aim + (difficulty - 1) * 3, defense: t.defense, mobility: t.mobility,
    weapon, dmg: [...t.dmg], ammo: 99, clip: 99, overwatch: false, downed: false, bleed: 0, stabilized: false,
    dead: false, evacuated: false, active: false, fear: 0, fearState: "steady", willGain: 0, terrifiedEver: false,
    grenades: 0, medkits: 0, jams: 0, jammed: 0, rageTurns: 0, lungeUsed: false, shootFirstUsed: false,
    suicideFlagged: false, talents: [], effects: [], rank: 0, kills: 0,
  };
}

export const alive = (u: Unit) => !u.dead && !u.evacuated;
export const canAct = (u: Unit) => alive(u) && !u.downed;

export function isFlanked(s: CombatState, target: Unit, attacker: Unit): boolean {
  return coverAgainst(s, target, attacker) === 0;
}

export interface ShotInfo { hit: number; crit: number; cover: number; flanked: boolean; dist: number; notes: string[] }

export function shotInfo(s: CombatState, a: Unit, t: Unit, opts: { reaction?: boolean; from?: { x: number; y: number }; extraAim?: number } = {}): ShotInfo {
  const from = opts.from ?? a;
  const d = dist(from, t);
  const notes: string[] = [];
  const w = WEAPONS[a.weapon];
  let aim = a.aim + w.rangeMod(d);
  if (opts.extraAim) aim += opts.extraAim;
  // rage reload: target hunts without cover
  let cover = t.rageTurns > 0 || a.weapon === "e-melee" ? 0 : coverAgainst(s, t, from);
  if (t.rageTurns > 0) notes.push("target raging: no cover");
  if (a.fearState === "shaken") { aim -= 10; notes.push("shaken −10"); }
  if (a.fearState === "terrified") { aim -= 20; notes.push("terrified −20"); }
  if (a.jammed > 0) { aim -= 25; notes.push("jammed −25"); }
  if (a.rageTurns > 0) { aim += 20; notes.push("rage +20"); }
  if (a.spot && a.spot.targetId === t.id) { aim += a.spot.bonus; notes.push(`spotter +${a.spot.bonus}`); }
  if (opts.reaction) { aim -= 15; notes.push("reaction −15"); }
  if (a.effects.some((e) => e.effect === "steady-under-fire") && a.hp < a.maxHp) { aim += 10; notes.push("steady hands +10"); }
  const flanked = cover === 0 && hasAnyCover(s, t);
  const exposed = cover === 0;
  if (cover) notes.push(`${cover === 20 ? "half" : "full"} cover −${cover}`);
  else notes.push(flanked ? "flanked" : "in the open");
  const hit = clamp(Math.round(aim - cover - t.defense), 5, 95);
  const crit = clamp((exposed ? (a.side === "squad" ? 40 : 30) : 5) + (a.weapon === "shotgun" && d <= 3 ? 15 : 0), 0, 100);
  return { hit, crit, cover, flanked: exposed, dist: d, notes };
}

export function canTarget(a: Unit, t: Unit, d: number): boolean {
  return d <= WEAPONS[a.weapon].maxRange;
}
