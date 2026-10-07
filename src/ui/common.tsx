import { Figure } from "../art/Figure";
import { Portrait, type Expression } from "../art/Portrait";
import type { PoseName } from "../art/skeleton";
import { CLASSES, habitCombat } from "../game/content";
import { RANKS } from "../game/roster";
import type { Habit, Soldier } from "../game/types";

/** What Command can read off someone's face: the dead, the hurt, the ones holding themselves tight. */
export function expressionOf(s: Soldier): Expression {
  if (s.status === "dead") return "dead";
  if (s.memories.some((m) => m.feeling === "grief" && /today|yesterday|couple/.test(m.anchor))) return "grief";
  if (s.status === "injured" || s.status === "repair") return "tense";
  if (s.braced) return "tense";
  return "calm";
}

export function Token({ s, size = 34 }: { s: Soldier; size?: number }) {
  return <Portrait seed={s.id} kind={s.kind} cls={s.class} expression={expressionOf(s)} size={size} label={s.name} />;
}

/** A standee on a little paper base, for dossiers and the deploy screen. */
export function Standee({ s, pose = "stand", height = 120, facing = 1 }: { s: Soldier; pose?: PoseName; height?: number; facing?: 1 | -1 }) {
  return (
    <svg className="standee" width={height * 0.62} height={height} viewBox="-31 -86 62 100">
      <ellipse cx={0} cy={4} rx={22} ry={5} fill="#23201a" opacity={0.18} />
      <rect x={-16} y={0} width={32} height={8} rx={2} fill="#3b3528" />
      <g transform="scale(1.05)"><Figure seed={s.id} kind={s.kind} cls={s.class} loadout={s.loadout} pose={pose} facing={facing} /></g>
    </svg>
  );
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
