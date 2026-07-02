/** Time — "Day N, HH:MM" canonical, tolerant parser, heuristic elapse. */

export interface ParsedTime { day: number; hour: number; minute: number }

export function parseTime(s: string): ParsedTime {
  const m = /day\s*(\d+)\s*,?\s*(\d{1,2}):(\d{2})/i.exec(s || "");
  if (m) return { day: +m[1], hour: +m[2], minute: +m[3] };
  return { day: 1, hour: 9, minute: 0 };
}

export function formatTime(t: ParsedTime): string {
  const phase = t.hour < 5 ? "Deep Night" : t.hour < 8 ? "Dawn" : t.hour < 12 ? "Morning" : t.hour < 17 ? "Afternoon" : t.hour < 21 ? "Evening" : "Night";
  return `Day ${t.day}, ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")} (${phase})`;
}

export function advance(s: string, minutes: number): string {
  const t = parseTime(s);
  let total = t.hour * 60 + t.minute + Math.max(0, Math.round(minutes));
  let day = t.day + Math.floor(total / 1440);
  total %= 1440;
  return formatTime({ day, hour: Math.floor(total / 60), minute: total % 60 });
}

/** Absolute minutes from a "Day N, HH:MM" string (Day 1 00:00 = 0). For comparing scheduled times. */
export function absMinutes(s: string): number {
  const t = parseTime(s);
  return (t.day - 1) * 1440 + t.hour * 60 + t.minute;
}
/** Minutes from a → b (negative if b is before a). */
export function minutesBetween(a: string, b: string): number {
  return absMinutes(b) - absMinutes(a);
}

/** Fallback elapse heuristic when the Simulator omits elapsed_minutes. */
export function heuristicMinutes(action: string, prose: string): number {
  const a = action.toLowerCase();
  if (/\bsleep|rest for the night|until morning\b/.test(a)) return 8 * 60;
  if (/\btravel|journey|ride to|walk to|hike\b/.test(a)) return 90;
  if (/\bcook|build|craft|repair|mend|forage|hunt\b/.test(a)) return 60;
  if (/\beat|meal|drink\b/.test(a)) return 30;
  return Math.min(45, 8 + Math.round(prose.length / 220) * 4);
}
