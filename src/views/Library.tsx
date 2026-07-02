import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ClipboardPaste, Hammer, Sprout, Trash2, Play as PlayIcon, Plus, Upload } from "lucide-react";
import { api, type ClientSave, type PresetInfo, type SaveListing } from "../lib/api";

export default function Library({ onOpen, onForge, onCreated }: {
  onOpen: (id: string) => void;
  onForge: () => void;
  onCreated: (s: ClientSave) => void;
}) {
  const [saves, setSaves] = useState<SaveListing[]>([]);
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      onCreated(await api.importSave(data));
    } catch (e: any) { alert(`Import failed: ${e.message}`); }
  };

  const refresh = () => { api.saves().then(setSaves).catch(() => {}); };
  useEffect(() => { refresh(); api.presets().then(setPresets).catch(() => {}); }, []);

  const launch = async (presetId: string) => {
    setBusy(presetId);
    try { onCreated(await api.newFromPreset(presetId)); } finally { setBusy(null); }
  };
  const [forking, setForking] = React.useState<string | null>(null);
  const forkSeason = async (id: string) => {
    setForking(id);
    try { onCreated(await api.forkNewSeason(id)); }
    catch (e: any) { alert(`New chapter failed: ${e.message}`); }
    finally { setForking(null); }
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this chronicle? No rollback past this.")) return;
    await api.remove(id); refresh();
  };

  return (
    <div className="scroll-y h-full px-4 pb-10 pt-3">
      {saves.length > 0 && (
        <>
          <div className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-lo)" }}>
            Continue
          </div>
          <div className="space-y-2.5 mb-7">
            {saves.map((s, i) => (
              <motion.div key={s.id} className="card card-press p-4 flex items-center gap-3"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                onClick={() => onOpen(s.id)}>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-[15px] truncate">{s.name}</div>
                  <div className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-lo)" }}>
                    {s.world_name} · turn {s.turn} · {new Date(s.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <button className="p-2" style={{ color: "var(--text-lo)" }} title="start a new chapter from this save"
                  onClick={(e) => { e.stopPropagation(); forkSeason(s.id); }}>
                  <Sprout size={15} style={{ color: forking === s.id ? "var(--accent)" : "var(--text-lo)" }} />
                </button>
                <button className="p-2" style={{ color: "var(--text-lo)" }}
                  onClick={(e) => { e.stopPropagation(); remove(s.id); }}>
                  <Trash2 size={15} />
                </button>
                <PlayIcon size={16} style={{ color: "var(--accent)" }} />
              </motion.div>
            ))}
          </div>
        </>
      )}

      <div className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-lo)" }}>
        Begin
      </div>
      <div className="space-y-2.5">
        {presets.map((p, i) => (
          <motion.div key={p.id} className="card card-press p-4"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={() => !busy && launch(p.id)}>
            <div className="flex items-center justify-between">
              <div className="font-display text-[15px]">{p.name}</div>
              <span className="chip">{busy === p.id ? "weaving…" : "new"}</span>
            </div>
            <div className="text-[13px] mt-1.5 leading-relaxed" style={{ color: "var(--text-mid)" }}>{p.blurb}</div>
          </motion.div>
        ))}

        <motion.div className="card card-press p-4 flex items-center gap-3"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.3 }}
          onClick={() => fileRef.current?.click()}>
          <Upload size={17} style={{ color: "var(--text-mid)" }} />
          <div>
            <div className="font-display text-[15px]">Import a chronicle</div>
            <div className="text-[12.5px]" style={{ color: "var(--text-mid)" }}>Restore from an exported .weft.json file.</div>
          </div>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        </motion.div>

        <motion.div className="card card-press p-4 flex items-center gap-3"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.23, duration: 0.3 }}
          onClick={async () => {
            let text = "";
            try { text = await navigator.clipboard.readText(); } catch { /* will prompt */ }
            if (!text) text = window.prompt("Paste your saved chronicle text here:") ?? "";
            if (!text.trim()) return;
            try { onCreated(await api.importSave(JSON.parse(text))); }
            catch (e: any) { alert(`Import failed: ${e.message}`); }
          }}>
          <ClipboardPaste size={17} style={{ color: "var(--text-mid)" }} />
          <div>
            <div className="font-display text-[15px]">Paste a chronicle</div>
            <div className="text-[12.5px]" style={{ color: "var(--text-mid)" }}>Restore from save text you copied (handy on phones).</div>
          </div>
        </motion.div>

        <motion.div className="card card-press p-4 flex items-center gap-3"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.3 }}
          style={{ borderStyle: "dashed", borderColor: "var(--accent-glow)" }}
          onClick={onForge}>
          <Hammer size={18} style={{ color: "var(--accent)" }} />
          <div>
            <div className="font-display text-[15px]">The Forge</div>
            <div className="text-[12.5px]" style={{ color: "var(--text-mid)" }}>Seed an idea. The engine builds the world, cast, and stakes.</div>
          </div>
          <Plus size={16} className="ml-auto" style={{ color: "var(--text-lo)" }} />
        </motion.div>
      </div>
    </div>
  );
}
