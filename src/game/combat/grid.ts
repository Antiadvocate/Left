import { Rng } from "../rng";
import type { CombatState, Pt, TileKind, Unit } from "./types";

export const W = 16;
export const H = 14;
export const SIGHT = 11;

export const idx = (s: { w: number }, x: number, y: number) => y * s.w + x;
export const inBounds = (s: { w: number; h: number }, x: number, y: number) => x >= 0 && y >= 0 && x < s.w && y < s.h;
export const tileAt = (s: { w: number; h: number; tiles: TileKind[] }, x: number, y: number): TileKind =>
  inBounds(s, x, y) ? s.tiles[idx(s, x, y)] : "wall";
export const blocksMove = (t: TileKind) => t !== "floor";
export const blocksSight = (t: TileKind) => t === "full" || t === "wall";
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const cheb = (a: Pt, b: Pt) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const ORTHO: Pt[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
export const DIRS8: Pt[] = [...ORTHO, { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }];

// ---------- map generation ----------

export interface GeneratedMap {
  w: number;
  h: number;
  tiles: TileKind[];
  squadSpawns: Pt[];
  enemySpawns: Pt[][]; // pods
  evac: Pt[];
}

export function generateMap(seed: number, pods: number): GeneratedMap {
  for (let attempt = 0; attempt < 40; attempt++) {
    const rng = new Rng(seed + attempt * 7919);
    const m = tryGenerate(rng, pods);
    if (m) return m;
  }
  throw new Error("map generation failed");
}

function tryGenerate(rng: Rng, pods: number): GeneratedMap | null {
  const w = W, h = H;
  const tiles: TileKind[] = Array(w * h).fill("floor");
  const set = (x: number, y: number, t: TileKind) => { if (x >= 0 && y >= 0 && x < w && y < h) tiles[y * w + x] = t; };
  const reserved = (x: number, y: number) => y >= h - 3 && x <= 7; // squad spawn + evac
  // buildings: solid blocks
  const nb = rng.int(2, 4);
  for (let i = 0; i < nb; i++) {
    const bw = rng.int(2, 4), bh = rng.int(2, 3);
    const bx = rng.int(0, w - bw), by = rng.int(1, h - bh - 3);
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) if (!reserved(x, y)) set(x, y, "wall");
  }
  // low walls
  const nl = rng.int(6, 9);
  for (let i = 0; i < nl; i++) {
    const len = rng.int(2, 3), horiz = rng.chance(0.5);
    const x0 = rng.int(0, w - 1), y0 = rng.int(1, h - 3);
    for (let k = 0; k < len; k++) {
      const x = horiz ? x0 + k : x0, y = horiz ? y0 : y0 + k;
      if (!reserved(x, y) && tiles[y * w + x] === "floor") set(x, y, "half");
    }
  }
  // crates (half) and wrecks / pillars (full)
  const nc = rng.int(6, 10);
  for (let i = 0; i < nc; i++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 3);
    if (!reserved(x, y) && tiles[y * w + x] === "floor") set(x, y, rng.chance(0.6) ? "half" : "full");
  }
  const nw = rng.int(2, 4);
  for (let i = 0; i < nw; i++) {
    const x = rng.int(0, w - 2), y = rng.int(1, h - 4);
    if (!reserved(x, y) && !reserved(x + 1, y)) { set(x, y, "full"); set(x + 1, y, "full"); }
  }
  // cover right at the spawn so the squad starts with somewhere to stand
  for (let x = 1; x <= 6; x += 2) if (rng.chance(0.7)) set(x, h - 4, "half");

  const squadSpawns: Pt[] = [];
  for (let x = 1; x <= 6; x++) squadSpawns.push({ x, y: h - 2 });
  const evac: Pt[] = [{ x: 0, y: h - 1 }, { x: 1, y: h - 1 }, { x: 0, y: h - 2 }];
  for (const p of [...squadSpawns, ...evac]) set(p.x, p.y, "floor");

  // enemy pods in the upper part
  const floorUpper: Pt[] = [];
  for (let y = 0; y < Math.floor(h * 0.45); y++) for (let x = 0; x < w; x++) if (tiles[y * w + x] === "floor") floorUpper.push({ x, y });
  const enemySpawns: Pt[][] = [];
  const used = new Set<string>();
  for (let p = 0; p < pods; p++) {
    let center: Pt | undefined;
    for (let t = 0; t < 30; t++) {
      const c = rng.pick(floorUpper);
      if (enemySpawns.every((pod) => dist(pod[0], c) >= 4)) { center = c; break; }
    }
    if (!center) return null;
    const pod: Pt[] = [center];
    used.add(`${center.x},${center.y}`);
    for (const d of DIRS8) {
      const q = { x: center.x + d.x, y: center.y + d.y };
      if (q.x >= 0 && q.y >= 0 && q.x < w && q.y < h && tiles[q.y * w + q.x] === "floor" && !used.has(`${q.x},${q.y}`)) {
        pod.push(q);
        used.add(`${q.x},${q.y}`);
      }
      if (pod.length >= 4) break;
    }
    enemySpawns.push(pod);
  }
  // connectivity: every pod reachable from spawn
  const m = { w, h, tiles };
  const reach = floodFrom(m, squadSpawns[0]);
  if (!enemySpawns.every((pod) => reach.has(pod[0].y * w + pod[0].x))) return null;
  if (!squadSpawns.every((p) => reach.has(p.y * w + p.x))) return null;
  return { w, h, tiles, squadSpawns, enemySpawns, evac };
}

function floodFrom(m: { w: number; h: number; tiles: TileKind[] }, start: Pt): Set<number> {
  const seen = new Set<number>([start.y * m.w + start.x]);
  const q = [start];
  while (q.length) {
    const p = q.shift()!;
    for (const d of ORTHO) {
      const x = p.x + d.x, y = p.y + d.y;
      if (!inBounds(m, x, y)) continue;
      const i = y * m.w + x;
      if (seen.has(i) || blocksMove(m.tiles[i])) continue;
      seen.add(i);
      q.push({ x, y });
    }
  }
  return seen;
}

// ---------- line of sight ----------

function clearLine(s: { w: number; h: number; tiles: TileKind[] }, a: Pt, b: Pt): boolean {
  const ax = a.x + 0.5, ay = a.y + 0.5, bx = b.x + 0.5, by = b.y + 0.5;
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.ceil(d * 4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(ax + (bx - ax) * t), y = Math.floor(ay + (by - ay) * t);
    if ((x === a.x && y === a.y) || (x === b.x && y === b.y)) continue;
    if (blocksSight(tileAt(s, x, y))) return false;
  }
  return true;
}

/** LOS with XCOM-style step-out: a unit beside cover can lean out of an open side. */
export function hasLos(s: { w: number; h: number; tiles: TileKind[] }, a: Pt, b: Pt, range = SIGHT): boolean {
  if (dist(a, b) > range) return false;
  if (clearLine(s, a, b)) return true;
  for (const d of ORTHO) {
    const n = { x: a.x + d.x, y: a.y + d.y };
    if (!inBounds(s, n.x, n.y) || blocksMove(tileAt(s, n.x, n.y))) continue;
    if (!ORTHO.some((e) => blocksSight(tileAt(s, a.x + e.x, a.y + e.y)))) continue;
    if (clearLine(s, n, b) && clearLine(s, a, n)) return true;
  }
  return false;
}

// ---------- cover ----------

/** Cover value (0, 20 half, 40 full) that tile t gets against an attacker at a. */
export function coverAgainst(s: { w: number; h: number; tiles: TileKind[] }, t: Pt, a: Pt): number {
  let best = 0;
  const vx = a.x - t.x, vy = a.y - t.y;
  for (const d of ORTHO) {
    const k = tileAt(s, t.x + d.x, t.y + d.y);
    if (k !== "half" && k !== "full" && k !== "wall") continue;
    // the cover object must face the attacker (attacker in front of it, not beside or behind)
    const dot = vx * d.x + vy * d.y;
    const perp = Math.abs(vx * d.y - vy * d.x);
    if (dot <= 0 || perp > dot * 2.5) continue;
    best = Math.max(best, k === "half" ? 20 : 40);
  }
  return best;
}

export function hasAnyCover(s: { w: number; h: number; tiles: TileKind[] }, t: Pt): boolean {
  return ORTHO.some((d) => { const k = tileAt(s, t.x + d.x, t.y + d.y); return k === "half" || k === "full" || k === "wall"; });
}

// ---------- pathfinding ----------

export function occupied(s: CombatState, x: number, y: number, ignore?: Unit): Unit | undefined {
  return s.units.find((u) => u !== ignore && !u.dead && !u.evacuated && u.x === x && u.y === y);
}

/** Dijkstra over 8 directions (diagonals cost 1.5, no corner cutting). Returns cost + parent map. */
export function reachable(s: CombatState, u: Unit, budget: number): Map<number, { cost: number; prev: number }> {
  const out = new Map<number, { cost: number; prev: number }>();
  const start = idx(s, u.x, u.y);
  out.set(start, { cost: 0, prev: -1 });
  const open: { i: number; c: number }[] = [{ i: start, c: 0 }];
  while (open.length) {
    open.sort((a, b) => a.c - b.c);
    const { i, c } = open.shift()!;
    if (c > (out.get(i)?.cost ?? Infinity)) continue;
    const x = i % s.w, y = Math.floor(i / s.w);
    for (const d of DIRS8) {
      const nx = x + d.x, ny = y + d.y;
      if (!inBounds(s, nx, ny) || blocksMove(tileAt(s, nx, ny))) continue;
      if (d.x && d.y && (blocksMove(tileAt(s, x + d.x, y)) || blocksMove(tileAt(s, x, y + d.y)))) continue;
      // enemies block; allies can be passed through but not stopped on (callers check)
      const other = occupied(s, nx, ny, u);
      if (other && other.side !== u.side) continue;
      const nc = c + (d.x && d.y ? 1.5 : 1);
      if (nc > budget) continue;
      const ni = idx(s, nx, ny);
      if (nc < (out.get(ni)?.cost ?? Infinity)) {
        out.set(ni, { cost: nc, prev: i });
        open.push({ i: ni, c: nc });
      }
    }
  }
  return out;
}

export function pathTo(s: CombatState, map: Map<number, { cost: number; prev: number }>, x: number, y: number): Pt[] {
  const path: Pt[] = [];
  let i = idx(s, x, y);
  if (!map.has(i)) return [];
  while (i !== -1) {
    path.push({ x: i % s.w, y: Math.floor(i / s.w) });
    i = map.get(i)!.prev;
  }
  return path.reverse();
}
