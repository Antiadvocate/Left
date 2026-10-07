// The day loop: Command → (deploy → combat → debrief) → night pass → next day.
// Battlefield events become deterministic relationship deltas and memories at debrief;
// the night pass then adds texture and its own clamped deltas.

import { MISSION_TYPES, PLACES } from "./content";
import { pairKey } from "./combat/engine";
import type { CombatState, PairInfo } from "./combat/types";
import { addMemory, decayMemories } from "./memory";
import { runNightPass, type NightOptions } from "./night";
import { applyDelta, bondScale, edge, living, mutualTier, nudgeRelaxation, pairActions, resetDaily, tierRank } from "./relations";
import { makeRoster, makeSoldier, promote } from "./roster";
import { Rng, clamp, uid } from "./rng";
import type { CampaignState, ClassId, DoctrineProfile, MissionResult, MissionSpec, NightReport, Soldier } from "./types";

export const POD_NAMES = ["A", "B", "C", "D"];

export function newCampaign(seed = Math.floor(Math.random() * 1e9)): CampaignState {
  const rng = new Rng(seed);
  const roster = makeRoster(rng, 12, 0.3);
  const bunks = POD_NAMES.map((p) => [1, 2, 3, 4].map((n) => `${p}${n}`));
  const st: CampaignState = {
    version: 1,
    seed,
    day: 1,
    act: 1,
    funds: 100,
    haldenContract: true,
    dataSharing: false,
    monolithTraining: 0,
    regionPanic: { Northwest: 1, Midwest: 1, South: 1, Northeast: 1 },
    history: [],
    soldiers: Object.fromEntries(roster.map((s) => [s.id, s])),
    edges: {},
    bunks,
    missions: [],
    pastMissions: [],
    nightLog: [],
    memorial: [],
    refusalReviews: [],
    recentBunkChanges: [],
    rngState: rng.state,
  };
  const free = rng.shuffle(bunks.flat());
  roster.forEach((s, i) => (s.bunkId = free[i]));
  for (const a of roster) for (const b of roster) if (a !== b) edge(st, a.id, b.id);
  ensureMission(st);
  return st;
}

export function withRng<T>(st: CampaignState, f: (rng: Rng) => T): T {
  const rng = new Rng(st.rngState);
  const out = f(rng);
  st.rngState = rng.state;
  return out;
}

// ---------- missions ----------

export function ensureMission(st: CampaignState) {
  if (st.missions.some((m) => m.day >= st.day)) return;
  withRng(st, (rng) => {
    const day = st.pastMissions.length === 0 && st.day === 1 ? 2 : st.day + rng.int(1, 3);
    const type = rng.pick(MISSION_TYPES);
    const used = new Set(st.pastMissions.map((p) => p.spec.place));
    const place = rng.pick(PLACES.filter((p) => !used.has(p)).length ? PLACES.filter((p) => !used.has(p)) : PLACES);
    const spec: MissionSpec = {
      id: uid("msn", rng),
      day,
      type,
      place,
      name: `the ${place} ${type}`,
      seed: Math.floor(rng.next() * 1e9),
      difficulty: clamp(1 + Math.floor((day - 1) / 10), 1, 5),
    };
    st.missions.push(spec);
  });
}

export const missionToday = (st: CampaignState) => st.missions.find((m) => m.day === st.day);

export const deployable = (st: CampaignState) => living(st).filter((s) => s.status === "active");

export function squadMood(st: CampaignState): number {
  const alive = living(st);
  return alive.reduce((a, s) => a + s.commandTrust, 0) / Math.max(1, alive.length);
}

export function combatPairs(st: CampaignState, squad: Soldier[]): Record<string, PairInfo> {
  const out: Record<string, PairInfo> = {};
  for (let i = 0; i < squad.length; i++)
    for (let j = i + 1; j < squad.length; j++) {
      const a = squad[i], b = squad[j];
      out[pairKey(a.id, b.id)] = {
        tier: mutualTier(st, a.id, b.id),
        actions: pairActions(st, a.id, b.id),
        scale: { [a.id]: bondScale(st, a, b.id), [b.id]: bondScale(st, b, a.id) },
      };
    }
  return out;
}

/** Which bonds a squad choice splits: one partner deployed, the other benched. */
export function splitBonds(st: CampaignState, squadIds: string[]): { a: string; b: string; tier: string }[] {
  const out: { a: string; b: string; tier: string }[] = [];
  const avail = deployable(st);
  for (const a of avail)
    for (const b of avail) {
      if (a.id >= b.id) continue;
      const t = mutualTier(st, a.id, b.id);
      if (tierRank(t) < 2) continue;
      if (squadIds.includes(a.id) !== squadIds.includes(b.id)) out.push({ a: a.id, b: b.id, tier: t });
    }
  return out;
}

export function profileOf(squad: Soldier[], c: CombatState): DoctrineProfile {
  const n = Math.max(1, squad.length);
  const classMix = { heavy: 0, assault: 0, scout: 0, sniper: 0, support: 0, ew: 0 } as Record<ClassId, number>;
  squad.forEach((s) => (classMix[s.class] += 1 / n));
  const longRange = squad.filter((s) => s.class === "sniper").length / n;
  const shortRange = squad.filter((s) => s.class === "assault" || s.class === "scout").length / n;
  const shots = c.log.filter((l) => l.kind === "hit" || l.kind === "miss").length;
  const ow = c.log.filter((l) => l.text.endsWith("on overwatch.")).length;
  const flanks = c.events.filter((e) => e.kind === "kill").length;
  return {
    armorWeight: squad.filter((s) => s.loadout === "heavy").length / n,
    rangeMix: 0.5 + (longRange - shortRange) / 2,
    aggression: clamp(shots / Math.max(1, c.turn * n), 0, 1),
    flankRate: clamp(flanks / Math.max(1, shots), 0, 1),
    overwatchRate: clamp(ow / Math.max(1, c.turn * n), 0, 1),
    classMix,
    confidence: 0,
  };
}

export function resultFromCombat(c: CombatState): MissionResult {
  const sq = c.units.filter((u) => u.side === "squad");
  return {
    missionId: c.missionId,
    outcome: c.outcome ?? "evacuated",
    deployed: sq.map((u) => u.soldierId!),
    slots: Object.fromEntries(sq.map((u) => [u.soldierId!, u.slot])),
    events: c.events,
    adjacency: c.adjacency,
    damageTaken: c.damageTaken,
    finalHp: Object.fromEntries(sq.map((u) => [u.soldierId!, u.hp])),
    deadIds: sq.filter((u) => u.dead).map((u) => u.soldierId!),
    willGains: Object.fromEntries(sq.filter((u) => u.willGain > 0).map((u) => [u.soldierId!, u.willGain])),
    kills: Object.fromEntries(sq.map((u) => [u.soldierId!, u.kills])),
    turns: c.turn,
  };
}

export interface Debrief { lines: string[]; result: MissionResult }

/** Battlefield → barracks. All deterministic; the night pass reads the same events for texture. */
export function applyMission(st: CampaignState, spec: MissionSpec, c: CombatState): Debrief {
  const result = resultFromCombat(c);
  const lines: string[] = [];
  const terrifiedIds = new Set(c.units.filter((u) => u.terrifiedEver).map((u) => u.soldierId!));
  st.missions = st.missions.filter((m) => m.id !== spec.id);
  st.pastMissions.push({ spec, result });
  const squad = result.deployed.map((id) => st.soldiers[id]);
  st.history = [...st.history, profileOf(squad, c)].slice(-5);
  const dead = new Set(result.deadIds);
  const survivors = squad.filter((s) => !dead.has(s.id));

  withRng(st, (rng) => {
    const relax = new Map<string, number>();
    lines.push(result.outcome === "victory" ? `${spec.name}: hostiles cleared.` : result.outcome === "evacuated" ? `${spec.name}: squad pulled out.` : `${spec.name}: squad lost.`);
    st.funds += result.outcome === "victory" ? 40 : 10;

    // the shared mission itself
    for (const a of squad) {
      a.missions++;
      addMemory(st, a, { significance: 30, core: `went to ${spec.name}`, peripheral: [`${result.turns} turns`], participants: result.deployed.filter((x) => x !== a.id), feeling: result.outcome === "victory" ? "relief" : "dread", valence: result.outcome === "victory" ? 0.3 : -0.5 }, rng);
    }
    for (const a of survivors)
      for (const b of squad) {
        if (a === b) continue;
        const e = edge(st, a.id, b.id);
        e.missionsTogether++;
        e.missionsApart = 0;
        applyDelta(st, { from: a.id, to: b.id, warmth: 1, trust: 1 }, rng);
      }
    // adjacent cover over many turns
    for (const [k, turns] of Object.entries(result.adjacency)) {
      const [a, b] = k.split("|");
      if (dead.has(a) && dead.has(b)) continue;
      for (const [x, y] of [[a, b], [b, a]]) {
        edge(st, x, y).adjacentTurns += turns;
        if (!dead.has(x)) applyDelta(st, { from: x, to: y, warmth: Math.min(6, turns), trust: Math.min(5, Math.round(turns * 0.7)) }, rng);
      }
    }
    const crisis = (a: string, b: string) => { edge(st, a, b).crises++; edge(st, b, a).crises++; };
    for (const ev of result.events) {
      const actor = st.soldiers[ev.actor], target = ev.target ? st.soldiers[ev.target] : undefined;
      if (ev.kind === "rescue" && actor && target && !dead.has(target.id)) {
        const weakStrong = actor.rank < target.rank;
        applyDelta(st, { from: target.id, to: actor.id, warmth: 8, trust: weakStrong ? 15 : 10 }, rng);
        crisis(actor.id, target.id);
        addMemory(st, target, { significance: weakStrong ? 80 : 65, core: `${actor.callsign} ${ev.note === "dragged" ? "dragged them into cover" : ev.note === "revived" ? "got them back on their feet" : "kept them from bleeding out"} at ${spec.name}`, peripheral: ["the noise", "a hand on the harness"], participants: [actor.id], feeling: "owed", valence: 0.5 }, rng);
        if (!dead.has(actor.id)) addMemory(st, actor, { significance: 45, core: `went out for ${target.callsign} at ${spec.name}`, participants: [target.id], feeling: "steady", valence: 0.3 }, rng);
        lines.push(`${actor.callsign} went out for ${target.callsign}.`);
        const already = target.traits.some((t) => t.combatEffect === "break-toward" && t.trigger?.value === actor.id);
        if (!already && rng.chance(0.35) && target.traits.length < 6 && tierRank(mutualTier(st, actor.id, target.id)) >= 1) {
          target.traits.push({ id: uid("habit", rng), text: `breaks cover toward ${actor.callsign} when ${actor.callsign} goes down`, valence: "hinder", trigger: { kind: "person", value: actor.id }, combatEffect: "break-toward" });
        }
      }
      if (ev.kind === "lunge" && actor && target) {
        applyDelta(st, { from: target.id, to: actor.id, warmth: 6, trust: 10 }, rng);
        crisis(actor.id, target.id);
        addMemory(st, target, { significance: 70, core: `${actor.callsign} took a shot meant for them at ${spec.name}`, participants: [actor.id], feeling: "owed", valence: 0.4 }, rng);
      }
      if (ev.kind === "downed" && actor) {
        for (const p of survivors) {
          if (p.id === actor.id || tierRank(edge(st, p.id, actor.id).tier) < 1) continue;
          crisis(p.id, actor.id);
          addMemory(st, p, { significance: 50, core: `watched ${actor.callsign} go down at ${spec.name}`, participants: [actor.id], feeling: "cold", valence: -0.6 }, rng);
        }
      }
      if (ev.kind === "near-death" && actor && !dead.has(actor.id)) {
        addMemory(st, actor, { significance: 55, core: `nearly died at ${spec.name}`, peripheral: ["the ringing", "the smell of hot metal"], feeling: "small", valence: -0.7 }, rng);
        nudgeRelaxation(actor, -2, relax);
        const flanked = result.events.some((x) => x.kind === "flanked" && x.actor === actor.id);
        if (flanked && rng.chance(0.25) && !actor.traits.some((t) => t.combatEffect === "freeze-when-flanked") && actor.traits.length < 6) {
          actor.traits.push({ id: uid("habit", rng), text: "freezes for a beat when the shooting comes from the side", valence: "hinder", combatEffect: "freeze-when-flanked" });
        }
      }
      if (ev.kind === "refusal" && actor) {
        for (const w of survivors) {
          if (w.id === actor.id) continue;
          if (w.wasTerrified || terrifiedIds.has(w.id)) applyDelta(st, { from: w.id, to: actor.id, warmth: 2 }, rng);
          else applyDelta(st, { from: w.id, to: actor.id, trust: -4 }, rng);
        }
        if (!dead.has(actor.id) && !st.refusalReviews.some((r) => r.soldierId === actor.id)) {
          st.refusalReviews.push({ soldierId: actor.id, missionId: spec.id });
          lines.push(`${actor.callsign} refused an order.`);
        }
      }
      if (ev.kind === "suicide-order" && actor) {
        for (const h of living(st)) {
          if (h.kind !== "human" || tierRank(edge(st, h.id, actor.id).tier) < 1) continue;
          h.commandTrust = clamp(h.commandTrust - 8, -100, 100);
          addMemory(st, h, { significance: 40, core: `Command sent ${actor.callsign} into the open at ${spec.name}`, participants: [actor.id], feeling: "sour", valence: -0.5 }, rng);
        }
        lines.push(`${actor.callsign} was sent into the open. Some of the squad noticed.`);
      }
    }
    // the dead
    for (const id of result.deadIds) {
      const d = st.soldiers[id];
      d.status = "dead";
      st.memorial.push({ id, name: d.name, day: st.day, mission: spec.name });
      lines.push(`${d.name} was killed.`);
      const sentIn = result.events.some((e) => e.kind === "suicide-order" && e.actor === id);
      for (const s of living(st)) {
        const e = edge(st, s.id, id);
        if (e.warmth < 15 && tierRank(e.tier) < 1) continue;
        const deep = tierRank(e.tier) >= 2;
        addMemory(st, s, { significance: deep ? 88 : 70, core: `${d.callsign} died at ${spec.name}`, peripheral: [`${d.callsign}'s empty bunk`], participants: [id], feeling: "grief", valence: -0.9 }, rng);
        nudgeRelaxation(s, deep ? -4 : -2, relax);
        if (sentIn && s.kind === "human") s.commandTrust = clamp(s.commandTrust - 6, -100, 100);
        if (deep && s.traits.length < 6) {
          const slot = result.slots[id];
          if (s.kind === "ai" || rng.chance(0.4)) {
            s.traits = s.traits.filter((t) => t.combatEffect !== "take-dead-position");
            s.traits.push({ id: uid("habit", rng), text: `takes ${d.callsign}'s place in the line, every mission, unprompted`, valence: "hinder", trigger: { kind: "position", value: String(slot) }, combatEffect: "take-dead-position" });
          } else {
            s.traits.push({ id: uid("habit", rng), text: `won't let anyone sleep in ${d.callsign}'s bunk`, valence: "hinder", trigger: { kind: "person", value: id } });
          }
        }
      }
    }
    // survivors: injuries, will, xp
    for (const s of survivors) {
      const u = c.units.find((x) => x.soldierId === s.id)!;
      if (u.terrifiedEver) s.wasTerrified = true;
      const gain = result.willGains[s.id] ?? 0;
      if (gain && s.kind === "human") {
        s.stats.will = (s.stats.will ?? 40) + gain;
        lines.push(`${s.callsign} kept going while afraid. (+${gain} Will)`);
      }
      const dmg = result.damageTaken[s.id] ?? 0;
      const days = dmg > 0 ? Math.min(7, Math.ceil(dmg / (s.kind === "ai" ? 3 : 2)) + (u.downed ? 2 : 0)) : 0;
      if (days > 0) {
        s.status = s.kind === "ai" ? "repair" : "injured";
        s.recoveryDays = days;
        lines.push(`${s.callsign}: ${s.kind === "ai" ? "Maintenance Bay" : "Medbay"}, ${days} day${days > 1 ? "s" : ""}.`);
      }
      s.kills += result.kills[s.id] ?? 0;
      s.xp += 1 + (result.kills[s.id] ?? 0) + (result.outcome === "victory" ? 1 : 0);
      const promo = promote(s, rng);
      if (promo) lines.push(promo);
      if (result.outcome === "victory") s.commandTrust = clamp(s.commandTrust + 2, -100, 100);
    }
    // separation and jealousy: bonded partners left behind
    const benched = living(st).filter((s) => !result.deployed.includes(s.id));
    for (const b of benched)
      for (const a of survivors) {
        const t = tierRank(mutualTier(st, a.id, b.id));
        if (t < 1) continue;
        for (const [x, y] of [[a, b], [b, a]]) {
          const e = edge(st, x.id, y.id);
          e.missionsApart++;
          if (e.missionsApart >= 3) applyDelta(st, { from: x.id, to: y.id, warmth: -3 }, rng);
        }
        if (tierRank(edge(st, b.id, a.id).tier) >= 2) edge(st, b.id, a.id).rivalCount++;
      }
  });
  return { lines, result };
}

// ---------- refusal reviews ----------

export type RefusalChoice = "demote" | "base-duty" | "discharge" | "keep";

export function resolveRefusal(st: CampaignState, soldierId: string, choice: RefusalChoice): string[] {
  const s = st.soldiers[soldierId];
  st.refusalReviews = st.refusalReviews.filter((r) => r.soldierId !== soldierId);
  if (!s) return [];
  const out: string[] = [];
  const harsh = { demote: 10, "base-duty": 5, discharge: 15, keep: -5 }[choice];
  if (choice === "demote") { s.rank = Math.max(0, s.rank - 1); s.commandTrust -= 10; out.push(`${s.callsign} demoted.`); }
  if (choice === "base-duty") { s.status = "base-duty"; s.recoveryDays = 5; s.commandTrust -= 5; out.push(`${s.callsign} reassigned to base duty.`); }
  if (choice === "discharge") { s.status = "discharged"; s.bunkId = undefined; out.push(`${s.callsign} discharged. Their bunk is stripped by morning.`); }
  if (choice === "keep") { s.commandTrust += 10; out.push(`${s.callsign} stays on the roster.`); }
  // the squad watches; the ones who were once scared themselves watch closest
  for (const w of living(st)) {
    if (w.id === s.id) continue;
    const d = w.wasTerrified ? -harsh : choice === "discharge" ? -4 : choice === "keep" ? -1 : 0;
    w.commandTrust = clamp(w.commandTrust + d, -100, 100);
  }
  s.commandTrust = clamp(s.commandTrust, -100, 100);
  return out;
}

// ---------- bunks ----------

export function podOf(st: CampaignState, bunkId?: string): number {
  return bunkId ? st.bunks.findIndex((p) => p.includes(bunkId)) : -1;
}

export function assignBunk(st: CampaignState, soldierId: string, bunkId: string) {
  const s = st.soldiers[soldierId];
  const occupant = Object.values(st.soldiers).find((x) => x.bunkId === bunkId && x.status !== "dead" && x.status !== "discharged");
  const before = new Map(living(st).map((x) => [x.id, podOf(st, x.bunkId)]));
  if (occupant && occupant !== s) occupant.bunkId = s.bunkId;
  s.bunkId = bunkId;
  // someone bonded watching their person move in with someone else
  for (const moved of [s, occupant].filter(Boolean) as Soldier[]) {
    for (const x of living(st)) {
      if (x.id === moved.id || tierRank(edge(st, x.id, moved.id).tier) < 2) continue;
      const wasTogether = before.get(x.id) === before.get(moved.id);
      const nowTogether = podOf(st, x.bunkId) === podOf(st, moved.bunkId);
      if (wasTogether && !nowTogether) edge(st, x.id, moved.id).rivalCount++;
    }
  }
}

// ---------- the night and the next morning ----------

export async function endDay(st: CampaignState, opts: NightOptions = {}): Promise<NightReport> {
  const rng = new Rng(st.rngState);
  const skipped = st.missions.filter((m) => m.day === st.day);
  for (const m of skipped) {
    st.missions = st.missions.filter((x) => x !== m);
    const region = Object.keys(st.regionPanic)[m.seed % 4];
    st.regionPanic[region] = clamp(st.regionPanic[region] + 1, 0, 5);
  }
  const report = await runNightPass(st, rng, opts);
  if (skipped.length) report.log.unshift(`${skipped[0].name} went unanswered. Panic rises.`);
  st.nightLog = [...st.nightLog, report].slice(-40);
  // morning
  st.day++;
  resetDaily(st);
  decayMemories(st, rng);
  for (const s of living(st)) {
    if (s.recoveryDays > 0) {
      s.recoveryDays--;
      if (s.recoveryDays === 0 && (s.status === "injured" || s.status === "repair" || s.status === "base-duty")) s.status = "active";
    }
  }
  st.rngState = rng.state;
  // replacements trickle in when the roster thins
  if (living(st).length < 10 && st.day % 2 === 0) {
    withRng(st, (r) => {
      const taken = new Set(Object.values(st.soldiers).map((x) => x.callsign));
      const s = makeSoldier(r, r.chance(0.3) ? "ai" : "human", undefined, st.day, taken);
      const usedBunks = new Set(living(st).map((x) => x.bunkId));
      s.bunkId = st.bunks.flat().find((b) => !usedBunks.has(b));
      st.soldiers[s.id] = s;
      for (const o of living(st)) if (o !== s) { edge(st, s.id, o.id); edge(st, o.id, s.id); }
      report.log.push(`New recruit: ${s.name}.`);
    });
  }
  ensureMission(st);
  return report;
}

// ---------- persistence ----------

const SAVE_KEY = "open-weights-save-v1";

export function saveCampaign(st: CampaignState) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(st)); } catch { /* storage unavailable */ }
}
export function loadCampaign(): CampaignState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const st = JSON.parse(raw) as CampaignState;
    return st.version === 1 ? st : null;
  } catch { return null; }
}
export function clearCampaign() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
