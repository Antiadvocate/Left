// The tactical board: an ink-on-paper field map with pseudo-3D cover, standee figures for
// the squad and Accord machines. Everything positional reads from the animated display copy.

import { Figure } from "../art/Figure";
import { Machine } from "../art/Machine";
import type { PoseName } from "../art/skeleton";
import { coverAgainst, hasLos } from "../game/combat/grid";
import type { CombatState, Unit } from "../game/combat/types";
import type { Disp, Effect } from "./useFx";

export const T = 48;
const PAD = 44;

const px = (x: number) => x * T + T / 2;
const py = (y: number) => y * T + PAD + T * 0.8; // feet line

function hashXY(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function Cover({ kind, x, y }: { kind: string; x: number; y: number }) {
  const x0 = x * T, y0 = y * T + PAD;
  const r = hashXY(x, y);
  if (kind === "half") {
    const bags = [0, 1, 2];
    return (
      <g className="cover half">
        <rect x={x0 + 4} y={y0 + T * 0.42} width={T - 8} height={T * 0.46} fill="#a8956a" stroke="#3b3528" strokeWidth={1.2} />
        {bags.map((i) => <rect key={i} x={x0 + 3 + i * ((T - 6) / 3)} y={y0 + T * 0.3} width={(T - 6) / 3 - 1} height={T * 0.2} rx={5} fill="#c4b184" stroke="#3b3528" strokeWidth={1.1} />)}
        {bags.map((i) => <rect key={`b${i}`} x={x0 + 3 + (i + 0.5) * ((T - 6) / 3) - 2} y={y0 + T * 0.48} width={(T - 6) / 3 - 1} height={T * 0.18} rx={5} fill="#b5a274" stroke="#3b3528" strokeWidth={1} opacity={i === 2 ? 0 : 1} />)}
      </g>
    );
  }
  if (kind === "full") {
    const wreck = r > 0.5;
    return wreck ? (
      <g className="cover full">
        <path d={`M${x0 + 3} ${y0 + T * 0.92} L${x0 + 5} ${y0 + T * 0.1} L${x0 + T * 0.6} ${y0 - T * 0.12} L${x0 + T - 3} ${y0 + T * 0.14} L${x0 + T - 4} ${y0 + T * 0.92} Z`} fill="#6e6a60" stroke="#26231c" strokeWidth={1.4} />
        <path d={`M${x0 + 5} ${y0 + T * 0.1} L${x0 + T * 0.6} ${y0 - T * 0.12} L${x0 + T - 3} ${y0 + T * 0.14} L${x0 + T * 0.45} ${y0 + T * 0.3} Z`} fill="#8b867a" stroke="#26231c" strokeWidth={1} />
        <rect x={x0 + T * 0.2} y={y0 + T * 0.45} width={T * 0.3} height={T * 0.16} fill="#3a4a5a" opacity={0.6} />
        <circle cx={x0 + T * 0.25} cy={y0 + T * 0.86} r={5} fill="#26231c" /><circle cx={x0 + T * 0.75} cy={y0 + T * 0.86} r={5} fill="#26231c" />
      </g>
    ) : (
      <g className="cover full">
        <rect x={x0 + 4} y={y0 + T * 0.05} width={T - 8} height={T * 0.85} fill="#9c988c" stroke="#26231c" strokeWidth={1.4} />
        <rect x={x0 + 4} y={y0 - T * 0.12} width={T - 8} height={T * 0.2} fill="#bdb9ad" stroke="#26231c" strokeWidth={1.2} />
        <path d={`M${x0 + T * 0.3} ${y0 + T * 0.2} l4 9 l-3 7 M${x0 + T * 0.7} ${y0 + T * 0.5} l-4 8`} stroke="#4f4b42" strokeWidth={1} fill="none" />
      </g>
    );
  }
  if (kind === "wall") {
    return (
      <g className="cover wall">
        <rect x={x0} y={y0 + T * 0.25} width={T} height={T * 0.75} fill="#5d594f" />
        <rect x={x0} y={y0 - T * 0.4} width={T} height={T * 0.66} fill="#3a3731" />
        <rect x={x0} y={y0 - T * 0.4} width={T} height={T * 0.66} fill="url(#roofhatch)" />
        {r > 0.45 && <rect x={x0 + T * 0.35} y={y0 + T * 0.42} width={T * 0.3} height={T * 0.2} fill="#1d1c19" />}
        <line x1={x0} y1={y0 + T * 0.25} x2={x0 + T} y2={y0 + T * 0.25} stroke="#26231c" strokeWidth={1.2} />
      </g>
    );
  }
  return null;
}

export interface BoardProps {
  c: CombatState;
  disp: Record<string, Disp>;
  effects: Effect[];
  revealed: Map<string, number>;
  selId: string | null;
  moveMap: Map<string, { ap: 1 | 2 }>;
  targetIds: Set<string>;
  hover: { x: number; y: number } | null;
  riskAt: (x: number, y: number) => boolean;
  grenade: boolean;
  busy: boolean;
  onTile: (x: number, y: number) => void;
  onHover: (p: { x: number; y: number } | null) => void;
}

export function Board({ c, disp, effects, revealed, selId, moveMap, targetIds, hover, riskAt, grenade, busy, onTile, onHover }: BoardProps) {
  const W = c.w * T, Hh = c.h * T + PAD;
  const now = performance.now();
  const squadEyes = c.units.filter((u) => u.side === "squad" && !disp[u.id]?.dead && !disp[u.id]?.downed && !disp[u.id]?.evac);
  const seen = (u: Unit) => {
    const d = disp[u.id];
    if (u.side === "squad") return !d.evac;
    if ((revealed.get(u.id) ?? 0) > now) return true;
    if (d.dead) return c.seenEnemies.includes(u.id);
    return squadEyes.some((s) => hasLos(c, { x: Math.round(disp[s.id].x), y: Math.round(disp[s.id].y) }, { x: Math.round(d.x), y: Math.round(d.y) }));
  };
  const visible = c.units.filter(seen);
  const foesOf = (u: Unit) => visible.filter((v) => v.side !== u.side && !disp[v.id].dead && !disp[v.id].downed);

  const facingOf = (u: Unit): 1 | -1 => {
    const d = disp[u.id];
    const target = d.aimAt ? disp[d.aimAt] : undefined;
    let tx = target?.x;
    if (tx === undefined) {
      const foes = foesOf(u);
      if (foes.length) {
        const n = foes.reduce((a, b) => (Math.hypot(disp[a.id].x - d.x, disp[a.id].y - d.y) < Math.hypot(disp[b.id].x - d.x, disp[b.id].y - d.y) ? a : b));
        tx = disp[n.id].x;
      }
    }
    if (tx === undefined || Math.abs(tx - d.x) < 0.01) return u.side === "squad" ? 1 : -1;
    return tx > d.x ? 1 : -1;
  };

  const poseOf = (u: Unit): PoseName => {
    const d = disp[u.id];
    if (d.dead) return "dead";
    if (d.downed) return "down";
    if (d.moving) return d.step % 2 ? "run1" : "run2";
    if (d.aimAt || u.overwatch) return "aim";
    if (u.kind === "human" && u.fearState === "terrified") return "cower";
    const foes = foesOf(u);
    if (!foes.length) return "stand";
    const pos = { x: Math.round(d.x), y: Math.round(d.y) };
    const covered = foes.some((f) => coverAgainst(c, pos, { x: Math.round(disp[f.id].x), y: Math.round(disp[f.id].y) }) > 0);
    return covered ? "crouch" : "ready";
  };

  const rows: React.ReactNode[] = [];
  for (let y = 0; y < c.h; y++) {
    const cells: React.ReactNode[] = [];
    for (let x = 0; x < c.w; x++) {
      const k = c.tiles[y * c.w + x];
      if (k !== "floor") cells.push(<Cover key={`c${x}`} kind={k} x={x} y={y} />);
    }
    const units = visible.filter((u) => Math.round(disp[u.id].y) === y).sort((a, b) => disp[a.id].y - disp[b.id].y);
    rows.push(
      <g key={y}>
        {cells}
        {units.map((u) => {
          const d = disp[u.id];
          const hit = d.hitAt && now - d.hitAt < 350;
          const sel = u.id === selId;
          const target = targetIds.has(u.id) && !busy;
          return (
            <g key={u.id} transform={`translate(${px(d.x)} ${py(d.y)})`} className={`unit-g ${hit ? "hit" : ""} ${d.dead ? "is-dead" : ""}`}>
              <ellipse cx={0} cy={0} rx={T * 0.32} ry={T * 0.1} fill="#000" opacity={0.25} />
              {sel && <ellipse className="sel-ring" cx={0} cy={0} rx={T * 0.4} ry={T * 0.14} fill="none" stroke="#c99a2e" strokeWidth={2.4} />}
              {u.side === "squad" ? (
                <g transform="scale(0.8)">
                  <Figure seed={u.soldierId!} kind={u.kind!} cls={u.cls!} loadout={u.loadout!} pose={poseOf(u)} facing={facingOf(u)} tweenMs={d.moving ? 90 : 170} />
                </g>
              ) : (
                <g transform="scale(0.9)"><Machine type={u.enemyType!} facing={facingOf(u)} dead={d.dead} jammed={u.jammed > 0} /></g>
              )}
              {!d.dead && !d.evac && (
                <g transform={`translate(0 ${u.side === "squad" ? -60 : -50})`}>
                  {Array.from({ length: Math.min(u.maxHp, 14) }, (_, i) => (
                    <rect key={i} x={-Math.min(u.maxHp, 14) * 2.2 + i * 4.4} y={0} width={3.6} height={4} fill={i < d.hp ? (u.side === "squad" ? "#4f6b2a" : "#b8261c") : "#00000030"} />
                  ))}
                  {u.overwatch && <g transform="translate(0 -9)"><path d="M-7 0 Q0 -6 7 0 Q0 6 -7 0 Z" fill="#f2e6c4" stroke="#23201a" strokeWidth={1.2} /><circle r={2.2} fill="#23201a" /></g>}
                  {u.side === "squad" && u.kind === "human" && u.fearState !== "steady" && !d.downed && (
                    <g transform={`translate(${Math.min(u.maxHp, 14) * 2.2 + 7} 2)`}><circle r={5.5} fill={u.fearState === "terrified" ? "#a3271f" : "#d09a2c"} /><text y={3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">!</text></g>
                  )}
                  {d.downed && !d.dead && <text y={-4} textAnchor="middle" className="bleed">{u.stabilized ? "STABLE" : `BLEEDING ${u.bleed}`}</text>}
                </g>
              )}
              {target && <g className="crosshair" transform="translate(0 -24)"><circle r={15} fill="none" stroke="#a3271f" strokeWidth={1.8} strokeDasharray="6 4" /><path d="M-20 0 h8 M12 0 h8 M0 -20 v8 M0 12 v8" stroke="#a3271f" strokeWidth={1.8} /></g>}
            </g>
          );
        })}
      </g>,
    );
  }

  const blastCenter = grenade && hover ? hover : null;
  return (
    <svg className="board-svg" viewBox={`0 0 ${W} ${Hh}`} onMouseLeave={() => onHover(null)}>
      <defs>
        <pattern id="grid" width={T} height={T} patternUnits="userSpaceOnUse" y={PAD}>
          <path d={`M${T} 0 L0 0 0 ${T}`} fill="none" stroke="#5b7a96" strokeWidth={0.6} opacity={0.45} />
        </pattern>
        <pattern id="roofhatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={6} stroke="#ffffff" strokeWidth={1} opacity={0.08} />
        </pattern>
        <pattern id="evac" width={12} height={12} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <rect width={6} height={12} fill="#4f6b2a" opacity={0.35} />
        </pattern>
      </defs>
      <rect width={W} height={Hh} fill="#e2d8bd" />
      {Array.from({ length: 4 }, (_, i) => <ellipse key={i} cx={hashXY(i, 7) * W} cy={hashXY(3, i) * Hh} rx={30 + hashXY(i, i) * 40} ry={18 + hashXY(i, 2) * 26} fill="none" stroke="#8a6d3b" strokeWidth={2} opacity={0.08} />)}
      <rect y={PAD} width={W} height={c.h * T} fill="url(#grid)" />
      {c.evac.map((p) => <rect key={`e${p.x},${p.y}`} x={p.x * T + 2} y={p.y * T + PAD + 2} width={T - 4} height={T - 4} fill="url(#evac)" stroke="#4f6b2a" strokeWidth={1.5} strokeDasharray="5 3" />)}
      {c.evac[0] && <text x={c.evac[0].x * T + 4} y={c.evac[0].y * T + PAD + 14} className="map-label">EVAC</text>}
      {!busy && [...moveMap.entries()].map(([k, m]) => {
        const [x, y] = k.split(",").map(Number);
        return <rect key={`m${k}`} x={x * T + 1.5} y={y * T + PAD + 1.5} width={T - 3} height={T - 3} className={`move m${m.ap}`} />;
      })}
      {hover && !busy && moveMap.has(`${hover.x},${hover.y}`) && (
        <g>
          <rect x={hover.x * T + 1} y={hover.y * T + PAD + 1} width={T - 2} height={T - 2} fill="none" stroke="#23201a" strokeWidth={2} />
          {riskAt(hover.x, hover.y) && <text x={hover.x * T + T / 2} y={hover.y * T + PAD + T / 2 + 6} textAnchor="middle" className="risk-mark">!</text>}
        </g>
      )}
      {blastCenter && <rect x={(blastCenter.x - 1) * T} y={(blastCenter.y - 1) * T + PAD} width={T * 3} height={T * 3} fill="#a3271f" opacity={0.15} stroke="#a3271f" strokeWidth={2} strokeDasharray="6 4" />}
      {rows}
      {/* effects */}
      {effects.map((e) => {
        if (e.kind === "tracer") {
          const x1 = px(e.x1), y1 = py(e.y1) - 34, x2 = px(e.x2), y2 = py(e.y2) - 26;
          return (
            <g key={e.id}>
              <line className="tracer" x1={x1} y1={y1} x2={x2} y2={y2} stroke={e.enemy ? "#ff4a36" : "#ffd36a"} strokeWidth={2.6} strokeLinecap="round" />
              <circle className="flash" cx={x1} cy={y1} r={7} fill={e.enemy ? "#ff6a4a" : "#ffe08a"} />
              {e.hit && <circle className="impact" cx={x2} cy={y2} r={6} fill="#fff1c8" />}
            </g>
          );
        }
        if (e.kind === "blast") return <g key={e.id} transform={`translate(${px(e.x)} ${py(e.y) - 16})`}><circle className="blast" r={T * 1.3} fill="#ffb347" /><circle className="blast b2" r={T * 0.8} fill="#fff1c8" /></g>;
        if (e.kind === "float") return <g key={e.id} transform={`translate(${px(e.x)} ${py(e.y) - 70})`}><text className={`floater ${e.tone}`} textAnchor="middle">{e.text}</text></g>;
        const d = disp[e.unitId];
        if (!d) return null;
        const w = Math.min(220, 18 + e.text.length * 6.4);
        const bx = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, px(d.x)));
        const by = py(d.y) - 78;
        return (
          <g key={e.id} className="bubble" transform={`translate(${bx} ${Math.max(14, by)})`}>
            <rect x={-w / 2} y={-14} width={w} height={22} rx={3} fill="#f6f0df" stroke="#23201a" strokeWidth={1.3} />
            <path d={`M${px(d.x) - bx - 4} 8 l4 8 l4 -8`} fill="#f6f0df" stroke="#23201a" strokeWidth={1.3} />
            <rect x={px(d.x) - bx - 4.5} y={6} width={9} height={3} fill="#f6f0df" />
            <text y={1} textAnchor="middle" className="bubble-text">{e.text}</text>
          </g>
        );
      })}
      {/* hit areas */}
      <g>
        {Array.from({ length: c.h }, (_, y) => Array.from({ length: c.w }, (_, x) => (
          <rect key={`h${x},${y}`} x={x * T} y={y * T + PAD} width={T} height={T} fill="transparent" onClick={() => onTile(x, y)} onMouseEnter={() => onHover({ x, y })} />
        )))}
      </g>
    </svg>
  );
}

