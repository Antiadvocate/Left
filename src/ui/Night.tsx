import { NightScene } from "../art/Scenes";
import type { CampaignState, NightEvent, NightReport } from "../game/types";
import { Token } from "./common";

export function EventCard({ st, e, faces = true }: { st: CampaignState; e: NightEvent; faces?: boolean }) {
  return (
    <div className="event-card">
      <div className="loc">{e.location}</div>
      {faces && (
        <div className="event-faces">
          {e.participants.map((id) => st.soldiers[id]).filter(Boolean).map((s) => <Token key={s.id} s={s} size={26} />)}
        </div>
      )}
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
      <div className="night-wrap">
        <NightScene loc="bunks" people={[]} id="loading" />
        <div className="night-loading">Lights out in the barracks<span className="dots" /></div>
        {usingLLM && <p className="small" style={{ textAlign: "center", color: "#8f8570" }}>The night pass is being written.</p>}
      </div>
    );
  }
  const notes = fieldNotes(report);
  return (
    <div className="night-wrap">
      <div className="spread">
        <div className="night-title">Night · Day {report.day}</div>
        <span className="tag" style={{ color: "#c9bd9f" }}>{report.source === "llm" ? "Written by model" : "Templates"}</span>
      </div>
      {report.error && <div className="panel small" style={{ marginBottom: 14 }}>The model call failed, so the night ran on templates. ({report.error})</div>}
      {report.events.length === 0 && (
        <div className="night-card">
          <NightScene loc="bunks" people={[]} id="quiet" />
          <div className="panel"><p className="scene muted">Nothing happens. People sleep, or don't.</p></div>
        </div>
      )}
      {report.events.map((e) => (
        <div key={e.id} className="night-card">
          <NightScene loc={e.location} people={e.participants.map((id) => st.soldiers[id]).filter(Boolean)} id={e.id} />
          <div className="panel">
            <EventCard st={st} e={e} faces={false} />
          </div>
        </div>
      ))}
      <div className="panel">
        {notes.length > 0 && (
          <>
            <h3>Field notes</h3>
            {notes.map((n, i) => <p key={i} className="small">{n}</p>)}
          </>
        )}
        {report.log.filter((l) => /went unanswered|New recruit/.test(l)).map((l, i) => <p key={i} className="small muted">{l}</p>)}
        {analyst && report.log.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary>Analyst: rules engine log</summary>
            <pre className="small mono muted" style={{ whiteSpace: "pre-wrap" }}>{report.log.join("\n")}</pre>
          </details>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={onMorning}>Morning · Day {st.day}</button>
        </div>
      </div>
    </div>
  );
}
