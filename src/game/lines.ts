// Template dialogue for barracks events, grouped by voice family. Short, spoken, no verdicts,
// no interiors. Used whenever the LLM is off or fails.

import type { VoiceId } from "./types";

export type Intent = "dismiss" | "offer" | "ack" | "jab" | "needle" | "deflect" | "ask" | "sit" | "instruct";
type Family = "blunt" | "soft" | "wry" | "numbers" | "salty" | "ai";

const FAMILY: Record<VoiceId, Family> = {
  clipped: "blunt", surnames: "blunt", formal: "soft", trailing: "soft", joker: "wry", questioner: "wry",
  counter: "numbers", profane: "salty", "ai-precise": "ai", "ai-echo": "ai", "ai-literal": "ai",
};

const LINES: Record<Intent, Record<Family, string[]>> = {
  dismiss: {
    blunt: ["Lights. Now.", "Not tonight.", "Go to sleep."],
    soft: ["Could you not, please.", "It's late, I— never mind."],
    wry: ["Is this a performance? Should I clap?", "Do you need an audience for that?"],
    numbers: ["That's the third time tonight.", "Four hours till wake-up. Four."],
    salty: ["Christ, give it a rest.", "Damn it, some of us sleep."],
    ai: ["The noise is at forty decibels.", "This is the fourth occurrence."],
  },
  offer: {
    blunt: ["Here. Take it.", "Yours."],
    soft: ["I had a spare. If you want it.", "This was going to waste, so—"],
    wry: ["Don't make it weird. Just take it.", "Found it. Nobody's claimed it."],
    numbers: ["Had two. Need one.", "Last one in the crate."],
    salty: ["Take the damn thing.", "Here, before I change my mind."],
    ai: ["I do not require this.", "This was allocated to me. Now to you."],
  },
  ack: {
    blunt: ["Yeah.", "Noted."],
    soft: ["Thank you. Really.", "I— okay. Thanks."],
    wry: ["What, no card?", "Is this a bribe?"],
    numbers: ["That's one I owe you.", "Logged."],
    salty: ["Huh. Damn. Thanks.", "Don't get used to it."],
    ai: ["Received. Thank you.", "I will remember this."],
  },
  jab: {
    blunt: ["Should've moved.", "Wasn't hard."],
    soft: ["Some of us went when we were told.", "I'm sure you had your reasons."],
    wry: ["Nice view from the back?", "Enjoy the wall you were hiding behind?"],
    numbers: ["Twelve meters. That's all it was.", "Three of us went. You didn't."],
    salty: ["Real brave, back there.", "Hell of a job holding that crate."],
    ai: ["Your position did not change.", "You stayed behind cover for four turns."],
  },
  needle: {
    blunt: ["Your problem, not mine.", "Saw that.", "Again? Really."],
    soft: ["I'm not going to pretend I didn't see.", "You could have just asked."],
    wry: ["Who taught you to play, a drone?", "Want me to look away next time?"],
    numbers: ["That's twice this week.", "Three times. I counted."],
    salty: ["Oh, for hell's sake.", "Unbelievable. Every damn time."],
    ai: ["That was not within the rules.", "I observed that."],
  },
  deflect: {
    blunt: ["Drop it.", "Not talking about it."],
    soft: ["Can we not do this here?", "Maybe another time."],
    wry: ["Did you hear that? Me neither.", "Who's asking?"],
    numbers: ["Ask me in a week.", "Not now. Maybe never."],
    salty: ["Leave it the hell alone.", "Don't."],
    ai: ["I do not have an answer for that.", "Please ask a different question."],
  },
  ask: {
    blunt: ["You eat?", "You good?"],
    soft: ["Are you all right?", "Did you sleep at all?"],
    wry: ["So are we talking or what?", "You planning to sit there all night?"],
    numbers: ["How many hours since you slept?", "That your third coffee?"],
    salty: ["You doing okay, or what?", "Hell of a day, huh?"],
    ai: ["Is your pulse elevated?", "Do you want me to stay?"],
  },
  instruct: {
    blunt: ["Elbow in.", "Breathe out. Then squeeze."],
    soft: ["Slower. Like this.", "Again, but don't rush it."],
    wry: ["You trying to hit it or scare it?", "Did the target insult you?"],
    numbers: ["Two degrees left. Again.", "Six rounds, six holes. Again."],
    salty: ["Hell, no. Elbow in.", "Stop strangling the damn thing."],
    ai: ["Your grip pressure is uneven. Again.", "You exhale too early. Again."],
  },
  sit: {
    blunt: ["Move over.", "This seat taken?"],
    soft: ["Mind if I sit?", "I'll just— here."],
    wry: ["Saving this for anyone?", "Room for one more?"],
    numbers: ["Two chairs. One of you.", "There's space."],
    salty: ["Scoot, damn it.", "Shove over."],
    ai: ["I will sit here.", "This chair is unoccupied."],
  },
};

export function line(voice: VoiceId, intent: Intent, pick: (n: number) => number): string {
  const opts = LINES[intent][FAMILY[voice]];
  return opts[pick(opts.length)];
}
