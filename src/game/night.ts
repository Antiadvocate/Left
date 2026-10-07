// The night pass. The LLM (when configured) proposes events; this module validates them
// against the schema, clamps every delta, rejects anything outside the pools, and applies
// the rest. If the call fails or times out, template events run from the same state.

import { BOND_ACTION_IDS, bondAction } from "./content";
import { type Intent, line } from "./lines";
import { callJson } from "./llm";
import { addMemory, recall } from "./memory";
import { nightSystemPrompt } from "./prompts";
import {
  applyDelta, edge, eligibleActions, living, mutualTier, nudgeRelaxation, proximityDrift, relaxationDynamics, tierRank, unlockAction, updateTiers,
} from "./relations";
import { Rng, clamp, uid } from "./rng";
import type { BarkBank, BarkTag, CampaignState, Location, MissionResult, MissionSpec, NightEvent, NightReport, Settings } from "./types";

export interface Group { location: Location; ids: string[] }
export interface NightContext {
  day: number;
  mission?: { spec: MissionSpec; result: MissionResult };
  groups: Group[];
  rescues: { rescuer: string; rescued: string }[];
  refusals: { refuser: string; witnesses: string[] }[];
  deaths: { dead: string; mourners: string[] }[];
  suicideOrders: { ai: string; humans: string[] }[];
  jealousy: { a: string; b: string; c: string }[];
}

const LOCATIONS: Location[] = ["bunks", "mess", "medbay", "maintenance", "memorial", "range"];
const BANNED = [/that'?s not nothing/i, /you do so much/i, /are you really (doing|going)/i];

// ---------- context ----------

export function buildContext(st: CampaignState, rng: Rng): NightContext {
  const alive = living(st);
  const here = alive.filter((s) => s.status !== "injured" && s.status !== "repair");
  const groups: Group[] = [];
  st.bunks.forEach((pod, i) => {
    const ids = here.filter((s) => s.bunkId && pod.includes(s.bunkId)).map((s) => s.id);
    if (ids.length > 1) groups.push({ location: "bunks", ids });
    void i;
  });
  const injured = alive.filter((s) => s.status === "injured").map((s) => s.id);
  if (injured.length > 1) groups.push({ location: "medbay", ids: injured });
  const repair = alive.filter((s) => s.status === "repair");
  if (repair.length) {
    const visitors = here
      .filter((h) => h.kind === "human" && repair.some((a) => edge(st, h.id, a.id).warmth >= 15))
      .slice(0, 3)
      .map((h) => h.id);
    if (visitors.length) groups.push({ location: "maintenance", ids: [...repair.map((r) => r.id), ...visitors] });
  }
  const last = st.pastMissions[st.pastMissions.length - 1];
  const mission = last && last.spec.day === st.day ? last : undefined;
  const mess = new Set<string>();
  if (mission) mission.result.deployed.forEach((id) => st.soldiers[id] && here.some((h) => h.id === id) && mess.add(id));
  const others = rng.shuffle(here.filter((h) => !mess.has(h.id)));
  others.slice(0, mission ? 3 : 4).forEach((h) => mess.add(h.id));
  if (mess.size > 1) groups.push({ location: "mess", ids: [...mess] });
  // mentoring at the range: someone with rank, someone without
  const vets = here.filter((s) => s.rank >= 2);
  const rookies = here.filter((s) => s.rank === 0 && s.kind === "human");
  if (vets.length && rookies.length && rng.chance(0.35)) groups.push({ location: "range", ids: [rng.pick(vets).id, rng.pick(rookies).id] });

  const ctx: NightContext = { day: st.day, mission, groups, rescues: [], refusals: [], deaths: [], suicideOrders: [], jealousy: [] };
  if (mission) {
    const r = mission.result;
    const survivors = r.deployed.filter((id) => !r.deadIds.includes(id));
    for (const e of r.events) {
      if (e.kind === "rescue" && e.target && !r.deadIds.includes(e.actor) && !r.deadIds.includes(e.target)) ctx.rescues.push({ rescuer: e.actor, rescued: e.target });
      if (e.kind === "refusal" && !r.deadIds.includes(e.actor)) ctx.refusals.push({ refuser: e.actor, witnesses: survivors.filter((id) => id !== e.actor) });
      if (e.kind === "suicide-order") {
        const humans = alive.filter((h) => h.kind === "human" && tierRank(edge(st, h.id, e.actor).tier) >= 1).map((h) => h.id);
        if (humans.length) ctx.suicideOrders.push({ ai: e.actor, humans });
      }
    }
    for (const d of r.deadIds) {
      const mourners = alive.filter((s) => edge(st, s.id, d).warmth >= 15 || tierRank(edge(st, s.id, d).tier) >= 1).map((s) => s.id);
      if (mourners.length) {
        ctx.deaths.push({ dead: d, mourners });
        groups.push({ location: "memorial", ids: mourners });
      }
    }
  }
  // jealousy: a bonded soldier keeps watching their person deploy or bunk with someone else
  for (const e of Object.values(st.edges)) {
    if (e.rivalCount < 2 || tierRank(e.tier) < 2) continue;
    const a = st.soldiers[e.from], b = st.soldiers[e.to];
    if (!a || !b || !here.includes(a) || !here.includes(b)) continue;
    const rivals = alive.filter((c) => c.id !== a.id && c.id !== b.id).sort((x, y) => edge(st, b.id, y.id).warmth - edge(st, b.id, x.id).warmth);
    if (!rivals.length) continue;
    ctx.jealousy.push({ a: a.id, b: b.id, c: rivals[0].id });
    e.rivalCount = 0;
  }
  return ctx;
}

// ---------- templates ----------

type Ev = Omit<NightEvent, "id" | "day" | "source">;

function mk(location: Location, participants: string[], scene: string, extra: Partial<Ev> = {}): Ev {
  return { location, participants, scene, lines: [], deltas: [], relaxation: [], ...extra };
}

class T {
  constructor(public st: CampaignState, public rng: Rng, public ctx: NightContext) {}
  s(id: string) { return this.st.soldiers[id]; }
  n(id: string) { return this.st.soldiers[id].callsign; }
  say(id: string, intent: Intent) { return { speaker: id, text: line(this.s(id).voice, intent, (k) => Math.floor(this.rng.next() * k)) }; }
  pick<X>(a: readonly X[]) { return this.rng.pick(a); }
  w(a: string, b: string) { return edge(this.st, a, b).warmth; }
  tr(a: string, b: string) { return edge(this.st, a, b).trust; }
}

// habits that only make sense under fire don't show up in the bunks
const BATTLE_ONLY = new Set(["freeze-when-flanked", "hold-fire-on", "shoot-first", "steady-under-fire", "take-dead-position", "break-toward"]);
const offDuty = (h: { combatEffect?: string }) => !h.combatEffect || !BATTLE_ONLY.has(h.combatEffect);

function friction(t: T, loc: Location, a: string, b: string): Ev | null {
  const habit = t.s(a).traits.find((h) => h.valence === "hinder" && offDuty(h));
  if (!habit) return null;
  const talks = t.rng.chance(0.5);
  const reaction = talks
    ? `${t.n(b)} sits up.`
    : t.pick([`${t.n(b)} turns to face the wall.`, `${t.n(b)} drags a blanket over their head.`, `${t.n(b)} gets up and leaves.`, `${t.n(b)} drops a boot on the floor, hard.`]);
  // habituation: the tenth night of the same habit lands softer than the first
  const worn = clamp(1 + t.w(b, a) / 60, 0.25, 1);
  return mk(loc, [a, b], `${t.n(a)} ${habit.text}. ${reaction}`, {
    lines: talks ? [t.say(b, "dismiss")] : [],
    deltas: [{ from: b, to: a, warmth: -Math.round(t.rng.int(4, 8) * worn) }, ...(talks ? [{ from: a, to: b, warmth: -2 }] : [])],
  });
}

function silence(t: T, loc: Location, a: string, b: string): Ev {
  const place = t.pick([
    "sit on the hangar ramp until the floodlights cut out",
    "split the last two ration bars on the bench outside the mess",
    "clean their weapons side by side",
    "watch the rain from the loading door",
  ]);
  const coda = t.pick(["Neither says anything.", "Nobody talks.", `${t.n(a)} passes the lighter over without looking.`]);
  void loc;
  return mk("mess", [a, b], `${t.n(a)} and ${t.n(b)} ${place}. ${coda}`, {
    deltas: [{ from: a, to: b, warmth: t.rng.int(3, 5), trust: t.rng.int(2, 3) }, { from: b, to: a, warmth: t.rng.int(3, 5), trust: t.rng.int(2, 3) }],
    relaxation: [{ id: a, delta: 1 }, { id: b, delta: 1 }],
  });
}

function cards(t: T, loc: Location, a: string, b: string): Ev {
  const caught = t.rng.chance(0.4);
  void loc;
  return mk("mess", [a, b], `A card game in the mess runs past lights-out. ${t.n(a)} palms a card. ${caught ? `${t.n(b)} reaches over and flips ${t.n(a)}'s hand face up.` : `${t.n(b)} sees it and deals the next hand anyway.`}`, {
    lines: caught ? [t.say(b, "needle")] : [],
    deltas: [{ from: a, to: b, warmth: 3 }, { from: b, to: a, warmth: caught ? 1 : 3, trust: caught ? -2 : 1 }],
  });
}

function kindness(t: T, loc: Location, a: string, b: string): Ev {
  const thing = t.pick(["a spare battery", "a ration bar", "a clean pair of socks", "a dog-eared paperback", "a cup of coffee"]);
  const returned = t.s(b).attachment === "avoidant" && t.rng.chance(0.5);
  return mk(loc, [a, b], `${t.n(a)} leaves ${thing} on ${t.n(b)}'s bunk. ${returned ? `An hour later it's back on ${t.n(a)}'s.` : t.pick([`${t.n(b)} pockets it.`, `${t.n(b)} looks at it for a long time.`])}`, {
    lines: returned ? [] : [t.say(b, "ack")],
    deltas: returned ? [{ from: b, to: a, warmth: 1 }, { from: a, to: b, warmth: -2 }] : [{ from: b, to: a, warmth: 5, trust: 4 }, { from: a, to: b, warmth: 2 }],
  });
}

function argument(t: T, loc: Location, a: string, b: string): Ev {
  const over = t.pick(["whose turn it is on the coffee", "a borrowed scope", "the radio volume", "who left the hatch open", "a missing pair of gloves"]);
  const end = t.pick(["end up nose to nose by the lockers", "have to be split up by the duty officer", "stop mid-sentence when the door opens"]);
  return mk(loc, [a, b], `It starts over ${over}. ${t.n(a)} and ${t.n(b)} ${end}.`, {
    lines: [t.say(a, "needle"), t.say(b, "deflect")],
    deltas: [{ from: a, to: b, warmth: -t.rng.int(4, 6), trust: -t.rng.int(3, 5) }, { from: b, to: a, warmth: -t.rng.int(4, 6), trust: -t.rng.int(3, 5) }],
    relaxation: [{ id: a, delta: -1 }, { id: b, delta: -1 }],
  });
}

function nightTerror(t: T, loc: Location, a: string, b: string): Ev | null {
  const wound = t.s(a).traits.find((h) => h.wound && offDuty(h));
  if (!wound) return null;
  const stays = t.w(b, a) > 8 || (t.s(b).attachment === "secure" && t.rng.chance(0.45)) || (t.s(b).kind === "ai" && t.rng.chance(0.4));
  if (stays) {
    const how = t.pick(["sits on the end of the bunk until it's light", "turns the radio on, low", "stays up too, reading by a penlight", "makes two cups of coffee and leaves one within reach"]);
    return mk(loc, [a, b], `0300. ${t.n(a)} ${wound.text}. ${t.n(b)} is awake too. ${t.n(b)} ${how}.`, {
      lines: t.rng.chance(0.5) ? [t.say(b, "ask")] : [],
      deltas: [{ from: a, to: b, warmth: 4, trust: 6 }, { from: b, to: a, warmth: 2 }],
      relaxation: [{ id: a, delta: 2 }],
      memory: { ownerId: a, significance: 42, core: `${t.n(b)} stayed up with them until morning`, peripheral: ["the radio, low", "the bunk lights"], participants: [b], feeling: "held", valence: 0.6 },
    });
  }
  return mk(loc, [a, b], `0300. ${t.n(a)} ${wound.text}. ${t.n(b)} rolls over and pretends to be asleep.`, {
    deltas: [{ from: a, to: b, trust: -2 }],
    relaxation: [{ id: a, delta: -1 }],
  });
}

function medbay(t: T, a: string, b: string): Ev {
  const what = t.pick(["argue over the one window", "trade the only working tablet back and forth", "race each other through the physio sheet", "take turns stealing each other's pudding cups"]);
  const sour = t.rng.chance(0.3);
  return mk("medbay", [a, b], `In the medbay, ${t.n(a)} and ${t.n(b)} ${what}.${sour ? ` By evening they've pulled the curtain between the beds.` : ""}`, {
    deltas: sour ? [{ from: a, to: b, warmth: -3 }, { from: b, to: a, warmth: -3 }] : [{ from: a, to: b, warmth: 4, trust: 2 }, { from: b, to: a, warmth: 4, trust: 2 }],
  });
}

function maintenance(t: T, human: string, ai: string): Ev {
  const does = t.pick(["repeats the last thing they said, twice", "reports its own damage in exact figures", "asks whether they've eaten", "goes quiet when the techs come near"]);
  return mk("maintenance", [human, ai], `${t.n(human)} sits by ${t.n(ai)}'s bay through the repair cycle. ${t.n(ai)} ${does}.`, {
    lines: [t.say(ai, "ask")],
    deltas: [{ from: human, to: ai, warmth: 4 }, { from: ai, to: human, warmth: 5, trust: 4 }],
  });
}

function memorial(t: T, v: string, dead: string, w?: string): Ev {
  const scene = `${t.n(v)} stands in front of ${t.n(dead)}'s name on the memorial wall for a long time.${w ? ` ${t.n(w)} comes and stands next to them. Neither speaks.` : ""}`;
  return mk("memorial", w ? [v, w] : [v], scene, {
    deltas: w ? [{ from: v, to: w, warmth: 6, trust: 5 }, { from: w, to: v, warmth: 6, trust: 4 }] : [],
    relaxation: [{ id: v, delta: -1 }],
  });
}

function rescueThanks(t: T, rescuer: string, rescued: string): Ev {
  const weakSavedStrong = t.s(rescuer).rank < t.s(rescued).rank;
  const how = t.pick([`${t.n(rescued)} drops a ration bar on ${t.n(rescuer)}'s bunk without a word.`, `${t.n(rescued)} finds ${t.n(rescuer)} in the mess and sits down across from them.`, `${t.n(rescued)} cleans ${t.n(rescuer)}'s rifle while ${t.n(rescuer)} is in the shower.`]);
  return mk("mess", [rescued, rescuer], how, {
    lines: t.rng.chance(0.6) ? [t.say(rescued, "ack")] : [],
    deltas: [{ from: rescued, to: rescuer, warmth: 6, trust: weakSavedStrong ? 10 : 6 }, { from: rescuer, to: rescued, warmth: 3 }],
  });
}

function refusalTalk(t: T, refuser: string, w: string): Ev {
  const kind = t.s(w).wasTerrified || t.w(w, refuser) > 12;
  if (kind) {
    return mk("mess", [w, refuser], `${t.n(w)} sits down next to ${t.n(refuser)} in the mess and slides a cup over.`, {
      lines: [t.say(w, "sit")],
      deltas: [{ from: refuser, to: w, warmth: 6, trust: 5 }, { from: w, to: refuser, warmth: 2 }],
    });
  }
  const how = t.pick([`${t.n(w)} says it loud enough for the table to hear.`, `${t.n(w)} takes their tray to another table when ${t.n(refuser)} sits down.`]);
  return mk("mess", [w, refuser], how, {
    lines: how.includes("loud") ? [t.say(w, "jab")] : [],
    deltas: [{ from: refuser, to: w, warmth: -6 }, { from: w, to: refuser, trust: -5 }],
    relaxation: [{ id: refuser, delta: -2 }],
  });
}

function jealousy(t: T, a: string, b: string, c: string): Ev {
  const m = t.ctx.mission?.spec.name;
  const scene = m
    ? `${t.n(a)} watches ${t.n(b)} and ${t.n(c)} come back from ${m} together. ${t.n(a)} takes their tray to the far end of the mess.`
    : `${t.n(b)} and ${t.n(c)} are laughing at something by the lockers. ${t.n(a)} finds somewhere else to be.`;
  return mk("mess", [a, b, c], scene, { deltas: [{ from: a, to: b, trust: -5, warmth: -2 }, { from: a, to: c, warmth: -7 }] });
}

function distance(t: T, a: string, b: string): Ev {
  return mk("mess", [a, b], `${t.n(b)} saves ${t.n(a)} a seat at the mess. ${t.n(a)} eats standing by the door.`, {
    deltas: [{ from: b, to: a, trust: -2 }, { from: a, to: b, warmth: 1 }],
  });
}

function drift(t: T, loc: Location, a: string, b: string): Ev {
  const how = t.pick([`${t.n(a)} keeps ending up wherever ${t.n(b)} is: the range, the mess, the hangar.`, `${t.n(a)} borrows ${t.n(b)}'s jacket and doesn't give it back.`, `${t.n(a)} learns which song ${t.n(b)} hums and starts humming it too.`]);
  const back = edge(t.st, b, a).spark > 0;
  return mk(loc, [a, b], how, { deltas: [{ from: a, to: b, attraction: 5, warmth: 2 }, ...(back ? [{ from: b, to: a, attraction: 3 }] : [])] });
}

function mentor(t: T, vet: string, rookie: string): Ev {
  return mk("range", [vet, rookie], `${t.n(vet)} spends an hour at the range fixing ${t.n(rookie)}'s grip, and doesn't say much else.`, {
    lines: [t.say(vet, "instruct")],
    deltas: [{ from: rookie, to: vet, trust: 4, warmth: 2 }, { from: vet, to: rookie, warmth: 2 }],
  });
}

function moodEvent(t: T, ids: string[]): Ev {
  return mk("mess", ids.slice(0, 2), `Someone has written on the mess whiteboard: "Command's next flank. Volunteers?" Nobody wipes it off.`, {
    relaxation: ids.slice(0, 4).map((id) => ({ id, delta: -1 })),
  });
}

function suicideGrumble(t: T, ai: string, human: string): Ev {
  return mk("mess", [human, ai], `${t.n(human)} reads the after-action report twice, then asks the duty officer who signed ${t.n(ai)}'s orders.`, {
    lines: [t.say(human, "deflect")],
    deltas: [{ from: human, to: ai, warmth: 2 }],
  });
}

export function templateEvents(st: CampaignState, ctx: NightContext, rng: Rng): Ev[] {
  const t = new T(st, rng, ctx);
  const out: Ev[] = [];
  const busy = new Map<string, number>();
  const free = (...ids: string[]) => ids.every((id) => (busy.get(id) ?? 0) < 2);
  const push = (e: Ev | null) => {
    if (!e) return;
    out.push(e);
    e.participants.forEach((id) => busy.set(id, (busy.get(id) ?? 0) + 1));
  };
  for (const j of ctx.jealousy) push(jealousy(t, j.a, j.b, j.c));
  for (const r of ctx.rescues) if (rng.chance(0.85) && free(r.rescuer, r.rescued)) push(rescueThanks(t, r.rescuer, r.rescued));
  for (const r of ctx.refusals) {
    const w = rng.shuffle([...r.witnesses]).find((id) => free(id));
    if (w && rng.chance(0.8)) push(refusalTalk(t, r.refuser, w));
  }
  for (const d of ctx.deaths) {
    const [v, w] = rng.shuffle([...d.mourners]);
    if (v) push(memorial(t, v, d.dead, w));
  }
  for (const so of ctx.suicideOrders) if (rng.chance(0.7)) push(suicideGrumble(t, so.ai, rng.pick(so.humans)));
  const alive = living(st);
  const mood = alive.reduce((a, s) => a + s.commandTrust, 0) / Math.max(1, alive.length);
  const messGroup = ctx.groups.find((g) => g.location === "mess");
  if (mood < 0 && messGroup && rng.chance(0.6)) push(moodEvent(t, messGroup.ids));

  const badMission = ctx.mission && (ctx.mission.result.deadIds.length > 0 || ctx.mission.result.outcome !== "victory");
  const deployed = new Set(ctx.mission?.result.deployed ?? []);
  for (const g of ctx.groups) {
    if (g.location === "memorial") continue;
    if (g.location === "range") { push(mentor(t, g.ids[0], g.ids[1])); continue; }
    if (g.location === "maintenance") {
      const ais = g.ids.filter((id) => t.s(id).kind === "ai" && t.s(id).status === "repair");
      for (const h of g.ids.filter((id) => !ais.includes(id))) if (ais.length && rng.chance(0.6)) push(maintenance(t, h, rng.pick(ais)));
      continue;
    }
    const pairs: [string, string][] = [];
    for (const a of g.ids) for (const b of g.ids) if (a !== b) pairs.push([a, b]);
    rng.shuffle(pairs);
    for (const [a, b] of pairs) {
      if (out.length >= 7) break;
      if (!free(a, b)) continue;
      const tier = tierRank(mutualTier(st, a, b));
      const heat = t.w(a, b) + t.w(b, a);
      // people who like each other seek each other out; people who don't, clash
      let p = 0.05 + (g.location === "bunks" ? 0.04 : 0) + (tier >= 1 ? 0.05 : 0) + clamp(Math.abs(heat) / 400, 0, 0.12);
      if (badMission && deployed.has(a) && deployed.has(b)) p += 0.12;
      if (g.location === "medbay") p += 0.25;
      if (!rng.chance(p)) continue;
      if (g.location === "medbay") { push(medbay(t, a, b)); continue; }
      const sa = t.s(a), wba = t.w(b, a), wab = t.w(a, b);
      // chemistry steers what kind of night a pair has, not just how often
      const chem = (edge(st, a, b).compat + edge(st, b, a).compat) / 2;
      const warmish = clamp(0.5 + chem, 0.1, 1.5), sourish = clamp(0.5 - chem, 0.1, 1.5);
      const options: [() => Ev | null, number][] = [
        [() => friction(t, g.location, a, b), (wba < 10 ? 0.8 : 0.35) * sourish],
        [() => silence(t, g.location, a, b), (badMission && deployed.has(a) && deployed.has(b) ? 1.6 : 0.5) * warmish],
        [() => cards(t, g.location, a, b), (wab >= -5 && wba >= -5 ? 0.6 : 0.1) * warmish],
        [() => kindness(t, g.location, a, b), wab >= 12 ? 0.9 * warmish : 0],
        [() => argument(t, g.location, a, b), (t.tr(a, b) < -5 || wab < -15 ? 0.6 : 0.12) * sourish],
        [() => (g.location === "bunks" ? nightTerror(t, g.location, a, b) : null), sa.braced || sa.relaxation <= -3 ? 1.4 : 0.2],
        [() => distance(t, a, b), sa.attachment === "avoidant" && wba - wab >= 15 ? 1.2 : 0],
        [() => drift(t, g.location, a, b), edge(st, a, b).spark > 0 && wab >= 25 ? 0.8 : 0],
      ];
      const chosen = rng.weighted(options, (o) => o[1]);
      push(chosen ? chosen[0]() : null);
    }
  }
  return out;
}

// ---------- LLM pass ----------

function compactInput(st: CampaignState, ctx: NightContext) {
  const ids = new Set(ctx.groups.flatMap((g) => g.ids));
  const soldiers = [...ids].map((id) => {
    const s = st.soldiers[id];
    return {
      id: s.id, name: s.callsign, kind: s.kind, class: s.class, rank: s.rank, voice: s.voice,
      habits: s.traits.map((h) => h.text), attachment: s.attachment, state: s.braced ? "braced" : "settled", status: s.status,
      memories: recall(s, 2).map((m) => `${m.core} (${m.anchor})`),
    };
  });
  const edges: Record<string, unknown>[] = [];
  for (const g of ctx.groups)
    for (const a of g.ids)
      for (const b of g.ids) {
        if (a >= b) continue;
        const ab = edge(st, a, b), ba = edge(st, b, a);
        edges.push({
          a, b, a_to_b: { warmth: Math.round(ab.warmth), trust: Math.round(ab.trust), attraction: Math.round(ab.attraction) },
          b_to_a: { warmth: Math.round(ba.warmth), trust: Math.round(ba.trust), attraction: Math.round(ba.attraction) },
          tier: mutualTier(st, a, b), eligible_bond_actions: eligibleActions(st, a, b),
        });
      }
  const r = ctx.mission?.result;
  return {
    day: ctx.day,
    mission: ctx.mission ? { name: ctx.mission.spec.name, outcome: r!.outcome, dead: r!.deadIds.map((d) => st.soldiers[d]?.callsign), deployed: r!.deployed } : null,
    tonight: ctx.groups,
    soldiers,
    edges: [...new Map(edges.map((e) => [`${e.a}|${e.b}`, e])).values()],
    battlefield: {
      rescues: ctx.rescues, refusals: ctx.refusals.map((x) => x.refuser), deaths: ctx.deaths.map((d) => d.dead),
      ai_sent_into_open: ctx.suicideOrders.map((x) => x.ai),
    },
    bond_action_pool: BOND_ACTION_IDS,
    barks_needed_for: r ? r.deployed.filter((id) => !r.deadIds.includes(id)) : [],
  };
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : undefined);

/** Schema validation + constraint enforcement. Anything malformed is dropped, not repaired. */
export function validateNight(st: CampaignState, ctx: NightContext, raw: any, rejected: string[]): { events: Ev[]; barks: Record<string, BarkBank> } {
  const present = new Set(ctx.groups.flatMap((g) => g.ids));
  const events: Ev[] = [];
  const list = Array.isArray(raw?.events) ? raw.events.slice(0, 8) : [];
  for (const e of list) {
    const parts: string[] = Array.isArray(e?.participants) ? e.participants.filter((p: unknown) => isStr(p) && present.has(p)) : [];
    if (!parts.length || !isStr(e.scene)) { rejected.push("event without valid participants or scene"); continue; }
    const loc: Location = LOCATIONS.includes(e.location) ? e.location : "bunks";
    const text = [e.scene, ...(Array.isArray(e.lines) ? e.lines.map((l: any) => l?.text) : [])].join(" ");
    if (BANNED.some((re) => re.test(text))) { rejected.push(`banned phrasing in event: ${String(e.scene).slice(0, 40)}…`); continue; }
    const ev: Ev = mk(loc, parts, String(e.scene).slice(0, 600));
    if (Array.isArray(e.lines))
      for (const l of e.lines.slice(0, 4)) if (isStr(l?.speaker) && parts.includes(l.speaker) && isStr(l?.text)) ev.lines.push({ speaker: l.speaker, text: l.text.slice(0, 160) });
    if (Array.isArray(e.deltas))
      for (const d of e.deltas.slice(0, 6)) {
        if (!parts.includes(d?.from) || !parts.includes(d?.to) || d.from === d.to) continue;
        ev.deltas.push({ from: d.from, to: d.to, warmth: num(d.warmth, -10, 10), trust: num(d.trust, -10, 10), attraction: num(d.attraction, -10, 10) });
      }
    if (Array.isArray(e.relaxation))
      for (const r of e.relaxation.slice(0, 4)) { const v = num(r?.delta, -3, 3); if (parts.includes(r?.id) && v !== undefined) ev.relaxation.push({ id: r.id, delta: v }); }
    if (e.memory && parts.includes(e.memory.ownerId) && isStr(e.memory.core)) {
      ev.memory = {
        ownerId: e.memory.ownerId, core: e.memory.core, significance: num(e.memory.significance, 0, 70) ?? 30,
        peripheral: Array.isArray(e.memory.peripheral) ? e.memory.peripheral.filter(isStr).slice(0, 3) : [],
        participants: parts, feeling: isStr(e.memory.feeling) ? e.memory.feeling : "unsettled", valence: num(e.memory.valence, -1, 1) ?? 0,
      };
    }
    if (e.habit && parts.includes(e.habit.ownerId) && isStr(e.habit.text)) {
      // LLM habits are texture only: combat effects are minted by code from battlefield memories
      ev.habit = { ownerId: e.habit.ownerId, text: e.habit.text.slice(0, 100), valence: e.habit.valence === "help" ? "help" : "hinder" };
    }
    if (e.bondUnlock && Array.isArray(e.bondUnlock.pair) && e.bondUnlock.pair.length === 2) {
      const [a, b] = e.bondUnlock.pair;
      if (!BOND_ACTION_IDS.includes(e.bondUnlock.actionId)) rejected.push(`bond action not in pool: ${e.bondUnlock.actionId}`);
      else if (!eligibleActions(st, a, b).includes(e.bondUnlock.actionId)) rejected.push(`bond action not earned: ${e.bondUnlock.actionId}`);
      else ev.bondUnlock = { pair: [a, b], actionId: e.bondUnlock.actionId };
    }
    events.push(ev);
  }
  const barks: Record<string, BarkBank> = {};
  if (raw?.barks && typeof raw.barks === "object") {
    for (const [id, bank] of Object.entries(raw.barks as Record<string, any>)) {
      if (!st.soldiers[id] || !bank || typeof bank !== "object") continue;
      const clean: BarkBank = {};
      for (const [tag, lines] of Object.entries(bank)) {
        if (!Array.isArray(lines)) continue;
        const ok = lines.filter((l) => isStr(l) && l.split(/\s+/).length <= 8).slice(0, 3);
        if (ok.length) clean[tag as BarkTag] = ok;
      }
      barks[id] = clean;
    }
  }
  return { events, barks };
}

// ---------- apply ----------

/** Earned bond actions with no LLM to choose: pick from the pair's actual history. */
function autoUnlocks(st: CampaignState, ctx: NightContext, log: string[]): Ev[] {
  const out: Ev[] = [];
  const alive = living(st);
  for (let i = 0; i < alive.length; i++)
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i].id, b = alive[j].id;
      const el = eligibleActions(st, a, b);
      if (!el.length) continue;
      const e = edge(st, a, b);
      const rescued = ctx.rescues.some((r) => (r.rescuer === a && r.rescued === b) || (r.rescuer === b && r.rescued === a));
      const pref = rescued ? ["drag", "lunge", "hold-line"] : e.adjacentTurns >= 4 ? ["spotter", "shared-overwatch", "hold-line"] : ["spotter", "drag", "shared-overwatch", "lunge", "rage-reload", "hold-line"];
      const id = pref.find((p) => el.includes(p)) ?? el[0];
      // one unlock per pair per night, and only on nights the pair was together
      if (!ctx.groups.some((g) => g.ids.includes(a) && g.ids.includes(b)) && !ctx.mission?.result.deployed.includes(a)) continue;
      out.push(mk("bunks", [a, b], "", { bondUnlock: { pair: [a, b], actionId: id } }));
      log.push(`earned: ${st.soldiers[a].callsign} & ${st.soldiers[b].callsign} — ${bondAction(id)?.name}`);
    }
  return out;
}

export function applyEvents(st: CampaignState, evs: Ev[], source: NightEvent["source"], rng: Rng, log: string[]): NightEvent[] {
  const relaxBudget = new Map<string, number>();
  const applied: NightEvent[] = [];
  for (const e of evs) {
    for (const d of e.deltas) applyDelta(st, d, rng, log);
    for (const r of e.relaxation) if (st.soldiers[r.id]) nudgeRelaxation(st.soldiers[r.id], r.delta, relaxBudget);
    for (const a of e.participants) for (const b of e.participants) if (a !== b) edge(st, a, b).lastEventDay = st.day;
    if (e.memory && st.soldiers[e.memory.ownerId]) addMemory(st, st.soldiers[e.memory.ownerId], e.memory, rng);
    if (e.habit) {
      const s = st.soldiers[e.habit.ownerId];
      if (s && s.traits.length < 6 && !s.traits.some((h) => h.text === e.habit!.text)) {
        s.traits.push({ id: uid("habit", rng), text: e.habit.text, valence: e.habit.valence });
        log.push(`${s.callsign} picked up a habit: ${e.habit.text}`);
      }
    }
    if (e.bondUnlock) {
      const [a, b] = e.bondUnlock.pair;
      if (unlockAction(st, a, b, e.bondUnlock.actionId)) log.push(`unlocked ${bondAction(e.bondUnlock.actionId)?.name} for ${st.soldiers[a].callsign} & ${st.soldiers[b].callsign}`);
      else log.push(`rejected unlock ${e.bondUnlock.actionId}`);
    }
    applied.push({ ...e, id: uid("ev", rng), day: st.day, source });
  }
  return applied;
}

export interface NightOptions { settings?: Settings; signal?: AbortSignal; fetchImpl?: typeof fetch }

export async function runNightPass(st: CampaignState, rng: Rng, opts: NightOptions = {}): Promise<NightReport> {
  const ctx = buildContext(st, rng);
  const log: string[] = [];
  let events: Ev[] = [];
  let source: "llm" | "template" = "template";
  let error: string | undefined;
  const s = opts.settings;
  if (s?.useLLM && s.apiKey && s.model) {
    try {
      const raw = await callJson(s, nightSystemPrompt(), JSON.stringify(compactInput(st, ctx)), { signal: opts.signal, fetchImpl: opts.fetchImpl });
      const rejected: string[] = [];
      const { events: evs, barks } = validateNight(st, ctx, raw, rejected);
      rejected.forEach((r) => log.push(`rejected: ${r}`));
      // rules events (jealousy) are owned by code; the LLM only writes texture around them
      const t = new T(st, rng, ctx);
      events = [...ctx.jealousy.map((j) => jealousy(t, j.a, j.b, j.c)), ...evs];
      for (const [id, bank] of Object.entries(barks)) st.soldiers[id].barks = { ...st.soldiers[id].barks, ...bank };
      source = "llm";
    } catch (e: any) {
      error = String(e?.message ?? e).slice(0, 200);
      log.push(`LLM night pass failed, using templates: ${error}`);
    }
  }
  if (source === "template") events = templateEvents(st, ctx, rng);
  const applied = applyEvents(st, events, source, rng, log);
  const unlocks = autoUnlocks(st, ctx, log);
  applyEvents(st, unlocks, "rules", rng, []);
  const coLocated = ctx.groups.filter((g) => g.location === "bunks" || g.location === "medbay").map((g) => g.ids);
  proximityDrift(st, ctx.groups.filter((g) => g.location !== "memorial").map((g) => g.ids), rng);
  relaxationDynamics(st, coLocated, log);
  updateTiers(st, log);
  return { day: st.day, events: applied.filter((e) => e.scene), source, error, log };
}
