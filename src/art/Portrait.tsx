// Front-facing ID-photo bust, grown from the same genome as the standee.
// Expression comes from state the player is allowed to see: fear in the field, grief, death.

import { useMemo } from "react";
import type { ClassId, SoldierKind } from "../game/types";
import { grow, HUMAN_SPEC, SYNTH_SPEC, type HumanGenome, type SynthGenome } from "./genome";

export type Expression = "calm" | "tense" | "afraid" | "grief" | "dead";

const INSIGNIA: Record<ClassId, string> = { heavy: "HVY", assault: "AST", scout: "SCT", sniper: "SNP", support: "MED", ew: "EW" };

export interface PortraitProps {
  seed: string;
  kind: SoldierKind;
  cls: ClassId;
  expression?: Expression;
  size?: number;
  framed?: boolean;
  label?: string;
}

export function Portrait({ seed, kind, cls, expression = "calm", size = 64, framed = true, label }: PortraitProps) {
  const id = `p${seed.replace(/\W/g, "")}`;
  return (
    <svg className={`portrait ${expression}`} width={size} height={size * 1.2} viewBox="0 0 100 120" role="img" aria-label={label}>
      {framed && (
        <>
          <defs>
            <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={kind === "ai" ? "#c9cfcb" : "#d6ccb2"} />
              <stop offset="1" stopColor={kind === "ai" ? "#9aa6a3" : "#b3a57f"} />
            </linearGradient>
          </defs>
          <rect x={0} y={0} width={100} height={120} fill={`url(#${id}bg)`} />
        </>
      )}
      {kind === "human" ? <HumanBust seed={seed} cls={cls} ex={expression} /> : <SynthBust seed={seed} cls={cls} ex={expression} />}
      {framed && <rect x={0.75} y={0.75} width={98.5} height={118.5} fill="none" stroke="#23201a" strokeWidth={1.5} />}
    </svg>
  );
}

function HumanBust({ seed, cls, ex }: { seed: string; cls: ClassId; ex: Expression }) {
  const g = useMemo(() => grow<HumanGenome>(seed, HUMAN_SPEC), [seed]);
  const cx = 50, cy = 54;
  const w = 23 * g.headW, h = 28 * g.headH;
  const hair = g.hair;
  const jaw =
    g.jaw === "square" ? `M${cx - w} ${cy} L${cx - w + 2} ${cy + h * 0.72} Q${cx} ${cy + h + 3} ${cx + w - 2} ${cy + h * 0.72} L${cx + w} ${cy} Z`
    : g.jaw === "narrow" ? `M${cx - w} ${cy} Q${cx - w + 4} ${cy + h * 0.8} ${cx} ${cy + h + 2} Q${cx + w - 4} ${cy + h * 0.8} ${cx + w} ${cy} Z`
    : `M${cx - w} ${cy} Q${cx - w} ${cy + h} ${cx} ${cy + h} Q${cx + w} ${cy + h} ${cx + w} ${cy} Z`;
  const gap = 9.5 * g.eyeGap;
  const eyeY = cy + 1;
  const open = ex === "afraid" ? 1.25 : ex === "tense" ? 0.6 : ex === "grief" ? 0.55 : ex === "dead" ? 0.08 : 0.9;
  // brows: inner end offset (negative = raised)
  const inner = ex === "afraid" ? -5 : ex === "grief" ? -4 : ex === "tense" ? 3 : 0;
  const outer = ex === "afraid" ? -2 : ex === "grief" ? 1.5 : ex === "tense" ? -1 : 0;
  const by = eyeY - 8;
  const mw = 8 * g.mouth, my = cy + h * 0.55;
  const mouth =
    ex === "afraid" ? <ellipse cx={cx} cy={my + 1} rx={mw * 0.45} ry={3.2} fill="#4a2a24" />
    : ex === "grief" ? <path d={`M${cx - mw} ${my + 2} Q${cx} ${my - 2.5} ${cx + mw} ${my + 2}`} stroke="#5a3328" strokeWidth={1.8} fill="none" strokeLinecap="round" />
    : ex === "tense" ? <path d={`M${cx - mw} ${my} L${cx + mw} ${my}`} stroke="#5a3328" strokeWidth={2} strokeLinecap="round" />
    : <path d={`M${cx - mw} ${my} Q${cx} ${my + 1.6} ${cx + mw} ${my - 0.4}`} stroke="#5a3328" strokeWidth={1.7} fill="none" strokeLinecap="round" />;
  const nose =
    g.nose === "broad" ? <path d={`M${cx - 1} ${eyeY + 2} L${cx - 3} ${my - 8} Q${cx} ${my - 5} ${cx + 4} ${my - 8}`} stroke="#00000033" strokeWidth={1.6} fill="none" />
    : g.nose === "long" ? <path d={`M${cx} ${eyeY} L${cx - 2} ${my - 7} L${cx + 2} ${my - 7}`} stroke="#00000033" strokeWidth={1.5} fill="none" />
    : <path d={`M${cx - 2} ${my - 9} Q${cx} ${my - 7} ${cx + 2} ${my - 9}`} stroke="#00000033" strokeWidth={1.5} fill="none" />;
  const collar = "#4b5130";
  const hairTop = (() => {
    const top = cy - h * 0.62;
    switch (g.style) {
      case "bald": return null;
      case "buzz": return <path d={`M${cx - w} ${cy - 2} Q${cx - w} ${top - 8} ${cx} ${top - 8} Q${cx + w} ${top - 8} ${cx + w} ${cy - 2} Q${cx + w - 3} ${top} ${cx} ${top} Q${cx - w + 3} ${top} ${cx - w} ${cy - 2} Z`} fill={hair} opacity={0.75} />;
      case "curls": return <g fill={hair}>{[-1, -0.6, -0.2, 0.2, 0.6, 1].map((k, i) => <circle key={i} cx={cx + k * w * 0.95} cy={top - 4 + Math.abs(k) * 7} r={8} />)}</g>;
      case "sidepart": return <path d={`M${cx - w - 1} ${cy + 2} Q${cx - w - 2} ${top - 10} ${cx + 4} ${top - 9} Q${cx + w + 3} ${top - 6} ${cx + w + 1} ${cy - 2} Q${cx + w - 6} ${top + 2} ${cx - 6} ${top + 1} Q${cx - w + 2} ${top + 6} ${cx - w + 1} ${cy + 2} Z`} fill={hair} />;
      default: return <path d={`M${cx - w - 1} ${cy} Q${cx - w - 1} ${top - 10} ${cx} ${top - 10} Q${cx + w + 1} ${top - 10} ${cx + w + 1} ${cy} Q${cx + w - 2} ${top + 1} ${cx} ${top + 1} Q${cx - w + 2} ${top + 1} ${cx - w - 1} ${cy} Z`} fill={hair} />;
    }
  })();
  return (
    <g>
      {(g.style === "tied" || g.style === "braids") && <path d={`M${cx - w + 2} ${cy + 4} Q${cx - w - 8} ${cy + 30} ${cx - w + 2} ${cy + 52} M${cx + w - 2} ${cy + 4} Q${cx + w + 8} ${cy + 30} ${cx + w - 2} ${cy + 52}`} stroke={hair} strokeWidth={g.style === "braids" ? 5 : 7} fill="none" strokeLinecap="round" />}
      {/* shoulders and uniform */}
      <path d={`M6 120 Q10 94 34 90 L66 90 Q90 94 94 120 Z`} fill={collar} />
      <path d={`M38 90 L50 104 L62 90 Z`} fill={g.skin} />
      <path d={`M38 90 L50 104 L44 92 Z M62 90 L50 104 L56 92 Z`} fill="#3b402a" />
      <rect x={72} y={100} width={14} height={9} rx={1} fill="#2f3322" />
      <text x={79} y={107} fontSize={6} textAnchor="middle" fill="#d8cfa8" fontFamily="Barlow Condensed, sans-serif" fontWeight={700}>{INSIGNIA[cls]}</text>
      <rect x={cx - 7} y={cy + h * 0.6} width={14} height={14} fill={g.skin} />
      <rect x={cx - 7} y={cy + h * 0.6} width={14} height={14} fill="#000" opacity={0.12} />
      {/* head */}
      {g.style === "bun" && <circle cx={cx} cy={cy - h * 0.95} r={9} fill={hair} />}
      <ellipse cx={cx - w} cy={eyeY + 3} rx={3.6} ry={6} fill={g.skin} />
      <ellipse cx={cx + w} cy={eyeY + 3} rx={3.6} ry={6} fill={g.skin} />
      <ellipse cx={cx} cy={cy} rx={w} ry={h * 0.7} fill={g.skin} />
      <path d={jaw} fill={g.skin} />
      {g.facialHair === "stubble" && <path d={jaw} fill={hair} opacity={0.18} transform={`translate(0 2)`} />}
      {g.facialHair === "beard" && <path d={`M${cx - w + 1} ${cy + 4} Q${cx - w + 3} ${cy + h + 6} ${cx} ${cy + h + 6} Q${cx + w - 3} ${cy + h + 6} ${cx + w - 1} ${cy + 4} Q${cx + w - 6} ${my + 8} ${cx} ${my + 6} Q${cx - w + 6} ${my + 8} ${cx - w + 1} ${cy + 4} Z`} fill={hair} />}
      {g.freckles && <g fill="#8a5636" opacity={0.45}>{[-1, -0.6, 0.6, 1].map((k, i) => <circle key={i} cx={cx + k * gap * 0.9} cy={eyeY + 9 + (i % 2)} r={0.9} />)}</g>}
      {/* eyes */}
      {[-1, 1].map((side) => (
        <g key={side}>
          <ellipse cx={cx + side * gap} cy={eyeY} rx={4.4} ry={3.2 * open + 0.3} fill={ex === "dead" ? "#00000040" : "#f4efe4"} />
          {ex !== "dead" && <circle cx={cx + side * gap} cy={eyeY} r={ex === "afraid" ? 1.6 : 2.2} fill={g.iris} />}
          {ex !== "dead" && <rect className="lid" x={cx + side * gap - 5} y={eyeY - 4.5} width={10} height={9} fill={g.skin} />}
          <line x1={cx + side * (gap - 5)} y1={by + inner} x2={cx + side * (gap + 5)} y2={by + outer} stroke={hair} strokeWidth={g.brow} strokeLinecap="round" />
        </g>
      ))}
      {nose}
      {g.facialHair === "mustache" && <path d={`M${cx - mw - 1} ${my - 2} Q${cx} ${my - 7} ${cx + mw + 1} ${my - 2} Q${cx} ${my - 3} ${cx - mw - 1} ${my - 2} Z`} fill={hair} />}
      {mouth}
      {g.scar && <path d={`M${cx + gap - 2} ${by - 4} L${cx + gap + 4} ${eyeY + 8}`} stroke="#9b5a4a" strokeWidth={1.3} opacity={0.75} />}
      {ex === "afraid" && <path className="sweat" d={`M${cx + w - 4} ${by - 2} q2 4 0 6 q-2 -2 0 -6 Z`} fill="#bfe0f0" />}
      {hairTop}
    </g>
  );
}

function SynthBust({ seed, cls, ex }: { seed: string; cls: ClassId; ex: Expression }) {
  const g = useMemo(() => grow<SynthGenome>(seed, SYNTH_SPEC), [seed]);
  const cx = 50, cy = 52, w = 24, h = 29;
  const light = ex === "dead" ? "#333" : ex === "grief" ? `${g.light}88` : g.light;
  const head =
    g.head === "capsule" ? <rect x={cx - w} y={cy - h} width={w * 2} height={h * 2} rx={w * 0.9} fill={g.plate} stroke={g.trim} strokeWidth={2} />
    : g.head === "angular" ? <path d={`M${cx - w} ${cy - h + 8} L${cx - w + 10} ${cy - h} L${cx + w - 10} ${cy - h} L${cx + w} ${cy - h + 8} L${cx + w - 3} ${cy + h - 8} L${cx} ${cy + h} L${cx - w + 3} ${cy + h - 8} Z`} fill={g.plate} stroke={g.trim} strokeWidth={2} />
    : <path d={`M${cx - w} ${cy + h} L${cx - w} ${cy - 4} A${w} ${h - 2} 0 0 1 ${cx + w} ${cy - 4} L${cx + w} ${cy + h} Z`} fill={g.plate} stroke={g.trim} strokeWidth={2} />;
  const vy = cy - 4;
  const narrow = ex === "tense" ? 0.55 : 1;
  const visor =
    g.visor === "band" ? <rect x={cx - w + 5} y={vy - 4 * narrow} width={(w - 5) * 2} height={8 * narrow} rx={3} fill={light} className="visor-glow" />
    : g.visor === "twin" ? <g fill={light} className="visor-glow"><circle cx={cx - 9} cy={vy} r={5 * narrow + 0.5} /><circle cx={cx + 9} cy={vy} r={5 * narrow + 0.5} /></g>
    : g.visor === "mono" ? <circle cx={cx} cy={vy} r={8 * narrow + 1} fill={light} className="visor-glow" />
    : <g fill={light} className="visor-glow">{Array.from({ length: 15 }, (_, i) => <rect key={i} x={cx - 15 + (i % 5) * 6.5} y={vy - 6 + Math.floor(i / 5) * 5 * narrow} width={4} height={3 * narrow} rx={0.6} />)}</g>;
  return (
    <g>
      <path d={`M6 120 Q10 92 32 88 L68 88 Q90 92 94 120 Z`} fill={g.plate} stroke={g.trim} strokeWidth={2} />
      <path d="M30 100 L70 100" stroke={g.trim} strokeWidth={1.2} />
      {Array.from({ length: g.marks }, (_, i) => <rect key={i} x={14 + i * 5} y={104} width={3} height={8} fill={g.trim} />)}
      <text x={78} y={110} fontSize={7} textAnchor="middle" fill={g.trim} fontFamily="Barlow Condensed, sans-serif" fontWeight={700}>{INSIGNIA[cls]}</text>
      <rect x={cx - 8} y={cy + h - 6} width={16} height={18} fill={g.trim} />
      {[0, 1, 2].map((i) => <line key={i} x1={cx - 8} y1={cy + h + i * 5} x2={cx + 8} y2={cy + h + i * 5} stroke={g.plate} strokeWidth={1} />)}
      {g.antenna && <><line x1={cx + w - 6} y1={cy - h + 4} x2={cx + w + 2} y2={cy - h - 12} stroke={g.trim} strokeWidth={2} /><circle cx={cx + w + 2} cy={cy - h - 12} r={2.2} fill={light} className="blink" /></>}
      {head}
      <path d={`M${cx - w + 4} ${cy + 10} L${cx + w - 4} ${cy + 10}`} stroke={g.trim} strokeWidth={1} opacity={0.6} />
      <rect x={cx - w + 6} y={vy - 9} width={(w - 6) * 2} height={18} rx={4} fill="#121416" />
      {visor}
      {ex !== "dead" && g.visor === "band" && <rect className="scan" x={cx - w + 6} y={vy - 4} width={5} height={8} fill="#ffffff" opacity={0.55} />}
      {[-1, 1].map((s) => <g key={s}>{[0, 1, 2].map((i) => <line key={i} x1={cx + s * (w - 6)} y1={cy + 14 + i * 3} x2={cx + s * (w - 12)} y2={cy + 14 + i * 3} stroke={g.trim} strokeWidth={1.2} />)}</g>)}
    </g>
  );
}
