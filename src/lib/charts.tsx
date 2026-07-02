/** Tiny dependency-free SVG chart kit. All charts read CSS vars for theming. */
import React from "react";

function pathFrom(points: [number, number][]): string {
  if (!points.length) return "";
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

function scale(values: number[], w: number, h: number, pad = 3, yMin?: number, yMax?: number): [number, number][] {
  const lo = yMin ?? Math.min(...values);
  const hi = yMax ?? Math.max(...values);
  const span = hi - lo || 1;
  const n = Math.max(values.length - 1, 1);
  return values.map((v, i) => [
    pad + (i / n) * (w - pad * 2),
    h - pad - ((v - lo) / span) * (h - pad * 2),
  ]);
}

export function Sparkline({ values, w = 120, h = 34, stroke = "var(--accent)", yMin, yMax, fill = false }: {
  values: number[]; w?: number; h?: number; stroke?: string; yMin?: number; yMax?: number; fill?: boolean;
}) {
  if (values.length < 2) return <svg width={w} height={h} />;
  const pts = scale(values, w, h, 3, yMin, yMax);
  const d = pathFrom(pts);
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${h - 1} L${pts[0][0].toFixed(1)},${h - 1} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {fill && <path d={area} fill={stroke} opacity={0.12} />}
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.4} fill={stroke} />
    </svg>
  );
}

/** Live pressure seismograph + optional instability hairline (λ̂ of the social map). */
export function Seismograph({ trace, overlay, w = 340, h = 32, max = 60 }: { trace: number[]; overlay?: number[]; w?: number; h?: number; max?: number }) {
  const vals = trace.slice(-max);
  const gap = w / max;
  const ov = (overlay ?? []).slice(-max);
  const ovPts = ov.map((v, i) => {
    const x = w - (ov.length - i) * gap + gap / 2;
    const y = h / 2 - clampL(v, -0.6, 0.6) * (h * 0.7);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
      {ovPts && <polyline points={ovPts} fill="none" stroke="var(--text-hi)" strokeWidth={0.9} opacity={0.5} strokeDasharray="1 3" />}
      {vals.map((p, i) => {
        const x = w - (vals.length - i) * gap + gap / 2;
        const t = p / 10;
        const bar = 3 + t * (h - 8);
        const color = t > 0.65 ? "var(--danger)" : t > 0.35 ? "var(--accent)" : "var(--text-lo)";
        return (
          <line key={i} x1={x} x2={x} y1={(h - bar) / 2} y2={(h + bar) / 2}
            stroke={color} strokeWidth={2.2} strokeLinecap="round" opacity={0.35 + t * 0.65} />
        );
      })}
    </svg>
  );
}

function clampL(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

/** Cusp catastrophe glyph: the bistable wedge in the (b, a) control plane + this psyche's position. */
export function CuspGlyph({ a, b, x, size = 86 }: { a: number; b: number; x: number; size?: number }) {
  const w = size, h = size * 0.78;
  // control plane: b ∈ [−1.2, 1.2] horizontal, a ∈ [0.4, −1.6] vertical (fold deepens downward)
  const px = (bv: number) => ((bv + 1.2) / 2.4) * w;
  const py = (av: number) => ((0.4 - av) / 2.0) * h;
  // wedge boundary: |b| = 2(−a/3)^{3/2} for a ≤ 0
  const left: string[] = [], right: string[] = [];
  for (let av = 0; av >= -1.6; av -= 0.05) {
    const bb = 2 * Math.pow(-av / 3, 1.5);
    left.push(`${px(-bb).toFixed(1)},${py(av).toFixed(1)}`);
    right.push(`${px(bb).toFixed(1)},${py(av).toFixed(1)}`);
  }
  const wedge = `M${left.join(" L")} L${right.reverse().join(" L")} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <rect x={0} y={0} width={w} height={h} rx={8} fill="var(--ink-1)" stroke="var(--line)" />
      <path d={wedge} fill="var(--accent)" opacity={0.13} stroke="var(--accent-glow)" strokeWidth={0.8} />
      <line x1={px(0)} x2={px(0)} y1={2} y2={h - 2} stroke="var(--line)" strokeDasharray="2 3" />
      <circle cx={px(b)} cy={py(a)} r={3.4}
        fill={x >= 0 ? "var(--calm)" : "var(--danger)"} stroke="var(--ink-0)" strokeWidth={1} />
    </svg>
  );
}

export function Bars({ data, w = 320, h = 120, color = "var(--accent)" }: {
  data: { label: string; value: number }[]; w?: number; h?: number; color?: string;
}) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const rowH = Math.min(26, h / data.length);
  return (
    <svg width="100%" height={data.length * rowH} viewBox={`0 0 ${w} ${data.length * rowH}`}>
      {data.map((d, i) => {
        const bw = (d.value / max) * (w - 120);
        return (
          <g key={d.label} transform={`translate(0,${i * rowH})`}>
            <text x={0} y={rowH / 2 + 3.5} fill="var(--text-mid)" fontSize={10.5} fontFamily="var(--font-mono)">
              {d.label.length > 14 ? d.label.slice(0, 13) + "…" : d.label}
            </text>
            <rect x={104} y={rowH / 2 - 5} width={Math.max(bw, 2)} height={10} rx={5} fill={color} opacity={0.85} />
            <text x={110 + bw} y={rowH / 2 + 3.5} fill="var(--text-lo)" fontSize={10} fontFamily="var(--font-mono)">
              {Math.round(d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Mood arc: valence -10..10 area chart around a zero line. */
export function MoodArc({ values, w = 340, h = 80 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return <svg width="100%" height={h} />;
  const pts = scale(values, w, h, 6, -10, 10);
  const zeroY = h - 6 - ((0 - -10) / 20) * (h - 12);
  const d = pathFrom(pts);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <line x1={0} x2={w} y1={zeroY} y2={zeroY} stroke="var(--line-strong)" strokeDasharray="3 4" />
      <path d={`${d} L${pts[pts.length - 1][0]},${zeroY} L${pts[0][0]},${zeroY} Z`} fill="var(--accent)" opacity={0.1} />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-lo)" }}>{label}</div>
      <div className="font-display text-xl mt-1" style={{ color: "var(--text-hi)" }}>{value}</div>
      {sub && <div className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-mid)" }}>{sub}</div>}
    </div>
  );
}
