/**
 * SIMULATOR DIFF SCHEMA — for provider-side constrained decoding (structured outputs).
 * Everything optional except scene_summary/elapsed_minutes, mirroring the optional-key
 * contract. Kept permissive (`additionalProperties: true` at the root) so a model that
 * emits an extra harmless key doesn't get its whole diff rejected — the engine ignores
 * unknown keys anyway. Providers that don't support json_schema fall back to json_object
 * automatically inside `complete()`.
 */
const S = (props: Record<string, object>, required: string[] = []): object =>
  ({ type: "object", properties: props, required, additionalProperties: true });
const A = (items: object): object => ({ type: "array", items });
const str = { type: "string" }, num = { type: "number" }, strA = A({ type: "string" });

export const SIMULATOR_JSON_SCHEMA: object = S({
  scene_summary: str,
  elapsed_minutes: num,
  weather: str,
  player_location: str,
  locations: A(S({ char_id: str, place: str }, ["char_id", "place"])),
  money: str,
  present: strA,
  facts: A(S({ char_id: str, field: { type: "string", enum: ["fatigue","hunger","condition_add","condition_remove","inventory_add","inventory_remove","wearing_add","wearing_remove","injury","injury_remove"] }, value: str }, ["char_id", "field", "value"])),
  psyche: A(S({ char_id: str, relaxation_delta: num, mood: str, states_add: strA, states_remove: strA }, ["char_id"])),
  edges: A(S({ from: str, to: str, warmth_delta: num, trust_delta: num, power_delta: num, note: str, roles_set: strA }, ["from", "to"])),
  memories: A(S({ char_id: str, content: str, importance: num, emotional_charge: str, scheduled_time: str, anchor: str }, ["char_id", "content"])),
  facts_learned: A(S({ char_id: str, fact: str, quote: str }, ["char_id", "fact"])),
  memory_recohere: A(S({ char_id: str, source_char: str, about: str, added_detail: str }, ["char_id", "about", "added_detail"])),
  traits: A(S({ char_id: str, label: str, origin: str, behavioral_impact: str, intensity: num }, ["char_id", "label"])),
  appearance: A(S({ char_id: str, value: str, permanent: { type: "boolean" } }, ["char_id", "value"])),
  drives_update: A(S({ char_id: str, goal: str, progress: num, blocker: str, priority: num }, ["char_id", "goal"])),
  canon_add: strA,
  track: strA,
  threads_update: A(S({ id: str, title: str, status: { type: "string", enum: ["active", "resolved"] }, description: str, tension: num }, ["title", "status"])),
  character_exits: A(S({ char_id: str, kind: { type: "string", enum: ["dead", "departed"] }, note: str }, ["char_id", "kind"])),
  texture_add: A(S({ char_id: str, item: str }, ["char_id", "item"])),
  rumors_new: A(S({ content: str, truth: { type: "string", enum: ["true", "distorted", "false"] }, salience: num, origin_char: str, about_char: str }, ["content"])),
  consequences_new: A(S({ description: str, fire_in_days: num, fire_in_hours: num, fire_in_turns: num, severity: { type: "string", enum: ["minor", "notable", "major"] }, source_char: str, location_trigger: str }, ["description"])),
  clocks_advance: A(S({ id: str, segments: num }, ["id"])),
  new_characters: A(S({ name: str, age: num, pronouns: str, appearance_facts: str, background: str, core_traits: strA, speech_pattern: str, texture: strA, gregariousness: num, capacity: num }, ["name"])),
  rename: A(S({ who: str, new_name: str }, ["who", "new_name"])),
  bible_update: S({ political_situation: str, what_people_fear: str, technology_level: str, cultures_and_languages: str, magic_rules: str }),
  new_places: A(S({ name: str, description_facts: str }, ["name"])),
  offscreen: strA,
}, ["scene_summary", "elapsed_minutes"]);
