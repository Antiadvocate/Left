import { AI_NAMES, AI_SIZES, AI_VOICES, BARKS, HABIT_POOL, HUMAN_FIRST, HUMAN_LAST, HUMAN_VOICES } from "./content";
import { Rng, clamp, uid } from "./rng";
import type { Attachment, ClassId, Habit, Soldier, SoldierKind, Stats } from "./types";

const CLASS_IDS: ClassId[] = ["heavy", "assault", "scout", "sniper", "support", "ew"];

const CLASS_MODS: Record<ClassId, Partial<Stats>> = {
  heavy: { hp: 2, mobility: -1 },
  assault: { hp: 1 },
  scout: { mobility: 2, aim: -5 },
  sniper: { aim: 10, hp: -1 },
  support: { tech: 10 },
  ew: { tech: 20, aim: -5 },
};

const CAPACITY: Record<Attachment, number> = { secure: 4, anxious: 1, avoidant: 2, disorganized: 0 };

function rollAttachment(rng: Rng): Attachment {
  return rng.weighted<Attachment>(["secure", "anxious", "avoidant", "disorganized"], (a) =>
    a === "secure" ? 40 : a === "anxious" ? 25 : a === "avoidant" ? 25 : 10,
  )!;
}

export function rollHabits(rng: Rng, kind: SoldierKind): Habit[] {
  const fits = HABIT_POOL.filter((h) => (kind === "ai" ? !h.human : !h.ai));
  const wounds = fits.filter((h) => h.wound);
  const picked: typeof fits = [rng.pick(wounds)];
  // roughly half hinder, half help across the three
  const want = picked[0].valence === "hinder" ? ["help", rng.chance(0.5) ? "help" : "hinder"] : ["hinder", rng.chance(0.5) ? "help" : "hinder"];
  for (const v of want) {
    const options = fits.filter((h) => h.valence === v && !picked.includes(h) && !(h.combatEffect && picked.some((p) => p.combatEffect === h.combatEffect)));
    if (options.length) picked.push(rng.pick(options));
  }
  return picked.map(({ ai: _a, human: _h, ...h }) => ({ ...h, id: uid("habit", rng) }));
}

export function makeSoldier(rng: Rng, kind: SoldierKind, cls: ClassId | undefined, day: number, taken: Set<string>): Soldier {
  const klass = cls ?? rng.pick(CLASS_IDS);
  let name = "";
  let callsign = "";
  for (let i = 0; i < 50; i++) {
    if (kind === "human") {
      const first = rng.pick(HUMAN_FIRST), last = rng.pick(HUMAN_LAST);
      name = `${first} ${last}`;
      callsign = last;
    } else {
      const n = rng.pick(AI_NAMES);
      name = `${n}-${rng.pick(AI_SIZES)}`;
      callsign = n;
    }
    if (!taken.has(callsign)) break;
  }
  taken.add(callsign);
  const base: Stats = { aim: 63 + rng.int(-4, 4), hp: 6, mobility: 4, defense: 0, tech: 45 + rng.int(-5, 10) };
  if (kind === "human") base.will = 40 + rng.int(-10, 20);
  const mods = CLASS_MODS[klass];
  const stats: Stats = { ...base };
  for (const k of Object.keys(mods) as (keyof Stats)[]) stats[k] = (stats[k] ?? 0) + (mods[k] ?? 0);
  if (kind === "ai") {
    // marginally higher on day one (+5 to 10%), plateaus later
    const m = 1.05 + rng.next() * 0.05;
    stats.aim = Math.round(stats.aim * m);
    stats.tech = Math.round(stats.tech * m);
    stats.hp = stats.hp + 1;
    stats.defense = 5;
  }
  const attachment = rollAttachment(rng);
  const capacity = CAPACITY[attachment] + rng.int(-1, 2);
  const voice = kind === "ai" ? rng.pick(AI_VOICES) : rng.pick(HUMAN_VOICES);
  const relaxation = clamp(capacity - rng.int(0, 4), -10, 10);
  return {
    id: uid("sol", rng),
    name,
    callsign,
    kind,
    class: klass,
    loadout: rng.chance(0.5) ? "heavy" : "light",
    rank: 0,
    xp: 0,
    stats,
    talents: kind === "ai" ? [rng.pick(["steady-aim", "hardened", "quick", "deep-pockets"])] : [],
    traits: rollHabits(rng, kind),
    voice,
    attachment,
    relaxation,
    braced: relaxation < -3,
    capacity,
    commandTrust: kind === "ai" ? 30 : 10 + rng.int(-10, 10),
    wasTerrified: false,
    memories: [],
    status: "active",
    recoveryDays: 0,
    kills: 0,
    missions: 0,
    barks: structuredClone(BARKS[voice]),
    joinedDay: day,
  };
}

export function makeRoster(rng: Rng, size = 12, aiShare = 0.3): Soldier[] {
  const taken = new Set<string>();
  const aiCount = Math.round(size * aiShare);
  const out: Soldier[] = [];
  // guarantee every class shows up at least once
  const classes = rng.shuffle([...CLASS_IDS, ...CLASS_IDS, ...Array.from({ length: Math.max(0, size - 12) }, () => rng.pick(CLASS_IDS))]).slice(0, size);
  for (let i = 0; i < size; i++) out.push(makeSoldier(rng, i < aiCount ? "ai" : "human", classes[i], 1, taken));
  return rng.shuffle(out);
}

export const RANKS = ["Rookie", "Private", "Corporal", "Sergeant", "Lieutenant", "Captain"];
export const XP_FOR_RANK = [0, 3, 8, 15, 25, 40];

/** Promotion: humans grow normally and gain talents; AI grows slower and keeps fixed talents. */
export function promote(s: Soldier, rng: Rng): string | null {
  const next = s.rank + 1;
  if (next >= XP_FOR_RANK.length || s.xp < XP_FOR_RANK[next]) return null;
  s.rank = next;
  if (s.kind === "human") {
    s.stats.aim += 4;
    if (next % 2 === 0) s.stats.hp += 1;
    s.stats.will = (s.stats.will ?? 40) + 3;
    const options = ["steady-aim", "hardened", "cool-head", "quick", "field-medic", "deep-pockets"].filter((t) => !s.talents.includes(t));
    if (options.length) s.talents.push(rng.pick(options));
  } else {
    s.stats.aim += 1;
    if (next === 3) s.stats.hp += 1;
  }
  return `${s.callsign} promoted to ${RANKS[next]}.`;
}
