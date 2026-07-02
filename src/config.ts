/** Browser-side config. The OpenRouter key lives in localStorage on THIS device only. */
const KEY_STORAGE = "weft-openrouter-key";

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? "";
}
export function setApiKey(k: string): void {
  if (k) localStorage.setItem(KEY_STORAGE, k.trim());
  else localStorage.removeItem(KEY_STORAGE);
}
export function hasApiKey(): boolean {
  return !!getApiKey();
}
