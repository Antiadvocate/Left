import { resolveRefusal, type Debrief, type RefusalChoice } from "../game/campaign";
import type { CampaignState } from "../game/types";
import { SoldierLine } from "./common";

const CHOICES: { id: RefusalChoice; label: string; note: string }[] = [
  { id: "keep", label: "Keep deployed", note: "Acting while afraid builds Will." },
  { id: "demote", label: "Demote", note: "Loses a rank." },
  { id: "base-duty", label: "Base duty", note: "Off the line for five days." },
  { id: "discharge", label: "Discharge", note: "Gone for good." },
];

export function RefusalReviews({ st, onChange }: { st: CampaignState; onChange: () => void }) {
  if (!st.refusalReviews.length) return null;
  return (
    <div className="stack">
      <h3>Refusals · Command's decision</h3>
      <p className="small muted">The squad will see what you do here. The ones who were once scared themselves will watch closest.</p>
      {st.refusalReviews.map((r) => {
        const s = st.soldiers[r.soldierId];
        if (!s) return null;
        return (
          <div key={r.soldierId} className="panel" style={{ background: "var(--panel-2)" }}>
            <div className="soldier-row" style={{ cursor: "default" }}><SoldierLine s={s} /></div>
            <div className="row" style={{ marginTop: 8 }}>
              {CHOICES.map((c) => (
                <button key={c.id} className={`btn small ${c.id === "discharge" ? "danger" : ""}`} title={c.note} onClick={() => { resolveRefusal(st, s.id, c.id); onChange(); }}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DebriefView({ st, debrief, onChange, onNight }: { st: CampaignState; debrief: Debrief; onChange: () => void; onNight: () => void }) {
  const r = debrief.result;
  return (
    <div className="grid2">
      <div className="panel">
        <h3>Debrief</h3>
        <h1>{r.outcome === "victory" ? "Mission complete" : r.outcome === "evacuated" ? "Squad evacuated" : "Squad lost"}</h1>
        <div className="stack" style={{ marginTop: 10 }}>
          {debrief.lines.slice(1).map((l, i) => <div key={i}>{l}</div>)}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" disabled={st.refusalReviews.length > 0} onClick={onNight}>Night falls</button>
          {st.refusalReviews.length > 0 && <span className="small muted">Decide on the refusals first.</span>}
        </div>
      </div>
      <div>
        {st.refusalReviews.length > 0 && <div className="panel"><RefusalReviews st={st} onChange={onChange} /></div>}
        <div className="panel">
          <h3>Deployed</h3>
          {r.deployed.map((id) => {
            const s = st.soldiers[id];
            return <div key={id} className="soldier-row" style={{ cursor: "default" }}><SoldierLine s={s} right={<span className="small mono muted">{r.kills[id] ?? 0}k</span>} /></div>;
          })}
        </div>
      </div>
    </div>
  );
}
