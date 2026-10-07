// Memory, Weft-style: indexed by emotional significance, recall gated by mood, peripheral
// detail fades, absolute dates decay into landmarks ("before the Tacoma raid").

import { Rng, clamp, uid } from "./rng";
import type { CampaignState, Memory, Soldier } from "./types";

export const MEMORY_CAP = 24;

export function addMemory(
  st: CampaignState,
  owner: Soldier,
  m: { significance: number; core: string; peripheral?: string[]; participants?: string[]; feeling: string; valence: number },
  rng: Rng,
): Memory {
  const mem: Memory = {
    id: uid("mem", rng),
    ownerId: owner.id,
    day: st.day,
    significance: clamp(Math.round(m.significance), 0, 100),
    core: m.core.slice(0, 240),
    peripheral: (m.peripheral ?? []).slice(0, 4).map((p) => p.slice(0, 160)),
    anchor: "",
    participants: (m.participants ?? []).filter((p) => st.soldiers[p]),
    feeling: m.feeling.slice(0, 24),
    valence: clamp(m.valence, -1, 1),
  };
  mem.anchor = anchorFor(st, mem.day);
  owner.memories.push(mem);
  if (owner.memories.length > MEMORY_CAP) {
    owner.memories.sort((a, b) => b.significance - a.significance || b.day - a.day);
    owner.memories.length = MEMORY_CAP;
  }
  return mem;
}

/** Recent memories carry a day; older ones only a landmark relative to a mission. */
export function anchorFor(st: CampaignState, day: number): string {
  const age = st.day - day;
  if (age < 3) return age === 0 ? "today" : age === 1 ? "yesterday" : "a couple of days ago";
  const missions = st.pastMissions.map((p) => p.spec);
  const same = missions.find((m) => m.day === day);
  if (same) return `the day of ${same.name}`;
  const after = missions.filter((m) => m.day > day).sort((a, b) => a.day - b.day)[0];
  if (after) return `before ${after.name}`;
  const before = missions.filter((m) => m.day < day).sort((a, b) => b.day - a.day)[0];
  if (before) return `after ${before.name}`;
  return "early on";
}

export function decayMemories(st: CampaignState, rng: Rng) {
  for (const s of Object.values(st.soldiers)) {
    if (s.status === "dead") continue;
    s.memories = s.memories.filter((m) => {
      if (m.significance < 70) m.significance -= m.significance < 30 ? 2 : 1;
      m.peripheral = m.peripheral.filter(() => !rng.chance((100 - m.significance) / 400));
      m.anchor = anchorFor(st, m.day);
      return m.significance >= 5;
    });
  }
}

/** Reconstructive, mood-gated recall: braced soldiers surface the bad nights and lose detail. */
export function recall(s: Soldier, n = 3): Memory[] {
  const mood = s.relaxation / 10;
  return s.memories
    .map((m) => ({ m, score: m.significance * (1 + 0.6 * m.valence * mood) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(({ m }) => (s.braced ? { ...m, peripheral: m.peripheral.slice(0, 1) } : m));
}
