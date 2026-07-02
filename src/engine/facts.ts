/**
 * FACTS — the fidelity layer. Two jobs, both deterministic and zero-token:
 *
 * 1. DURABLE FACT LEDGER. Human memory splits episodic ("she told me over dinner")
 *    from semantic ("she is from Seattle"). The engine previously stored only
 *    episodics + reflected beliefs — both of which pass through a small model's
 *    paraphrase, where proper nouns silently mutate (Seattle → Portland), and both
 *    of which decay/evict. Durable personal facts now live in their own ledger:
 *    verbatim-anchored, never decayed, never rewritten, surfaced by relevance.
 *
 * 2. QUOTE-GROUNDED VERIFICATION. Anything the Simulator writes into memory is
 *    checked against the turn's actual source text (player action + narrator prose).
 *    A proper noun that appears in the stored memory but in neither the source nor
 *    the world's known-name whitelist was CONFABULATED by the bookkeeper. We repair
 *    it by swapping in the best-matching verbatim source sentence, or flag it.
 *    (This is the attribution-verification idea from grounded-generation research —
 *    RARR-style "does the source actually say this" — done as a substring check
 *    instead of a model call, because here we HOLD the source.)
 */
import type { SaveState, CharMemory, DurableFact, Belief } from "./types";
import { relevance, compactGist } from "./memory";

/** Words that start sentences / are commonly capitalized without being names. */
const CAP_STOP = new Set([
  "The","A","An","I","He","She","They","We","You","It","His","Her","Their","My","Your","Our",
  "And","But","Or","So","Then","When","While","After","Before","If","As","At","In","On","Of","To",
  "There","This","That","These","Those","What","Who","Where","Why","How","Not","No","Yes","Now",
  "Day","Night","Morning","Evening","Afternoon","Dawn","Dusk","God","Sir","Ma'am","Madam","Lord","Lady",
  "Mr","Mrs","Ms","Dr","Everyone","Someone","Nothing","Something","Everything","Once","Later","Earlier",
  "Left","Went","Achieved","Perspective",
]);

/** Extract candidate proper nouns: capitalized tokens (and joined runs like "New Harbor"). */
export function properNouns(s: string): string[] {
  const out = new Set<string>();
  // runs of Capitalized words are one name ("Puget Sound"); singles too
  const re = /\b([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const run = m[1];
    // sentence-initial SINGLE capitalized words are usually just sentence case, not names —
    // skip them when they read like ordinary words (verb/adverb shapes). Mid-sentence
    // occurrences still catch real names; a missed sentence-initial name only weakens
    // detection, while a false positive would trigger a benign verbatim-swap.
    const atSentenceStart = m.index === 0 || /[.!?"\n]\s*$/.test(s.slice(Math.max(0, m.index - 3), m.index));
    const words = run.split(/\s+/).filter((w) => !CAP_STOP.has(w.replace(/[’']s$/, "")));
    if (!words.length) continue;
    if (atSentenceStart && words.length === 1 && /(ed|ing|ly)$/.test(words[0])) continue;
    out.add(words.join(" "));
    for (const w of words) if (w.length > 2) out.add(w);
  }
  return [...out];
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'");

/** Every name the world legitimately knows: characters, places, bible, canon, factions. */
export function knownNameWhitelist(state: SaveState): Set<string> {
  const wl = new Set<string>();
  const add = (s?: string) => { if (s) for (const n of properNouns(s)) wl.add(norm(n)); };
  for (const c of Object.values(state.characters)) { add(c.name); add(c.background); add(c.appearance_facts); }
  for (const p of Object.values(state.world.places)) add(p.name);
  const b = state.world_bible;
  add(b.name); add(b.era); add(b.cultures_and_languages); add(b.political_situation);
  add(b.climate_and_geography); add(b.calendar_and_currency); add(b.magic_rules);
  for (const cn of state.world.canon) add(cn);
  for (const k of state.world.clocks) { add(k.faction); add(k.objective); }
  for (const t of state.world.threads) { add(t.title); add(t.description); }
  return wl;
}

/** Which proper nouns in `content` appear in neither the source text nor the whitelist? */
export function suspectNouns(content: string, sourceText: string, whitelist: Set<string>): string[] {
  const src = norm(sourceText);
  return properNouns(content).filter((n) => {
    const nn = norm(n);
    return !src.includes(nn) && !whitelist.has(nn);
  });
}

/** Best verbatim source sentence for a claim (highest token-overlap), or null. */
export function bestSourceSentence(claim: string, sourceText: string, minRel = 0.22): string | null {
  const sents = sourceText.match(/[^.!?\n]+[.!?]?/g) ?? [];
  let best: string | null = null, bestS = minRel;
  for (const s of sents) {
    const t = s.trim();
    if (t.length < 12) continue;
    const r = relevance(t, claim);
    if (r > bestS) { bestS = r; best = t; }
  }
  return best;
}

/**
 * Ground a Simulator-written memory against the turn's source text.
 * If it contains confabulated proper nouns, replace it with the best verbatim
 * source sentence (truth by construction). If no source sentence matches, keep
 * the text but report the suspects so the caller can log it.
 */
export function groundMemoryContent(
  content: string, anchor: string | undefined, sourceText: string, whitelist: Set<string>,
): { content: string; repaired: boolean; suspects: string[] } {
  // an anchor that genuinely appears in the source is the strongest evidence — prefer content as-is
  const anchored = !!anchor && norm(sourceText).includes(norm(anchor.trim()));
  const suspects = suspectNouns(content, sourceText + (anchored ? " " + anchor : ""), whitelist);
  if (!suspects.length) return { content, repaired: false, suspects: [] };
  const verbatim = bestSourceSentence(content, sourceText) ?? (anchored ? anchor! : null);
  if (verbatim) return { content: compactGist(verbatim.trim(), 170), repaired: true, suspects };
  return { content, repaired: false, suspects };
}

/** Fold a verified durable fact into a character's ledger (dedupe by overlap; capped; never decays). */
export function addFact(mem: CharMemory, fact: string, turn: number, quote?: string): boolean {
  mem.facts ??= [];
  const f = fact.trim();
  if (!f) return false;
  const dup = mem.facts.find((x) => relevance(x.content, f) >= 0.6);
  if (dup) { dup.turn = turn; if (quote && !dup.quote) dup.quote = quote; return false; }
  mem.facts.push({ content: compactGist(f, 140), turn, quote: quote?.slice(0, 160) });
  if (mem.facts.length > 40) {
    // evict the oldest low-signal fact (never the newest); facts are cheap, so this is rare
    mem.facts.sort((a, b) => a.turn - b.turn);
    mem.facts.shift();
  }
  return true;
}

/** Render the ledger for the digest: the most query-relevant few + the most recent one. */
export function factsDigest(facts: DurableFact[] | undefined, query: string, max = 5): string {
  if (!facts?.length) return "";
  const ranked = [...facts]
    .map((f) => ({ f, r: relevance(f.content, query) }))
    .sort((a, b) => b.r - a.r);
  const chosen = new Set(ranked.slice(0, Math.max(1, max - 1)).map((x) => x.f));
  chosen.add(facts[facts.length - 1]); // the newest fact always rides along
  return [...chosen].map((f) => f.content).join(" | ");
}

/** Reflection guard: drop beliefs whose proper nouns appear in neither the episodic
 *  source text nor the whitelist — the cheap model invented a specific. */
export function filterSuspectBeliefs<T extends Pick<Belief, "content">>(
  beliefs: T[], sourceText: string, whitelist: Set<string>,
): { kept: T[]; dropped: string[] } {
  const kept: T[] = [], dropped: string[] = [];
  for (const b of beliefs) {
    if (suspectNouns(b.content, sourceText, whitelist).length) dropped.push(b.content);
    else kept.push(b);
  }
  return { kept, dropped };
}
