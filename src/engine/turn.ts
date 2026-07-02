/**
 * The turn loop. Per turn:
 *   0. pushSnapshot (rollback ring)
 *   1. decidePressure        — deterministic, 0 tokens (was: Threat Director call)
 *   2. NARRATOR              — streamed, cache-aligned prefix  [LLM call 1]
 *   3. SIMULATOR             — one strict-JSON diff merging the old Bookkeeper,
 *                              World Tick and memory-writer    [LLM call 2]
 *   4. apply diff + deterministic systems: psyche drift, trait decay,
 *      rumor diffusion, drive ticks, clock/consequence bookkeeping — 0 tokens
 *   5. reflection (every R turns, importance-gated)            [occasional small call]
 */
import type { ActionMode, SaveState, SimulatorDiff, TurnTelemetry, Belief, Stance } from "./types";
import { decidePressure, isDue, pressureDirective, detectPowerTier } from "./pressure";
import { narratorSystem, simulatorSystem, REFLECTION_SYSTEM, CHAPTER_SYSTEM, simulatorSchemaHint, stablePrefix, volatileDigest, simulatorContext, deltaNote } from "./prompts";
import { updateMind } from "./mind";
import { buildMessages, buildChatlogMessages, complete, completeStream, safeJson, setLLMPrefs } from "../llm";
import { advance, heuristicMinutes } from "./time";
import { applyEdgeDelta, capMemory, consolidateBackground, consolidateTraits, decayTraits, diffuseRumors, needsHistoryCompaction, reinforceOrMergeTrait, tickDrives, playerEdgeSnapshot, tickPsyche } from "./social";
import { regenerateDrives, seedDrive } from "./drives";
import { reflectionDue, applyReflection, tickMemoryDecay, reconsolidate, integrationGate, compactGist } from "./memory";
import { knownNameWhitelist, groundMemoryContent, addFact, filterSuspectBeliefs } from "./facts";
import { extractHeuristics, backfillDiff } from "./extract";
import { SIMULATOR_JSON_SCHEMA } from "./schema";
import { neutralUndertow } from "./undertow";
import { pushSnapshot, registerCharacter, uid } from "./state";

export interface TurnEvents {
  onPhase: (phase: string) => void;
  onDelta: (text: string) => void;
  onMeta: (meta: object) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Does a trait label describe ACQUIRED EXPERTISE (skill built over years) rather than temperament?
 *  Temperament (guarded, cruel, brave, loyal) forms at any age; expertise needs time to develop. */
function impliesExpertise(label: string): boolean {
  const l = label.toLowerCase();
  return /(master|expert|seasoned|skilled|veteran|accomplished|practiced|trained|scholar|strateg|tactician|analyst|surgeon|marksman|sniper|negotiat|diplomat|engineer|architect|virtuoso|professional|adept|connoisseur|specialist|polymath|erudite|learned|sage|encyclopedic|fluent in|mastery|expertise)/.test(l);
}
/** Minimum plausible age for a given expertise level — the harder the mastery word, the older. */
function expertiseFloor(label: string): number {
  const l = label.toLowerCase();
  if (/(master|veteran|seasoned|virtuoso|accomplished|polymath|erudite|encyclopedic|mastery|sage)/.test(l)) return 22; // deep mastery
  if (/(expert|specialist|surgeon|strateg|tactician|negotiat|diplomat|architect|connoisseur)/.test(l)) return 20;
  return 16; // basic competence/training
}


/**
 * STRIP LEAKED META — strained models sometimes emit their own working notes into the prose
 * (a trailing parenthetical of craft vocabulary: "(110 words. Action, reaction, escalation. No
 * interiority...)") or a stray instruction-echo line. The player must never see this. We remove a
 * trailing parenthetical block that reads as self-commentary, and any standalone line that is
 * clearly the model talking about its own writing rather than narrating the scene.
 */
function stripMeta(text: string): string {
  if (!text) return text;
  let t = text.trim();
  const META = /\b(word count|words?\.|interiority|kinetic|action,?\s*reaction|escalation|concrete development|ends? on|begins? on|second person|paragraphs?\.|no dialogue|prose only|the player'?s? (declaration|action) is (absolute|inviolable)|per the directive|as instructed|word-?count|beat sheet|tone:|register:|pacing:)\b/i;
  // 1) trailing parenthetical note packed with craft vocabulary
  t = t.replace(/\s*\(([^()]{0,400})\)\s*$/,(m, inner) => META.test(inner) ? "" : m).trim();
  // 2) trailing bracketed note
  t = t.replace(/\s*\[([^\[\]]{0,400})\]\s*$/,(m, inner) => META.test(inner) ? "" : m).trim();
  // 3) standalone meta lines anywhere (a whole line that is craft-talk, not scene)
  t = t.split("\n").filter((ln) => {
    const s = ln.trim();
    if (!s) return true;
    // a line is meta if it's short-ish AND hits craft vocabulary AND isn't obviously in-scene prose (no quotes/sentence flow)
    const looksMeta = META.test(s) && s.length < 220 && !/["“”]/.test(s) && (/^\(|^\[|^—\s|^\d+\s*words/i.test(s) || (s.match(/[.;]/g)?.length ?? 0) >= 2 && /\b(no |ends? on|begins? on|direct\.|kinetic\.)\b/i.test(s));
    return !looksMeta;
  }).join("\n").trim();
  return t;
}


/** Stable small hash of a character id — staggers reflection so the cast doesn't all reflect
 *  on the same turn (which produced a burst of LLM calls and a visible stall every R turns). */
function reflectSalt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 7;
}

/** MEMGPT-STYLE PAGING — cold central characters' identity cards page OUT of the cached prefix
 *  to a one-line stub, and page back IN the moment they matter (present, or named in the action
 *  or recent prose, or strongly bonded to the player). The prefix only changes on transitions,
 *  which are rare, so cache stability holds between them. Memory/traits are untouched — this
 *  pages only the identity card's place in context, not the character's mind. */
export function updatePaging(state: SaveState, action: string): void {
  if (state.model_settings.paging === false) return;
  const AWAY_TURNS = 12, BOND_FLOOR = 40;
  const turn = state.world.current_turn;
  const recentText = (state.history.slice(-3).map((h) => h.narrator_prose).join(" ") + " " + action).toLowerCase();
  const lastSeen = new Map<string, number>();
  for (const t of state.telemetry) for (const pid of t.present) lastSeen.set(pid, t.turn);
  for (const [id, c] of Object.entries(state.characters)) {
    if (id === "char_player" || c.central === false || c.status === "dead" || c.status === "departed") continue;
    const first = c.name.split(/\s+/)[0]?.toLowerCase() ?? "";
    const named = first.length >= 3 && recentText.includes(first);
    const present = state.world.present.includes(id);
    if (present || named) { if (c.paged) c.paged = false; continue; }
    if (c.paged) continue; // stays paged until presence/mention wakes them
    const e = state.world.edges.find((x) => x.from === id && x.to === "char_player");
    const bond = e ? Math.abs(e.warmth) + Math.abs(e.trust) : 0;
    const away = turn - (lastSeen.get(id) ?? 0);
    if (away >= AWAY_TURNS && bond < BOND_FLOOR) c.paged = true;
  }
}

/** PLACE GC — resolvePlace creates a record for every unmatched name and nothing ever cleaned
 *  them up, so long campaigns accumulate junk locations. Sweep: over a soft cap, evict places
 *  that are unoccupied, aren't anyone's location, and aren't referenced in recent play —
 *  oldest first (creation time is embedded in the uid). */
export function gcPlaces(state: SaveState, cap = 60): void {
  const ids = Object.keys(state.world.places);
  if (ids.length <= cap) return;
  const used = new Set<string>([state.world.player_location]);
  for (const c of Object.values(state.characters)) if (c.location) used.add(c.location);
  const recentText = state.history.slice(-8).map((h) => `${h.narrator_prose} ${h.summary}`).join(" ").toLowerCase();
  const bornAt = (id: string): number => {
    const m = /^loc_([0-9a-z]+)/.exec(id);
    if (!m) return 0;
    return parseInt(m[1].slice(0, m[1].length - 5), 36) || 0;
  };
  const evictable = ids
    .filter((id) => !used.has(id) && !(state.world.places[id].contains?.length) && !recentText.includes(state.world.places[id].name.toLowerCase()))
    .sort((a, b) => bornAt(a) - bornAt(b));
  for (const id of evictable) {
    if (Object.keys(state.world.places).length <= cap) break;
    delete state.world.places[id];
  }
}

function emptyDiff(): SimulatorDiff {
  return {
    scene_summary: "", elapsed_minutes: 20, facts: [], psyche: [], edges: [], memories: [], appearance: [], drives_update: [],
    traits: [], threads_update: [], rumors_new: [], consequences_new: [], clocks_advance: [],
    new_characters: [], new_places: [], offscreen: [],
  };
}

const INLINE_CHANNEL_NOTE = `\n[How to read the player's input: text in "double quotes" is spoken ALOUD and others can hear it; text in *asterisks* is a PRIVATE THOUGHT that NO ONE in the scene can perceive, react to, or know — not even by intuition; everything else is physical action the player takes. Honor these channels exactly: never let a character respond to or act on a thought in *asterisks*, and never have someone "overhear" something the player only thought. If the player mixes them in one message, treat each part on its own channel.]`;

const MODE_FRAME: Record<ActionMode, (a: string) => string> = {
  do: (a) => `${a}${/\*/.test(a) ? INLINE_CHANNEL_NOTE : ""}`,
  say: (a) => `The player speaks aloud, in their own voice: "${a}"`,
  think: (a) => `PRIVATE INTERIOR — the player's unspoken thought, sensed by NO ONE: ${a}\nThis is internal only. The player did NOT say or do this. No character can hear it, react to it, or know it — not even characters present, not even by intuition. Do NOT have anyone respond to it or act on its content. Render only the player's own private experience of the thought and, if anything, what is already happening around them; the thought itself changes nothing others perceive.`,
  story: (a) => `The player narrates what happens next (treat as authorial intent, weave it in, keep the world's logic): ${a}`,
};

/** A proper name (multi-word, or Capitalized non-generic) — used only as a hint for auto-tracking. */
function looksNamed(name: string): boolean {
  const generic = /^(the |a |an )?(guard|thug|man|woman|figure|stranger|officer|cop|patron|crowd|bystander|clerk|driver|waiter|nurse|soldier|guy|girl|boy|kid|person|someone)s?$/i;
  if (generic.test(name.trim())) return false;
  return /\s/.test(name.trim()) || /^[A-Z]/.test(name.trim());
}

export async function runTurn(state: SaveState, action: string, ev: TurnEvents, mode: ActionMode = "do", opts?: { ground?: boolean; eco?: boolean }): Promise<void> {
  const t0 = Date.now();
  const framedAction = MODE_FRAME[mode](action);
  const turn = state.world.current_turn;
  setLLMPrefs({ routeByPrice: !!state.model_settings.route_by_price });
  // ECO (cost governor): a transient posture, never a persisted setting — lean prompts and a
  // tightened context ceiling for this turn only.
  const eco = !!opts?.eco;
  const lean = !!state.model_settings.lean_mode || eco;
  await pushSnapshot(state);

  // 1 ── the undertow turns first: strategy, chaos, catastrophe (deterministic, 0 tokens)
  ev.onPhase("undertow");
  // ── KERNEL: psyche is driven by the relaxation scalar itself, recovered toward capacity.
  //    (The cusp-catastrophe/Kuramoto layer that used to OVERWRITE relaxation here has been
  //    removed — it severed the generative kernel. Relaxation is the driver again: the
  //    simulator's per-character relaxation_delta moves it, tickPsyche drifts it toward
  //    capacity and derives state. Emergence from one scalar, as originally designed.) ──
  for (const id of Object.keys(state.condition)) tickPsyche(state.condition[id].psyche);
  for (const id of Object.keys(state.memory)) tickMemoryDecay(state.memory[id], state.world.current_turn);
  const undertow = neutralUndertow();

  // 1b ── pressure (deterministic), heat amplified when the world is primed
  ev.onPhase("pressure");
  const verdict = decidePressure({
    turn, now: state.world.current_time, trace: state.pressure_trace, difficulty: state.world_bible.difficulty_profile,
    threads: state.world.threads, consequences: state.world.consequences, clocks: state.world.clocks, action,
    instability: undertow.instability,
    focusMode: state.world.focus?.mode ?? null, focusLabel: state.world.focus?.label ?? null,
    tension: state.model_settings.tension ?? 5,
  });
  state.pressure_trace.push(verdict.pressure);
  ev.onMeta({ pressure: verdict.pressure, band: verdict.band, source: verdict.source });

  // 2 ── narrator (streamed)
  ev.onPhase("narrator");
  updatePaging(state, action);
  const prefix = stablePrefix(state);
  const digest = volatileDigest(state, action, eco ? { budgetOverride: Math.min(state.model_settings.token_budget || 4000, 3500) } : undefined);
  const god = !!state.world_bible.god_mode;
  // tier is a light gate (blocks the "throw troops at a god" category error); it does NOT script
  // behavior — that emerges from each character's relaxation state via the perception gate.
  const recentText = [
    ...state.history.slice(-3).map((h) => h.narrator_prose ?? ""),
    state.history.slice(-1)[0]?.player_action ?? "",
  ].join(" ");
  const tier = detectPowerTier(god, recentText);
  let directive = pressureDirective(verdict, state.world_bible.pressure_palette, state.model_settings.tension ?? 5, tier);

  // ── PLOT-STALL DETECTION ── A scene has no engine of its own when nothing is pushing the PLOT
  // outward. The subtlety: a thread can carry high tension while being purely INTERNAL — a
  // character's awe, collapse, or realization. That kind of tension generates lush reaction-prose
  // that goes nowhere. So we don't ask "is there tension," we ask "is there tension pointed at an
  // external situation." When the only live threads are emotional, no consequence is pending, no
  // clock is live, AND the player is passive, the scene is stalled even if it looks intense.
  const INTERNAL_THREAD = /\b(collaps|awe|realiz|understand|awaken|existential|feeling|inner|spiritual|grief|accept|reckon|contempl|peace|doubt|faith|recogni|devotion|worship|reverence)\b/i;
  const plotThreads = (state.world.threads ?? []).filter((t) => (t.tension ?? 0) >= 3 && !INTERNAL_THREAD.test(`${t.title} ${t.description}`));
  const liveThread = plotThreads.length > 0;
  const pendingCons = (state.world.consequences ?? []).some((c) => c.status === "pending");
  const liveClock = (state.world.clocks ?? []).some((c: any) => c?.threshold && (c.progress ?? 0) < c.threshold);
  const passiveAct = !action.trim() || /^\s*(\[observer\]|continue|i watch|i wait|i observe|i look|i listen|watch|wait|observe|keep going|go on|\.\.\.)\b/i.test(action.trim());
  // stalled: no OUTWARD plot pressure of any kind, and the player isn't supplying momentum either
  const stalled = !liveThread && !pendingCons && !liveClock && passiveAct;
  const stallDirective = stalled
    ? `\nAPPLY POLICY STALL_BREAK${tier === "cosmic" || tier === "mythic" ? " (beyond-threat variant)" : ""} — nothing external is pushing the plot and the player is passive: the world must originate a concrete new external development this turn and end on it.`
    : "";

  // forbidden_as_primary stops the NARRATOR from reaching for a theme unprompted as a lazy
  // plot-solver. In god mode it is suppressed entirely (the player is sovereign). Outside god
  // mode it restrains the narrator's own plotting only — never an action the player declares.
  const forbid = (!god && state.world_bible.forbidden_as_primary?.length)
    ? `\nNever the primary engine of this scene: ${state.world_bible.forbidden_as_primary.join("; ")}. (This restrains your own unprompted plotting; it does not override an action the player explicitly declares.)`
    : "";
  // HARD FORBIDDEN GATE: the bible's `forbidden` list is banned content for this world, and unlike
  // forbidden_as_primary it isn't merely "not the focus" — it must not be INTRODUCED by you at all.
  // This was previously only a passive line at the top of the prompt with no enforcement, so the
  // thread/tension system could spin up forbidden plot (e.g. a stalker/violence thread in a world
  // whose bible says "no violence as plot driver"). Enforce it per-turn at the high-compliance spot.
  const forbiddenGate = (!god && state.world_bible.forbidden?.trim())
    ? `\nFORBIDDEN IN THIS WORLD — do NOT introduce, escalate toward, or build a thread around any of these, even if a tension or thread seems to point that way: ${state.world_bible.forbidden.trim()}. If an existing thread or the current momentum is heading into forbidden territory, steer the scene away from it rather than into it. This restrains YOUR plotting; it does not punish something the player themselves explicitly chose to make happen.`
    : "";
  // NAMED-ENTITY FABRICATION GUARD — a recurring catastrophic failure: a stray name or passing mention
  // ("David Attenborough" in a joke, an offhand "my ex") gets reconstructed under pressure into a
  // fully-formed person with a backstory and a threat. Block that explicitly at the high-compliance spot.
  // (fabrication guard now lives in the cached system prompt as an every-turn rule)

  if (god) {
    // detect an ONGOING / escalating declaration vs a discrete one-and-done act. "I will kill this
    // realm", "I begin unmaking the city", "I start tearing it all down" initiate a PROCESS that must
    // visibly unfold and accelerate this turn — not be rendered as a single tremor and a promise of
    // more later. This is the milquetoast trap: the player supplies huge momentum and the narrator
    // spends it on atmosphere and reaction instead of delivering the escalating event.
    const lowerAct = action.toLowerCase();
    const ongoing = /\b(i('?m| am| will| shall|'ll)?\s*(going to|begin|start|am beginning|will begin)\b|\bkill (this|the) (realm|world|planet|city|place)\b|\bunmak\w*|\btear\w* (it|this|the) .*(down|apart|realm|world|place)|\bbring\w* (it|this|them|the|this) (whole )?(place|realm|world|city)?\s*(all )?down|\bend (this|the) (realm|world|place|everything)|\bdestroy\w* (everything|it all|the realm|the world|this place|the place))/i.test(lowerAct);
    directive += `\nGOD MODE — THE PLAYER IS ABSOLUTELY SOVEREIGN. Whatever the player declares happens, completely, immediately, at exactly the scale and intensity they state, with no cost unless they narrate one. This overrides everything else: the magic rules, the difficulty profile and its lethality setting, the forbidden list, "consequence not catastrophe," "fair scale," and your own instinct to keep things small or safe. Never downscale, soften, delay, deflect, reinterpret, or substitute a tamer version of what they declared. If they kill millions, millions die as real bodies. If they remake a city, the city is remade.`;
    if (ongoing) {
      directive += `\nTHE PLAYER HAS INITIATED A LARGE, ONGOING ACTION — it must VISIBLY UNFOLD AND ACCELERATE this turn, not be rendered as a hint of things to come. The single worst failure here is decompressing a declared cataclysm into atmosphere: one tremor, a flickering torch, a character who "doesn't finish the sentence," a promise that it will happen soon. NO. If they said they are killing the realm, the realm is DYING NOW and fast — show it concretely and at scale this turn: structures failing, the ground opening, the sky changing, people dying en masse, the physical process tearing through everything, escalating paragraph by paragraph. Deliver the event in progress, not the warning before it. Reaction is at most a sentence amid the cataclysm; the cataclysm itself is the turn. End mid-acceleration with the thing well underway, not poised to begin.`;
    } else {
      directive += `\nThe player's act is done as declared. Now show the world's honest reaction to it — drawn from each present character's own state and relationship to the player, never from a script, and never by undoing or shrinking what happened. But reaction is not a substitute for events: if the moment calls for the story to keep moving, move it.`;
    }
  }

  // (dialogue + agenda duties now live in the cached system prompt as every-turn rules)
  const earnedResponse = (tier === "mythic" || tier === "cosmic")
    ? `\nAPPLY POLICY EARNED_RESPONSE — the player operates at extraordinary scale; the world responds at that scale.`
    : "";
  // CONTRACT GOVERNOR: when the last chapter audit found the story drifting from its standing
  // direction, every turn carries a course-correction until the next audit passes. This is the
  // machinery that was missing when a "romantic/erotic literary fiction" ran 163 turns of
  // tribunal procedure with nobody noticing.
  const contractFix = state.contract_drift
    ? `\nCOURSE-CORRECTION (the story has drifted from its contract): ${state.contract_drift} Steer back through present characters' wants and the standing direction — not with a lurch, but starting THIS turn.`
    : "";
  const fullDirective = directive + forbid + forbiddenGate + earnedResponse + stallDirective + contractFix + "\n" + undertow.directive;
  const groundNote = opts?.ground ? `\n\n=== GROUNDING (this turn) ===\nThis story is set in a real place / based on real subject matter. Use web search to get the real-world facts right — actual locations, layouts, names, how things really work, accurate period or setting detail — and weave that accuracy naturally into the prose. Do not cite sources or break the fiction; just be correct.` : "";
  // ── CONTEXT MODE ──────────────────────────────────────────────────────────
  // "digest" (classic): system + stable prefix + full digest rebuilt each turn. Correct, but only
  //   the prefix rides the provider cache.
  // "chatlog" (append-only): the SillyTavern economics. The conversation IS the context: a full
  //   state I-frame is anchored into the system message every `iframe_cadence` turns, and each
  //   turn thereafter appends only [player action] / [prose] pairs plus a small P-frame delta of
  //   live state. Between anchors the entire growing history is byte-identical, so providers with
  //   implicit prefix caching (DeepSeek ~0.1x, Gemini ~0.25x, Anthropic cache_control) bill almost
  //   all input at the cached rate. Re-anchoring resets the cache once per window — amortized.
  const chatlog = state.model_settings.context_mode === "chatlog";
  let narratorMsgs: any[];
  if (chatlog) {
    const cad = Math.max(2, state.model_settings.iframe_cadence ?? 6);
    const castSig = Object.entries(state.characters)
      .filter(([, c]) => c.status !== "dead" && c.status !== "departed" && c.central !== false && !c.paged)
      .map(([id]) => id).sort().join(",");
    const anchor = state.context_anchor;
    const stale = !anchor || (turn - anchor.turn) >= cad || anchor.cast_sig !== castSig;
    if (stale) state.context_anchor = { turn, digest: `${prefix}\n\n${digest}`, cast_sig: castSig };
    const a = state.context_anchor!;
    const pairs = state.history
      .filter((h) => h.kind !== "opening" && h.kind !== "interlude" && h.turn >= a.turn)
      .slice(-cad)
      .map((h) => ({ user: h.player_action, assistant: h.narrator_prose }));
    narratorMsgs = buildChatlogMessages(
      narratorSystem(lean), a.digest, pairs,
      `${deltaNote(state, action)}\n\n=== DIRECTION ===\n${fullDirective}${groundNote}\n\n=== PLAYER ACTION (render exactly, add no interiority) ===\n${framedAction}`,
      state.model_settings.narrator_model,
    );
  } else {
    narratorMsgs = buildMessages(
      narratorSystem(lean), prefix,
      `${digest}\n\n=== DIRECTION ===\n${fullDirective}${groundNote}\n\n=== PLAYER ACTION (render exactly, add no interiority) ===\n${framedAction}`,
      state.model_settings.narrator_model,
    );
  }
  const stream = completeStream(narratorMsgs, state.model_settings.narrator_model, state.model_settings.fallback_model, 4000, opts?.ground === true);
  let prose = "";
  let narratorUsage: import("../llm").Usage = { prompt_tokens: 0, completion_tokens: 0 };
  while (true) {
    const { done, value } = await stream.next();
    if (done) { prose = value.text; narratorUsage = value.usage; break; }
    ev.onDelta(value);
  }
  prose = stripMeta(prose);

  // 3 ── simulator (one JSON call: bookkeeper + world tick + memory writes)
  ev.onPhase("simulator");
  // The bookkeeper gets its OWN minimal context (roster, ledgers, open bookkeeping objects) —
  // not the narrator's prefix+digest. This cuts its input by more than half AND removes the
  // prose-adjacent noise a small model confabulates from. The prose it must transcribe is the
  // last thing it reads.
  const simMsgs = buildMessages(
    simulatorSystem(lean) + "\n\n" + simulatorSchemaHint(),
    simulatorContext(state),
    `=== PLAYER ACTION ===\n${framedAction}\n\n=== NARRATOR PROSE (source of truth — transcribe its specifics EXACTLY) ===\n${prose}`,
    state.model_settings.simulator_model,
  );
  let simUsage: import("../llm").Usage = { prompt_tokens: 0, completion_tokens: 0 };
  let diff = emptyDiff();
  let simOk = false;
  try {
    // constrained decoding: providers that support json_schema enforce the diff shape at the
    // decoder; `complete` transparently falls back to json_object where unsupported.
    const res = await complete(simMsgs, state.model_settings.simulator_model, state.model_settings.fallback_model, { schema: SIMULATOR_JSON_SCHEMA, name: "weft_diff" }, 3000);
    simUsage = res.usage;
    const parsed = safeJson<Partial<SimulatorDiff> | null>(res.text, null);
    if (parsed && Object.keys(parsed).length) { diff = { ...emptyDiff(), ...parsed }; simOk = true; }
    else if (res.text.trim()) {
      // RESCUE: a malformed diff used to be swallowed silently — the turn applied NOTHING and
      // every character quietly failed to remember it (a major source of "amnesia"). One cheap
      // repair round-trip fixes most cases.
      const fix = await complete(
        [{ role: "system", content: "The following was supposed to be one strict JSON object but failed to parse. Re-emit it as VALID JSON only — same content, no commentary, no markdown fences." },
         { role: "user", content: res.text.slice(0, 6000) }],
        state.model_settings.simulator_model, state.model_settings.fallback_model, true, 3000);
      simUsage.prompt_tokens += fix.usage.prompt_tokens; simUsage.completion_tokens += fix.usage.completion_tokens;
      const reparsed = safeJson<Partial<SimulatorDiff> | null>(fix.text, null);
      if (reparsed && Object.keys(reparsed).length) { diff = { ...emptyDiff(), ...reparsed }; simOk = true; }
    }
  } catch (e: any) {
    console.warn(`[turn] simulator failed entirely: ${e.message} — applying heuristics only`);
  }
  if (!simOk) console.warn("[turn] simulator diff unusable — this turn's bookkeeping is thin");
  // REGEX-FIRST BACKFILL: deterministic extraction of the mechanical, patterned changes
  // (movement, hand-offs, conditions subsiding, elapsed-time cues). The LLM diff always wins;
  // heuristics only fill what it missed — and when the diff failed entirely, they turn a
  // silent-amnesia turn into a "basics still recorded" turn. Zero tokens.
  try { diff = backfillDiff(diff, extractHeuristics(state, action, prose)); }
  catch (e: any) { console.warn(`[turn] heuristic extraction failed (skipped): ${e.message}`); }

  // 4 ── apply diff + deterministic systems
  ev.onPhase("apply");
  const shifts = applyDiff(state, diff, action, prose);
  if (!simOk) shifts.push("(the loom stuttered — this turn's records are thin; consider re-running or editing memory by hand)");
  shifts.push(...undertow.snaps);
  if (undertow.regime === "cascading") shifts.push("The world is primed — small things cascade.");
  const offscreenLog = [...(diff.offscreen ?? [])];
  offscreenLog.push(...undertow.snaps);
  offscreenLog.push(...undertow.stances.slice(0, 3).map((st) => `${st.name} ${st.stance === "press" ? "presses" : st.stance === "maneuver" ? "maneuvers" : st.stance === "hold" ? "holds position" : "yields ground"} against ${st.vs} (quantal p=${st.p.toFixed(2)})`));
  // present, named characters the player is actually engaging join the long game
  const capCentral = state.model_settings.max_central_characters ?? 6;
  for (const id of state.world.present) {
    const c = state.characters[id];
    if (c && id !== "char_player" && !c.tracked && looksNamed(c.name)) {
      // a named character in the scene becomes central (tracked, full fidelity) — but only if
      // there's room under the cap. If we're full, they stay a background/non-central figure.
      const nCentral = Object.values(state.characters).filter((x) => x.character_id !== "char_player" && x.central && x.status !== "dead" && x.status !== "departed").length;
      if (nCentral < capCentral) { c.tracked = true; c.central = true; }
      else if (c.central === undefined) c.central = false;
    }
  }
  offscreenLog.push(...tickDrives(state));   // completion events (progress already moved by QRE stances)

  // ── THEORY-OF-MIND UPDATE ── reconnect the mind layer that was orphaned when the undertow (which
  // used to call it, off the deleted QRE stance game) was removed. Without this, characters' models
  // of each other never update and mindDigest is empty. We now derive the inputs from the live
  // relaxation kernel instead of the deleted math: a character's OBSERVABLE stance is read from how
  // clenched they are (clenched → press/guard, open → yield/warm), and DISPERSION is the spread of
  // relaxation across the present cast (high spread = pulling apart, which erodes settled confidence).
  if ((state.model_settings.tension ?? 5) > 0) {
    const presentReal = state.world.present.filter((pid) => state.characters[pid] && pid !== "char_player");
    const relVals = presentReal.map((pid) => state.condition[pid]?.psyche?.relaxation ?? 0);
    // dispersion: normalized spread (std-dev-ish) of openness across the room, 0..1
    let dispersion = 0;
    if (relVals.length >= 2) {
      const mean = relVals.reduce((a, b) => a + b, 0) / relVals.length;
      const variance = relVals.reduce((a, b) => a + (b - mean) ** 2, 0) / relVals.length;
      dispersion = clamp(Math.sqrt(variance) / 10, 0, 1); // relaxation is ~-10..10, so /10 normalizes
    }
    const stanceOf = (pid: string): Stance => {
      const r = state.condition[pid]?.psyche?.relaxation ?? 0;
      return r <= -6 ? "press" : r <= -2 ? "hold" : r >= 4 ? "yield" : "maneuver";
    };
    const observedStances: Record<string, Stance> = {};
    for (const pid of presentReal) observedStances[pid] = stanceOf(pid);
    for (const id of presentReal) {
      if (!state.characters[id]?.central) continue; // only central characters carry full theory-of-mind
      const r = updateMind(state, id, observedStances, turn, dispersion);
      if (r.lines.length) shifts.push(...r.lines.slice(0, 1)); // surface at most one belief-shift line
    }
  }

  if ((state.model_settings.tension ?? 5) > 0) offscreenLog.push(...regenerateDrives(state, Math.random, undertow.epistemic_pulls ?? [], { dispersion: undertow.dispersion, sharedTarget: undertow.shared_target })); // tracked + idle → a fresh want; epistemic pulls steer toward "find out" goals; dispersion spreads the cast off any shared magnet; suppressed entirely at tension 0
  offscreenLog.push(...diffuseRumors(state));
  for (const id of Object.keys(state.characters)) {
    // conditions decay for EVERYONE incl. the player — a nosebleed is not a life sentence
    const cc = state.condition[id];
    cc.condition_age ??= {};
    const expired = cc.conditions.filter((x) => turn - (cc.condition_age![x] ?? turn) >= CONDITION_LIFESPAN);
    if (expired.length) {
      cc.conditions = cc.conditions.filter((x) => !expired.includes(x));
      for (const x of expired) delete cc.condition_age![x];
      offscreenLog.push(`${state.characters[id].name}: ${expired.map((e) => e.toLowerCase()).join(", ")} — faded.`);
    }
    if (id === "char_player") continue;
    const { kept, log } = decayTraits(state.traits[id] ?? [], turn);
    state.traits[id] = kept;
    offscreenLog.push(...log.map((l) => `${state.characters[id].name}: ${l}`));
    // earned identity change: only on the reflection cadence, never per-turn
    if (reflectionDue(state.memory[id], state.model_settings.reflection_cadence, turn, reflectSalt(id))) {
      const { kept: ck, log: clog } = consolidateTraits(state.characters[id], state.traits[id], turn);
      state.traits[id] = ck;
      for (const l of clog) { offscreenLog.push(l); shifts.push(l); }
      // identity-defining memories fold permanently into background (survive eviction, shape who they are)
      const blog = consolidateBackground(state.characters[id], state.memory[id]);
      for (const l of blog) { offscreenLog.push(l); shifts.push(l); }
    }
  }
  for (const id of Object.keys(state.condition)) {
    const ps = state.condition[id].psyche;
    ps.mood_valence = Math.round(ps.relaxation);
  }
  // fired consequences retire
  for (const c of state.world.consequences) if (isDue(c, turn, state.world.current_time) && verdict.due_consequence?.id === c.id) c.status = "fired";

  // PHASE auto-advance: when the event a build-phase was converging on actually fires,
  // the phase becomes the next one (e.g. "prepare for war" → "fighting the war"), flipping the
  // tension default from suppressed to hot — generically, driven by the consequence, not by words.
  const focus = state.world.focus;
  if (focus?.linked_consequence_id) {
    const linked = state.world.consequences.find((c) => c.id === focus.linked_consequence_id);
    if (linked && linked.status === "fired") {
      if (focus.next_label) {
        state.world.focus = { label: focus.next_label, mode: focus.next_mode ?? "active" };
        shifts.push(`The phase turns: now ${focus.next_label}.`);
      } else {
        state.world.focus = null;   // the event passed and there's no next phase — release focus
      }
    }
  }
  // fired clocks
  for (const c of state.world.clocks) if (c.status === "running" && c.filled >= c.segments) c.status = "fired";

  // history + time
  const minutes = diff.elapsed_minutes > 0 ? clamp(diff.elapsed_minutes, 1, 12 * 60) : heuristicMinutes(action, prose);
  state.world.current_time = advance(state.world.current_time, minutes);
  state.history.push({
    turn, player_action: action, action_mode: mode, narrator_prose: prose,
    summary: diff.scene_summary || prose.slice(0, 120),
    shifts: shifts.slice(0, 8), weather: state.world.weather, directive: fullDirective,
    offscreen: offscreenLog.slice(0, 6), time_label: state.world.current_time,
  });

  // 5 ── reflection (occasional, importance-gated)
  let reflectionTokens = 0;
  for (const id of Object.keys(state.memory)) {
    const mem = state.memory[id];
    if (!reflectionDue(mem, state.model_settings.reflection_cadence, turn, reflectSalt(id))) continue;
    ev.onPhase("reflection");
    try {
      const recent = mem.episodic.slice(-20).map((m) => `[T${m.turn}, imp ${m.importance}] ${m.content}`).join("\n");
      const msgs = [
        { role: "system", content: REFLECTION_SYSTEM },
        { role: "user", content: `Character: ${state.characters[id]?.name}\nExisting beliefs: ${mem.beliefs.map((b) => b.content).join(" | ") || "none"}\nRecent memories:\n${recent}` },
      ];
      const res = await complete(msgs, state.model_settings.simulator_model, state.model_settings.fallback_model, true, 600);
      reflectionTokens += res.usage.prompt_tokens + res.usage.completion_tokens;
      const parsed = safeJson<{ beliefs: { content: string; confidence: number }[] }>(res.text, { beliefs: [] });
      let beliefs: Belief[] = parsed.beliefs.slice(0, 3).map((b) => ({ content: b.content, confidence: clamp(b.confidence ?? 0.7, 0, 1), formed_turn: turn, evidence_turns: [] }));
      // FIDELITY GATE: a belief is a paraphrase by a cheap model — if it contains a proper noun
      // that appears nowhere in the episodic memories it was distilled from (nor in the world's
      // known names), the model invented a specific. Drop that belief; keep the rest.
      {
        const wl = knownNameWhitelist(state);
        const src = mem.episodic.map((m) => `${m.content} ${m.full_content ?? ""}`).join(" ") + " " + (mem.facts ?? []).map((f) => f.content).join(" ");
        const { kept, dropped } = filterSuspectBeliefs(beliefs, src, wl);
        beliefs = kept;
        if (dropped.length) console.warn(`[reflection] dropped ${dropped.length} confabulated belief(s) for ${state.characters[id]?.name}`);
      }
      if (beliefs.length) applyReflection(mem, beliefs, turn);

      // history compaction: when the accreted life_history has grown long, re-summarize it into
      // tighter prose (preserve the throughline, lose verbatim detail). Bedrock background untouched.
      const ident = state.characters[id];
      if (ident && needsHistoryCompaction(ident)) {
        try {
          const cmsg = [
            { role: "system", content: `You compress a character's accumulated life-history into tighter prose. Preserve every identity-defining throughline (relationships formed, who they became, irreversible changes, key losses and bonds) but collapse repetitive or minor beats and lose verbatim detail. Keep it under 120 words, past tense, plain prose, no list. Output ONLY the rewritten history paragraph.` },
            { role: "user", content: `Character: ${ident.name}\nTheir core identity (do NOT repeat this, it's already known): ${ident.background}\nAccumulated history to compress:\n${ident.life_history}` },
          ];
          const cres = await complete(cmsg, state.model_settings.simulator_model, state.model_settings.fallback_model, false, 300);
          reflectionTokens += cres.usage.prompt_tokens + cres.usage.completion_tokens;
          const tightened = cres.text.trim();
          if (tightened && tightened.length < (ident.life_history?.length ?? 0)) {
            ident.life_history = tightened;
            shifts.push(`${ident.name}'s long history settled into its essentials.`);
          }
        } catch (e: any) {
          // if the rewrite fails, fall back to a hard tail-trim so it can't grow unbounded
          if (ident.life_history && ident.life_history.length > 1400) ident.life_history = ident.life_history.slice(-1400);
        }
      }
    } catch (e: any) {
      console.warn(`[turn] reflection failed for ${id}: ${e.message}`);
    }
  }

  gcPlaces(state);

  // ── CHAPTERING: every chapter_cadence turns, one cheap call turns the last stretch of
  // summaries into a titled chapter — shown in Chronicle and carried as one line each in
  // context, so the verbatim history window can stay small without losing the arc.
  const chapCad = state.model_settings.chapter_cadence ?? 25;
  if (chapCad > 0 && turn > 0 && turn % chapCad === 0) {
    try {
      ev.onPhase("reflection");
      state.chapters ??= [];
      const fromTurn = (state.chapters.at(-1)?.to_turn ?? 0) + 1;
      const beats = state.history.filter((h) => h.kind !== "opening" && h.turn >= fromTurn).map((h) => `T${h.turn}: ${h.summary}`).join("\n");
      if (beats.trim()) {
        const contract = state.world_bible.narrator_direction?.trim() || "";
        const res = await complete([
          { role: "system", content: CHAPTER_SYSTEM },
          { role: "user", content: `STANDING DIRECTION (the contract): "${contract || "none given"}"\n\nChapter ${state.chapters.length + 1}. Beats:\n${beats.slice(0, 6000)}` },
        ], state.model_settings.simulator_model, state.model_settings.fallback_model, true, 500);
        reflectionTokens += res.usage.prompt_tokens + res.usage.completion_tokens;
        const ch = safeJson<{ title?: string; summary?: string; on_contract?: boolean; drift?: string }>(res.text, {});
        if (ch.summary) {
          state.chapters.push({ idx: state.chapters.length + 1, from_turn: fromTurn, to_turn: turn, title: (ch.title ?? `Chapter ${state.chapters.length + 1}`).slice(0, 60), summary: ch.summary.slice(0, 400), on_contract: ch.on_contract !== false, drift: ch.drift?.slice(0, 200) });
          // arm or clear the governor
          state.contract_drift = ch.on_contract === false && ch.drift?.trim() ? ch.drift.trim().slice(0, 200) : null;
        }
      }
    } catch (e: any) { console.warn(`[turn] chaptering failed: ${e.message}`); }
  }

  // telemetry
  const tel: TurnTelemetry = {
    turn, ts: Date.now(), pressure: verdict.pressure, pressure_source: verdict.source,
    narrator_tokens_in: narratorUsage.prompt_tokens, narrator_tokens_out: narratorUsage.completion_tokens,
    simulator_tokens_in: simUsage.prompt_tokens, simulator_tokens_out: simUsage.completion_tokens,
    cached_tokens: (narratorUsage.cached_tokens ?? 0) + (simUsage.cached_tokens ?? 0),
    turn_cost: (narratorUsage.cost ?? 0) + (simUsage.cost ?? 0) || undefined,
    reflection_tokens: reflectionTokens, duration_ms: Date.now() - t0,
    word_count: prose.split(/\s+/).filter(Boolean).length,
    player_mood_valence: state.condition["char_player"]?.psyche.mood_valence ?? 0,
    present: [...state.world.present], time_label: state.world.current_time,
    edge_snapshot: playerEdgeSnapshot(state),
    lyapunov: undertow.lyapunov, coherence: undertow.coherence,
    regime: undertow.regime, early_warning: undertow.early_warning,
  };
  state.telemetry.push(tel);
  // sliding window: long campaigns (thousands of turns) would otherwise bloat every save with raw
  // per-turn telemetry. Keep a generous recent window — the charts don't need more, and lifetime
  // counts that matter are derived elsewhere. Same for the pressure trace.
  const TEL_WINDOW = 300;
  if (state.telemetry.length > TEL_WINDOW) state.telemetry = state.telemetry.slice(-TEL_WINDOW);
  if (state.pressure_trace.length > TEL_WINDOW) state.pressure_trace = state.pressure_trace.slice(-TEL_WINDOW);
  state.world.current_turn++;
  ev.onMeta({ telemetry: tel, offscreen: offscreenLog.slice(0, 6), shifts: shifts.slice(0, 8), weather: state.world.weather, time: state.world.current_time });
}

const TRANSIENT_RE = /\b(currently|right now|at the moment|for now|bleeding|blood(y|ied)?|nosebleed|fatigued?|exhausted|tears?|crying|sweat(ing)?|panting|trembling|shaking|wincing|sedat\w*|bandag\w*|restrained)\b/i;

/** Appearance is identity, not status. Strip sentences describing transient state. */
export function stripTransient(value: string): string {
  const kept = value
    .split(/(?<=[.;!?])\s+/)
    .filter((sent) => !TRANSIENT_RE.test(sent));
  return kept.join(" ").trim();
}

function wordOverlap(a: string, b: string): boolean {
  const STOP = new Set(["the","a","an","of","in","on","and","with","from","severe","slowly","slow","heavy","mild","light"]);
  const wa = a.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !STOP.has(w));
  const wb = b.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !STOP.has(w));
  return wb.some((w) => wa.some((x) => x === w || x.startsWith(w) || w.startsWith(x)));
}

/** Add a condition with dedupe: a variant of an existing condition REPLACES it instead of stacking. */
export function addCondition(c: { conditions: string[]; condition_age?: Record<string, number> }, value: string, turn: number): void {
  if (!value) return;
  c.condition_age ??= {};
  const dup = c.conditions.find((x) => x.toLowerCase() === value.toLowerCase() || wordOverlap(x, value));
  if (dup) {
    delete c.condition_age[dup];
    c.conditions = c.conditions.filter((x) => x !== dup);
  }
  c.conditions.push(value);
  c.condition_age[value] = turn;
  // hard cap: oldest fall off
  while (c.conditions.length > 6) {
    const oldest = c.conditions.reduce((m, x) => ((c.condition_age![x] ?? 0) < (c.condition_age![m] ?? 0) ? x : m), c.conditions[0]);
    c.conditions = c.conditions.filter((x) => x !== oldest);
    delete c.condition_age[oldest];
  }
}

const CONDITION_LIFESPAN = 10; // turns; afflictions heal unless re-earned

function findCharByName(state: SaveState, name: string): string | null {
  const n = name.toLowerCase().trim();
  for (const [id, c] of Object.entries(state.characters)) if (c.name.toLowerCase() === n) return id;
  for (const [id, c] of Object.entries(state.characters)) if (c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase())) return id;
  return null;
}

function resolveId(state: SaveState, ref: string): string | null {
  if (!ref) return null;
  if (state.characters[ref]) return ref;
  return findCharByName(state, ref);
}

/** Find a place by id or (case-insensitive) name; create it on first mention. Returns the place id. */
/** The LOCALE of a place name — the building/area, stripping a " - subroom" suffix. So "House - kitchen",
 *  "House - porch", and "House" all share locale "house". Used for presence: people in different rooms
 *  of the same building are in the same scene, instead of flickering apart on sub-room drift. */
export function localeOf(name: string): string {
  return (name || "").split(/\s+[-–—]\s+/)[0].trim().toLowerCase().replace(/[.,;:]+$/, "");
}
/** Is this a transient motion/state label rather than a real place? "walking home", "driving away",
 *  "in transit" — these shouldn't become persistent place records or break co-location. */
function isTransientLabel(name: string): boolean {
  return /\b(walking|driving|heading|moving|running|traveling|travelling|in transit|en route|on (the|their) way|leaving|departing|fleeing)\b/i.test(name) &&
    /\b(home|away|off|out|back|toward|towards|to|from)\b/i.test(name);
}

export function resolvePlace(state: SaveState, ref: string): string {
  if (!ref) return state.world.player_location;
  if (state.world.places[ref]) return ref;
  // normalize transient phrasings so "walking outside the dome" and "outside the dome" don't
  // spawn two records: drop leading motion gerunds and "in transit to", trim articles/punctuation.
  const norm = ref.trim()
    .replace(/^(walking|heading|moving|going|running|traveling|travelling|in transit|en route)\s+(to|toward|towards|into|through|out|outside|past|along|near|by)?\s*/i, "")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[.,;:]+$/, "")
    .trim() || ref.trim();
  // a transient motion label ("walking home", "driving away") is NOT a new place — it means the
  // character is leaving the current locale. Resolve it to their current place rather than spawning junk.
  if (isTransientLabel(norm)) return state.world.player_location;
  // exact-name match first
  const byName = Object.values(state.world.places).find((p) => p.name.toLowerCase() === norm.toLowerCase() || p.name.toLowerCase() === ref.trim().toLowerCase());
  if (byName) return byName.id;
  // locale match: if a "House - kitchen" already exists and we're resolving "House - living room",
  // we still make the new room, but if we're resolving the bare "House" and rooms exist, reuse one.
  const id = uid("loc");
  state.world.places[id] = { id, name: norm, description_facts: "", contains: [] };
  return id;
}

/** present is DERIVED: whoever shares the player's place is in the scene. Rebuilds every place's
 *  occupancy from each character's location. A `hint` (the diff's `present`) only nudges defaults
 *  for characters who don't yet have a location set. */
export function syncPresence(state: SaveState, hint?: string[]): void {
  const ploc = state.world.player_location;
  // seed locations for anyone the narrator named as present but who has no place yet
  if (hint) {
    for (const ref of hint) {
      const id = resolveId(state, ref);
      if (id && id !== "char_player" && !state.characters[id].location) state.characters[id].location = ploc;
    }
  }
  state.characters["char_player"].location = ploc;
  // rebuild contains[] from the source of truth (each character's location); the gone don't occupy rooms
  for (const p of Object.values(state.world.places)) p.contains = [];
  for (const [id, c] of Object.entries(state.characters)) {
    if (c.status === "dead" || c.status === "departed") continue;
    if (c.location && state.world.places[c.location]) state.world.places[c.location].contains.push(id);
  }
  // the scene = living non-player characters in the player's LOCALE — same building/area, even if a
  // different room. "House - kitchen" and "House - porch" are one scene, so people don't flicker out
  // of presence when they move between rooms. Exact-place match OR same locale both count as present.
  const playerLocaleName = localeOf(state.world.places[ploc]?.name ?? "");
  state.world.present = Object.entries(state.characters)
    .filter(([id, c]) => {
      if (id === "char_player" || c.status === "dead" || c.status === "departed" || !c.location) return false;
      if (c.location === ploc) return true; // same exact place
      // locale match counts only when at least one of the two names is explicitly a SUB-ROOM
      // ("House - kitchen"). Two distinct dash-less places whose names merely share a first
      // word ("Harbor", "Harbor House") must not merge into one scene.
      const theirName = state.world.places[c.location]?.name ?? "";
      const plName = state.world.places[ploc]?.name ?? "";
      const theirLocale = localeOf(theirName);
      return !!playerLocaleName && theirLocale === playerLocaleName && (/[-–—]/.test(theirName) || /[-–—]/.test(plName));
    })
    .map(([id]) => id);
}


export function applyDiff(state: SaveState, diff: SimulatorDiff, action: string, prose: string): string[] {
  const turn = state.world.current_turn;
  const shifts: string[] = [];
  const nameOf = (id: string) => state.characters[id]?.name ?? id;

  // MASTER TENSION DIAL — origination clamp. At tension 0 the engine introduces NOTHING new on its
  // own: no new consequences, no brand-new threads, no new faction clocks. The world still RESPONDS
  // (existing threads can resolve/shift, conditions heal, edges move, people react) — it just stops
  // manufacturing fresh trouble in the background. Low tension (1–2) also blocks new consequences.
  const tension = state.model_settings.tension ?? 5;
  if (tension <= 0) {
    diff = { ...diff,
      consequences_new: [],
      threads_update: (diff.threads_update ?? []).filter((t) => {
        const exists = state.world.threads.some((x) => x.id === t.id || x.title.toLowerCase() === t.title.toLowerCase());
        return exists; // allow updates/resolutions to existing threads, block brand-new ones
      }),
    } as SimulatorDiff;
  } else if (tension <= 2) {
    diff = { ...diff, consequences_new: [] } as SimulatorDiff;
  }

  // new characters & places first so later refs resolve
  // BIBLE UPDATE — when canon/actions fundamentally change what the WORLD IS, revise the world
  // bible itself (not just append a canon fact). The bible is the foundational description the
  // narrator reads as law; if it stays static while canon says reality was rewritten, the narrator
  // trusts the static bible and the world renders unchanged. This is what makes a transformed world
  // actually get depicted as transformed.
  {
    const bu = (diff as any).bible_update;
    if (bu && typeof bu === "object") {
      const fields = ["political_situation", "what_people_fear", "technology_level", "cultures_and_languages", "magic_rules"] as const;
      for (const f of fields) {
        const v = bu[f];
        if (typeof v === "string" && v.trim() && v.trim() !== (state.world_bible as any)[f]) {
          (state.world_bible as any)[f] = v.trim();
          shifts.push(`The world itself has changed: ${f.replace(/_/g, " ")}.`);
        }
      }
    }
  }

  // RENAME — a placeholder-named character ("the stranger") given a real name in the prose. Update
  // the actual character record (and rumor/canon references) so they're known by their real name now.
  for (const rn of (diff as any).rename ?? []) {
    if (!rn?.who || !rn?.new_name) continue;
    const id = resolveId(state, rn.who) || findCharByName(state, rn.who);
    if (!id || !state.characters[id]) continue;
    const oldName = state.characters[id].name;
    const newName = String(rn.new_name).trim();
    if (!newName || newName.toLowerCase() === oldName.toLowerCase()) continue;
    // don't collide with an existing different character
    const clashId = findCharByName(state, newName);
    if (clashId && clashId !== id) continue;
    state.characters[id].name = newName;
    shifts.push(`${oldName} is named: ${newName}.`);
  }

  const maxCentral = state.model_settings.max_central_characters ?? 6;
  const centralCount = () => Object.values(state.characters).filter((c) => c.character_id !== "char_player" && c.central && c.status !== "dead" && c.status !== "departed").length;
  for (const nc of diff.new_characters ?? []) {
    if (!nc?.name || findCharByName(state, nc.name)) continue;
    // CENTRAL-CHARACTER CAP: a new character joins as central (full fidelity) only if there's room
    // under the cap. Beyond it, they register as NON-CENTRAL — a background/environment figure with
    // minimal footprint and simple handling — until something promotes them.
    // EXCEPTION: a REFERENCED person being promoted (they carry established memories/relationships —
    // the simulator supplied seed memories or an established_reference flag) is story-load-bearing,
    // not a walk-on. They may take a central slot even at the cap, because a blank memoryless version
    // of an established person is exactly the amnesia bug (e.g. "Ellen's mother" not knowing anyone).
    const isReferenced = !!(nc as any).established_reference || ((nc as any).memories?.length ?? 0) > 0;
    const canBeCentral = centralCount() < maxCentral || isReferenced;
    registerCharacter(state, { ...nc, character_id: undefined as any, gregariousness: clamp(nc.gregariousness ?? 0.5, 0, 1), central: canBeCentral, tracked: canBeCentral && ((nc as any).tracked ?? isReferenced) });
    if (!canBeCentral) shifts.push(`${nc.name} enters as a background figure (cast is at ${maxCentral} central characters).`);
  }
  for (const np of diff.new_places ?? []) {
    if (!np?.name) continue;
    const exists = Object.values(state.world.places).some((p) => p.name.toLowerCase() === np.name.toLowerCase());
    if (!exists) {
      const id = uid("loc");
      state.world.places[id] = { id, name: np.name, description_facts: np.description_facts ?? "", contains: [] };
    }
  }

  if (diff.weather) state.world.weather = diff.weather;
  if (diff.money) state.world.money = diff.money;

  // ── LOCATION: the bookkeeper records where everyone is. Places auto-resolve by
  //    id or name and are created on first mention (incl. "in-between" places like
  //    "walking outside the dome"). present is DERIVED from co-location, never authored. ──
  if (diff.player_location) {
    state.world.player_location = resolvePlace(state, diff.player_location);
    state.characters["char_player"].location = state.world.player_location;
  }
  for (const mv of diff.locations ?? []) {
    const cid = resolveId(state, mv.char_id);
    if (!cid || !mv.place) continue;
    const fromPid = state.characters[cid].location;
    const pid = resolvePlace(state, mv.place);
    if (pid !== fromPid) {
      // a move is an event the character remembers: where from, where to, when
      const fromName = (fromPid && state.world.places[fromPid]?.name) || "elsewhere";
      const toName = state.world.places[pid]?.name ?? mv.place;
      const mem = state.memory[cid];
      if (mem && fromPid) {
        mem.episodic.push({
          turn, content: `Left ${fromName} and went to ${toName}.`,
          importance: 4, emotional_charge: "", when_label: state.world.current_time, where: toName,
          last_accessed_turn: turn,
        });
        mem.episodic = capMemory(mem.episodic);
      }
    }
    state.characters[cid].location = pid;
    if (cid === "char_player") state.world.player_location = pid;
  }

  // ── EXITS: someone died or left the story for good. Mark them, pull them from the
  //    scene and any room, and stop the engine from seeding them new wants. ──
  for (const ex of diff.character_exits ?? []) {
    const cid = resolveId(state, ex.char_id);
    if (!cid || cid === "char_player") continue;
    const c = state.characters[cid];
    if (!c) continue;
    c.status = ex.kind;
    c.exit_turn = turn;
    if (ex.note) c.exit_note = ex.note;
    c.tracked = false;
    c.drive = undefined;
    c.drive_queue = [];
    // remove from whatever room held them
    const pid = c.location;
    if (pid && state.world.places[pid]) {
      state.world.places[pid].contains = state.world.places[pid].contains.filter((x) => x !== cid);
    }
    shifts.push(ex.kind === "dead" ? `${c.name} is dead.` : `${c.name} is gone.`);
  }

  syncPresence(state, diff.present);

  // ── DEATH LOCK ── the dead stay dead. A weak simulator can re-emit a killed character as present
  // or alive on a later turn (it sees them lingering in a scene and writes them acting), which
  // resurrects them. Nothing above guards against that, so enforce it here as an absolute floor:
  // any character marked dead is stripped from the scene, every room, all tracking and drives, and
  // can never be reactivated by a diff. This runs AFTER syncPresence so it wins unconditionally.
  for (const [cid, c] of Object.entries(state.characters)) {
    if (c.status !== "dead") continue;
    state.world.present = state.world.present.filter((p) => p !== cid);
    for (const p of Object.values(state.world.places)) p.contains = p.contains.filter((x) => x !== cid);
    if (c.tracked || c.drive || (c.drive_queue?.length ?? 0)) { c.tracked = false; c.drive = undefined; c.drive_queue = []; }
  }

  // a new standing quirk/interest the story earned (kept small; capped so it never becomes a list)
  for (const tx of diff.texture_add ?? []) {
    const cid = resolveId(state, tx.char_id);
    if (!cid || !tx.item?.trim()) continue;
    const c = state.characters[cid];
    c.texture ??= [];
    const item = tx.item.trim();
    if (!c.texture.some((t) => t.toLowerCase() === item.toLowerCase())) {
      c.texture.push(item);
      if (c.texture.length > 5) c.texture = c.texture.slice(-5);
    }
  }


  for (const f of diff.facts ?? []) {
    const id = resolveId(state, f.char_id); if (!id) continue;
    const c = state.condition[id]; if (!c) continue;
    switch (f.field) {
      case "fatigue": if (["fresh","tired","exhausted"].includes(f.value)) c.fatigue = f.value as any; break;
      case "hunger": if (["fed","peckish","hungry","starving"].includes(f.value)) c.hunger = f.value as any; break;
      case "condition_add": addCondition(c, f.value, turn); break;
      case "condition_remove": {
        const q = f.value.toLowerCase();
        c.conditions = c.conditions.filter((x) => {
          const keep = !(x.toLowerCase().includes(q) || q.includes(x.toLowerCase()) || wordOverlap(x, f.value));
          if (!keep) delete c.condition_age?.[x];
          return keep;
        });
        break;
      }
      case "inventory_add": if (f.value) c.inventory.push({ id: uid("itm"), name: f.value }); break;
      case "inventory_remove": c.inventory = c.inventory.filter((i) => i.name.toLowerCase() !== f.value.toLowerCase()); break;
      case "wearing_add": {
        if (!f.value) break;
        const v = f.value.toLowerCase();
        // drop any existing garment that shares a head noun (coat, jacket, dress…) so layers replace, not pile up
        const noun = (s: string) => (s.toLowerCase().match(/\b(coat|jacket|dress|shirt|gown|cloak|robe|suit|armor|armour|trousers|pants|boots|shoes|gloves|mask|hat)\b/)?.[1]) ?? "";
        const vn = noun(v);
        if (vn) c.wearing = c.wearing.filter((w) => noun(w) !== vn);
        if (!c.wearing.some((w) => w.toLowerCase() === v)) c.wearing.push(f.value);
        if (c.wearing.length > 10) c.wearing = c.wearing.slice(-10);
        break;
      }
      case "wearing_remove": {
        const v = (f.value || "").toLowerCase();
        c.wearing = c.wearing.filter((w) => { const lw = w.toLowerCase(); return lw !== v && !lw.includes(v) && !v.includes(lw); });
        break;
      }
      case "injury": if (f.value) c.injuries.push({ id: uid("inj"), type: f.value, cause: "this turn", permanent: false, functional_impact: f.value }); break;
      case "injury_remove": {
        const q = f.value.toLowerCase();
        c.injuries = c.injuries.filter((inj) => !(inj.type.toLowerCase().includes(q) || q.includes(inj.type.toLowerCase())));
        break;
      }
    }
  }

  for (const p of diff.psyche ?? []) {
    const id = resolveId(state, p.char_id); if (!id) continue;
    const c = state.condition[id]; if (!c) continue;
    c.psyche.relaxation = clamp(c.psyche.relaxation + clamp(p.relaxation_delta ?? 0, -6, 6), -10, 10);
    if (p.mood) c.psyche.mood = p.mood;
    for (const s of p.states_add ?? []) if (s && !c.psyche.active_states.includes(s)) c.psyche.active_states.push(s);
    for (const s of p.states_remove ?? []) c.psyche.active_states = c.psyche.active_states.filter((x) => x !== s);
    if (c.psyche.active_states.length > 5) c.psyche.active_states = c.psyche.active_states.slice(-5);
    const d = clamp(p.relaxation_delta ?? 0, -6, 6);
    if (id !== "char_player" && Math.abs(d) >= 3) shifts.push(d > 0 ? `${nameOf(id)} opened a little.` : `${nameOf(id)} clenched.`);
  }

  const explicitEdges = new Set((diff.edges ?? []).map((e) => `${resolveId(state, e.from)}|${resolveId(state, e.to)}`));
  for (const e of diff.edges ?? []) {
    const from = resolveId(state, e.from), to = resolveId(state, e.to);
    if (!from || !to || from === to) continue;
    applyEdgeDelta(state.world.edges, { from, to, warmth_delta: e.warmth_delta ?? 0, trust_delta: e.trust_delta ?? 0, power_delta: e.power_delta ?? 0, note: e.note, roles_set: e.roles_set }, turn);
    // RECIPROCAL ECHO: relationships move both ways, but the simulator usually emits one
    // direction. A meaningful shift echoes back at reduced strength — unless the diff moved
    // the reverse explicitly, and never INTO the player's own head (their feelings are theirs;
    // rule 5). Power echoes inverted: standing gained over someone is standing they ceded.
    const w = e.warmth_delta ?? 0, tr = e.trust_delta ?? 0, pw = e.power_delta ?? 0;
    if (to !== "char_player" && !explicitEdges.has(`${to}|${from}`) && (Math.abs(w) >= 4 || Math.abs(tr) >= 4 || Math.abs(pw) >= 4)) {
      applyEdgeDelta(state.world.edges, { from: to, to: from, warmth_delta: Math.round(w * 0.3), trust_delta: Math.round(tr * 0.25), power_delta: Math.round(-pw * 0.5) }, turn);
    }
    if (to === "char_player") {
      const w = e.warmth_delta ?? 0, tr = e.trust_delta ?? 0;
      if (w <= -5) shifts.push(`${nameOf(from)} cooled toward you.`);
      else if (w >= 5) shifts.push(`${nameOf(from)} warmed toward you.`);
      if (tr <= -5) shifts.push(`${nameOf(from)} trusts you less.`);
      else if (tr >= 5) shifts.push(`${nameOf(from)} trusts you more.`);
    }
  }

  // GROUNDING: everything the bookkeeper writes to memory is checked against the turn's actual
  // text. A proper noun in a memory that appears in neither the source nor the world's known
  // names was confabulated (the "told him Seattle, it saved Portland" bug); we repair it by
  // swapping in the best verbatim source sentence — truth by construction, zero tokens.
  const sourceText = `${action}\n${prose}`;
  const whitelist = knownNameWhitelist(state);
  for (const fl of diff.facts_learned ?? []) {
    const id = resolveId(state, fl.char_id); if (!id || !fl.fact) continue;
    const mem = state.memory[id]; if (!mem) continue;
    const quoteOk = !!fl.quote && sourceText.toLowerCase().includes(fl.quote.trim().toLowerCase());
    const g = groundMemoryContent(fl.fact, quoteOk ? fl.quote : undefined, sourceText, whitelist);
    // a fact whose specifics can't be traced to the source at all is not stored as fact —
    // it degrades to an ordinary low-importance memory of the exchange, and we log it.
    if (!g.repaired && g.suspects.length) {
      console.warn(`[facts] unverifiable fact for ${nameOf(id)} (suspects: ${g.suspects.join(", ")}) — not ledgered`);
      continue;
    }
    if (addFact(mem, g.content, turn, quoteOk ? fl.quote : undefined) && id !== "char_player") shifts.push(`${nameOf(id)} now knows: ${g.content}`);
  }
  for (const m of diff.memories ?? []) {
    const id = resolveId(state, m.char_id); if (!id || !m.content) continue;
    const mem = state.memory[id]; if (!mem) continue;
    const g = groundMemoryContent(m.content, m.anchor, sourceText, whitelist);
    if (g.repaired) m.content = g.content;
    else if (g.suspects.length) console.warn(`[memory] suspect specifics in ${nameOf(id)}'s memory (${g.suspects.join(", ")}) — no source sentence matched; stored as-is`);
    const wherePid = state.characters[id]?.location;
    mem.episodic.push({
      turn, content: compactGist(m.content), full_content: m.content, decay_stage: 0,
      importance: clamp(m.importance ?? 3, 1, 10),
      emotional_charge: m.emotional_charge ?? "", last_accessed_turn: turn,
      when_label: state.world.current_time,
      where: (wherePid && state.world.places[wherePid]?.name) || undefined,
      ...(m.scheduled_time ? { scheduled_time: m.scheduled_time, commitment_status: "pending" as const } : {}),
    });
    mem.episodic = capMemory(mem.episodic);
    if (id !== "char_player" && (m.importance ?? 3) >= 6) shifts.push(`${nameOf(id)} will remember that.`);
  }

  // reconsolidation: discussed past events get rebuilt with supplied detail (recall rewrites the
  // trace) — BUT only if the receiver credits the source. Whether the detail integrates is gated by
  // the receiver's warmth+trust toward whoever supplied it, against their own clench-resistance.
  for (const rc of (diff as any).memory_recohere ?? []) {
    const id = resolveId(state, rc.char_id); if (!id || !rc.about || !rc.added_detail) continue;
    const mem = state.memory[id]; if (!mem) continue;
    // integration gate: do they believe this source?
    const srcId = rc.source_char ? resolveId(state, rc.source_char) : null;
    const relax = state.condition[id]?.psyche?.relaxation ?? 0;
    let integrates = true;
    if (srcId && srcId !== id) {
      const edge = state.world.edges.find((e) => e.from === id && e.to === srcId);
      integrates = integrationGate(relax, edge?.warmth ?? 0, edge?.trust ?? 0);
    }
    if (!integrates) {
      // they hold their own version; the correction bounces off
      if (id !== "char_player") shifts.push(`${nameOf(id)} isn't buying that version.`);
      continue;
    }
    const merged = reconsolidate(mem, rc.about, rc.added_detail, turn);
    if (!merged) {
      // nothing close enough to recohere — it was effectively a new recollection; store it
      mem.episodic.push({
        turn, content: rc.added_detail, full_content: rc.added_detail, decay_stage: 1,
        importance: 4, emotional_charge: "", last_accessed_turn: turn, when_label: state.world.current_time,
      });
      mem.episodic = capMemory(mem.episodic);
    }
  }

  for (const cn of diff.canon_add ?? []) {
    if (!cn || state.world.canon.some((x) => x.toLowerCase() === cn.toLowerCase())) continue;
    state.world.canon.push(cn);
    if (state.world.canon.length > 20) state.world.canon.shift();
    // Canon is world-altering and PUBLIC, but knowledge of it PROPAGATES — it does not teleport
    // into every mind at once. Those PRESENT witnessed it and remember it now. Everyone else learns
    // it the way news travels: seeded as a fast-spreading rumor that reaches other minds over turns.
    // (Destroy a city, then flee to another country, and the people there don't know yet.)
    for (const id of state.world.present) {
      if (!state.memory[id]) continue;
      state.memory[id].episodic.push({
        turn, content: `I was there when it happened: ${cn}`, full_content: `I was there when it happened: ${cn}`,
        decay_stage: 0, importance: 9, emotional_charge: "awe", last_accessed_turn: turn,
        when_label: state.world.current_time,
        where: (state.characters[id]?.location && state.world.places[state.characters[id].location!]?.name) || undefined,
      });
    }
    // seed the spread: a true, high-reach rumor so the wider world finds out as news, not by fiat
    const origin = state.world.present.find((id) => id !== "char_player") ?? "char_player";
    state.world.rumors.push({
      id: uid("rum"), content: cn, truth: "true", salience: 10, origin_char: origin,
      knowers: [...state.world.present], born_turn: turn, dead: false,
    });
    shifts.push(`CANON: ${cn} (the world will come to know)`);
  }

  for (const a of diff.appearance ?? []) {
    const id = resolveId(state, a.char_id); if (!id || !a.value) continue;
    const c = state.characters[id];
    if (a.permanent) {
      // BEDROCK is append-only. A scar, a lost finger, a brand — one sentence joins the
      // baseline; face, eyes, hair, build stay exactly as written at creation. The old code
      // replaced appearance_facts wholesale here, and every partial "revision" from the
      // bookkeeper erased the character's actual face. Never again.
      const cleaned = stripTransient(a.value);
      if (!cleaned) continue;
      const sentence = cleaned.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "") + ".";
      if (!c.appearance_facts.toLowerCase().includes(sentence.toLowerCase().slice(0, -1))) {
        c.appearance_facts = `${c.appearance_facts.replace(/[.\s]+$/, "")}. ${sentence}`.slice(0, 700);
        shifts.push(`${nameOf(id)} is permanently marked — ${cleaned}`);
      }
    } else {
      // presentation layer: freely replaced, never touches the baseline
      c.appearance_now = a.value.replace(/\s+/g, " ").trim().slice(0, 300);
    }
  }

  // group drives_update by character; highest priority becomes active, rest become the queue (max 2)
  const drivesByChar = new Map<string, typeof diff.drives_update>();
  for (const du of diff.drives_update ?? []) {
    const id = resolveId(state, du.char_id); if (!id || id === "char_player" || !du.goal) continue;
    (drivesByChar.get(id) ?? drivesByChar.set(id, []).get(id)!).push(du);
  }
  for (const [id, dus] of drivesByChar) {
    const sorted = [...dus].sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
    const mk = (d: typeof sorted[number]) => ({ goal: d.goal, progress: clamp(d.progress ?? 0, 0, 100), blocker: d.blocker, priority: d.priority ?? 1, updated_turn: turn });
    state.characters[id].drive = mk(sorted[0]);
    if (sorted.length > 1) state.characters[id].drive_queue = sorted.slice(1, 3).map(mk);
    state.characters[id].tracked = true;
    if (!sorted[0].progress) shifts.push(`${nameOf(id)} wants something new: ${sorted[0].goal}.`);
  }

  // the narrator can promote characters into the long game
  for (const tk of diff.track ?? []) {
    const id = resolveId(state, tk); if (!id || id === "char_player") continue;
    if (!state.characters[id].tracked) {
      state.characters[id].tracked = true;
      shifts.push(`${nameOf(id)} steps into the larger story.`);
    }
  }

  for (const t of diff.traits ?? []) {
    const id = resolveId(state, t.char_id); if (!id || id === "char_player" || !t.label) continue;
    // age plausibility: temperament/disposition can form at any age (guarded, cruel, brave), but
    // ACQUIRED EXPERTISE needs years a child hasn't lived. Block mastery-type traits on the young.
    const age = state.characters[id]?.age ?? 30;
    if (age < 16 && impliesExpertise(t.label) && age < expertiseFloor(t.label)) continue; // too young for this expertise
    reinforceOrMergeTrait(state.traits[id] ?? (state.traits[id] = []), t, turn);
    shifts.push(`Something is growing on ${nameOf(id)}: "${t.label}".`);
  }

  for (const tu of diff.threads_update ?? []) {
    if (!tu?.title) continue;
    const existing = state.world.threads.find((t) => t.id === tu.id || t.title.toLowerCase() === tu.title.toLowerCase());
    if (existing) {
      existing.status = tu.status;
      if (tu.description) existing.description = tu.description;
      if (typeof tu.tension === "number") existing.tension = clamp(tu.tension, 0, 10);
      if (tu.status === "resolved") existing.turn_resolved = turn;
    } else if (tu.status === "active") {
      state.world.threads.push({ id: uid("thr"), title: tu.title, status: "active", description: tu.description ?? "", turn_started: turn, tension: clamp(tu.tension ?? 3, 0, 10) });
      shifts.push(`A new thread: ${tu.title}.`);
    }
    if (existing && tu.status === "resolved") shifts.push(`Thread resolved: ${tu.title}.`);
  }

  for (const r of diff.rumors_new ?? []) {
    if (!r?.content) continue;
    const origin = resolveId(state, r.origin_char) ?? "char_player";
    state.world.rumors.push({
      id: uid("rum"), content: r.content, truth: r.truth ?? "true",
      salience: clamp(r.salience ?? 5, 1, 10), origin_char: origin,
      knowers: [origin, ...state.world.present.filter(() => Math.random() < 0.6)],
      born_turn: turn, about_char: r.about_char ? resolveId(state, r.about_char) ?? undefined : undefined,
    });
    if (state.world.rumors.length > 40) state.world.rumors = state.world.rumors.slice(-40);
    shifts.push(r.truth === "true" ? `A rumor is born.` : `A rumor is born — and it isn't true.`);
  }

  for (const c of diff.consequences_new ?? []) {
    if (!c?.description) continue;
    // prefer an in-world-time schedule: "in 2 days" must mean two days of story time, not two turns.
    const deltaMin = (c.fire_in_days ? c.fire_in_days * 1440 : 0) + (c.fire_in_hours ? c.fire_in_hours * 60 : 0);
    const fire_time = deltaMin > 0 ? advance(state.world.current_time, deltaMin) : undefined;
    state.world.consequences.push({
      id: uid("cq"), description: c.description,
      fire_turn: turn + Math.max(1, c.fire_in_turns ?? 1),   // a floor only
      fire_time,
      severity: c.severity ?? "notable", source_char: c.source_char ? resolveId(state, c.source_char) ?? undefined : undefined,
      location_trigger: c.location_trigger, status: "pending",
    });
    shifts.push(fire_time ? `Something is set for ${fire_time.replace(/\s*\(.*\)$/, "")}.` : `Something was set in motion. It will come back around.`);
  }

  for (const ca of diff.clocks_advance ?? []) {
    if ((state.model_settings.tension ?? 5) <= 0) break;   // tension 0: faction clocks freeze, no background escalation
    const clock = state.world.clocks.find((c) => c.id === ca.id || c.faction.toLowerCase() === String(ca.id).toLowerCase());
    if (clock && clock.status === "running") {
      clock.filled = clamp(clock.filled + (ca.segments ?? 1), 0, clock.segments);
      shifts.push(clock.filled >= clock.segments ? `${clock.faction}'s clock has run out.` : `${clock.faction} moved closer to their objective.`);
    }
  }

  return shifts;
}
