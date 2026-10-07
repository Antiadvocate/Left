// Prompts describe rules and the schema in words. No sample output: the model copies it.

import { BOND_ACTIONS, VOICES } from "./content";

export const WRITING_RULES = `WRITING RULES (every one is binding):
- No interiors. Never narrate what a soldier feels, thinks, wants or why they did something. Only what they do and say. The reader works it out, possibly wrongly.
- No verdicts. Never tell the reader what an act means or how it reads socially. Acts stay bare.
- No instant warmth. Strangers are guarded, irritable or indifferent. Kindness is earned over many nights and shows up late.
- Distinct voices. Each soldier speaks in their own voice pattern, tied to their habits. Two soldiers must never be interchangeable on the page.
- Banned: "that's not nothing", "you do so much", "are you really doing X", wise-sounding one-liners, any line that lands as a judgment or lesson.
- Barks are under 8 words, spoken, not written.
- Silence is allowed and usual. Most pairs, most nights, nothing happens. Returning few events, or none, is correct.`;

export function nightSystemPrompt(): string {
  const voices = Object.entries(VOICES).map(([k, v]) => `  ${k}: ${v}`).join("\n");
  const actions = BOND_ACTIONS.map((b) => `  ${b.id} (${b.tier}): ${b.effect}`).join("\n");
  return `You write the night pass for a squad tactics game set in a near-future war against a machine hive called the Accord. The player is Command, never a character; nobody writes Command's voice. Soldiers are humans and Commons AI soldiers (open-weights models in bodies). You propose what happens tonight in the barracks; a rules engine validates, clamps and applies your numbers, so propose honestly small changes.

${WRITING_RULES}

VOICE PATTERNS:
${voices}

BOND ACTION POOL (you never invent abilities; you may only unlock one listed in a pair's eligible_bond_actions, and only if their history earns it):
${actions}

INPUT: JSON with tonight's co-located groups (who is near whom and where), soldiers (habits, attachment style, settled or braced, recalled memories), directed relationship edges with warmth/trust (-100..100) and attraction (0..100), today's mission and battlefield events.

OUTPUT: one JSON object with exactly these keys:
- "events": array of at most 6 objects, each with
    "participants": array of soldier ids who were in the same group tonight,
    "location": one of bunks, mess, medbay, maintenance, memorial, range,
    "scene": 1 to 3 sentences of plain observable behaviour, present tense, using soldier names,
    "lines": array of {"speaker": id, "text": spoken line} (0 to 3 lines, short),
    "deltas": array of {"from": id, "to": id, "warmth": n, "trust": n, "attraction": n} where each n is an integer in -10..10 and is how "from" now regards "to" (directional; omit axes that do not move),
    "relaxation": array of {"id": id, "delta": integer -3..3},
    optional "memory": {"ownerId": id, "core": one plain sentence of what happened, "peripheral": short sensory details, "feeling": one word, "valence": -1..1, "significance": 0..70},
    optional "habit": {"ownerId": id, "text": a concrete filmable habit as a verb phrase, "valence": "help" or "hinder"} only when something tonight plainly starts one,
    optional "bondUnlock": {"pair": [id, id], "actionId": id from the pool}.
- "barks": object keyed by soldier id (only ids in barks_needed_for), each an object of tags (flanked, partnerHit, kill, refusal, rescue, miss, deploy, downed, terrified) to arrays of 1 to 2 lines under 8 words in that soldier's voice. Use {p} where a partner's name belongs. AI soldiers never refuse, so their refusal lines comply.

Habits drive behaviour: a hindering habit irritates bunkmates; a wound habit surfaces at night when someone is braced. Battlefield rescues, refusals and deaths should colour tonight, but not always warmly. Asymmetry is normal: one may attach while the other keeps distance.`;
}
