// Generic genome: a typed spec of genes grows a deterministic look from any seed string.
// Every soldier's face and body come from their id, so they look the same every session.

import { Rng } from "../game/rng";

export type Gene<T> = (r: Rng) => T;
export type Spec<G> = { readonly [K in keyof G]: Gene<G[K]> };

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Grow a genome of shape G from a seed. Keys are rolled in spec order, so adding a gene at the end never reshuffles existing faces. */
export function grow<G>(seed: string, spec: Spec<G>): G {
  const r = new Rng(hashSeed(seed));
  const out = {} as G;
  for (const k of Object.keys(spec) as (keyof G)[]) out[k] = spec[k](r);
  return out;
}

export const oneOf = <T,>(xs: readonly T[]): Gene<T> => (r) => r.pick(xs);
export const range = (lo: number, hi: number): Gene<number> => (r) => lo + r.next() * (hi - lo);
export const chance = (p: number): Gene<boolean> => (r) => r.chance(p);
export const weighted = <T,>(pairs: readonly (readonly [T, number])[]): Gene<T> => (r) => r.weighted(pairs, (p) => p[1])![0];

// ---------- humans ----------

export const SKIN = ["#f1d3b8", "#e6bc98", "#d4a07a", "#bf8a62", "#a26d48", "#8a5636", "#6e4128", "#553020"] as const;
export const HAIR = ["#1b1612", "#2e2118", "#4a3020", "#6b4526", "#8f6a3c", "#b8955a", "#7a7570", "#a33c1e"] as const;
export type HairStyle = "buzz" | "crop" | "bun" | "braids" | "bald" | "curls" | "sidepart" | "tied";
export type Jaw = "round" | "square" | "narrow";
export type FacialHair = "none" | "stubble" | "mustache" | "beard";

export interface HumanGenome {
  skin: string;
  hair: string;
  style: HairStyle;
  headW: number;
  headH: number;
  jaw: Jaw;
  build: number;
  height: number;
  eyeGap: number;
  brow: number;
  nose: "small" | "long" | "broad";
  mouth: number;
  facialHair: FacialHair;
  scar: boolean;
  freckles: boolean;
  iris: string;
}

export const HUMAN_SPEC: Spec<HumanGenome> = {
  skin: oneOf(SKIN),
  hair: oneOf(HAIR),
  style: weighted<HairStyle>([["buzz", 3], ["crop", 3], ["bun", 2], ["braids", 1.5], ["bald", 1], ["curls", 2], ["sidepart", 2], ["tied", 2]]),
  headW: range(0.9, 1.1),
  headH: range(0.95, 1.08),
  jaw: oneOf<Jaw>(["round", "square", "narrow"]),
  build: range(0.85, 1.2),
  height: range(0.93, 1.06),
  eyeGap: range(0.9, 1.15),
  brow: range(1.2, 2.6),
  nose: oneOf(["small", "long", "broad"] as const),
  mouth: range(0.8, 1.2),
  facialHair: weighted<FacialHair>([["none", 7], ["stubble", 2], ["mustache", 0.8], ["beard", 1.2]]),
  scar: chance(0.2),
  freckles: chance(0.15),
  iris: oneOf(["#3b2a1d", "#4d3a26", "#2f4a5c", "#4a5a33", "#5b4630"]),
};

// ---------- Commons AI bodies ----------

export interface SynthGenome {
  plate: string;
  trim: string;
  light: string;
  visor: "band" | "twin" | "mono" | "grid";
  head: "capsule" | "angular" | "dome";
  antenna: boolean;
  build: number;
  height: number;
  marks: number;
}

export const SYNTH_SPEC: Spec<SynthGenome> = {
  plate: oneOf(["#d9d6cc", "#b9bcb8", "#8f948f", "#cbbf9f", "#6f767a"]),
  trim: oneOf(["#3a3f42", "#2c3133", "#5a4a32", "#433b4a"]),
  light: oneOf(["#5fe0d6", "#7cf0a0", "#f3c45a", "#9fb4ff", "#e8f0ff"]),
  visor: oneOf(["band", "twin", "mono", "grid"] as const),
  head: oneOf(["capsule", "angular", "dome"] as const),
  antenna: chance(0.35),
  build: range(0.95, 1.15),
  height: range(0.98, 1.06),
  marks: (r) => r.int(0, 3),
};
