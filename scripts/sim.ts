// Headless campaign: N days of barracks + bot-played missions, template night passes only.
// Milestone 1 check: do 30 days produce uneven, surprising pairs, with some never bonding?
//   npm run sim -- [days] [seed] [--barracks]
// --barracks keeps everyone alive (deaths become injuries) so the relationship web can be read
// without the bot's tactical blunders thinning the roster.

import { applyMission, combatPairs, deployable, endDay, missionToday, newCampaign, resolveRefusal, squadMood, type RefusalChoice } from "../src/game/campaign";
import { autoplay } from "../src/game/combat/bot";
import { startCombat } from "../src/game/combat/engine";
import { edge, living, mutualTier, tierRank } from "../src/game/relations";
import { Rng } from "../src/game/rng";

const args = process.argv.slice(2).filter((a: string) => /^\d+$/.test(a));
const days = Number(args[0] ?? 30);
const seed = Number(args[1] ?? 1234);
const barracks = process.argv.includes("--barracks");
const st = newCampaign(seed);
const pick = new Rng(seed ^ 0xabc);
let missions = 0, wins = 0;
const sampleScenes: string[] = [];

for (let d = 0; d < days; d++) {
  const m = missionToday(st);
  if (m) {
    const pool = pick.shuffle(deployable(st));
    const squad = pool.slice(0, Math.min(pool.length, pick.int(4, 6)));
    if (squad.length >= 2) {
      squad.forEach((s) => (s.loadout = pick.chance(0.5) ? "heavy" : "light"));
      const c = startCombat({ mission: m, squad, pairs: combatPairs(st, squad), squadMood: squadMood(st) });
      autoplay(c);
      if (barracks) {
        for (const u of c.units) if (u.side === "squad" && u.dead) { u.dead = false; u.downed = true; u.hp = 0; }
        c.events = c.events.filter((e) => e.kind !== "died");
        if (c.outcome === "wiped") c.outcome = "evacuated";
      }
      missions++;
      if (c.outcome === "victory") wins++;
      const deb = applyMission(st, m, c);
      console.log(`day ${st.day}: ${deb.lines[0]} (${c.turn} turns, ${deb.result.deadIds.length} dead, ${c.events.filter((e) => e.kind === "refusal").length} refusals)`);
      for (const r of [...st.refusalReviews]) resolveRefusal(st, r.soldierId, pick.pick<RefusalChoice>(["keep", "keep", "demote", "base-duty"]));
    }
  }
  const report = await endDay(st);
  for (const e of report.events) if (sampleScenes.length < 14 && pick.chance(0.25)) sampleScenes.push(`  d${report.day} [${e.location}] ${e.scene}${e.lines.length ? "  " + e.lines.map((l) => `${st.soldiers[l.speaker].callsign}: "${l.text}"`).join(" ") : ""}`);
}

const alive = living(st);
const tiers: Record<string, number> = { stranger: 0, familiar: 0, bonded: 0, deep: 0 };
let asym = 0, negative = 0, strangersForever = 0, pairs = 0, warmNoTrust = 0;
const ranked: { a: string; b: string; ab: string; ba: string; score: number }[] = [];
for (let i = 0; i < alive.length; i++)
  for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i], b = alive[j];
    const ab = edge(st, a.id, b.id), ba = edge(st, b.id, a.id);
    pairs++;
    tiers[mutualTier(st, a.id, b.id)]++;
    if (ab.tier !== ba.tier) asym++;
    if (ab.warmth < -10 || ba.warmth < -10) negative++;
    if (ab.tier === "stranger" && ba.tier === "stranger") strangersForever++;
    if ((ab.warmth > 25 && ab.trust < 5) || (ba.warmth > 25 && ba.trust < 5)) warmNoTrust++;
    ranked.push({
      a: a.callsign, b: b.callsign,
      ab: `${ab.tier} w${ab.warmth.toFixed(0)} t${ab.trust.toFixed(0)}`,
      ba: `${ba.tier} w${ba.warmth.toFixed(0)} t${ba.trust.toFixed(0)}`,
      score: ab.warmth + ba.warmth + ab.trust + ba.trust,
    });
  }
ranked.sort((x, y) => y.score - x.score);
console.log(`\n=== after ${days} days (seed ${seed}) ===`);
console.log(`missions ${missions}, victories ${wins}, alive ${alive.length}, dead ${st.memorial.length}`);
console.log(`pairs ${pairs}: mutual tiers`, tiers);
console.log(`asymmetric pairs (A→B tier ≠ B→A tier): ${asym}`);
console.log(`pairs where someone is cold (warmth < -10): ${negative}`);
console.log(`pairs still strangers both ways: ${strangersForever}`);
console.log(`warm-but-distrustful edges: ${warmNoTrust}`);
console.log(`\ntop pairs:`);
ranked.slice(0, 6).forEach((r) => console.log(`  ${r.a} → ${r.b}: ${r.ab}   |   ${r.b} → ${r.a}: ${r.ba}`));
console.log(`coldest pairs:`);
ranked.slice(-3).forEach((r) => console.log(`  ${r.a} → ${r.b}: ${r.ab}   |   ${r.b} → ${r.a}: ${r.ba}`));
const unlocked = Object.values(st.edges).filter((e) => e.unlockedActions.length && e.from < e.to);
console.log(`\nbond actions unlocked: ${unlocked.map((e) => `${st.soldiers[e.from].callsign}&${st.soldiers[e.to].callsign}: ${e.unlockedActions.join(",")}`).join("; ") || "none"}`);
const minted = alive.flatMap((s) => s.traits.filter((t) => t.trigger?.kind === "person" || t.trigger?.kind === "position").map((t) => `${s.callsign} ${t.text}`));
console.log(`habits minted from memory: ${minted.join("; ") || "none"}`);
console.log(`squad mood (avg command trust): ${squadMood(st).toFixed(1)}`);
console.log(`\nsample nights:\n${sampleScenes.join("\n")}`);
void tierRank;
