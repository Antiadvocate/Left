/** Humanizers + tiny time/weather glyphs. */
import React from "react";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Moon, Snowflake, Sun, Wind } from "lucide-react";

/** "terrified_by_heat" / "hungry-eating" / "testingRabi" → "terrified by heat" etc. */
export function nice(s: string): string {
  if (!s) return s;
  return s
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function niceCap(s: string): string {
  const n = nice(s);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** Parse "Day 2, 14:30 (Afternoon)" → {h, m} or null. */
export function parseClock(label?: string): { h: number; m: number } | null {
  const mt = label?.match(/(\d{1,2}):(\d{2})/);
  if (!mt) return null;
  return { h: Number(mt[1]) % 24, m: Number(mt[2]) };
}

/** Tiny analog clock face. */
export function AnalogClock({ label, size = 13 }: { label?: string; size?: number }) {
  const t = parseClock(label);
  if (!t) return null;
  const r = size / 2;
  const hourA = ((t.h % 12) + t.m / 60) * 30 * (Math.PI / 180);
  const minA = t.m * 6 * (Math.PI / 180);
  const hand = (a: number, len: number) => ({
    x2: r + Math.sin(a) * len, y2: r - Math.cos(a) * len,
  });
  const hh = hand(hourA, r * 0.48), mh = hand(minA, r * 0.74);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "inline-block", verticalAlign: "-2px" }}>
      <circle cx={r} cy={r} r={r - 0.7} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.55} />
      <line x1={r} y1={r} x2={hh.x2} y2={hh.y2} stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <line x1={r} y1={r} x2={mh.x2} y2={mh.y2} stroke="currentColor" strokeWidth={1} strokeLinecap="round" opacity={0.8} />
    </svg>
  );
}

const WEATHER_MAP: [RegExp, React.ComponentType<{ size?: number }>][] = [
  [/snow|blizzard|flurr/i, CloudSnow],
  [/ice|frost|freez/i, Snowflake],
  [/thunder|lightning|storm/i, CloudLightning],
  [/rain|drizzle|shower|wet|damp/i, CloudRain],
  [/fog|mist|haze|smog|steam/i, CloudFog],
  [/wind|gust|gale/i, Wind],
  [/night|dark|moon/i, Moon],
  [/cloud|overcast|grey|gray/i, Cloud],
  [/sun|clear|bright|hot|warm/i, Sun],
];

export function WeatherIcon({ weather, size = 12 }: { weather?: string; size?: number }) {
  if (!weather) return null;
  const hit = WEATHER_MAP.find(([re]) => re.test(weather));
  const Icon = hit?.[1] ?? Cloud;
  return <Icon size={size} />;
}
