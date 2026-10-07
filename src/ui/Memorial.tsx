import type { CampaignState } from "../game/types";

export function MemorialView({ st }: { st: CampaignState }) {
  return (
    <div className="panel" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h3>Memorial wall</h3>
      {st.memorial.length === 0 && <p className="scene muted">The wall is still bare.</p>}
      {st.memorial.slice().reverse().map((m) => (
        <div key={m.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
          <div className="wall-name">{m.name}</div>
          <div className="small muted">Day {m.day} · {m.mission}</div>
        </div>
      ))}
    </div>
  );
}
