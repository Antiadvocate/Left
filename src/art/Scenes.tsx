// Night vignettes: the location, a lamp, and the people the event is about, placed in it.

import type { Location, Soldier } from "../game/types";
import { Figure } from "./Figure";
import type { PoseName } from "./skeleton";

const W = 640, H = 220, FLOOR = 196;

type Slot = { x: number; y?: number; pose: PoseName; facing: 1 | -1; scale?: number };
const SLOTS: Record<Location, Slot[]> = {
  bunks: [{ x: 250, y: 174, pose: "sit", facing: 1 }, { x: 390, pose: "stand", facing: -1 }, { x: 470, pose: "stand", facing: -1 }],
  mess: [{ x: 230, y: 178, pose: "sit", facing: 1 }, { x: 410, y: 178, pose: "sit", facing: -1 }, { x: 480, pose: "stand", facing: -1 }],
  medbay: [{ x: 200, y: 150, pose: "down", facing: 1 }, { x: 430, y: 150, pose: "down", facing: -1 }, { x: 320, pose: "stand", facing: 1 }],
  maintenance: [{ x: 300, pose: "stand", facing: -1 }, { x: 390, pose: "sit", facing: -1, y: 178 }, { x: 470, pose: "stand", facing: -1 }],
  memorial: [{ x: 300, pose: "stand", facing: 1 }, { x: 360, pose: "stand", facing: 1 }, { x: 420, pose: "stand", facing: 1 }],
  range: [{ x: 230, pose: "aim", facing: 1 }, { x: 170, pose: "stand", facing: 1 }, { x: 120, pose: "stand", facing: 1 }],
};

function Backdrop({ loc }: { loc: Location }) {
  switch (loc) {
    case "bunks":
      return (
        <g>
          <rect x={470} y={34} width={56} height={44} fill="#1c2a3e" stroke="#0a0d12" strokeWidth={4} />
          <rect x={470} y={34} width={56} height={44} fill="url(#moon)" />
          {[120, 520].map((x) => (
            <g key={x} fill="#1a1d22" stroke="#0b0d10" strokeWidth={2}>
              <rect x={x - 70} y={110} width={140} height={10} />
              <rect x={x - 70} y={160} width={140} height={10} />
              <rect x={x - 70} y={100} width={6} height={96} /><rect x={x + 64} y={100} width={6} height={96} />
              <rect x={x - 60} y={102} width={50} height={9} rx={4} fill="#3a3a36" />
            </g>
          ))}
          <rect x={210} y={152} width={100} height={8} fill="#2a2620" />
        </g>
      );
    case "mess":
      return (
        <g>
          <line x1={320} y1={0} x2={320} y2={46} stroke="#0b0d10" strokeWidth={2} />
          <g className="swing"><path d="M300 46 L340 46 L332 58 L308 58 Z" fill="#2a2620" /></g>
          <rect x={160} y={150} width={330} height={10} fill="#3b3226" />
          <rect x={180} y={160} width={8} height={36} fill="#2a241c" /><rect x={462} y={160} width={8} height={36} fill="#2a241c" />
          <rect x={300} y={140} width={9} height={10} rx={2} fill="#cfc6b0" /><rect x={340} y={140} width={9} height={10} rx={2} fill="#cfc6b0" />
          <path d="M302 136 q2 -6 0 -12" stroke="#ffffff30" strokeWidth={1.5} fill="none" className="steam" />
        </g>
      );
    case "medbay":
      return (
        <g>
          {[200, 430].map((x) => <g key={x}><rect x={x - 60} y={150} width={120} height={14} fill="#c9cfd0" opacity={0.35} /><rect x={x - 60} y={164} width={6} height={32} fill="#22262a" /><rect x={x + 54} y={164} width={6} height={32} fill="#22262a" /></g>)}
          <rect x={300} y={60} width={44} height={30} rx={3} fill="#0d1a17" stroke="#22262a" strokeWidth={3} />
          <path className="pulse" d="M304 78 L314 78 L318 68 L323 88 L327 76 L340 76" stroke="#5fe0a0" strokeWidth={1.6} fill="none" />
          <path d="M100 30 Q110 120 100 196 M540 30 Q530 120 540 196" stroke="#2a3a40" strokeWidth={14} fill="none" opacity={0.6} />
        </g>
      );
    case "maintenance":
      return (
        <g>
          <rect x={240} y={20} width={120} height={8} fill="#22262a" />
          <line x1={260} y1={28} x2={260} y2={196} stroke="#22262a" strokeWidth={6} /><line x1={340} y1={28} x2={340} y2={196} stroke="#22262a" strokeWidth={6} />
          <path d="M300 28 L300 70" stroke="#3a3f42" strokeWidth={2} />
          <g className="sparks">{[0, 1, 2].map((i) => <circle key={i} cx={318 + i * 3} cy={96 + i * 4} r={1.2} fill="#ffd27a" />)}</g>
        </g>
      );
    case "memorial":
      return (
        <g>
          <rect x={120} y={30} width={400} height={130} fill="#26241f" stroke="#0b0d10" strokeWidth={3} />
          {Array.from({ length: 24 }, (_, i) => <rect key={i} x={140 + (i % 8) * 47} y={44 + Math.floor(i / 8) * 36} width={38} height={8} fill="#8d8160" opacity={0.6} />)}
          {[180, 460].map((x) => <g key={x}><rect x={x - 3} y={166} width={6} height={14} fill="#d8cfb5" /><ellipse className="flame" cx={x} cy={162} rx={2.6} ry={5} fill="#ffcf6a" /></g>)}
        </g>
      );
    case "range":
      return (
        <g>
          {[430, 520, 600].map((x, i) => <g key={x}><rect x={x - 2} y={110 + i * 8} width={4} height={86 - i * 8} fill="#2a2620" /><circle cx={x} cy={104 + i * 8} r={14 - i * 2} fill="#d8cfb5" /><circle cx={x} cy={104 + i * 8} r={8 - i} fill="none" stroke="#a3271f" strokeWidth={2} /><circle cx={x} cy={104 + i * 8} r={2} fill="#a3271f" /></g>)}
          <line x1={260} y1={196} x2={640} y2={170} stroke="#ffffff10" strokeWidth={2} />
        </g>
      );
  }
}

const LAMP: Record<Location, { x: number; y: number }> = {
  bunks: { x: 280, y: 120 }, mess: { x: 320, y: 70 }, medbay: { x: 322, y: 80 }, maintenance: { x: 300, y: 90 }, memorial: { x: 320, y: 160 }, range: { x: 300, y: 60 },
};

export function NightScene({ loc, people, id }: { loc: Location; people: Soldier[]; id: string }) {
  const lamp = LAMP[loc];
  const g = `ns${id.replace(/\W/g, "")}`;
  return (
    <svg className="night-scene" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${loc}, night`}>
      <defs>
        <radialGradient id={`${g}lamp`} cx={lamp.x / W} cy={lamp.y / H} r="0.55">
          <stop offset="0" stopColor="#f3c37a" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#c58a45" stopOpacity="0.12" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${g}dark`} cx={lamp.x / W} cy={lamp.y / H} r="0.7">
          <stop offset="0.25" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#05070b" stopOpacity="0.85" />
        </radialGradient>
        <linearGradient id="moon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9fb4d8" stopOpacity="0.35" /><stop offset="1" stopColor="#9fb4d8" stopOpacity="0" /></linearGradient>
      </defs>
      <rect width={W} height={H} fill="#11161f" />
      <rect y={FLOOR} width={W} height={H - FLOOR} fill="#0b0e14" />
      <Backdrop loc={loc} />
      {people.slice(0, 3).map((p, i) => {
        const slot = SLOTS[loc][i];
        return (
          <g key={p.id} transform={`translate(${slot.x} ${slot.y ?? FLOOR}) scale(${slot.scale ?? 1.55})`}>
            <ellipse cx={0} cy={0} rx={14} ry={2.5} fill="#000" opacity={0.4} />
            <Figure seed={p.id} kind={p.kind} cls={p.class} loadout="light" pose={slot.pose} facing={slot.facing} armed={loc === "range"} />
          </g>
        );
      })}
      <rect width={W} height={H} fill={`url(#${g}dark)`} />
      <rect width={W} height={H} fill={`url(#${g}lamp)`} className="lamp" style={{ mixBlendMode: "screen" }} />
      <g className="motes">{[0, 1, 2, 3, 4].map((i) => <circle key={i} cx={lamp.x - 60 + i * 30} cy={lamp.y + 20 + (i % 3) * 14} r={0.9} fill="#f3d9a8" opacity={0.5} style={{ animationDelay: `${i * 1.3}s` }} />)}</g>
    </svg>
  );
}
