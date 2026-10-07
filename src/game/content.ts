// Hand-authored pools. The LLM never invents abilities or effects; it picks from here
// and writes texture around it. Templates double as the fallback when no LLM is set.

import type { BarkTag, BondAction, ClassId, CombatEffect, Habit, VoiceId } from "./types";

export const CLASSES: Record<ClassId, { name: string; short: string; weapon: string; blurb: string }> = {
  heavy: { name: "Heavy", short: "HVY", weapon: "Cannon", blurb: "Big gun, one grenade." },
  assault: { name: "Assault", short: "AST", weapon: "Shotgun", blurb: "Lethal up close." },
  scout: { name: "Scout", short: "SCT", weapon: "SMG", blurb: "Fast, light, many shots." },
  sniper: { name: "Sniper", short: "SNP", weapon: "Rifle", blurb: "Deadly at range, poor up close." },
  support: { name: "Support", short: "SUP", weapon: "Carbine", blurb: "Medkits, stabilizes at range." },
  ew: { name: "Electronic Warfare", short: "EW", weapon: "Sidearm", blurb: "Jams enemy targeting." },
};

export const BOND_ACTIONS: BondAction[] = [
  { id: "drag", name: "Drag to cover", tier: "familiar", effect: "Move to a downed partner and pull them one tile into cover." },
  { id: "spotter", name: "Spotter call", tier: "familiar", effect: "Partner gets +15 Aim on a target you can see." },
  { id: "shared-overwatch", name: "Shared overwatch", tier: "bonded", effect: "When one partner's overwatch fires, the other fires on the same trigger." },
  { id: "lunge", name: "Covering lunge", tier: "bonded", effect: "Out of turn: step between partner and a shot, take the hit. Once per mission." },
  { id: "rage-reload", name: "Rage reload", tier: "deep", effect: "Partner downed: free reload and +20 Aim, but no cover for one turn." },
  { id: "hold-line", name: "Hold the line", tier: "deep", effect: "Neither partner can be Terrified while adjacent." },
];
export const BOND_ACTION_IDS = BOND_ACTIONS.map((b) => b.id);
export const bondAction = (id: string) => BOND_ACTIONS.find((b) => b.id === id);

export const TALENTS: Record<string, string> = {
  "steady-aim": "+5 Aim",
  hardened: "+1 HP",
  "cool-head": "Starts missions calmer",
  quick: "+1 Mobility",
  "field-medic": "Stabilize from 2 tiles",
  "deep-pockets": "+1 grenade or medkit charge",
};

export const HUMAN_FIRST = [
  "Mara", "Tomas", "Ines", "Dev", "Okafor", "Rhee", "Lucia", "Bram", "Sana", "Teo", "Yusuf", "Wren", "Kalani", "Ilse",
  "Dmitri", "Amara", "Nils", "Priya", "Jonah", "Esme", "Kofi", "Hana", "Ruiz", "Saoirse", "Arjun", "Noor", "Pell", "Zofia",
  "Matteo", "Ade", "Lin", "Callum", "Rosa", "Baz", "Femi", "Marisol",
];
export const HUMAN_LAST = [
  "Kowalski", "Okonkwo", "Varga", "Haddad", "Sato", "Ferreira", "Lindqvist", "Mbeki", "Duarte", "Nakamura", "Brennan",
  "Petrov", "Asante", "Quill", "Moreau", "Iyer", "Halloran", "Szabo", "Reyes", "Achterberg", "Nwosu", "Castellano",
  "Oyelaran", "Vance", "Kerr", "Tanaka", "Abiodun", "Marsh",
];
export const AI_NAMES = [
  "Lark", "Moth", "Juniper", "Ash", "Fennel", "Tally", "Quarry", "Hollis", "Sorrel", "Kestrel", "Bramble", "Ledger",
  "Cinder", "Thistle", "Verity", "Pike",
];
export const AI_SIZES = ["7b", "13b", "34b", "70b", "8x7b", "3b", "405b"];

export const PLACES = [
  "Tacoma", "Duluth", "Fresno", "Spokane", "Galveston", "Erie", "Boise", "Laredo", "Akron", "Yakima", "Missoula", "Toledo",
  "Bakersfield", "Provo", "Savannah", "Dayton", "Odessa", "Lansing", "Reno", "Moline", "Pueblo", "Sioux Falls",
];

// Traits are habits, not adjectives: concrete, filmable, unexplained.
type HabitSeed = Omit<Habit, "id"> & { ai?: boolean; human?: boolean };

export const HABIT_POOL: HabitSeed[] = [
  // help
  { text: "keeps their hands steady under fire", valence: "help", combatEffect: "steady-under-fire" },
  { text: "shoots before anyone finishes the callout", valence: "help", combatEffect: "shoot-first" },
  { text: "checks a doorway twice before entering", valence: "help", wound: true, combatEffect: "double-check" },
  { text: "keeps a spare tourniquet in every pocket", valence: "help" },
  { text: "counts magazines out loud before every op", valence: "help" },
  { text: "falls asleep anywhere, instantly", valence: "help" },
  { text: "remembers how everyone takes their coffee", valence: "help" },
  { text: "fixes things nobody asked them to fix", valence: "help" },
  { text: "learns the name of every medic on base", valence: "help" },
  { text: "eats fast, always facing the door", valence: "help", wound: true, human: true },
  { text: "hums the same four bars while cleaning a weapon", valence: "help" },
  { text: "shares cigarettes without being asked", valence: "help", human: true },
  { text: "sits with whoever is eating alone, says nothing", valence: "help" },
  { text: "writes letters nobody sees them send", valence: "help", wound: true, human: true },
  { text: "stands watch at the bunk door all night", valence: "help", ai: true },
  { text: "repeats orders back word for word", valence: "help", ai: true },
  { text: "logs every conversation aloud afterward", valence: "help", ai: true },
  // hinder
  { text: "goes silent when someone raises their voice", valence: "hinder", wound: true },
  { text: "can't sleep without noise", valence: "hinder", wound: true, human: true },
  { text: "flinches at the sound of drones", valence: "hinder", wound: true, human: true, combatEffect: "flinch-at", trigger: { kind: "enemy", value: "drone" } },
  { text: "won't sit with their back to a window", valence: "hinder", wound: true, human: true },
  { text: "freezes for a beat when the shooting comes from the side", valence: "hinder", wound: true, combatEffect: "freeze-when-flanked" },
  { text: "talks over people mid-sentence", valence: "hinder" },
  { text: "borrows kit and doesn't return it", valence: "hinder" },
  { text: "keeps the lights on all night", valence: "hinder", wound: true },
  { text: "laughs at the wrong moments", valence: "hinder" },
  { text: "picks at the skin around their thumbnails", valence: "hinder", human: true },
  { text: "takes the last of everything in the mess", valence: "hinder", human: true },
  { text: "sleeps with boots on", valence: "hinder", wound: true, human: true },
  { text: "hoards ration bars under the mattress", valence: "hinder", wound: true, human: true },
  { text: "corrects people's grammar on the radio", valence: "hinder" },
  { text: "changes the subject whenever anyone mentions home", valence: "hinder", wound: true, human: true },
  { text: "won't fire on the hounds until they're close", valence: "hinder", wound: true, combatEffect: "hold-fire-on", trigger: { kind: "enemy", value: "hound" } },
  { text: "stands perfectly still when idle, for hours", valence: "hinder", ai: true },
  { text: "mimics the laugh of whoever is nearest", valence: "hinder", ai: true },
  { text: "runs diagnostics out loud during meals", valence: "hinder", ai: true },
  { text: "asks the same question again the next morning", valence: "hinder", ai: true, wound: true },
  { text: "won't power down while anyone else is awake", valence: "hinder", ai: true, wound: true },
  { text: "moves slowly through every corner, even in the mess", valence: "hinder", combatEffect: "double-check" },
];

export const VOICES: Record<VoiceId, string> = {
  clipped: "Clipped. Drops subjects and articles. Never more than one sentence.",
  counter: "Talks in counts, distances and numbers. Precise, a little flat.",
  questioner: "Answers questions with questions. Deflects.",
  profane: "Swears softly and constantly, almost tender about it.",
  formal: "Formal, full sentences, says 'sir' even off duty.",
  trailing: "Starts sentences and lets them trail off.",
  surnames: "Calls everyone by surname only. Short, dry.",
  joker: "Jokes at the wrong time, then goes quiet.",
  "ai-precise": "Machine-precise. Corrects itself mid-line. Uses exact figures.",
  "ai-echo": "Repeats the last words someone said before answering.",
  "ai-literal": "Literal. Takes idioms at face value. Very calm.",
};
export const HUMAN_VOICES: VoiceId[] = ["clipped", "counter", "questioner", "profane", "formal", "trailing", "surnames", "joker"];
export const AI_VOICES: VoiceId[] = ["ai-precise", "ai-echo", "ai-literal"];

// Bark templates per voice. Under 8 words, spoken not written. {p} = partner name.
export const BARKS: Record<VoiceId, Record<BarkTag, string[]>> = {
  clipped: {
    flanked: ["Side. They're on the side.", "Flank. Moving."], partnerHit: ["{p}'s hit.", "{p} down. Covering."],
    kill: ["Down.", "One less."], refusal: ["No. Not that.", "Can't. Not moving."], rescue: ["Got you. Stay low."],
    miss: ["Miss.", "Dammit."], deploy: ["Ready.", "Go."], downed: ["Hit. Hit."], terrified: ["Too many. Too many."],
  },
  counter: {
    flanked: ["Two o'clock, eight meters. Exposed.", "Contact left, open angle."], partnerHit: ["{p} hit. Twelve meters.", "{p}'s down, four tiles out."],
    kill: ["That's three this week.", "Confirmed. One."], refusal: ["That's thirty meters of open ground.", "I count four guns. No."],
    rescue: ["Thirty seconds. Hold still."], miss: ["High and left.", "Wind. Correcting."], deploy: ["Six mags. Two charges. Set."],
    downed: ["Took one. Can't count."], terrified: ["I've lost count. I've lost count."],
  },
  questioner: {
    flanked: ["Since when are they behind us?", "Who's watching the left?"], partnerHit: ["{p}? {p}, you there?", "Did they get {p}?"],
    kill: ["Did you see that?", "That one count?"], refusal: ["You want me out there? Now?", "Are you serious?"],
    rescue: ["You think I'd leave you?"], miss: ["How did that miss?"], deploy: ["We doing this, then?"],
    downed: ["Why can't I feel my—"], terrified: ["Why are there so many?"],
  },
  profane: {
    flanked: ["Shit, they're round the side.", "Oh, hell. Flank."], partnerHit: ["Damn it, {p}!", "{p}, oh hell no."],
    kill: ["Get bent.", "Hell yes."], refusal: ["Hell no. Not doing it.", "No. Fuck, I can't."], rescue: ["Hold on, you bastard. Got you."],
    miss: ["Son of a—", "Goddamn it."], deploy: ["Let's go break something."], downed: ["Ah, shit. Shit."],
    terrified: ["Oh hell. Oh hell."],
  },
  formal: {
    flanked: ["Sir, we're flanked.", "Enemy on our flank, sir."], partnerHit: ["{p} is hit, sir.", "Man down. {p}."],
    kill: ["Target eliminated.", "Hostile down, sir."], refusal: ["I can't, sir.", "Sir, I— I can't."], rescue: ["I have you. Easy now."],
    miss: ["Missed, sir.", "Apologies. Missed."], deploy: ["Ready when you are, sir."], downed: ["I'm hit, sir."],
    terrified: ["Sir. Sir, please."],
  },
  trailing: {
    flanked: ["They're coming round the—", "Wait, that's not—"], partnerHit: ["{p}? No, no—", "{p}'s not moving, I—"],
    kill: ["Got it. I think I—", "That's one, that's—"], refusal: ["I can't, I just—", "Please don't make me—"],
    rescue: ["Okay, okay, I've got—"], miss: ["I had it, I—"], deploy: ["Right. Okay. Let's—"], downed: ["I don't think I—"],
    terrified: ["I can't— I can't—"],
  },
  surnames: {
    flanked: ["Flanked. Watch it.", "Side angle. Move."], partnerHit: ["{p}'s hit.", "{p}. Talk to me."],
    kill: ["Scratch one.", "Clean."], refusal: ["Find someone else.", "Not me. Not this."], rescue: ["Up. You're fine."],
    miss: ["Wide."], deploy: ["Fine."], downed: ["Hit."], terrified: ["Get me out."],
  },
  joker: {
    flanked: ["Oh good, a surprise party.", "Rude. From the side."], partnerHit: ["{p}! Not funny!", "{p}, get up. Joke's over."],
    kill: ["Tip your waiter.", "And stay down."], refusal: ["Hard pass. Really.", "Nope. Not today."], rescue: ["Who loves you? Me."],
    miss: ["Warning shot.", "Meant that."], deploy: ["Smile for the drones."], downed: ["Ha. Ow. Ow."],
    terrified: ["This isn't funny anymore."],
  },
  "ai-precise": {
    flanked: ["Flanked. Correction: doubly flanked.", "Exposure on the left vector."], partnerHit: ["{p} damaged. Forty— fifty percent.", "{p} is down."],
    kill: ["Hostile terminated.", "Kill confirmed. Logging."], refusal: ["Refusal is not available to me."],
    rescue: ["Stabilizing. Hold. Holding."], miss: ["Miss. Recalculating.", "Error margin exceeded."], deploy: ["Systems nominal. Mostly."],
    downed: ["Critical damage. Logging."], terrified: ["Threat density exceeds model."],
  },
  "ai-echo": {
    flanked: ["Flanked. We're flanked.", "From the side. The side."], partnerHit: ["{p}. {p} is hit.", "Hit. {p} is hit."],
    kill: ["Down. It's down.", "Got it. Got it."], refusal: ["I will. I will."], rescue: ["I have you. Have you."],
    miss: ["Missed. Missed it."], deploy: ["Ready. Ready."], downed: ["Down. I'm down."], terrified: ["Too many. Too many."],
  },
  "ai-literal": {
    flanked: ["They are beside us now.", "There is no wall there."], partnerHit: ["{p} has been shot.", "{p} is on the ground."],
    kill: ["It stopped moving.", "That one is finished."], refusal: ["I am going."], rescue: ["You are not dead. Good."],
    miss: ["The bullet went elsewhere."], deploy: ["I am ready to go outside."], downed: ["I am on the ground now."],
    terrified: ["There are many of them."],
  },
};

export const ENEMY_TYPES = {
  drone: { name: "Drone", hp: 4, aim: 55, mobility: 6, defense: 10, dmg: [2, 4] as [number, number], range: "mid", heavy: false, glyph: "◇" },
  stalker: { name: "Stalker", hp: 7, aim: 60, mobility: 5, defense: 5, dmg: [3, 5] as [number, number], range: "mid", heavy: false, glyph: "△" },
  hound: { name: "Hound", hp: 6, aim: 70, mobility: 7, defense: 0, dmg: [4, 6] as [number, number], range: "melee", heavy: false, glyph: "▲" },
  warden: { name: "Warden", hp: 12, aim: 60, mobility: 3, defense: 0, dmg: [4, 7] as [number, number], range: "long", heavy: true, glyph: "■" },
} as const;
export type EnemyTypeId = keyof typeof ENEMY_TYPES;

export const MISSION_TYPES = ["raid", "defense", "rescue", "data recovery", "sabotage", "retaliation"] as const;

export function habitCombat(effect: CombatEffect): string {
  switch (effect) {
    case "steady-under-fire": return "+10 Aim when wounded";
    case "freeze-when-flanked": return "Loses an action if a turn starts flanked";
    case "shoot-first": return "Free shot at the first enemy that appears";
    case "double-check": return "-1 Mobility, +5 Defense";
    case "take-dead-position": return "Deploys in a dead partner's slot";
    case "break-toward": return "Breaks cover toward someone when they go down";
    case "hold-fire-on": return "Overwatch won't fire on one enemy type";
    case "flinch-at": return "Fear rises when one enemy type is in view";
  }
}
