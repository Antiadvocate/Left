// The Accord: non-humanoid kill machines. Drawn precise and matte, lit from inside in red.

import type { EnemyTypeId } from "../game/content";

const BODY = "#1c1c1f", PLATE = "#2c2c31", EDGE = "#4a4a52", GLOW = "#ff3d2e";

export function Machine({ type, facing = 1, dead = false, jammed = false }: { type: EnemyTypeId; facing?: 1 | -1; dead?: boolean; jammed?: boolean }) {
  const glow = dead ? "#3a3a3a" : jammed ? "#7aa0ff" : GLOW;
  const cls = `machine ${type} ${dead ? "wreck" : ""} ${jammed ? "jammed" : ""}`;
  return (
    <g className={cls} transform={facing === -1 ? "scale(-1 1)" : undefined}>
      {type === "drone" && (
        <g className={dead ? "" : "hover"}>
          <g transform={dead ? "translate(0 30) rotate(25)" : undefined}>
            <line x1={-14} y1={-44} x2={14} y2={-44} stroke={EDGE} strokeWidth={1.5} />
            <ellipse className={dead ? "" : "rotor"} cx={-13} cy={-46} rx={8} ry={1.6} fill={EDGE} opacity={0.8} />
            <ellipse className={dead ? "" : "rotor r2"} cx={13} cy={-46} rx={8} ry={1.6} fill={EDGE} opacity={0.8} />
            <path d="M-11 -38 L0 -45 L11 -38 L6 -29 L-6 -29 Z" fill={BODY} stroke={EDGE} strokeWidth={1} />
            <circle cx={5} cy={-36} r={2.6} fill={glow} className={dead ? "" : "eye"} />
            <line x1={0} y1={-29} x2={0} y2={-25} stroke={EDGE} strokeWidth={1.2} />
          </g>
        </g>
      )}
      {type === "stalker" && (
        <g transform={dead ? "translate(0 8) rotate(-12)" : undefined} className={dead ? "" : "sway"}>
          <path d="M-4 -30 L-16 -14 L-12 0" stroke={PLATE} strokeWidth={2.4} fill="none" strokeLinejoin="round" />
          <path d="M4 -30 L16 -16 L13 0" stroke={PLATE} strokeWidth={2.4} fill="none" strokeLinejoin="round" />
          <path d="M0 -30 L3 -14 L-2 0" stroke={EDGE} strokeWidth={2} fill="none" strokeLinejoin="round" />
          <ellipse cx={0} cy={-35} rx={11} ry={7} fill={BODY} stroke={EDGE} strokeWidth={1} />
          <rect x={6} y={-44} width={9} height={7} rx={2} fill={PLATE} />
          <rect x={10} y={-42} width={5} height={1.8} fill={glow} className={dead ? "" : "eye"} />
          <rect x={8} y={-34} width={14} height={2.6} fill={EDGE} />
        </g>
      )}
      {type === "hound" && (
        <g transform={dead ? "translate(0 6) rotate(8)" : undefined}>
          <path d="M-14 -16 L-17 -6 L-15 0 M-8 -16 L-10 -6 L-7 0 M8 -16 L10 -6 L8 0 M14 -16 L17 -7 L16 0" stroke={PLATE} strokeWidth={2.4} fill="none" strokeLinecap="round" />
          <path d="M-18 -22 Q0 -28 16 -21 L14 -14 L-17 -14 Z" fill={BODY} stroke={EDGE} strokeWidth={1} />
          <g className={dead ? "" : "snout"}>
            <path d="M14 -24 L25 -21 L24 -16 L13 -16 Z" fill={PLATE} stroke={EDGE} strokeWidth={0.8} />
            <path d="M24 -18 L31 -14 L23 -15 Z" fill="#9a9aa2" />
            <circle cx={21} cy={-21} r={1.5} fill={glow} className={dead ? "" : "eye"} />
          </g>
        </g>
      )}
      {type === "warden" && (
        <g transform={dead ? "translate(0 4) rotate(-6)" : undefined}>
          <rect x={-20} y={-8} width={40} height={8} rx={4} fill={BODY} stroke={EDGE} strokeWidth={1} />
          {[-14, -6, 2, 10].map((x) => <circle key={x} cx={x + 2} cy={-4} r={2.4} fill={PLATE} className={dead ? "" : "tread"} />)}
          <path d="M-16 -9 L-12 -46 L12 -50 L17 -9 Z" fill={BODY} stroke={EDGE} strokeWidth={1.2} />
          <path d="M-9 -40 L10 -43" stroke={EDGE} strokeWidth={1} />
          {[0, 1, 2].map((i) => <circle key={i} cx={-4 + i * 6} cy={-34} r={2} fill={glow} className={dead ? "" : `chase c${i}`} />)}
          <rect x={10} y={-30} width={22} height={6} rx={1.5} fill={PLATE} stroke={EDGE} strokeWidth={0.8} />
          <rect x={28} y={-29} width={6} height={4} fill={EDGE} />
        </g>
      )}
      {dead && <g className="smoke"><circle cx={0} cy={-26} r={5} fill="#555" opacity={0.35} /><circle cx={4} cy={-34} r={4} fill="#666" opacity={0.25} /></g>}
    </g>
  );
}
