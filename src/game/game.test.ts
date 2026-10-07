import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMission, combatPairs, deployable, endDay, missionToday, newCampaign, resolveRefusal, squadMood } from "./campaign";
import { autoplay } from "./combat/bot";
import { orderMove, setFear, squadUnits, startCombat } from "./combat/engine";
import { coverAgainst, hasLos } from "./combat/grid";
import { shotInfo } from "./combat/rules";
import type { CombatState } from "./combat/types";
import { buildContext, runNightPass, templateEvents, validateNight } from "./night";
import { applyDelta, edge, living, resetDaily, TIER_REQ, updateTiers } from "./relations";
import { Rng } from "./rng";
import type { CampaignState, MissionSpec, Settings } from "./types";

const LLM: Settings = { baseUrl: "http://llm.test/v1", apiKey: "k", model: "m", useLLM: true, analyst: false };

// combat must never call out: fail loudly if anything reaches for the network
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(() => { throw new Error("network call during test"); });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

function twoSoldiers(st: CampaignState) {
  const [a, b] = living(st);
  return [a, b];
}

function spec(seed: number, difficulty = 1): MissionSpec {
  return { id: `m${seed}`, day: 2, type: "raid", place: "Test", name: "the Test raid", seed, difficulty };
}

describe("relationships", () => {
  it("clamps daily movement so one great night can't make a bond", () => {
    const st = newCampaign(1);
    const [a, b] = twoSoldiers(st);
    st.soldiers[a.id].attachment = "secure";
    const before = edge(st, a.id, b.id).warmth;
    const rng = new Rng(1);
    for (let i = 0; i < 5; i++) applyDelta(st, { from: a.id, to: b.id, warmth: 20 }, rng);
    expect(edge(st, a.id, b.id).warmth - before).toBeLessThanOrEqual(10.0001);
    resetDaily(st);
    applyDelta(st, { from: a.id, to: b.id, warmth: 20 }, rng);
    expect(edge(st, a.id, b.id).warmth - before).toBeGreaterThan(10);
  });

  it("is directional: A's view of B moves without B's view of A", () => {
    const st = newCampaign(2);
    const [a, b] = twoSoldiers(st);
    const ba = edge(st, b.id, a.id).warmth;
    applyDelta(st, { from: a.id, to: b.id, warmth: 8, trust: 5 }, new Rng(2));
    expect(edge(st, b.id, a.id).warmth).toBe(ba);
  });

  it("needs sustained conditions for a tier, not a single day", () => {
    const st = newCampaign(3);
    const [a, b] = twoSoldiers(st);
    const e = edge(st, a.id, b.id);
    e.warmth = TIER_REQ.familiar.warmth + 1;
    e.trust = TIER_REQ.familiar.trust + 1;
    updateTiers(st, []);
    expect(e.tier).toBe("stranger");
    for (let d = 1; d < TIER_REQ.familiar.days; d++) updateTiers(st, []);
    expect(e.tier).toBe("familiar");
    // bonded also needs missions together, whatever the numbers say
    e.warmth = 90; e.trust = 90;
    for (let d = 0; d < 10; d++) updateTiers(st, []);
    expect(e.tier).toBe("familiar");
  });
});

describe("night pass", () => {
  it("rejects invented or unearned bond actions and banned phrasing, clamps deltas", () => {
    const st = newCampaign(4);
    const ctx = buildContext(st, new Rng(4));
    const g = ctx.groups.find((x) => x.ids.length >= 2)!;
    const [a, b] = g.ids;
    const rejected: string[] = [];
    const { events } = validateNight(st, ctx, {
      events: [
        { participants: [a, b], location: "bunks", scene: "A and B sit.", deltas: [{ from: a, to: b, warmth: 90 }], bondUnlock: { pair: [a, b], actionId: "orbital-strike" } },
        { participants: [a, b], location: "mess", scene: "A says that's not nothing.", lines: [] },
        { participants: [a, b], location: "mess", scene: "A hands B a cup.", bondUnlock: { pair: [a, b], actionId: "hold-line" } },
        { participants: ["nobody"], location: "mess", scene: "ghost" },
      ],
    }, rejected);
    expect(events).toHaveLength(2);
    expect(events[0].deltas[0].warmth).toBe(10);
    expect(events.every((e) => !e.bondUnlock)).toBe(true);
    expect(rejected.join(" ")).toMatch(/not in pool/);
    expect(rejected.join(" ")).toMatch(/not earned/);
    expect(rejected.join(" ")).toMatch(/banned/);
  });

  it("falls back to templates when the model call fails, and the day still advances", async () => {
    const st = newCampaign(5);
    const failing = vi.fn(async () => new Response("boom", { status: 500 }));
    const r = await runNightPass(st, new Rng(5), { settings: LLM, fetchImpl: failing as unknown as typeof fetch });
    expect(failing).toHaveBeenCalledOnce();
    expect(r.source).toBe("template");
    expect(r.error).toMatch(/500/);
    const day = st.day;
    await endDay(st, { settings: LLM, fetchImpl: failing as unknown as typeof fetch });
    expect(st.day).toBe(day + 1);
  });

  it("applies validated model events", async () => {
    const st = newCampaign(6);
    const ctx = buildContext(st, new Rng(6));
    const [a, b] = ctx.groups.find((x) => x.ids.length >= 2)!.ids;
    const body = { events: [{ participants: [a, b], location: "bunks", scene: `${st.soldiers[a].callsign} leaves the light on.`, deltas: [{ from: b, to: a, warmth: -5 }] }] };
    const ok = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), { status: 200 }));
    const before = edge(st, b, a).warmth;
    const r = await runNightPass(st, new Rng(6), { settings: LLM, fetchImpl: ok as unknown as typeof fetch });
    expect(r.source).toBe("llm");
    expect(r.events[0].scene).toContain("leaves the light on");
    expect(edge(st, b, a).warmth).toBeLessThan(before);
  });
});

describe("combat geometry", () => {
  function blank(): CombatState {
    const st = newCampaign(7);
    const c = startCombat({ mission: spec(7), squad: living(st).slice(0, 2), pairs: {}, squadMood: 0 });
    c.tiles = c.tiles.map(() => "floor");
    return c;
  }
  it("half cover protects only from the front", () => {
    const c = blank();
    c.tiles[5 * c.w + 5] = "half"; // cover north of (5,6)
    expect(coverAgainst(c, { x: 5, y: 6 }, { x: 5, y: 0 })).toBe(20);
    expect(coverAgainst(c, { x: 5, y: 6 }, { x: 5, y: 12 })).toBe(0);
    expect(coverAgainst(c, { x: 5, y: 6 }, { x: 12, y: 6 })).toBe(0); // flanked
  });
  it("walls block sight; half cover does not", () => {
    const c = blank();
    c.tiles[5 * c.w + 5] = "half";
    expect(hasLos(c, { x: 5, y: 2 }, { x: 5, y: 8 })).toBe(true);
    for (let x = 0; x < c.w; x++) c.tiles[5 * c.w + x] = "wall";
    expect(hasLos(c, { x: 5, y: 2 }, { x: 5, y: 8 })).toBe(false);
  });
  it("cover lowers the visible hit chance", () => {
    const c = blank();
    const [a] = squadUnits(c);
    const e = c.units.find((u) => u.side === "accord")!;
    a.x = 5; a.y = 12; e.x = 5; e.y = 6;
    const open = shotInfo(c, a, e).hit;
    c.tiles[7 * c.w + 5] = "half";
    expect(shotInfo(c, a, e).hit).toBe(open - 20);
  });
});

describe("fear and refusal", () => {
  it("a terrified human may refuse an exposed move; an AI never refuses", () => {
    const st = newCampaign(8);
    const human = living(st).find((s) => s.kind === "human")!;
    const ai = living(st).find((s) => s.kind === "ai")!;
    human.stats.will = 20;
    human.commandTrust = -20;
    const c = startCombat({ mission: spec(8), squad: [human, ai], pairs: {}, squadMood: 0 });
    c.tiles = c.tiles.map(() => "floor");
    const [h, a] = squadUnits(c);
    const e = c.units.find((u) => u.side === "accord")!;
    for (const o of c.units) if (o.side === "accord" && o !== e) o.dead = true;
    e.x = 8; e.y = 4; e.active = true;
    c.seenEnemies.push(e.id);
    h.x = 3; h.y = 12; a.x = 4; a.y = 12;
    setFear(c, h, 95);
    expect(h.fearState).toBe("terrified");
    const r = orderMove(c, h, 3, 10);
    expect(r.refused).toBe(true);
    expect(h.ap).toBe(1);
    expect(h.x).toBe(3);
    expect(c.events.some((ev) => ev.kind === "refusal")).toBe(true);
    const r2 = orderMove(c, a, 4, 10);
    expect(r2.refused).toBeFalsy();
    expect(a.y).toBe(10);
  });
});

describe("milestone checks", () => {
  it("M2: missions are winnable and losable with no LLM calls", () => {
    const st = newCampaign(9);
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 12 && outcomes.size < 2; seed++) {
      const squad = living(st).slice(0, seed % 2 ? 6 : 2);
      const c = startCombat({ mission: spec(seed * 101, seed % 2 ? 1 : 3), squad, pairs: combatPairs(st, squad), squadMood: 0 });
      autoplay(c);
      outcomes.add(c.outcome === "victory" ? "win" : "loss");
    }
    expect(outcomes).toEqual(new Set(["win", "loss"]));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("M3: a rescue or a refusal shows up in the next night's events", () => {
    let hits = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const st = newCampaign(seed * 13);
      st.day = 2;
      const m = missionToday(st)!;
      const squad = deployable(st).slice(0, 4);
      const c = startCombat({ mission: m, squad, pairs: combatPairs(st, squad), squadMood: squadMood(st) });
      autoplay(c);
      const [x, y] = squad;
      c.events.push({ kind: "rescue", turn: 1, actor: x.id, target: y.id, note: "dragged" });
      for (const u of c.units) if (u.soldierId === x.id || u.soldierId === y.id) u.dead = false;
      applyMission(st, m, c);
      st.refusalReviews.forEach((r) => resolveRefusal(st, r.soldierId, "keep"));
      const ctx = buildContext(st, new Rng(seed));
      expect(ctx.rescues.some((r) => r.rescuer === x.id && r.rescued === y.id)).toBe(true);
      const evs = templateEvents(st, ctx, new Rng(seed));
      if (evs.some((e) => e.participants.includes(x.id) && e.participants.includes(y.id))) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(4);
  });

  it("M1: thirty days of barracks produce uneven pairs, and some never bond", async () => {
    const st = newCampaign(1234);
    for (let d = 0; d < 30; d++) await endDay(st);
    const alive = living(st);
    let asym = 0, strangers = 0, cold = 0, warm = 0;
    for (const a of alive)
      for (const b of alive) {
        if (a.id >= b.id) continue;
        const ab = edge(st, a.id, b.id), ba = edge(st, b.id, a.id);
        if (Math.abs(ab.warmth - ba.warmth) >= 12) asym++;
        if (ab.tier === "stranger" && ba.tier === "stranger") strangers++;
        if (ab.warmth < -10 || ba.warmth < -10) cold++;
        if (ab.warmth > 20 && ba.warmth > 20) warm++;
      }
    expect(asym).toBeGreaterThan(3);
    expect(strangers).toBeGreaterThan(20);
    expect(cold).toBeGreaterThan(0);
    expect(warm).toBeGreaterThan(0);
  });
});
