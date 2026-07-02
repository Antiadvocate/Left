/** IndexedDB save store. Plain JSON values; comfortably holds image data URLs. */
import type { SaveState } from "./engine/types";
import { sanitize } from "./engine/state";

const DB = "weft";
const STORE = "saves";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then((db) => new Promise<T>((res, rej) => {
    const store = db.transaction(STORE, mode).objectStore(STORE);
    const r = fn(store);
    r.onsuccess = () => res(r.result as T);
    r.onerror = () => rej(r.error);
  }));
}

export async function putSave(s: SaveState): Promise<void> {
  s.updated_at = new Date().toISOString();
  await tx("readwrite", (store) => store.put(JSON.parse(JSON.stringify(s))));
}

export async function getSave(id: string): Promise<SaveState | null> {
  const raw = await tx<SaveState | undefined>("readonly", (store) => store.get(id));
  return raw ? sanitize(raw) : null;
}

export async function deleteSave(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id));
}

export async function listSaves(): Promise<{ id: string; name: string; updated_at: string; turn: number; world_name: string }[]> {
  const all = await tx<SaveState[]>("readonly", (store) => store.getAll());
  return (all ?? [])
    .map((s) => ({ id: s.id, name: s.name, updated_at: s.updated_at, turn: s.world.current_turn, world_name: s.world_bible.name }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
