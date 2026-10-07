import { CLASSES, habitCombat } from "../game/content";
import { RANKS } from "../game/roster";
import type { FearState, Habit, Soldier } from "../game/types";

export const initials = (s: string) => s.slice(0, 2).toUpperCase();

export function Token({ s, fear }: { s: Soldier; fear?: FearState }) {
  const cls = ["token", s.kind, fear && fear !== "steady" ? fear : "", s.status === "dead" ? "dead" : ""].join(" ");
  return <span className={cls} title={s.name}>{initials(s.callsign)}</span>;
}

export function KindTag({ s }: { s: Soldier }) {
  return <span className={`tag ${s.kind}`}>{s.kind === "ai" ? "COMMONS" : "HUMAN"}</span>;
}

export function StatusTag({ s }: { s: Soldier }) {
  switch (s.status) {
    case "active": return null;
    case "injured": return <span className="tag warn">MEDBAY {s.recoveryDays}d</span>;
    case "repair": return <span className="tag warn">REPAIR {s.recoveryDays}d</span>;
    case "base-duty": return <span className="tag">BASE DUTY {s.recoveryDays}d</span>;
    case "dead": return <span className="tag bad">KIA</span>;
    case "discharged": return <span className="tag">DISCHARGED</span>;
    case "defected": return <span className="tag bad">DEFECTED</span>;
  }
}

export function SoldierLine({ s, right }: { s: Soldier; right?: React.ReactNode }) {
  return (
    <>
      <Token s={s} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="name">{s.name}</div>
        <div className="small muted">{RANKS[s.rank]} · {CLASSES[s.class].name} · {s.loadout} kit</div>
      </div>
      <KindTag s={s} />
      <StatusTag s={s} />
      {right}
    </>
  );
}

export function HabitLine({ h }: { h: Habit }) {
  return (
    <div className="habit">
      {h.text}
      {h.combatEffect && <span className="hk">{habitCombat(h.combatEffect)}</span>}
    </div>
  );
}
