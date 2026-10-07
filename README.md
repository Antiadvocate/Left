# Open Weights

XCOM-style tactics where the squad's relationships are the real strategy layer. Fire Emblem's bonds, XCOM's permadeath, and a barracks that keeps living between missions. Placeholder graphics: grid, cards and text.

This is a prototype of milestones 1 to 3 from the design doc: the barracks sim, grid combat, and bonds and fear in combat. Base building, research, funding, enemy adaptation and the campaign arc come next.

## Run it

```bash
npm install
npm run dev              # http://localhost:5173
npm test                 # unit tests and milestone checks
npm run sim -- 30 1234   # headless 30-day campaign, bot plays the missions
npm run sim:barracks     # same, but nobody dies, so the relationship web stays readable
npm run build            # static bundle in dist/ (GitHub Pages workflow included)
```

The game runs fully on templates. To have an LLM write the nights, open **Settings** and add any OpenAI-compatible endpoint (OpenRouter by default; DeepSeek or a local server work too). The key stays in your browser.

## How a day works

1. **Command**: see the situation. A mission comes up every 1–3 days; on quiet days you go straight to the night.
2. **Deploy**: pick up to six soldiers and set each one's loadout line (heavy or light). The screen lists the bonds your choice splits.
3. **Combat**: 16×14 grid, two actions, half and full cover, flanking, overwatch, bleed-out, evac, permadeath. Visible hit chances. Fear states (Steady, Shaken, Terrified) are shown as words, not numbers. A terrified human may refuse an exposed order, and the UI warns you before you give it. AI soldiers never refuse, and the squad notices when you use them for that.
4. **Debrief**: battlefield events become relationship changes, memories and new habits. You decide what happens to anyone who refused: keep them, demote, base duty or discharge. The soldiers who were once scared themselves care most about that choice.
5. **Night**: the night pass proposes barracks events. The rules engine validates them, clamps them and applies them. Then morning.

## Hard rules from the design doc, and where they live

| Rule | Where |
| --- | --- |
| No LLM call inside combat | `src/game/combat/` has no network code; a test stubs `fetch` to throw during missions |
| The LLM proposes, code applies | `night.ts` `validateNight` handles schema checks, clamps, the bond-action pool, banned phrasing and the template fallback |
| Daily caps and sustained tiers | `relations.ts` (`CAPS`, `TIER_REQ`, `updateTiers`) |
| Directional edges, asymmetric attachment | `relations.ts`: every pair has two edges, plus attachment-style scaling and fixed directional chemistry |
| Memory by significance, landmarks, mood-gated recall | `memory.ts` |
| Private habits minted from memory | `campaign.ts` `applyMission`: "takes X's place in the line", "breaks cover toward X", flank freezes |
| Barks pre-generated, picked by tag | `content.ts` `BARKS` per voice; the night pass can replace a soldier's bank |

## Code map

```
src/game/
  types.ts        data model (extends the doc's starting types)
  content.ts      pools: classes, habits, voices, barks, bond actions, enemies
  roster.ts       soldier generation, promotion
  relations.ts    bond engine: deltas, caps, tiers, relaxation, co-regulation, drift
  memory.ts       memories, landmark anchors, decay, recall
  night.ts        night pass: context, template events, LLM call, validation, apply
  lines.ts        template dialogue by voice family
  prompts.ts      night-pass system prompt (writing rules, schema in words, no examples)
  llm.ts          provider-agnostic JSON client
  campaign.ts     day loop, missions, debrief, refusals, bunks, save/load
  combat/         grid + LOS + cover, rules, engine, enemy utility AI, autoplayer bot
src/ui/           React screens: Command, Barracks, Deploy, Combat, Debrief, Night, Memorial, Settings
scripts/sim.ts    headless campaign for tuning
```

## Calls made where the doc left things open

- **How much Command sees:** behaviour only, as the doc defaults. Dossiers show habits, earned field partnerships and "seen lately" scenes. **Settings → Analyst overlay** reveals the numbers (warmth matrix, fear, memories) for tuning.
- **Refusal** is deterministic. It compares fear against Will, Command Trust and support nearby (a bonded partner, the ace), so it reads as character, not a dice roll. The UI says "may refuse" because it doesn't show those inputs.
- **Why pairs come out uneven:** every directed pair has a fixed hidden chemistry. Sharing a room drifts the pair by it, and chemistry also steers what kind of night the pair has. Most pairs barely move, a few warm up, and a few sour for good.
- **AI recruit share** is fixed at 30% for now.

## Not built yet (milestones 4–6)

Facility grid, research, Halden contract and clauses, council panic, enemy doctrine adaptation (the profile vector is already recorded per mission in `CampaignState.history`), LLM enemy comms, acts, Turned Forks, monoliths, epilogue. Funds are tracked but have nothing to spend on yet.
