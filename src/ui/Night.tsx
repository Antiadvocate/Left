import type { CampaignState, NightEvent, NightReport } from "../game/types";

export function EventCard({ st, e }: { st: CampaignState; e: NightEvent }) {
  return (
    <div className="event-card">
      <div className="loc">{e.location}{e.source === "llm" ? "" : ""}</div>
      <div className="scene">{e.scene}</div>
      {e.lines.map((l, i) => (
        <div key={i} className="dialogue">
          <span className="who">{st.soldiers[l.speaker]?.callsign ?? "?"}</span>“{l.text}”
        </div>
      ))}
    </div>
  );
}

/** Bond actions are mechanics Command needs to know about, so they surface as field notes. */
function fieldNotes(report: NightReport): string[] {
  return report.log
    .filter((l) => l.startsWith("earned: ") || l.startsWith("unlocked "))
    .map((l) => {
      const m = /^earned: (.+) & (.+) — (.+)$/.exec(l) ?? /^unlocked (.+) for (.+) & (.+)$/.exec(l);
      if (!m) return l;
      return l.startsWith("earned") ? `${m[1]} and ${m[2]} have started working as a pair in the field: ${m[3]}.` : `${m[2]} and ${m[3]} have started working as a pair in the field: ${m[1]}.`;
    });
}

export function NightView({ st, report, analyst, usingLLM, onMorning }: { st: CampaignState; report?: NightReport; analyst: boolean; usingLLM: boolean; onMorning: () => void }) {
  if (!report) {
    return (
      <div className="panel" style={{ maxWidth: 680, margin: "40px auto", textAlign: "center" }}>
        <h3>Night</h3>
        <p className="scene muted">Lights out in the barracks.</p>
        <p className="small dim">{usingLLM ? "The night pass is being written…" : "…"}</p>
      </div>
    );
  }
  const notes = fieldNotes(report);
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="panel">
        <div className="spread">
          <h3>Night of day {report.day}</h3>
          <span className="tag">{report.source === "llm" ? "LLM" : "TEMPLATES"}</span>
        </div>
        {report.error && <p className="small" style={{ color: "var(--accent)" }}>The model call failed, so the night ran on templates. ({report.error})</p>}
        {report.events.length === 0 && <p className="scene muted">Nothing happens. People sleep, or don't.</p>}
        {report.events.map((e) => <EventCard key={e.id} st={st} e={e} />)}
        {notes.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <h3>Field notes</h3>
            {notes.map((n, i) => <p key={i} className="small">{n}</p>)}
          </div>
        )}
        {report.log.filter((l) => /went unanswered|New recruit/.test(l)).map((l, i) => <p key={i} className="small muted">{l}</p>)}
        {analyst && report.log.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary>Analyst: rules engine log</summary>
            <pre className="small mono muted" style={{ whiteSpace: "pre-wrap" }}>{report.log.join("\n")}</pre>
          </details>
        )}
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={onMorning}>Morning · Day {st.day}</button>
        </div>
      </div>
    </div>
  );
}
