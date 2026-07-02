import React, { useState } from "react";
import type { ClientSave } from "../lib/api";

/** The social web. Player at center, cast around a ring. Edges colored by warmth
 *  (green warm ↔ red hostile), thickness by strength. Tap a node to focus its ties. */
export function RelationshipWeb({ save }: { save: ClientSave }) {
  const [focus, setFocus] = useState<string | null>(null);
  const ids = Object.keys(save.characters).filter((id) => { const st = save.characters[id]?.status; return st !== "dead" && st !== "departed"; });
  if (ids.length < 2) return null;

  const others = ids.filter((id) => id !== "char_player");
  const W = 320, H = 320, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 40;

  // positions: player center, others on a ring
  const pos: Record<string, { x: number; y: number }> = { char_player: { x: cx, y: cy } };
  others.forEach((id, i) => {
    const a = (i / others.length) * Math.PI * 2 - Math.PI / 2;
    pos[id] = { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
  });

  const warmthColor = (w: number) =>
    w >= 25 ? "var(--calm)" : w <= -25 ? "var(--danger)" : w < 0 ? "#a8743f" : "var(--text-lo)";

  const edges = save.world.edges.filter((e) => pos[e.from] && pos[e.to]);
  const shown = focus ? edges.filter((e) => e.from === focus || e.to === focus) : edges;

  const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {shown.map((e, i) => {
          const a = pos[e.from], b = pos[e.to];
          const strong = (Math.abs(e.warmth) + Math.abs(e.trust)) / 200;
          return (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={warmthColor(e.warmth)} strokeWidth={0.6 + strong * 2.4}
              opacity={focus ? 0.85 : 0.4} strokeLinecap="round" />
          );
        })}
        {ids.map((id) => {
          const p = pos[id];
          const isPlayer = id === "char_player";
          const ch = save.characters[id];
          const dim = focus && focus !== id && !edges.some((e) => (e.from === focus && e.to === id) || (e.to === focus && e.from === id));
          return (
            <g key={id} onClick={() => setFocus(focus === id ? null : id)} style={{ cursor: "pointer" }} opacity={dim ? 0.3 : 1}>
              {ch.portrait_url
                ? <image href={ch.portrait_url} x={p.x - (isPlayer ? 20 : 16)} y={p.y - (isPlayer ? 20 : 16)} width={isPlayer ? 40 : 32} height={isPlayer ? 40 : 32}
                    clipPath={`circle(${isPlayer ? 20 : 16}px at ${isPlayer ? 20 : 16}px ${isPlayer ? 20 : 16}px)`}
                    style={{ clipPath: "circle(50%)" } as React.CSSProperties} preserveAspectRatio="xMidYMid slice" />
                : <circle cx={p.x} cy={p.y} r={isPlayer ? 20 : 16} fill={isPlayer ? "var(--accent-soft)" : "var(--ink-2)"} />}
              <circle cx={p.x} cy={p.y} r={isPlayer ? 20 : 16} fill="none"
                stroke={isPlayer ? "var(--accent)" : focus === id ? "var(--text-hi)" : "var(--line-strong)"} strokeWidth={isPlayer ? 2 : 1.2} />
              {!ch.portrait_url && (
                <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={isPlayer ? 11 : 9} fontFamily="var(--font-mono)" fill="var(--text-mid)">{initials(ch.name)}</text>
              )}
              <text x={p.x} y={p.y + (isPlayer ? 32 : 27)} textAnchor="middle" fontSize={9} fill="var(--text-lo)">
                {ch.name.split(/\s+/)[0]}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center justify-center gap-3 mt-1 font-mono text-[9px]" style={{ color: "var(--text-lo)" }}>
        <span style={{ color: "var(--calm)" }}>● warm</span>
        <span style={{ color: "#a8743f" }}>● cool</span>
        <span style={{ color: "var(--danger)" }}>● hostile</span>
        <span>· tap a face to isolate</span>
      </div>
      {focus && (() => {
        const ch = save.characters[focus];
        const ties = edges.filter((e) => e.from === focus);
        return (
          <div className="mt-2 text-[12px]" style={{ color: "var(--text-mid)" }}>
            <span style={{ color: "var(--text-hi)" }}>{ch.name}</span> feels:
            {ties.length ? ties.map((e, i) => (
              <span key={i}> {save.characters[e.to]?.name?.split(/\s+/)[0]}{e.roles?.length ? ` (${e.roles.join(", ")})` : ""} <span className="font-mono text-[10px]" style={{ color: e.warmth >= 0 ? "var(--calm)" : "var(--danger)" }}>({e.warmth > 0 ? "+" : ""}{e.warmth})</span>{i < ties.length - 1 ? "," : ""}</span>
            )) : <span style={{ color: "var(--text-lo)" }}> no recorded ties yet</span>}
          </div>
        );
      })()}
    </div>
  );
}
