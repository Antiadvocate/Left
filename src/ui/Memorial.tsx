import type { CampaignState } from "../game/types";
import { Token } from "./common";

export function MemorialView({ st }: { st: CampaignState }) {
  return (
    <div className="panel" style={{ maxWidth: 860, margin: "0 auto" }}>
      <h3>Memorial wall</h3>
      <h1>The names</h1>
      {st.memorial.length === 0 && <p className="scene muted">The wall is still bare.</p>}
      <div className="memorial-grid" style={{ marginTop: 14 }}>
        {st.memorial.slice().reverse().map((m) => {
          const s = st.soldiers[m.id];
          return (
            <div key={m.id} className="memorial-card">
              {s && <Token s={s} size={86} />}
              <div className="wall-name">{m.name}</div>
              <div className="small muted">Day {m.day}</div>
              <div className="small dim">{m.mission}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
