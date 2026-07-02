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

## 3. Known issues — all fixed in round 2

| Issue | Fix |
|---|---|
| Retrieval rich-get-richer (retrieved memories fully refreshed recency, locking in the same top-k) | Full refresh only when scene relevance ≥ 0.2 (genuine rehearsal); otherwise half-step toward current turn, so pure recency/importance surfacing still ages |
| Place proliferation (`resolvePlace` created a record for every unmatched name, forever) | `gcPlaces`: over a soft cap of 60, evict places that are unoccupied, nobody's location, and unreferenced in the last 8 turns — oldest first (creation time parsed from the uid) |
| `localeOf` collisions ("Harbor" vs "Harbor House" could merge into one scene) | Locale-based presence match now requires an explicit sub-room dash ("House - kitchen") on at least one of the two names |
| `complete()` swallowed the primary model's error | Errors logged to an exported `llmErrors` ring (last 20) with console warnings; final failure now throws instead of vanishing |
| `involvement()` rescanned full history per character | Last-prose text hoisted out of the loop — computed once per digest |
| Edges only moved in the written direction | Reciprocal echo: a meaningful shift (|Δ| ≥ 4) echoes back at 0.3 warmth / 0.25 trust / −0.5 power — unless the diff moved the reverse explicitly, and never into the player's own head |
| Snapshot ring stored 7 full plain-JSON state copies | gzip via `CompressionStream` (base64-stored, `z` flag), transparent fallback to plain where unsupported; `pushSnapshot`/`rollback` now async |

## 4. Research directions — all five implemented

**1. Chat-log-as-cache** (`context_mode: "chatlog"`, off by default — Tuning → Context engine).
The conversation becomes the context: a full state snapshot (I-frame) is anchored inside the system message every `iframe_cadence` turns (default 6), stored byte-identical in `save.context_anchor`; each turn appends only literal [action]/[prose] pairs plus a small P-frame delta (`deltaNote`: NOW line, per-present compact state, top-2 recalls, last-turn shifts). Between anchors every prior byte is identical, so implicit prefix caching (DeepSeek ~0.1×, Gemini ~0.25×) covers nearly the whole input; Anthropic models get `cache_control` breakpoints on the system block and last pair. Re-anchor also triggers on cast changes. Trade-off is state-fidelity drift between anchors — that's why it's opt-in and the cadence is tunable. The simulator stays on its minimal digest regardless.

**2. Regex-first bookkeeping** (`engine/extract.ts`, always on, zero tokens).
Deterministic extraction of the mechanical diff keys: elapsed-time cues, second-person movement, inventory hand-offs, conditions subsiding, named arrivals/departures. Runs as *backfill*: the LLM diff wins on any key it populated; heuristics only fill gaps — and when the diff fails entirely, they turn a silent-amnesia turn into a basics-still-recorded turn. Every pattern is second-person or names a known character; ambiguity is left to the LLM. Unit-tested.

**3. Constrained decoding** (`engine/schema.ts`).
The simulator call now ships a permissive JSON Schema (`response_format: json_schema`) so supporting providers enforce the diff shape at the decoder. Schema rejection is treated as a capability gap: same model retried in plain `json_object`, then the normal fallback chain.

**4. Price-aware routing** (Tuning → Context engine → "Route by price").
Adds OpenRouter `provider: { sort: "price" }` per call so each request lands on the cheapest healthy provider. The settings card also notes DeepSeek's automatic off-peak discount window (≈16:30–00:30 UTC).

**5. MemGPT-style paging** (`paging`, on by default; Tuning → Context engine).
A central character offscreen ≥ 12 turns, unnamed in recent prose/action, with weak player bond (<40 combined |warmth|+|trust|) pages out: their identity card leaves the cached prefix, replaced by a one-line dormant stub in the digest ("wake by naming them"). They rehydrate instantly on presence or mention. Memory, traits, and edges are untouched — only the card's seat in context is paged. Transitions are rare, so prefix cache stability holds between them.

## 5. UX — implemented

- **One play surface, three drawers.** Cast, World, and Chronicle now also mount as right-side slide-overs from chips on the Play strip — check something, keep playing, never leave the scene. Bottom tabs still work.
- **Who's-here chips are tappable** — tap a face, their full Cast drawer opens on them.
- **Cost HUD** above the composer: session spend (provider-reported), cache-hit %, daily-budget bar with eco state, and a one-tap lean toggle.
- **Truth panel** in every character's Cast drawer: the verified-fact ledger, listed with sources, deletable, hand-addable. Player edits are law.
- **Settings triage**: Tuning is now "The story" (tension, bible, opening, palette) above "The machine" (key, models, context engine, token economy, cost governor, cast, memory).

## 6. Features — implemented

- **Chaptering** (`chapter_cadence`, default 25, 0 = off): one cheap call distills the last stretch of turn summaries into a titled chapter — timeline at the top of Chronicle, carried as one line each in context (STORY SO FAR block), so the verbatim history window can stay small without losing the arc.
- **Interview mode** (Cast drawer): a quiet aside with any character, out of scene. They answer only from their own digest — memories, verified facts, mood through the openness rules — on the cheap model. Pure: nothing enters the story, their memory, or the world.
- **Cost governor** (`daily_budget_usd`, 0 = off): soft ceiling. Past 70% of today's spend the engine shifts to eco — lean prompts + tightened context — transparently, without touching saved settings. Play is never blocked; the HUD shows the bar and the leaf.
- **Anchor facts / Truth panel** — see UX above; `api.setFacts` is the authoritative write path.

## 7. Files changed

**New:** `engine/facts.ts` (fact ledger + grounding), `engine/extract.ts` (regex-first bookkeeping), `engine/schema.ts` (simulator JSON schema).
**Engine:** `types.ts`, `memory.ts`, `prompts.ts`, `turn.ts`, `state.ts`, `continuity.ts`, `llm.ts`.
**API:** `lib/api.ts` (governor, setFacts, interview, grounded refresh).
**Views:** `Play.tsx` (HUD, drawers, presence deep-link), `Cast.tsx` (Truth panel, interview), `Chronicle.tsx` (chapters), `Settings.tsx` (triage + new controls).

All type-checked (`tsc --noEmit` clean) and built (`vite build` clean). Unit tests: fact grounding (Portland→Seattle repair, clean-fact pass-through, belief filtering) and heuristic extraction (movement, hand-offs, condition removal, elapsed time, arrivals) both pass.
