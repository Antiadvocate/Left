// Full-body standee, side view. Body shape from the genome, kit from class and loadout,
// pose from the generic skeleton. Poses tween so people move instead of snapping.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClassId, Loadout, SoldierKind } from "../game/types";
import { grow, HUMAN_SPEC, SYNTH_SPEC, type HumanGenome, type SynthGenome } from "./genome";
import { BODY, BODY_ORDER, easeInOut, lerpPose, POSES, solve, type BodyJoint, type Pose, type PoseName, type Pt } from "./skeleton";

export function useTweenPose(target: Pose<BodyJoint>, ms = 160): Pose<BodyJoint> {
  const [pose, setPose] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const from = cur.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const p = lerpPose(from, target, easeInOut(t));
      cur.current = p;
      setPose(p);
      if (t < 1) raf = requestAnimationFrame(tick);
      else cur.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return pose;
}

const line = (a: Pt, b: Pt, w: number, stroke: string, key?: string) => (
  <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={w} strokeLinecap="round" />
);
const along = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, "0")}`;
};

const WEAPON_OF: Record<ClassId, string> = { heavy: "cannon", assault: "shotgun", scout: "smg", sniper: "rifle", support: "carbine", ew: "sidearm" };

function Weapon({ cls, ink }: { cls: ClassId; ink?: string }) {
  const m = ink ?? "#232220", d = ink ?? "#3b3a36", a = ink ?? "#6e6a5e";
  switch (WEAPON_OF[cls]) {
    case "cannon": return <g><rect x={-6} y={-4} width={24} height={7} rx={2} fill={m} /><rect x={-2} y={-7} width={9} height={4} fill={d} /><rect x={6} y={3} width={4} height={5} fill={d} /></g>;
    case "shotgun": return <g><rect x={-4} y={-2.5} width={19} height={4} rx={1} fill={m} /><rect x={4} y={1.5} width={8} height={2.5} fill={a} /></g>;
    case "smg": return <g><rect x={-3} y={-2.5} width={13} height={4.5} rx={1} fill={m} /><rect x={2} y={2} width={2.5} height={6} fill={d} /></g>;
    case "rifle": return <g><rect x={-6} y={-2} width={27} height={3.2} rx={1} fill={m} /><rect x={1} y={-6} width={8} height={3} rx={1.5} fill={d} /><line x1={18} y1={1} x2={16} y2={6} stroke={d} strokeWidth={1} /></g>;
    case "carbine": return <g><rect x={-4} y={-2.5} width={18} height={4} rx={1} fill={m} /><rect x={3} y={1.5} width={3} height={5} fill={d} /></g>;
    default: return <g><rect x={-1} y={-2} width={8} height={3.5} rx={1} fill={m} /><rect x={-1} y={1} width={2.5} height={4} fill={d} /></g>;
  }
}

export interface FigureProps {
  seed: string;
  kind: SoldierKind;
  cls: ClassId;
  loadout: Loadout;
  pose: PoseName | Pose<BodyJoint>;
  facing?: 1 | -1;
  ink?: string;     // silhouette colour, for night scenes
  idle?: boolean;   // breathing (humans) / visor pulse (AI)
  armed?: boolean;
  tweenMs?: number;
}

export function Figure({ seed, kind, cls, loadout, pose, facing = 1, ink, idle = true, armed = true, tweenMs }: FigureProps) {
  const target = typeof pose === "string" ? POSES[pose] : pose;
  const p = useTweenPose(target, tweenMs);
  const human = useMemo(() => (kind === "human" ? grow<HumanGenome>(seed, HUMAN_SPEC) : null), [seed, kind]);
  const synth = useMemo(() => (kind === "ai" ? grow<SynthGenome>(seed, SYNTH_SPEC) : null), [seed, kind]);
  const g = human ?? synth!;
  const s = solve(BODY, BODY_ORDER, p, g.height);
  const b = g.build;
  const heavy = loadout === "heavy";
  const c = (x: string) => ink ?? x;

  // palette
  const cloth = human ? (heavy ? "#4a4f31" : "#6f6c47") : synth!.plate;
  const clothB = shade(cloth, 0.72);
  const trim = human ? "#26231d" : synth!.trim;
  const skin = human ? human.skin : synth!.plate;
  const boot = human ? "#2a251f" : synth!.trim;

  const limbW = (human ? 5.2 : 4.6) * b;
  const legW = (human ? 6 : 5.4) * b;
  const pelvis = s.spine.a;

  const limb = (j1: BodyJoint, j2: BodyJoint, w: number, col: string, end: string) => (
    <g>
      {!human && line(s[j1].a, s[j1].b, w + 1.6, c(trim))}
      {line(s[j1].a, s[j1].b, w, c(col))}
      {!human && line(s[j2].a, s[j2].b, w + 1.4, c(trim))}
      {line(s[j2].a, s[j2].b, w * 0.9, c(col))}
      {!human && <circle cx={s[j1].b.x} cy={s[j1].b.y} r={w * 0.45} fill={c(synth!.light)} opacity={ink ? 0 : 0.8} />}
      <circle cx={s[j2].b.x} cy={s[j2].b.y} r={w * 0.48} fill={c(end)} />
    </g>
  );

  // torso frame: origin at pelvis, -y toward the shoulders, -x toward the back
  const torsoLen = BODY.spine.len * g.height;
  const torsoT = `translate(${pelvis.x} ${pelvis.y}) rotate(${s.spine.angle + 90})`;
  const headC = along(s.head.a, s.head.b, 0.45);
  const headT = `translate(${headC.x} ${headC.y}) rotate(${s.head.angle + 90})`;
  const handT = `translate(${s.foreF.b.x} ${s.foreF.b.y}) rotate(${s.foreF.angle})`;

  const pack = (
    <g transform={torsoT}>
      {cls === "heavy" && <rect x={-13 * b} y={-torsoLen + 2} width={8} height={17} rx={2} fill={c("#3b3d2a")} />}
      {cls === "support" && <g><rect x={-11 * b} y={-torsoLen + 5} width={6} height={11} rx={1.5} fill={c("#d8d2c0")} />{!ink && <path d={`M${-8 * b} ${-torsoLen + 8} v5 M${-10.5 * b} ${-torsoLen + 10.5} h5`} stroke="#a3271f" strokeWidth={1.6} />}</g>}
      {cls === "ew" && <g><rect x={-11 * b} y={-torsoLen + 4} width={6} height={12} rx={1} fill={c("#2f3433")} /><line x1={-9 * b} y1={-torsoLen + 4} x2={-12 * b} y2={-torsoLen - 12} stroke={c("#2f3433")} strokeWidth={1.2} />{!ink && <circle cx={-12 * b} cy={-torsoLen - 12} r={1.4} fill="#e0564a" className="blink" />}</g>}
      {cls === "sniper" && <rect x={-11 * b} y={-torsoLen + 2} width={5} height={14} rx={2.5} fill={c("#5d5638")} />}
      {(cls === "scout" || cls === "assault") && <rect x={-10 * b} y={-torsoLen + 6} width={5} height={9} rx={1.5} fill={c("#4a4632")} />}
    </g>
  );

  const torso = (
    <g transform={torsoT}>
      <path
        d={`M${-5.5 * b} 0 L${-6.5 * b} ${-torsoLen + 3} Q0 ${-torsoLen - 3} ${6.5 * b} ${-torsoLen + 3} L${5.5 * b} 0 Z`}
        fill={c(cloth)}
        stroke={c(trim)}
        strokeWidth={human ? 0.8 : 1.4}
      />
      {human && heavy && <rect x={-1 * b} y={-torsoLen + 5} width={7.5 * b} height={torsoLen * 0.55} rx={2} fill={c("#363a26")} />}
      {human && !heavy && <rect x={0.5 * b} y={-torsoLen + 6} width={5 * b} height={4} rx={1} fill={c(clothB)} />}
      {!human && <><line x1={-4 * b} y1={-torsoLen * 0.45} x2={5.5 * b} y2={-torsoLen * 0.45} stroke={c(synth!.trim)} strokeWidth={1} />{!ink && <rect x={2 * b} y={-torsoLen + 6} width={3} height={2} fill={synth!.light} className="visor-glow" />}</>}
      <rect x={-6 * b} y={-3} width={12 * b} height={3.4} fill={c(trim)} />
    </g>
  );

  let head: React.ReactNode;
  if (human) {
    const hw = 5.6 * human.headW, hh = 6.3 * human.headH;
    const hair = c(human.hair);
    const hat = (() => {
      switch (cls) {
        case "heavy": case "assault": return <path d={`M${-hw - 1} ${-1} Q${-hw} ${-hh - 3} 0 ${-hh - 2.5} Q${hw + 1} ${-hh - 2} ${hw + 1.5} ${-1.5} Z`} fill={c(heavy ? "#3c4128" : "#555334")} />;
        case "support": return <g><path d={`M${-hw - 1} ${-1} Q${-hw} ${-hh - 3} 0 ${-hh - 2.5} Q${hw + 1} ${-hh - 2} ${hw + 1.5} ${-1.5} Z`} fill={c("#c9c2ad")} />{!ink && <path d={`M-1 ${-hh + 0.5} h4 M1 ${-hh - 1.5} v4`} stroke="#a3271f" strokeWidth={1.3} />}</g>;
        case "scout": return <g><path d={`M${-hw} ${-2} Q${-hw} ${-hh - 2} 0 ${-hh - 1.5} Q${hw} ${-hh - 1.5} ${hw} ${-2.5} Z`} fill={c("#3f4a2e")} /><rect x={hw - 2} y={-3.5} width={7} height={1.8} rx={0.9} fill={c("#3f4a2e")} /></g>;
        case "sniper": return <path d={`M${-hw - 4} ${-2} L${hw + 4} ${-2.5} L${hw} ${-4} Q0 ${-hh - 4} ${-hw} ${-4} Z`} fill={c("#6b6342")} />;
        default: return <g><path d={`M${-hw + 1} ${-hh + 1} Q0 ${-hh - 3} ${hw - 1} ${-hh + 1}`} stroke={c("#2b2f2e")} strokeWidth={1.6} fill="none" /><rect x={-2.5} y={-2} width={4} height={5} rx={1.5} fill={c("#2b2f2e")} /></g>;
      }
    })();
    const showHair = cls === "ew";
    head = (
      <g transform={headT}>
        {(human.style === "tied" || human.style === "braids") && <path d={`M${-hw + 1} ${-1} q-4 5 -2 11`} stroke={hair} strokeWidth={2.4} fill="none" strokeLinecap="round" />}
        {human.style === "bun" && <circle cx={-hw + 0.5} cy={-hh * 0.4} r={2.6} fill={hair} />}
        <ellipse cx={0} cy={0} rx={hw} ry={hh} fill={c(human.skin)} />
        <path d={`M${hw - 0.5} ${-0.5} l2.2 2.2 l-2 0.6`} fill={c(human.skin)} />
        {human.jaw === "square" && <rect x={-1} y={hh * 0.3} width={hw + 0.5} height={hh * 0.55} rx={1.5} fill={c(human.skin)} />}
        <ellipse cx={-1.2} cy={0.5} rx={1.3} ry={1.9} fill={c(shade(human.skin, 0.85))} />
        {!ink && <circle cx={hw - 2.2} cy={-1.2} r={0.75} fill="#1b1612" />}
        {!ink && <line x1={hw - 3.4} y1={-2.9} x2={hw - 0.8} y2={-3.1} stroke={hair} strokeWidth={human.brow * 0.45} strokeLinecap="round" />}
        {human.facialHair === "beard" && <path d={`M${-1} ${hh * 0.2} Q${hw * 0.5} ${hh + 1.5} ${hw + 0.6} ${hh * 0.25}`} stroke={hair} strokeWidth={2.4} fill="none" />}
        {(showHair || !["heavy", "assault", "support", "scout", "sniper"].includes(cls)) && human.style !== "bald" && <path d={`M${-hw} ${0} Q${-hw - 0.5} ${-hh - 1} 0 ${-hh - 0.8} Q${hw} ${-hh} ${hw - 0.5} ${-hh * 0.45} Q0 ${-hh * 0.75} ${-hw * 0.4} ${-hh * 0.3} Z`} fill={hair} />}
        {hat}
      </g>
    );
  } else {
    const sy = synth!;
    const hw = 5.6, hh = 6.6;
    const shape =
      sy.head === "capsule" ? <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={hw} fill={c(sy.plate)} stroke={c(sy.trim)} strokeWidth={1.2} />
      : sy.head === "angular" ? <path d={`M${-hw} ${-hh + 2} L${-hw + 3} ${-hh} L${hw} ${-hh + 1} L${hw + 1} ${hh - 3} L${hw - 3} ${hh} L${-hw} ${hh - 1} Z`} fill={c(sy.plate)} stroke={c(sy.trim)} strokeWidth={1.2} />
      : <path d={`M${-hw} ${hh} L${-hw} ${-1} A${hw} ${hw + 1} 0 0 1 ${hw} ${-1} L${hw} ${hh} Z`} fill={c(sy.plate)} stroke={c(sy.trim)} strokeWidth={1.2} />;
    head = (
      <g transform={headT}>
        {sy.antenna && <line x1={-2} y1={-hh} x2={-4} y2={-hh - 6} stroke={c(sy.trim)} strokeWidth={1} />}
        {shape}
        {!ink && <rect x={hw - 4.5} y={-2.2} width={5} height={sy.visor === "band" ? 2.4 : 3.2} rx={1} fill={sy.light} className="visor-glow" />}
      </g>
    );
  }

  const tilt = p.tilt ? `rotate(${p.tilt} ${pelvis.x} ${pelvis.y})` : undefined;
  return (
    <g transform={facing === -1 ? "scale(-1 1)" : undefined} className={`fig ${idle ? (human ? "breathe" : "still") : ""}`}>
      <g transform={tilt}>
        <g className="legs">
          {limb("thighB", "shinB", legW, human ? clothB : shade(synth!.plate, 0.78), boot)}
        </g>
        <g className="upper">
          {limb("armB", "foreB", limbW, human ? clothB : shade(synth!.plate, 0.78), human ? human.skin : synth!.trim)}
          {pack}
        </g>
        <g className="legs">{limb("thighF", "shinF", legW, cloth, boot)}</g>
        <g className="upper">
          {torso}
          {head}
          {limb("armF", "foreF", limbW, cloth, skin)}
          {armed && <g transform={handT}><Weapon cls={cls} ink={ink} /></g>}
        </g>
      </g>
    </g>
  );
}
