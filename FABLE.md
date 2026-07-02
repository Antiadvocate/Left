# WEFT — FABLE REVISION

A refresh of the engine, not a remake. Every core system — relaxation kernel, perception gate, salience-weighted memory with decay/reconsolidation/mood-congruent recall, edges, rumors, drives, pressure controller, theory-of-mind, focus phases — is preserved exactly. What changed: where the tokens go, and whether a specific fact can survive contact with a small model.

---

## 1. Where the money was going (measured)

Per typical mid-game turn (8 central characters, 4 present), the old build:

| | Narrator | Simulator |
|---|---|---|
| System prompt | 5,291 tok (2,614 lean) | 4,353 tok (2,076 lean) + 638 schema |
| Stable prefix (bible + cast) | ~1,080 | ~1,080 (same one, wholesale) |
| Volatile digest | ~3,180 | ~3,180 (same one, wholesale) |
| Per-turn directive tail | ~565 | prose ~400 |
| **Input/turn** | **~10,150** | **~9,700** |

≈ **20k input tokens per turn** → 1–2M/day at your pace. Matches your bill.

Three structural facts drove it:

1. **The bookkeeper was reading the narrator's mail.** The simulator received the full world bible, all cast cards, every present character's memories, minds, voice derivations, and want-instructions — none of which it can act on. It records deltas from prose. Feeding a small model 4k tokens of adjacent narrative material is not just waste; it is *where the confabulation comes from* — the model pattern-completes from the noise instead of transcribing the source.
2. **~400 tokens/turn of static instructions were re-sent uncached.** `voiceAutonomyReminder`, `fabricationGuard`, `earnedResponse`, and the stall directive were injected into the volatile tail every turn — identical text, full price, forever.
3. **The digest killed its own cache one line in.** Providers (DeepSeek, Gemini, Anthropic) cache the longest byte-identical prefix. The digest opened with canon (stable) followed immediately by `Turn N | time` — guaranteed to change every turn — so everything after the stable prefix was billed fresh, even the blocks that hadn't changed in 40 turns.

## 2. What this revision changes (all shipped, type-checked, built)

### Token structure
- **`simulatorContext()`** (prompts.ts) — the bookkeeper now gets its own minimal view: id roster with locations, present characters' mutable ledgers (conditions/injuries/inventory/wearing/mood), open threads/clocks/consequences/rumors *by id* so it updates instead of duplicating, canon titles, focus, tension dial, the standing direction, last two summaries. ~500–800 tokens instead of ~4,300. The prose it must transcribe is the **last** thing it reads.
- **Policy system** (prompts.ts + turn.ts) — the three static directive blocks moved into the *cached* narrator system prompt as always-on rules (voice/agenda duties, fabrication guard) and named policies (`STALL_BREAK`, `EARNED_RESPONSE`). The per-turn tail now *activates* them by name in one line (~15 tokens) instead of restating them (~400). God-mode blocks stay inline — they're dynamic and compliance-critical.
- **Compact digest keys** — `WRITE THEM AS: … Let this show in what they say and do, not as a stated label` → `as: …`; the 25-token WANTS instruction → `wants: … (stalled)`. Semantics defined once in the cached system legend. ~90–120 tokens saved per present character per turn.
- **Volatility-ordered digest** — canon → threads → clocks → focus → offscreen first; the turn/time line as late as possible. Stable digest blocks now ride the provider's implicit prefix cache.
- **Optional-key schema** — the simulator no longer emits ~25 mandatory keys of empty arrays. `scene_summary` + `elapsed_minutes` always; everything else only when it changed. Cuts output tokens and, more importantly, cuts the failure surface for small models (big mandatory schemas are where malformed JSON comes from).

**New budget, same feature set:** narrator ≈ 9.5k in, of which ~7.3k is cache-stable; simulator ≈ 3.8–4.8k in, of which ~3k is cache-stable. Raw input drops ~20k → ~13k/turn; **effective billed input (DeepSeek hit ≈ 0.1×, Gemini ≈ 0.25×) drops from ~10.4k-equivalent to ~5.5k-equivalent per turn — the ~50% you asked for**, before touching lean mode or the token budget dial, which stack on top.

### Memory fidelity (the Seattle→Portland fix)
The root cause was architectural: *every* durable fact passed through a small model's paraphrase at least once (write-time), often three times (write → reflection → condensation), with no verification anywhere, and the verbatim originals were evicted. Fixes, all deterministic and zero-token:

- **`facts.ts` (new): a semantic/episodic split.** Human memory keeps "she's from Seattle" (semantic) separate from "she told me over dinner" (episodic). The engine now has a per-character **fact ledger**: durable declarative facts, verbatim-anchored at write time, **never decayed, never re-paraphrased**, surfaced in the digest by relevance (`KNOWS:` line). The simulator emits `facts_learned: {char_id, fact, quote}` and the engine verifies the quote actually appears in the turn's text before ledgering. Decay still applies to episodics exactly as designed — you keep the token bound *and* the fact.
- **Quote-grounded verification at every paraphrase point.** Any memory the simulator writes is checked: a proper noun that appears in neither the turn's source text nor the world's known names was confabulated. Repair = swap in the best-matching **verbatim source sentence** (truth by construction). Verified in a unit test against your exact failure: input memory "grew up in **Portland**" against prose saying Seattle → stored as the verbatim Seattle sentence. The same gate runs on **reflection** (confabulated beliefs are dropped, correct ones kept — tested) and on the **context-refresh condensation** in api.ts, the single most dangerous spot, where one bad call used to be able to mutate a specific across a character's entire history at once.
- **Silent-amnesia fix.** A malformed simulator JSON used to be swallowed by `safeJson → {}`: the turn applied *nothing*, nobody's memory recorded the scene, and no one was told. Now: one cheap repair round-trip ("re-emit as valid JSON"), and if that also fails, a visible shift line — *"the loom stuttered — this turn's records are thin."* This was very likely a large share of your "people forget specific things" experience, independent of decay.
- **Reconsolidation guard** (memory.ts) — match threshold raised 0.15 → 0.30, and a supplied detail that introduces a proper noun the target memory doesn't contain needs a much stronger match (0.5) before it may overwrite. Reconstructive memory stays (it's a feature); cross-memory contamination doesn't.
- **Commitment boost is proximity-aware** — a dinner next week no longer crowds today's recall at full 0.8 weight.
- **Staggered reflection** — per-character hash offset; the whole cast no longer reflects on the same turn (which caused a cost spike and a visible stall every R turns).

### What was deliberately NOT touched
Relaxation kernel, perception gate, salience scoring (α·recency + β·importance + γ·relevance + state bias), decay stages, mood-congruent retrieval and tinting, integration gate, edges/rumors/drives/clocks/pressure/focus/mind layer, god mode, channels, presence-by-colocation, UI. Feature parity is exact; old saves load (sanitize backfills the fact ledger).

## 3. Remaining known issues (found in audit, not yet fixed)

- **Retrieval rich-get-richer**: retrieval refreshes `last_accessed_turn`, which boosts recency, which re-retrieves the same memories. Consider refreshing at half-weight or capping refreshes per memory per N turns.
- **Place proliferation**: `resolvePlace` creates a record for every unmatched name and nothing ever GC's them. Add a sweep: unvisited, empty, non-referenced places older than ~40 turns.
- **`localeOf` collisions**: "Harbor House" and "Harbor" share no locale logic but "House - kitchen"/"House" do; two unrelated places starting with the same word before a dash could merge scenes.
- **`complete()` swallows the primary error** — the fallback fires with no record of why. Log the first error into telemetry.
- **`involvement()`** rescans history per character per assemble level — harmless now, quadratic-ish if the cast grows.
- **Edges are single-direction on write** — the simulator emits A→B; B→A often should move (asymmetrically). Consider a small reciprocal heuristic.
- **Snapshot ring** keeps 7 full-state JSON blobs per save; fine now, but the fact ledger and life histories will grow them — consider structural sharing or compression.

## 4. If you want to go further than half (research-grade options)

1. **Chat-log-as-cache (the SillyTavern economics).** ST is cheap not because it's smarter but because its context is an *append-only conversation*: the entire history is a byte-identical prefix, so providers cache nearly 100% of input at 0.1–0.25×. Weft rebuilds a bespoke digest each turn — correct for "state is law," hostile to caching. Hybrid: keep the digest, but restructure the narrator call as multi-turn messages where prior turns are literal assistant messages and only a small per-turn state-delta note rides in the newest user message, with a full digest re-anchored every K turns (video-codec style: I-frames + P-frames). Estimated effective input: ~1.5–2.5k/turn. This is the single biggest remaining lever; it's also the most invasive, which is why it's a proposal, not a patch.
2. **Regex-first bookkeeping, LLM-second.** Locations, inventory hand-offs, condition removes, and elapsed time are highly patterned; a deterministic extractor could handle 60–70% of diff keys, with the LLM called only for edges/psyche/memories. Halves the simulator again.
3. **Constrained decoding** (OpenRouter `response_format` json_schema on providers that honor it) — kills malformed JSON at the source rather than repairing after.
4. **Off-peak / batch pricing** — DeepSeek's off-peak window discounts are substantial if any of your play is time-flexible; not a design change at all.
5. **MemGPT-style paging** if casts grow past ~12 central: page whole characters out to a one-line stub + on-demand rehydration, rather than shrinking everyone uniformly.

## 5. UX notes (recommendation, not code)

The unwieldiness has one root: **Weft exposes the simulation as the interface.** Cast, Chronicle, Settings, World are debug views wearing product clothes. Suggested shape:
- **One play surface, three drawers.** Play stays primary; collapse Cast/World/Chronicle into slide-over drawers from the play screen (the "who's here" strip is already the right instinct — extend it: tap a face → that character's drawer, with memory/facts/bonds tabs).
- **A "Truth" panel** — the fact ledger made visible and *editable*. When the engine gets something wrong, you correct it in one field and it propagates (this turns the fidelity layer into a user feature, and it's the cheapest trust-builder the app can have).
- **Cost as a first-class HUD element** — you already track per-turn tokens; surface a small $/session estimate + cache-hit % next to the composer, with one-tap Lean toggle. Budget anxiety is a UX problem before it's an engineering one.
- **Settings triage**: split "Story" (tension, focus, direction) from "Machine" (models, budgets, k, cadence). Most sessions never need the second page.

## 6. Feature proposals for the refresh (3–4, in priority order)

1. **Anchor Facts / Truth panel** (above) — player-editable verified-facts board per character. Backend already exists as of this revision; it's a view + two api methods.
2. **Chaptering** — auto-generate a one-paragraph chapter summary every ~25 turns (one cheap call), shown as a timeline in Chronicle and injected as a single line in context, letting you shrink `history_window` without losing arc awareness.
3. **Interview mode** — talk to any character out-of-scene (no turn, no world mutation, cheap model, their digest only). Costs ~1k tokens a question, creates enormous attachment, and doubles as a memory-fidelity debugger: ask her where you're from.
4. **Turn cost governor** — a per-day budget in settings; when projected spend crosses it, the engine auto-steps: lean mode on → token_budget tightens → suggests interlude/chapter. Makes "$5/day" a setting instead of a hope.

## 7. Files changed in this revision

- `src/engine/facts.ts` — **new**: fact ledger, proper-noun verification, quote grounding, belief filter.
- `src/engine/types.ts` — `DurableFact`, `CharMemory.facts`, `SimulatorDiff.facts_learned`, memory `anchor`.
- `src/engine/memory.ts` — KNOWS digest line, proximity-aware commitment boost, reconsolidation guard, staggered `reflectionDue`.
- `src/engine/prompts.ts` — system legend + policies (cached), simulator fidelity rules, `simulatorContext()`, optional-key schema with anchors, compact per-character keys, volatility-ordered digest.
- `src/engine/turn.ts` — simulator on its own context, JSON rescue + visible thin-bookkeeping, memory/fact grounding in `applyDiff`, verified reflection, policy-activation directives.
- `src/engine/state.ts` — fact-ledger init/backfill.
- `src/lib/api.ts` — grounded context-refresh condensation.

`tsc --noEmit` clean; `vite build` clean; grounding layer unit-tested against the Seattle/Portland case.
