/** Built-in worlds. Sump 9 ported from the original; Thaw Camp new. */
import type { SaveState } from "./types";
import { newSave, registerCharacter, uid } from "./state";

function place(state: SaveState, name: string, facts: string, contains: string[] = []): string {
  const id = uid("loc");
  state.world.places[id] = { id, name, description_facts: facts, contains };
  return id;
}

export function buildPreset(presetId: string): SaveState | null {
  if (presetId === "sump9") return sump9();
  if (presetId === "thaw") return thaw();
  return null;
}

export const PRESET_LIST = [
  { id: "sump9", name: "Sector 9: The Wet Sump", blurb: "High-decay cyber-industrial sewers. Solder-slang, drone sweeps, the Hum.", era_theme: "rust" },
  { id: "thaw", name: "The Thaw Camp", blurb: "Mesolithic lakeshore band at winter's end. Hunger, gossip, ice going soft.", era_theme: "frost" },
];

function sump9(): SaveState {
  const s = newSave("Sector 9: The Wet Sump", {
    name: "Sector 9 Sump",
    era: "Late Rust-Century, Year 204",
    technology_level: "High-decay cyber-industrial. Corrosive oil filters, cathode tubes, pneumatic doors, lead-shielded cybernetics, obsolete corporate net access.",
    magic_rules: "No sorcery. 'The Sump Hum' is a resonant carrier wave that triggers auditory hallucinations and selective telekinesis in people with damaged neural sockets.",
    forbidden: "Unlogged firmware flashing, trading pure copper piping, owning unauthorized security chips.",
    what_people_fear: "Enforcer grid-sweeps, Neural Core burn-out, the Corrosive Sump Drip that melts rubber boots and synthetic skin.",
    cultures_and_languages: "The Chromeheads (obsessively augmented, Solder-Slang) and the Dredgers (sub-basement survivors, Broken Dialect).",
    climate_and_geography: "Subterranean sewer corridors, rusty sludge water, glowing green condensation mold, heated copper and ozone on the air.",
    calendar_and_currency: "Battery Shifts (4×8h, 360-shift Cycles). Blue Credits ('chits') as stamped plastic coins.",
    political_situation: "Sector 9 abandoned by Vanguard Corp. Drone Enforcers execute anyone on upper levels; scrap boss Razor-Face controls water filtration.",
    era_theme: "rust",
    difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" },
    pressure_palette: [
      "Enforcer drone sweep patterns shifting",
      "Filtration politics — Razor-Face's water tax and collectors",
      "Hardware failure: corroded seals, dying batteries, bad solder",
      "The Hum acting up in socket-damaged people",
      "Dredger/Chromehead frictions, debts and gossip in the Ray Deck",
    ],
    forbidden_as_primary: ["random monster attacks", "tone-policing the player's manner", "cosmic or supernatural punishment"],
  });

  const clinic = place(s, "Slam-Gate Cyber-Clinic", "A pneumatic-door clinic lit by cathode tubes; smells of burnt flux and antiseptic gel.", ["surgical rig", "parts bins", "a wall of pawned augments"]);
  const weir = place(s, "Hydro-Weir Filter Grate", "The great filtration weir; Razor-Face's collectors tally water debt here.", ["roaring grate", "chained sluice wheel"]);
  const ray = place(s, "Ray Deck", "Dredger commons under a dead cargo lift — barter stalls, rumor, sour mash.", ["barter stalls", "mash still"]);

  registerCharacter(s, {
    character_id: "char_player", name: "Vex", age: 31,
    appearance_facts: "Lean, oil-stained coveralls, one lead-shielded forearm socket gone matte with wear.",
    background: "Freelance solder-tech keeping Sector 9's last clinics half-alive; owes water debt at the weir.",
    core_traits: ["resourceful", "wary", "dry-humored"], values: ["self-reliance", "fair trade"],
    speech_pattern: "Clipped Solder-Slang, jokes that land flat on purpose.",
    skills: { soldering: "expert", "drone evasion": "competent", barter: "competent" },
  });
  const kildare = registerCharacter(s, {
    name: "Kildare Sumpter", age: 47,
    appearance_facts: "Barrel-chested Dredger, yellow-taped insulated cutters always on his hip.",
    background: "Runs cable salvage out of the Ray Deck; raised three kids on weir-water credit.",
    core_traits: ["loyal", "stubborn", "superstitious about the Hum"], values: ["family", "debts honored"],
    speech_pattern: "Broken Dialect, slow and deliberate.", gregariousness: 0.7,
    current_goal: "Pay down his water debt before the next collection shift.",
    drive: { goal: "secure a copper line worth two cycles of water", progress: 20, updated_turn: 1 },
    skills: { salvage: "expert" },
  });
  const mara = registerCharacter(s, {
    name: "Mara Voltbright", age: 28,
    appearance_facts: "Chromehead with mirror-iris implants and a humming jaw socket she taps when thinking.",
    background: "Clinic surgeon; flashes firmware off the books. The Hum talks to her some shifts.",
    core_traits: ["brilliant", "impulsive", "secretive"], values: ["the craft", "owing nobody"],
    speech_pattern: "Rapid Solder-Slang, trails off mid-sentence.", gregariousness: 0.4,
    intelligence: "brilliant",
    current_goal: "Source a lead-shielded socket before her jaw implant burns out.",
    drive: { goal: "decode the pattern in the Hum's last three episodes", progress: 35, updated_turn: 1 },
    skills: { surgery: "expert", firmware: "expert" },
  });

  s.world.edges.push(
    { from: kildare, to: "char_player", warmth: 25, trust: 30, power: 0, notes: "Vex fixed his cutters cheap last cycle", updated_turn: 1 },
    { from: mara, to: "char_player", warmth: 10, trust: -5, power: 5, notes: "respects the work, suspects the debt", updated_turn: 1 },
    { from: kildare, to: mara, warmth: -10, trust: -20, power: -10, notes: "thinks her firmware games bring drones down on everyone", updated_turn: 1 },
    { from: mara, to: kildare, warmth: 0, trust: 10, power: 10, notes: "finds his superstition useful cover", updated_turn: 1 },
  );
  s.world.clocks.push({
    id: uid("clk"), faction: "Razor-Face's collectors", objective: "Triple the water tax before Cycle's end",
    segments: 6, filled: 1, consequence: "Weir lockout: no chits, no water, debtors named on the grate wall",
    visible_signs: ["new tally chalk on the grate", "collectors counting heads at the Ray Deck", "rumor of a debtor's boots found empty"],
    status: "running",
  });
  s.world.norms.push({ id: uid("nrm"), rule: "Never speak of the Hum near an open socket", enforcement: "shunning", holders: "Dredgers" });
  s.world.player_location = ray;
  s.world.present = [kildare];
  s.world.weather = "Condensation fog off the warm pipes; green mold-light";
  s.world.money = "14 chits";
  s.world.current_time = "Day 1, 09:00 (Morning)";
  s.memory["char_player"].core = ["Owes 60 chits of water debt at the Hydro-Weir.", "Keeps the clinic's old generator alive as quiet charity."];
  s.memory[kildare].core = ["Three kids in the sub-basements; weir debt hangs over all of it.", "Vex once fixed his cutters for a song — that meant something."];
  s.memory[mara].core = ["The Hum spoke in threes last episode. Nobody believes her.", "Her jaw socket is dying; lead shielding or burn-out within the cycle."];
  return s;
}

function thaw(): SaveState {
  const s = newSave("The Thaw Camp", {
    name: "Lakeshore Band of the Reed Water",
    era: "Mesolithic, last weeks of a hard winter",
    technology_level: "Flint, bone, antler, hide, birch tar, dugout canoes, fish weirs.",
    magic_rules: "None real. People believe the lake holds the drowned and the dead listen through ice.",
    forbidden: "Eating the marrow of a named hunting dog; speaking a dead person's name before the ice breaks.",
    what_people_fear: "The ice going soft early, wolf-winter, a bad birth, being talked about at the fire.",
    cultures_and_languages: "One band of ~30; trade-words shared with the Pine Ridge people upriver.",
    climate_and_geography: "Frozen reed lake, birch and pine shore, smoke-houses on stilts above the snow.",
    calendar_and_currency: "Moons and thaws. Worth measured in dried fish, good flint, and standing at the fire.",
    political_situation: "Headwoman Ettel is old; two younger hunters quietly measure each other for what comes after.",
    era_theme: "frost",
    difficulty_profile: { lethality: "medium", friction_density: "sparse", antagonist_aggression: "slow_burn", protagonist_competence: "average" },
    pressure_palette: [
      "Hunger arithmetic — the fish racks running low",
      "Ice condition: soft patches, the weir failing",
      "Standing at the fire: gossip, obligation, marriage talk",
      "The Ettel succession — Brant and Saiva circling",
      "Weather fronts and wolf sign",
    ],
    forbidden_as_primary: ["supernatural events treated as real", "random predator attacks without sign", "tone-policing the player's manner"],
  });

  const fire = place(s, "The Long Fire", "Center of camp: hide windbreaks, the communal hearth, where standing is made and lost.", ["the headwoman's seat", "drying racks"]);
  const weir = place(s, "Reed Weir", "The fish weir at the lake mouth, half-iced; the band's stomach.", ["wicker traps", "soft ice flags"]);
  const smoke = place(s, "Smoke-houses", "Stilted smoke-houses above the snowline; the winter ledger in fish.", ["fish racks, two-thirds empty"]);

  registerCharacter(s, {
    character_id: "char_player", name: "Orun", age: 27,
    appearance_facts: "Wiry, frost-scarred knuckles, a mended seal-hide parka with another family's stitching.",
    background: "Taken in by the band six winters ago after his own people starved out. Earns his place daily.",
    core_traits: ["watchful", "capable", "outsider's caution"], values: ["earning his place", "the children eat first"],
    speech_pattern: "Few words, exact ones.", skills: { "ice reading": "expert", flintwork: "competent", fishing: "competent" },
  });
  const ettel = registerCharacter(s, {
    name: "Ettel", age: 61,
    appearance_facts: "Headwoman; bird-boned, eyes that finish your sentences.",
    background: "Has buried two husbands and one winter's worth of the band. Holds the camp together by memory.",
    core_traits: ["shrewd", "tired", "fair when it costs nothing"], values: ["the band outliving her", "order at the fire"],
    speech_pattern: "Soft, final.", gregariousness: 0.5, intelligence: "sharp",
    current_goal: "Settle the succession before the thaw scatters the band to the fishing grounds.",
    drive: { goal: "bind Brant and Saiva to each other before she names one", progress: 15, updated_turn: 1 },
    skills: { memory: "expert", judgment: "expert" },
  });
  const brant = registerCharacter(s, {
    name: "Brant", age: 33,
    appearance_facts: "Broad, loud, a bear-claw scar he tells differently each telling.",
    background: "Best spear in camp and knows it. Feeds many; reminds them.",
    core_traits: ["generous", "vain", "quick to feel slighted"], values: ["being owed", "his name at the fire"],
    speech_pattern: "Big, warm, lands on himself.", gregariousness: 0.85,
    current_goal: "Bring in the first big kill of the thaw, in front of everyone.",
    drive: { goal: "be named at the fire as Ettel's successor", progress: 40, blocker: "Saiva's quiet competence", updated_turn: 1 },
    skills: { spear: "expert", tracking: "competent" },
  });
  const saiva = registerCharacter(s, {
    name: "Saiva", age: 29,
    appearance_facts: "Quiet hands, a net-mender's squint, hair tied with a strip of her drowned brother's parka.",
    background: "Runs the weir and the smoke-houses; the band eats because of her arithmetic.",
    core_traits: ["precise", "guarded", "long-memoried"], values: ["the count being right", "debts of grief"],
    speech_pattern: "Flat, factual, the rare joke deadpan.", gregariousness: 0.35, intelligence: "sharp",
    current_goal: "Keep the racks above the hunger line until the ice breaks.",
    drive: { goal: "prove the weir can be rebuilt bigger at the second creek", progress: 25, updated_turn: 1 },
    skills: { weirs: "expert", counting: "expert" },
  });

  s.world.edges.push(
    { from: ettel, to: "char_player", warmth: 20, trust: 35, power: 30, notes: "the outsider who reads ice better than her own", updated_turn: 1 },
    { from: brant, to: "char_player", warmth: 5, trust: 10, power: 15, notes: "useful, but watches him take up room at the fire", updated_turn: 1 },
    { from: saiva, to: "char_player", warmth: 15, trust: 25, power: 0, notes: "he counts honestly; that is most of it", updated_turn: 1 },
    { from: brant, to: saiva, warmth: -15, trust: -10, power: 10, notes: "her counts make his generosity look small", updated_turn: 1 },
    { from: saiva, to: brant, warmth: -20, trust: -25, power: -5, notes: "he ate loudly the winter her brother drowned working", updated_turn: 1 },
    { from: ettel, to: brant, warmth: 10, trust: -5, power: 40, notes: "strong, but the band is not a story about him", updated_turn: 1 },
    { from: ettel, to: saiva, warmth: 25, trust: 40, power: 40, notes: "the count is the band", updated_turn: 1 },
  );
  s.world.clocks.push({
    id: uid("clk"), faction: "The lake ice", objective: "The thaw — ice unsafe, weir season over",
    segments: 8, filled: 2, consequence: "The band must scatter to spring grounds; whoever is named leads the move",
    visible_signs: ["grey patches off the reed point", "the weir poles weeping at noon", "geese heard high up"],
    status: "running",
  });
  s.world.norms.push(
    { id: uid("nrm"), rule: "No dead names spoken before the ice breaks", enforcement: "shunning", holders: "everyone" },
    { id: uid("nrm"), rule: "Children eat before hunters boast", enforcement: "gossip", holders: "the fire circle" },
  );
  s.world.player_location = fire;
  s.world.present = [ettel, saiva];
  s.world.weather = "Still cold, high thin sun; the snow crust just starting to give at midday";
  s.world.money = "a pouch of good flint blanks";
  s.world.current_time = "Day 1, 08:30 (Morning)";
  s.memory["char_player"].core = ["His own band starved out six winters ago; he walked here alone over the ice.", "Ettel took him in over objections he was meant to overhear."];
  s.memory[ettel].core = ["The winter of the dog marrow — what she allowed, and never speaks of.", "Orun read the soft ice last spring and saved two children; she has not forgotten."];
  s.memory[brant].core = ["His bear scar came from a sow he provoked; the story has improved.", "Ettel looked past him at the midwinter fire. Everyone saw."];
  s.memory[saiva].core = ["Her brother went through the ice hauling Brant's heavy traps.", "The count says nine days of fish at full mouths. She tells no one the true number."];
  return s;
}
