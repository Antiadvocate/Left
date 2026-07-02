import React, { useState } from "react";
import { ModelPicker } from "./ModelPicker";
import { Braces, Check, Copy, Download } from "lucide-react";
import { api, type ClientSave, type ModelSettings } from "../lib/api";
import { getApiKey, setApiKey } from "../config";

const THEMES = ["auto", "ember", "verdigris", "rust", "frost"];

export const PROSE_FONTS: { id: string; label: string; stack: string }[] = [
  { id: "newsreader", label: "Newsreader", stack: '"Newsreader", serif' },
  { id: "source", label: "Source Serif", stack: '"Source Serif 4", serif' },
  { id: "fraunces", label: "Fraunces", stack: '"Fraunces", serif' },
  { id: "inter", label: "Inter", stack: '"Inter", system-ui, sans-serif' },
];

export function applyProseFont(id: string) {
  const f = PROSE_FONTS.find((x) => x.id === id) ?? PROSE_FONTS[0];
  document.documentElement.style.setProperty("--font-prose", f.stack);
  localStorage.setItem("weft-prose-font", f.id);
}

/* Field components live at MODULE level — defining them inside the component
   recreates the type every render, React remounts the input, and the keyboard
   dies after one keystroke. Never again. */
function TextField({ label, value, onChange, mono, rows }: {
  label: string; value: string; onChange: (v: string) => void; mono?: boolean; rows?: number;
}) {
  const style = mono ? { fontFamily: "var(--font-mono)", fontSize: 13 } : undefined;
  return (
    <div className="py-1.5">
      <div className="font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-lo)" }}>{label}</div>
      {rows && rows > 1
        ? <textarea className="field" style={style} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input className="field" style={style} value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

export default function Settings({ save, setSave }: { save: ClientSave; setSave: (s: ClientSave) => void }) {
  const m = save.model_settings;
  const wb = save.world_bible;
  const [draft, setDraft] = useState<ModelSettings>({ ...m });
  const [theme, setTheme] = useState(wb.era_theme ?? "auto");
  const [proseFont, setProseFont] = useState(() => localStorage.getItem("weft-prose-font") ?? "newsreader");
  const [saved, setSaved] = useState(false);
  const [orKey, setOrKey] = useState(getApiKey());
  const [keySaved, setKeySaved] = useState(false);
  const [rescueText, setRescueText] = useState<string | null>(null);
  const [worldJson, setWorldJson] = useState<string | null>(null);
  const [worldErr, setWorldErr] = useState("");
  const [openingText, setOpeningText] = useState<string | null>(null);
  const [openingBusy, setOpeningBusy] = useState(false);
  const [bibleSaved, setBibleSaved] = useState(false);
  const [bible, setBible] = useState({
    name: wb.name ?? "", era: wb.era ?? "", technology_level: wb.technology_level ?? "",
    magic_rules: wb.magic_rules ?? "", forbidden: wb.forbidden ?? "",
    political_situation: wb.political_situation ?? "", what_people_fear: wb.what_people_fear ?? "",
    cultures_and_languages: wb.cultures_and_languages ?? "", climate_and_geography: wb.climate_and_geography ?? "",
    calendar_and_currency: wb.calendar_and_currency ?? "",
    narrator_direction: wb.narrator_direction ?? "",
    art_direction: wb.art_direction ?? "",
  });
  const [palette, setPalette] = useState((wb.pressure_palette ?? []).join(", "));
  const [forbidPrimary, setForbidPrimary] = useState((wb.forbidden_as_primary ?? []).join(", "));
  const [godMode, setGodMode] = useState(!!wb.god_mode);
  const [canon, setCanon] = useState(((save.world as any).canon ?? []).join("\n"));
  const [difficulty, setDifficulty] = useState({ ...wb.difficulty_profile });

  const DIFF_OPTIONS = {
    lethality: ["low", "medium", "high"],
    friction_density: ["sparse", "balanced", "dense"],
    antagonist_aggression: ["slow_burn", "active", "hostile"],
    protagonist_competence: ["soft", "average", "hardened"],
  } as const;

  const setM = (k: keyof ModelSettings) => (v: string) =>
    setDraft((d) => ({ ...d, [k]: typeof m[k] === "number" ? Number(v) || 0 : v }) as ModelSettings);
  const setB = (k: keyof typeof bible) => (v: string) => setBible((b) => ({ ...b, [k]: v }));

  const previewTheme = (t: string) => {
    setTheme(t);
    // live preview — saving makes it stick to the save file
    document.documentElement.setAttribute("data-theme", t === "auto" ? "ember" : t);
  };

  const commit = async () => {
    const s = await api.settings(save.id, { ...draft, era_theme: theme });
    setSave(s); setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  const commitBible = async () => {
    const s = await api.edit(save.id, { canon: canon.split("\n").map((x: string) => x.trim()).filter(Boolean), world_bible: {
      ...bible,
      god_mode: godMode,
      difficulty_profile: difficulty,
      pressure_palette: palette.split(",").map((x) => x.trim()).filter(Boolean),
      forbidden_as_primary: forbidPrimary.split(",").map((x) => x.trim()).filter(Boolean),
    } });
    setSave(s); setBibleSaved(true);
    setTimeout(() => setBibleSaved(false), 1400);
  };

  return (
    <div className="scroll-y h-full px-4 pb-10 pt-3 space-y-3">
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>OpenRouter key (stored on this device only)</div>
        <input className="field" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }} type="password"
          placeholder="sk-or-..." value={orKey} onChange={(e) => setOrKey(e.target.value)} />
        <button className="btn w-full mt-2" onClick={() => { setApiKey(orKey); setKeySaved(true); setTimeout(() => setKeySaved(false), 1400); }}>
          {keySaved ? <><Check size={14} /> saved locally</> : "Save key"}
        </button>
        <div className="text-[11px] italic mt-1.5" style={{ color: "var(--text-lo)" }}>
          The key lives in your browser's localStorage and is sent straight to OpenRouter. It never touches any other server. Get one at openrouter.ai/keys.
        </div>
      </div>
      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Models (OpenRouter ids)</div>
        <ModelPicker label="Narrator — the voice" value={draft.narrator_model} onChange={setM("narrator_model")} />
        <ModelPicker label="Simulator — the bookkeeper" value={draft.simulator_model} onChange={setM("simulator_model")} />
        <ModelPicker label="Forge — world generation" value={draft.forge_model} onChange={setM("forge_model")} />
        <ModelPicker label="Fallback" value={draft.fallback_model} onChange={setM("fallback_model")} />
        <ModelPicker label="Images — portraits & scenes" value={draft.image_model} onChange={setM("image_model")} kind="image" />
        <div className="text-[11px] -mt-1 mb-1" style={{ color: "var(--text-lo)" }}>
          Live list from OpenRouter, newest first — search or type a custom id. Image field shows image-capable models.
        </div>
        <div className="text-[11px] italic mt-1" style={{ color: "var(--text-lo)" }}>
          Two calls per turn. Prefix `anthropic/` models get prompt-cache breakpoints automatically.
          Append ":online" to any model id (e.g. deepseek/deepseek-chat-v3-0324:online) and it gains live web search for grounding — works for the narrator, simulator, or forge.
        </div>
      </div>

      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>World tension</div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[14px]">How much the world throws at you</span>
          <span className="font-mono text-[13px]" style={{ color: "var(--accent)" }}>{draft.tension ?? 5}</span>
        </div>
        <input type="range" min={0} max={10} step={1} value={draft.tension ?? 5}
          onChange={(e) => setDraft((d) => ({ ...d, tension: Number(e.target.value) }))}
          className="w-full" style={{ accentColor: "var(--accent)" }} />
        <div className="text-[11px] mt-1" style={{ color: "var(--text-lo)" }}>
          {(draft.tension ?? 5) === 0
            ? "0 — at rest. The world introduces nothing new: no fresh threats, threads, events, faction moves, or background drives. It only responds to what you do. Pure breathing room."
            : (draft.tension ?? 5) <= 2
              ? "Low — quiet. Existing situations can resolve and people react, but little new friction is manufactured, and no scheduled consequences are created."
              : (draft.tension ?? 5) <= 4
                ? "Below midpoint — gentle. Friction stays mild; the world rarely escalates on its own."
                : (draft.tension ?? 5) === 5
                  ? "Balanced — the default rhythm of complication and calm."
                  : (draft.tension ?? 5) <= 7
                    ? "Above midpoint — eventful. The world presses harder and more often."
                    : "High — relentless. Expect frequent, fast escalation."}
        </div>
      </div>

      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Token economy</div>
        <button className="w-full flex items-center justify-between py-2" onClick={() => setDraft((d) => ({ ...d, lean_mode: !d.lean_mode }))}>
          <span className="text-left">
            <span className="block text-[14px]">Lean mode</span>
            <span className="block text-[11px]" style={{ color: "var(--text-lo)" }}>Compressed instructions + only present/tracked cast in context. ~Half the input tokens, slightly less prose richness.</span>
          </span>
          <span style={{ width: 42, height: 24, borderRadius: 999, background: draft.lean_mode ? "var(--accent)" : "var(--ink-3)", position: "relative", flexShrink: 0, transition: "background .2s" }}>
            <span style={{ position: "absolute", top: 2, left: draft.lean_mode ? 20 : 2, width: 20, height: 20, borderRadius: 999, background: "var(--ink-0)", transition: "left .2s" }} />
          </span>
        </button>
        <div className="mt-2">
          <TextField label="Token budget per turn (0 = off; e.g. 4000 to cap context)" value={String(draft.token_budget ?? 0)} onChange={(v) => setDraft((d) => ({ ...d, token_budget: Number(v) || 0 }))} mono />
          <div className="text-[11px] -mt-0.5" style={{ color: "var(--text-lo)" }}>
            When set, the per-turn context is trimmed toward this many input tokens — shedding offscreen detail, old memories, and rumors first, collapsing only the least-involved present characters as a last resort. People in your scene are never dropped.
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Cast</div>
        <div className="flex items-center justify-between">
          <span className="text-[14px]">Central characters</span>
          <span className="font-mono text-[13px]" style={{ color: "var(--accent)" }}>{draft.max_central_characters ?? 6}</span>
        </div>
        <input type="range" min={2} max={12} step={1} value={draft.max_central_characters ?? 6}
          onChange={(e) => setDraft((d) => ({ ...d, max_central_characters: Number(e.target.value) }))}
          className="w-full mt-1" style={{ accentColor: "var(--accent)" }} />
        <div className="text-[11px] mt-1" style={{ color: "var(--text-lo)" }}>
          How many full, autonomous characters the world holds at once — each with memory, goals, and inner life. Beyond this, new people enter as lightweight background figures (a guard, a vendor) that cost almost nothing and stay simple, until a central slot frees up. Fewer central characters means each gets more presence and autonomy; more means a busier, costlier cast. Default 6.
        </div>
      </div>

      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Memory economy</div>
        <TextField label="Memories per NPC in context (top-k)" value={String(draft.context_memories_k)} onChange={setM("context_memories_k")} mono />
        <TextField label="Reflection cadence (turns)" value={String(draft.reflection_cadence)} onChange={setM("reflection_cadence")} mono />
        <TextField label="Verbatim history window (turns)" value={String(draft.history_window)} onChange={setM("history_window")} mono />
      </div>

      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-2.5" style={{ color: "var(--text-lo)" }}>Palette (previews live — save to keep)</div>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((t) => (
            <button key={t} className="chip" onClick={() => previewTheme(t)}
              style={theme === t ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)" } : undefined}>
              {t}
            </button>
          ))}
        </div>

        <div className="font-mono text-[10px] uppercase tracking-widest mt-4 mb-2.5" style={{ color: "var(--text-lo)" }}>Narrator's typeface</div>
        <div className="flex flex-wrap gap-2">
          {PROSE_FONTS.map((f) => (
            <button key={f.id} className="chip" style={{
              textTransform: "none", fontFamily: f.stack, fontSize: 12, letterSpacing: 0,
              ...(proseFont === f.id ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)" } : {}),
            }}
              onClick={() => { setProseFont(f.id); applyProseFont(f.id); }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="mt-3 text-[15px]" style={{ fontFamily: "var(--font-prose)", color: "var(--text-mid)" }}>
          The ice spoke first, a long groan from under the reeds. <span className="dlg">"Don't,"</span> Ettel said, without turning.
        </div>
      </div>

      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>World bible — every rule, yours (live next turn)</div>

        <button className="chip my-2" onClick={() => setGodMode((v) => !v)}
          style={godMode ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)" } : undefined}>
          {godMode ? "◉" : "○"} god mode — powers cost nothing; the world reacts to a god
        </button>

        <TextField label="Name" value={bible.name} onChange={setB("name")} />
        <TextField label="Era" value={bible.era} onChange={setB("era")} />
        <TextField label="Art direction (portraits & scenes — style, medium, palette)" value={bible.art_direction} onChange={setB("art_direction")} rows={2} />
        <div className="text-[11px] -mt-1 mb-1" style={{ color: "var(--text-lo)" }}>
          e.g. "muted painterly chiaroscuro, oil texture" · "90s cel anime, hard ink lines" · "gritty photoreal, 35mm film grain". Portraits are full-body on white studio; scenes use this same style.
        </div>
        <TextField label="Technology" value={bible.technology_level} onChange={setB("technology_level")} rows={2} />
        <TextField label="Magic / power rules (incl. any costs — delete a cost and it's gone)" value={bible.magic_rules} onChange={setB("magic_rules")} rows={4} />
        <TextField label="Forbidden in this world" value={bible.forbidden} onChange={setB("forbidden")} rows={2} />
        <TextField label="Political situation" value={bible.political_situation} onChange={setB("political_situation")} rows={3} />
        <TextField label="What people fear" value={bible.what_people_fear} onChange={setB("what_people_fear")} rows={2} />
        <TextField label="Cultures & languages" value={bible.cultures_and_languages} onChange={setB("cultures_and_languages")} rows={2} />
        <TextField label="Climate & geography" value={bible.climate_and_geography} onChange={setB("climate_and_geography")} rows={2} />
        <TextField label="Calendar & currency" value={bible.calendar_and_currency} onChange={setB("calendar_and_currency")} rows={2} />
        <TextField label="Pressure palette (comma-sep — where friction is allowed to come from)" value={palette} onChange={setPalette} rows={2} />
        <TextField label="Never the primary engine of a scene (comma-sep)" value={forbidPrimary} onChange={setForbidPrimary} rows={2} />
        <TextField label="Narrator direction (your standing orders)" value={bible.narrator_direction} onChange={setB("narrator_direction")} rows={3} />
        <TextField label="Established canon (one per line — world-altering facts EVERYONE knows, forever)" value={canon} onChange={setCanon} rows={4} />

        <div className="font-mono text-[10px] uppercase tracking-wider mt-3 mb-1.5" style={{ color: "var(--text-lo)" }}>Difficulty profile</div>
        {(Object.keys(DIFF_OPTIONS) as (keyof typeof DIFF_OPTIONS)[]).map((k) => (
          <div key={k} className="flex items-center gap-2 py-1 flex-wrap">
            <span className="font-mono text-[9.5px] uppercase tracking-wider w-32 shrink-0" style={{ color: "var(--text-lo)" }}>{k.replace(/_/g, " ")}</span>
            {DIFF_OPTIONS[k].map((opt) => (
              <button key={opt} className="chip" onClick={() => setDifficulty((d) => ({ ...d, [k]: opt }))}
                style={difficulty[k] === opt ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)" } : undefined}>
                {opt.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        ))}

        <button className="btn w-full mt-3" onClick={commitBible}>
          {bibleSaved ? <><Check size={14} /> rewoven</> : "Rewrite the bible"}
        </button>
        <button className="btn btn-ghost w-full mt-2" onClick={async () => {
          setWorldErr(""); const raw = await api.getWorldRaw(save.id); setWorldJson(JSON.stringify(raw, null, 2));
        }}>
          <Braces size={14} /> Raw world edit (full JSON)
        </button>
        <div className="text-[11px] mt-1" style={{ color: "var(--text-lo)" }}>
          Edit the world directly — bible, threads, faction clocks, places, edges, canon. Handy at turn 1 to fix anything the forge over-baked.
        </div>
      </div>

      {worldJson !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 95, background: "var(--ink-0)", display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="font-display text-[16px]">Raw world edit</div>
            <div className="text-[12px] mt-1" style={{ color: "var(--text-mid)" }}>
              World bible, threads, clocks, places, edges, canon. Delete a clock you don't want, retune the bible, fix the opening. Save writes it straight to the world.
            </div>
            {worldErr && <div className="text-[12px] mt-1.5 px-2 py-1 rounded" style={{ color: "var(--danger)", background: "rgba(200,60,60,.12)" }}>{worldErr}</div>}
            <div className="flex gap-2 mt-2.5">
              <button className="btn btn-accent" style={{ flex: 1 }} onClick={async () => {
                try { const parsed = JSON.parse(worldJson); setSave(await api.rawEditWorld(save.id, parsed)); setWorldJson(null); setWorldErr(""); }
                catch (e) { const m = e instanceof Error ? e.message : String(e); setWorldErr(m.includes("JSON") ? "Invalid JSON — check brackets and commas." : m); }
              }}>Save world</button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setWorldJson(null); setWorldErr(""); }}>Cancel</button>
            </div>
          </div>
          <textarea value={worldJson} onChange={(e) => setWorldJson(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off"
            style={{ flex: 1, width: "100%", background: "var(--ink-1)", color: "var(--text-mid)", border: "none", padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5 }} />
        </div>
      )}

      <div className="card p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Opening scene</div>
        <div className="text-[12px] mb-2" style={{ color: "var(--text-mid)" }}>The scene you start in, before turn 1. Generate one, edit it, or clear it.</div>
        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1" disabled={openingBusy} onClick={async () => {
            setOpeningBusy(true);
            try { const v = await api.generateOpening(save.id); setSave(v); const op = v.history.find((h: any) => h.kind === "opening"); setOpeningText(op?.narrator_prose ?? ""); }
            catch (e: any) { alert(`Opening failed: ${e.message}`); }
            finally { setOpeningBusy(false); }
          }}>{openingBusy ? "writing…" : "Generate"}</button>
          <button className="btn btn-ghost flex-1" onClick={() => {
            const op = save.history.find((h: any) => h.kind === "opening");
            setOpeningText(op?.narrator_prose ?? "");
          }}>Edit</button>
        </div>
        {openingText !== null && (
          <div className="mt-2">
            <textarea className="field w-full" rows={6} value={openingText} onChange={(e) => setOpeningText(e.target.value)} style={{ fontSize: 13, lineHeight: 1.5 }} />
            <div className="flex gap-2 mt-2">
              <button className="btn btn-accent flex-1" onClick={async () => { setSave(await api.setOpening(save.id, openingText)); setOpeningText(null); }}>Save opening</button>
              <button className="btn btn-ghost" onClick={async () => { setSave(await api.setOpening(save.id, "")); setOpeningText(null); }}>Clear</button>
              <button className="btn btn-ghost" onClick={() => setOpeningText(null)}>Close</button>
            </div>
          </div>
        )}
      </div>

      <button className="btn btn-ghost w-full" style={{ height: 46 }} onClick={async () => {
        const { name, json } = await api.exportSave(save.id);
        const filename = `${name}.weft.json`;
        // 1) iOS/modern: native share sheet with a real file (Save to Files, AirDrop, Messages…)
        try {
          const file = new File([json], filename, { type: "application/json" });
          const nav = navigator as any;
          if (nav.canShare && nav.canShare({ files: [file] })) {
            await nav.share({ files: [file], title: filename });
            return;
          }
        } catch (e: any) { if (e?.name === "AbortError") return; /* user cancelled */ }
        // 2) desktop: classic download
        try {
          const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
          const a = document.createElement("a");
          a.href = url; a.download = filename; document.body.appendChild(a); a.click();
          a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
          return;
        } catch { /* fall through */ }
        // 3) last resort: clipboard (paste into Notes/email; Import accepts pasted text)
        try { await navigator.clipboard.writeText(json); alert("Couldn't open a download here, so your save was copied to the clipboard. Paste it into Notes or email to keep it — you can re-import it later."); }
        catch { alert("Export failed on this browser. Try Copy save instead."); }
      }}>
        <Download size={14} /> Export save (share / download)
      </button>

      <button className="btn btn-ghost w-full" style={{ height: 46 }} onClick={async () => {
        const { json } = await api.exportSave(save.id);
        try { await navigator.clipboard.writeText(json); alert("Save copied to clipboard. Paste it somewhere safe (Notes, email). Re-import it later via Library → paste."); }
        catch {
          // clipboard blocked: drop the text into a prompt so it can be selected/copied manually
          window.prompt("Select all and copy your save:", json.slice(0, 100000));
        }
      }}>
        <Copy size={14} /> Copy save as text
      </button>

      <button className="btn btn-ghost w-full" style={{ height: 46 }} onClick={async () => {
        const { json } = await api.exportSave(save.id);
        setRescueText(json);
      }}>
        <Copy size={14} /> Show save text (manual backup)
      </button>

      {rescueText !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "var(--ink-0)", display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="font-display text-[16px]">Your save — back it up</div>
            <div className="text-[12px] mt-1" style={{ color: "var(--text-mid)" }}>
              Tap and hold the text below → Select All → Copy. Paste into Notes or email. To restore later: Library → Paste a chronicle.
            </div>
            <div className="flex gap-2 mt-2.5">
              <button className="btn btn-accent" style={{ flex: 1 }} onClick={async () => {
                try { await navigator.clipboard.writeText(rescueText); alert("Copied to clipboard."); }
                catch { alert("Couldn't auto-copy — long-press the text and choose Select All → Copy."); }
              }}>Try auto-copy</button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setRescueText(null)}>Done</button>
            </div>
          </div>
          <textarea
            readOnly
            value={rescueText}
            onFocus={(e) => e.currentTarget.select()}
            style={{ flex: 1, width: "100%", background: "var(--ink-1)", color: "var(--text-mid)", border: "none", padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.5, WebkitUserSelect: "text", userSelect: "text" }}
          />
        </div>
      )}

      <button className="btn btn-accent w-full" style={{ height: 48 }} onClick={commit}>
        {saved ? <><Check size={15} /> woven in</> : "Save tuning"}
      </button>
    </div>
  );
}
