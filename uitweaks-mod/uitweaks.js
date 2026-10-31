/*
 * DFO Online - UI Tweaks: readable loot, in the plaque and the item card.
 *
 * Installer hooks (all read-only):
 *   - propBodies-*.js      row label/tier, the shared row-filter hook line,
 *                          and the "empty pile" model guard
 *   - deepWaterRuntime-*.js  data-tier on the row (the style keys off it)
 *   - enhancedInventory-*.js the card's summary line and its data-dfo-tier
 *
 * Nothing here touches game data: it reads the item object the game already
 * hands over.
 *
 * Label:  T3 . Iron Saber . Long Blade
 *   T<n>   the item's tier in the Daggerfall material order: Leather 1,
 *          Chain 2, Iron 3, Steel 4, Silver 5, Elven 6, Dwarven 7,
 *          Mithril 8, Adamantium 9, Ebony 10, Orcish 11, Daedric 12
 *   Iron   the item's material word (skipped when the game name has it)
 *   Saber  the game's own name for the item
 *   Long Blade  the weapon skill (weapons) or Leather/Chain/Plate (armor)
 */
'use strict';

export const MOD_BUILD = '@BUILD@';

/* Daggerfall's material grades, in the game's own enum order
 * ({Iron:0, Steel:1, ... Daedric:9}); the printed tier is index + 1. */
const MATERIALS = ['Iron', 'Steel', 'Silver', 'Elven', 'Dwarven',
  'Mithril', 'Adamantium', 'Ebony', 'Orcish', 'Daedric'];

/* The game's equip-slot ids (the item's `equipSlot`) and the slot word shown
 * as a cosmetic item's type - the same slots the inventory's paper doll uses. */
const SLOT_LABELS = {
  0: 'Amulet', 1: 'Amulet', 2: 'Bracelet', 3: 'Bracelet', 4: 'Ring', 5: 'Ring',
  6: 'Bracer', 7: 'Bracer', 8: 'Mark', 9: 'Mark', 10: 'Crystal', 11: 'Crystal',
  12: 'Head', 13: 'Right arm', 14: 'Cloak', 15: 'Left arm', 16: 'Cloak',
  17: 'Chest', 18: 'Chest', 19: 'Right hand', 20: 'Gloves', 21: 'Left hand',
  23: 'Legs', 24: 'Legs', 26: 'Feet',
};

/* Clothing/jewellery template index -> slot, from the game's own equip table
 * (the same one the paper doll uses). Ground and pack items usually have no
 * `equipSlot` - only worn ones do - so the template is the reliable key. */
const CLOTHING_SLOTS = {
  141: 'Chest', 142: 'Chest', 143: 'Chest', 144: 'Chest', 145: 'Chest', 146: 'Chest',
  157: 'Chest', 158: 'Chest', 159: 'Chest', 160: 'Chest', 161: 'Chest', 163: 'Chest',
  164: 'Chest', 165: 'Chest', 166: 'Chest', 167: 'Chest', 168: 'Chest', 169: 'Chest',
  170: 'Chest', 171: 'Chest', 172: 'Chest', 173: 'Chest', 176: 'Chest', 177: 'Chest',
  178: 'Chest', 179: 'Chest', 180: 'Chest', 181: 'Chest',
  147: 'Feet', 148: 'Feet', 149: 'Feet', 150: 'Feet',
  151: 'Legs', 152: 'Legs', 153: 'Legs', 156: 'Legs', 162: 'Legs', 174: 'Legs', 175: 'Legs',
  154: 'Cloak', 155: 'Cloak',
  182: 'Chest', 183: 'Chest', 184: 'Chest', 185: 'Chest', 194: 'Chest', 195: 'Chest',
  196: 'Chest', 197: 'Chest', 198: 'Chest', 200: 'Chest', 201: 'Chest', 202: 'Chest',
  203: 'Chest', 204: 'Chest', 205: 'Chest', 206: 'Chest', 207: 'Chest', 208: 'Chest',
  209: 'Chest', 214: 'Chest', 215: 'Chest', 210: 'Chest', 216: 'Chest',
  186: 'Feet', 187: 'Feet', 188: 'Feet', 189: 'Feet',
  190: 'Legs', 193: 'Legs', 199: 'Legs', 211: 'Legs', 212: 'Legs', 213: 'Legs',
  191: 'Cloak', 192: 'Cloak',
  133: 'Amulet', 138: 'Amulet', 139: 'Amulet',
  134: 'Bracer', 135: 'Ring', 136: 'Bracelet', 137: 'Mark',
};
const WEARABLE_GROUPS = new Set(['MensClothing', 'WomensClothing', 'Clothing', 'Jewellery']);

/* Weapon template indices (the game's own table: Dagger 113 ... Arrow 131).
 * These are Daggerfall's canonical item ids, so an artifact or a renamed
 * weapon still reports the right skill; the name map below covers modded
 * items and is the fallback. */
const WEAPON_BY_INDEX = {
  113: 'Short Blade', 114: 'Short Blade', 115: 'Blunt Weapon', 116: 'Short Blade',
  117: 'Short Blade', 118: 'Long Blade', 119: 'Long Blade', 120: 'Long Blade',
  121: 'Long Blade', 122: 'Long Blade', 123: 'Long Blade', 124: 'Blunt Weapon',
  125: 'Blunt Weapon', 126: 'Blunt Weapon', 127: 'Axe', 128: 'Axe',
  129: 'Archery', 130: 'Archery', 131: 'Archery',
};

/* Name words that already give the type away, keyed by the type they stand for.
 * In the "Hide obvious" mode the type is left off for these: a Formal Cloak is
 * plainly a cloak, a Longsword a long blade, a Battle Axe an axe. Words are
 * matched on whole tokens of the normalized name, so "market" is not a mark
 * and "elbow" is not a bow. A type with no words listed here always prints. */
const OBVIOUS_WORDS = {
  'Short Blade': ['dagger', 'knife', 'shortsword', 'short sword'],
  'Long Blade': ['longsword', 'long sword'],
  Axe: ['axe'],
  'Blunt Weapon': ['mace', 'flail', 'warhammer', 'war hammer', 'hammer', 'staff', 'club', 'cudgel'],
  Archery: ['bow', 'shortbow', 'longbow', 'short bow', 'long bow', 'arrow', 'crossbow'],
  Leather: ['leather'],
  Chain: ['chain', 'chainmail', 'mail'],
  Plate: ['plate'],
  Head: ['helm', 'helmet', 'hat', 'hood', 'cap'],
  Chest: ['shirt', 'robe', 'gown', 'vest', 'blouse'],
  Legs: ['pants', 'trousers', 'breeches', 'leggings', 'skirt'],
  Feet: ['shoe', 'boot', 'sandal', 'slipper'],
  Gloves: ['glove', 'gauntlet'],
  Cloak: ['cloak', 'mantle', 'cape', 'cowl', 'shawl'],
  Ring: ['ring'],
  Amulet: ['amulet', 'necklace', 'pendant'],
  Bracelet: ['bracelet'],
  Bracer: ['bracer'],
  Mark: ['mark'],
  Crystal: ['crystal'],
};

/* Weapon name -> skill, for items whose template index is not in the table
 * (added content). Names are content, not minifier output. */
const WEAPON_TYPES = {
  dagger: 'Short Blade', tanto: 'Short Blade', wakazashi: 'Short Blade', shortsword: 'Short Blade',
  broadsword: 'Long Blade', longsword: 'Long Blade', saber: 'Long Blade', katana: 'Long Blade',
  claymore: 'Long Blade', 'dai katana': 'Long Blade', dai_katana: 'Long Blade',
  'battle axe': 'Axe', 'war axe': 'Axe',
  staff: 'Blunt Weapon', mace: 'Blunt Weapon', flail: 'Blunt Weapon', warhammer: 'Blunt Weapon',
  'short bow': 'Archery', 'long bow': 'Archery', arrow: 'Archery',
};

const STORE_KEY = 'dfoUiTweaks.config.v1';
const STYLE_ID = 'dfo-uitweaks-style';

/* Quest items: no material tier, and they must be easy to spot. They take their
 * own colour key (the same --dfo-tier/--dfo-ink pair the tiers use) and a
 * "Quest:" prefix on the plaque row. The item card already prints
 * "Quest item: <quest>" as a boundline; the colour key reaches it too. */
const QUEST_SLUG = 'quest';

/* Ingredient glyphs, drawn as masks so they take the row's own colour. */
const ICON_SVG = {
  herb: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 22V10c0-4 3-7 9-7 0 6-3 9-9 9zm0-6v-3c0-3-3-6-8-6 0 5 3 9 8 9z'/></svg>",
  fungus: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M3 12a9 9 0 0 1 18 0zm7 1h4v6a2 2 0 0 1-4 0z'/></svg>",
  mineral: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 1l8 8-8 14L4 9z'/></svg>",
  flower: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 2a3.5 3.5 0 0 1 0 7 3.5 3.5 0 0 1 0-7zm-5 5a3.5 3.5 0 0 1 5 5 3.5 3.5 0 0 1-5-5zm10 0a3.5 3.5 0 0 1 0 7 3.5 3.5 0 0 1 0-7zm-5 5a3.5 3.5 0 0 1 0 7 3.5 3.5 0 0 1 0-7zM11 15h2v8h-2z'/></svg>",
  animal: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M6 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm12 0a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM3 16c0-3.5 4-6 9-6s9 2.5 9 6-4 6-9 6-9-2.5-9-6z'/></svg>",
};
const ICON_RULES = Object.entries(ICON_SVG).map(([kind, svg]) =>
  `:root.dfo-uitweaks-icons .pack-shell .itemrow[data-dfo-ing="${kind}"] .itemname > span::before{--dfo-icon:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`).join('\n');
const QUEST_HEX = '#f873ff';

/* The Daggerfall material order the game itself ranks by, low to high:
 * Leather, Chain, Iron, Steel, Silver, Elven, Dwarven, Mithril, Adamantium,
 * Ebony, Orcish, Daedric. The printed tier is the index + 1. */
const MATERIAL_ORDER = ['Leather', 'Chain', ...MATERIALS];

/* Colours, keyed by material slug. `hex` is the dot; `ink` is the name colour
 * - the same colour except where the hex is too dark to read on the plaque's
 * near-black ground. Two palettes; the tier scale above is the same for both. */
const PALETTES = {
  classic: {
    leather: { hex: '#8b4513' }, chain: { hex: '#c0c0c0' },
    iron: { hex: '#4a4a4a', ink: '#a3a3a3' }, steel: { hex: '#808080' },
    silver: { hex: '#d3d3d3' }, elven: { hex: '#e0e0e0' }, dwarven: { hex: '#daa520' },
    mithril: { hex: '#191970', ink: '#7b7bd0' }, adamantium: { hex: '#2f2f2f', ink: '#969696' },
    ebony: { hex: '#1a1a1a', ink: '#909090' }, orcish: { hex: '#2e8b57' },
    daedric: { hex: '#b22222', ink: '#d95757' },
  },
  /* Blue/orange ramp: readable for red-green colour blindness, where the
   * metal ladder (red->green->gold) collapses into one muddy band. */
  colourblind: {
    leather: { hex: '#8a6a3a' }, chain: { hex: '#9aa0a6' },
    iron: { hex: '#c8c8c8' }, steel: { hex: '#e2e2e2' }, silver: { hex: '#f2f6fa' },
    elven: { hex: '#66b3ff' }, dwarven: { hex: '#f5c542' }, mithril: { hex: '#2f7dff' },
    adamantium: { hex: '#b4b4b4' }, ebony: { hex: '#6f6f6f' }, orcish: { hex: '#a3c94a' },
    daedric: { hex: '#ff7a3d' },
  },
  /* Maximum separation on a dark ground, for low vision. */
  contrast: {
    leather: { hex: '#ffd24d' }, chain: { hex: '#ffffff' },
    iron: { hex: '#ffffff' }, steel: { hex: '#ffffff' }, silver: { hex: '#ffffff' },
    elven: { hex: '#66ffcc' }, dwarven: { hex: '#ffd24d' }, mithril: { hex: '#66ccff' },
    adamantium: { hex: '#ff9ec4' }, ebony: { hex: '#b8b8ff' }, orcish: { hex: '#9dff5a' },
    daedric: { hex: '#ff5c5c' },
  },
  bright: {
    leather: { hex: '#b08355' }, chain: { hex: '#aeb4bd' },
    iron: { hex: '#b8b2a4' }, steel: { hex: '#cdd5df' }, silver: { hex: '#eaf0f6' },
    elven: { hex: '#7fd39a' }, dwarven: { hex: '#d1904f' }, mithril: { hex: '#86c6ff' },
    adamantium: { hex: '#a99bff' }, ebony: { hex: '#c07ad8' }, orcish: { hex: '#8fb552' },
    daedric: { hex: '#ff6050' },
  },
};
const SCHEMES = ['classic', 'bright', 'colourblind', 'contrast'];

/* Gems are their own thing: no metal grade, no type, no dot - the row is just
 * the gem in its own colour, and the grade word the game already puts in the
 * name (Chipped Emerald). Template indices from the game's item table (Ruby 0
 * ... Amber 7); a graded gem is a block above that: 1900 + grade*8 + stone,
 * with grades chipped/flawed/flawless/perfect. */
const GEMS = {
  0: ['ruby', '#c8323c'], 1: ['emerald', '#34c46a'], 2: ['sapphire', '#3f7fdf'],
  3: ['diamond', '#d9f2ff'], 4: ['jade', '#6fc48c'], 5: ['turquoise', '#35d0c5'],
  6: ['malachite', '#0f9e63'], 7: ['amber', '#ffb938'], 77: ['pearl', '#f2ead8'],
};
const GEM_STONES = ['ruby', 'emerald', 'sapphire', 'diamond', 'jade', 'turquoise', 'malachite', 'amber'];
const GEM_GRADES = ['chipped', 'flawed', 'flawless', 'perfect'];
const GEM_GRADE_BASE = 1900;
const GEM_BY_NAME = Object.fromEntries(Object.values(GEMS).map(([slug]) => [slug, slug]));

function gemSlug(item) {
  if (!item) return null;
  const ti = Number(item.templateIndex);
  const byIndex = GEMS[ti];
  if (byIndex) return byIndex[0];
  const graded = ti - GEM_GRADE_BASE;
  if (graded >= 0 && graded < GEM_GRADES.length * GEM_STONES.length) {
    return `${GEM_GRADES[Math.floor(graded / GEM_STONES.length)]}-${GEM_STONES[graded % GEM_STONES.length]}`;
  }
  const direct = GEM_BY_NAME[norm(item.name)];
  if (direct) return direct;
  // "Chipped Emerald" for a build whose index table moved
  const m = /^(chipped|flawed|flawless|perfect)\s+(.+)$/i.exec(String(item.name ?? '').trim());
  const stone = m ? GEM_BY_NAME[norm(m[2])] : null;
  return stone ? `${m[1].toLowerCase()}-${stone}` : null;
}

let cfg = null;
let styleEl = null;

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* How much of the type/slot a label carries:
 *   off      - none (tier/material and the name only)
 *   obvious  - only when the name does not already say it
 *   all      - always */
const TYPE_MODES = ['off', 'obvious', 'all'];
const TYPE_MODE_DEFAULT = 'obvious';

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      // pre-1.1 schemes ('metal' / 'full') both become the classic palette
      const scheme = SCHEMES.includes(raw.scheme) ? raw.scheme : 'classic';
      // older configs had a hideObvious checkbox instead of the dropdown
      const typeMode = TYPE_MODES.includes(raw.typeMode)
        ? raw.typeMode
        : (raw.hideObvious === false ? 'all' : TYPE_MODE_DEFAULT);
      return {
        labels: raw.labels !== false,
        colours: raw.colours !== false,
        typeMode,
        hands: raw.hands !== false,
        quests: raw.quests !== false,
        gradient: raw.gradient !== false,
        icons: raw.icons !== false,
        scheme,
        rows: clampRows(raw.rows),
      };
    }
  } catch { /* unreadable - defaults */ }
  return { labels: true, colours: true, typeMode: TYPE_MODE_DEFAULT, hands: true, quests: true, gradient: true, icons: true, scheme: 'classic', rows: ROWS_DEFAULT };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
}

/* Ammo is not material-graded: pellets and arrows keep their plain name. */
const AMMO = /(?:^|\s)(pellets?|arrows?|bolts?)$/i;

/** How many item rows the plaque shows at once (the game hard-caps at 6;
 *  the installer makes its row framer ask this instead). */
const ROWS_MIN = 3;
const ROWS_MAX = 20;
const ROWS_DEFAULT = 10;
function clampRows(n) {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) ? Math.min(ROWS_MAX, Math.max(ROWS_MIN, v)) : ROWS_DEFAULT;
}
export function lootRows() {
  return clampRows(cfg?.rows);
}

function materialOf(item) {
  const m = Number(item?.material);
  if (!Number.isInteger(m) || m < 0) return null;
  if (item.group === 'Armor') {
    // armor packs its class in the high byte and the metal grade in the low
    // one: 0 / 1<<8 = Leather / Chain, 2<<8 | grade = Plate in that metal
    // (Steel Helm = 513, Daedric Helm = 521). Only plate carries a grade.
    return (m >> 8) === 2 && (m & 255) < MATERIALS.length ? (m & 255) : null;
  }
  if (item.group !== 'Weapons') return null;
  return m < MATERIALS.length ? m : null;
}
/** The armor class the game itself shows as "Type": Leather, Chain, Plate. */
function armorClass(item) {
  const m = Number(item?.material);
  if (!Number.isInteger(m) || m < 0) return null;
  const cls = m >> 8;
  return cls === 0 ? 'Leather' : cls === 1 ? 'Chain' : 'Plate';
}
/** A quest item, when quest marking is on. The game sets `questItem` on the
 *  item object (with a questUID); the value is truthy, not always `true`. */
function isQuest(item) {
  return !!(cfg?.quests !== false && item && typeof item === 'object' && item.questItem);
}

/** The colour key for a row: a quest item's own key, a gem's own colour, or the
 *  material slug, or null when the item is not graded. */
function materialSlug(item) {
  if (!item) return null;
  if (isQuest(item)) return QUEST_SLUG;
  const gem = gemSlug(item);
  if (gem) return `gem-${gem}`;
  if (AMMO.test(String(item.name ?? ''))) return null;
  if (item.group === 'Armor') {
    const cls = armorClass(item);
    if (cls !== 'Plate') return cls.toLowerCase();
  }
  const grade = materialOf(item);
  return grade == null ? null : MATERIALS[grade].toLowerCase();
}
/** The printed tier: the item's place in the Daggerfall material order
 *  (Leather 1, Chain 2, Iron 3 ... Daedric 12). */
function tierNumber(item) {
  const slug = materialSlug(item);
  if (!slug) return null;
  const at = MATERIAL_ORDER.findIndex((m) => m.toLowerCase() === slug);
  return at < 0 ? null : at + 1;
}
/** The slot a cosmetic/wearable goes to (clothing, jewellery, marks...), or
 *  null when the item is not worn. */
function slotLabel(item) {
  if (!item) return null;
  const slot = Number(item?.equipSlot);
  if (Number.isInteger(slot) && SLOT_LABELS[slot]) return SLOT_LABELS[slot];
  if (!WEARABLE_GROUPS.has(String(item.group ?? ''))) return null;
  return CLOTHING_SLOTS[Number(item.templateIndex)] ?? null;
}

/* Armour's own slot, from the game's equip table (`equipRules` Armor):
 * 102 Chest, 103 Hands, 104 Legs, 105/106 arms, 107 Head, 108 Feet,
 * 109-112 shields. A worn item's equipSlot is the fallback for added armour. */
const ARMOR_SLOTS = {
  102: 'Chest', 103: 'Hands', 104: 'Legs', 105: 'Left arm', 106: 'Right arm',
  107: 'Head', 108: 'Feet',
  109: 'Shield', 110: 'Shield', 111: 'Shield', 112: 'Shield',
};
function armorSlot(item) {
  if (!item || item.group !== 'Armor') return null;
  const byIndex = ARMOR_SLOTS[Number(item.templateIndex)];
  if (byIndex) return byIndex;
  const slot = Number(item.equipSlot);
  if (!Number.isInteger(slot)) return null;
  if (slot === 19 || slot === 21) return 'Shield';
  if (slot === 20) return 'Hands';
  return SLOT_LABELS[slot] ?? null;
}
function typeOf(item) {
  if (!item) return null;
  if (item.group === 'Armor') return armorClass(item);
  if (item.group !== 'Weapons') return slotLabel(item);
  const byIndex = WEAPON_BY_INDEX[Number(item.templateIndex)];
  if (byIndex) return byIndex;
  return WEAPON_TYPES[norm(item.name)] ?? null;
}

/** True when the name already says the type: "Longsword" is a long blade, a
 *  "Formal Cloak" a cloak, a "Battle Axe" an axe. Whole tokens only, with a
 *  simple plural ("Plain Robes", "Shoes"). */
/** Whole-word (and simple-plural) match on the normalized name. */
function hasWord(name, word) {
  const padded = ` ${norm(name)} `;
  return padded.includes(` ${word} `) || padded.includes(` ${word}s `)
    || (word.endsWith('s') && padded.includes(` ${word.slice(0, -1)} `));
}

function obviousType(name, type) {
  const words = OBVIOUS_WORDS[type];
  return !!words && words.some((w) => hasWord(name, w));
}

/* One- or two-handed, from the game's own weapon table (equipRules `Xe`):
 * 113 Dagger … 127 Battle Axe are Either (one hand), 115 Staff, 122 Claymore,
 * 123 Dai-Katana, 125 Warhammer, 126 Flail, 128 War Axe and the bows are Both.
 * Artifacts use special templates: 560 is Both, 562/563 Either. Unknown
 * templates (added content) fall back to the name. */
const WEAPON_HANDS = {
  113: 1, 114: 1, 116: 1, 117: 1, 118: 1, 119: 1, 120: 1, 121: 1, 124: 1, 127: 1,
  115: 2, 122: 2, 123: 2, 125: 2, 126: 2, 128: 2, 129: 2, 130: 2,
  560: 2, 562: 1, 563: 1,
};
const TWO_HAND_WORDS = ['staff', 'claymore', 'dai katana', 'dai-katana', 'warhammer', 'war hammer', 'flail', 'war axe', 'short bow', 'shortbow', 'long bow', 'longbow', 'bow'];
const ONE_HAND_WORDS = ['dagger', 'tanto', 'shortsword', 'short sword', 'wakazashi', 'broadsword', 'broad sword', 'saber', 'sabre', 'longsword', 'long sword', 'katana', 'mace', 'battle axe', 'axe'];

/** 1 or 2 for a weapon, null for anything else (ammo included). */
function handsOf(item) {
  if (!item || item.group !== 'Weapons') return null;
  if (AMMO.test(String(item.name ?? ''))) return null;
  const byIndex = WEAPON_HANDS[Number(item.templateIndex)];
  if (byIndex) return byIndex;
  if (TWO_HAND_WORDS.some((w) => hasWord(item.name, w))) return 2;
  if (ONE_HAND_WORDS.some((w) => hasWord(item.name, w))) return 1;
  return null;
}

/** The type/slot display mode; a type is printed when this allows it. */
function showType(name, type) {
  const mode = cfg?.typeMode ?? TYPE_MODE_DEFAULT;
  if (mode === 'off') return false;
  return mode === 'all' || !obviousType(name, type);
}
function showSlot(name, slot) {
  const mode = cfg?.typeMode ?? TYPE_MODE_DEFAULT;
  if (mode === 'off') return false;
  return mode === 'all' || !hasWord(name, norm(slot));
}

/** The plaque row label. The installer calls this with the raw item and the
 *  game's own computed name (so quality words and epithets survive). */
export function lootLabel(item, gameName = null) {
  if (!item || typeof item !== 'object') return null;
  let name = String(gameName || item.name || 'Item').trim() || 'Item';
  /* A quest item is marked whatever the tier-label switch says: the marker is
   * the "Quests" switch on its own, so it never disappears by accident. */
  if (isQuest(item)) return `Quest: ${name}`;
  if (!cfg?.labels) return null;
  if (AMMO.test(String(item.name ?? ''))) return name; // no grade, no type

  const grade = materialOf(item);
  if (grade != null) {
    const mat = MATERIALS[grade];
    // The game already prefixes the metal once it matters (Steel Saber,
    // Ebony Cuirass); iron stays bare, so only add it when missing.
    if (mat && !norm(name).startsWith(norm(mat))) name = `${mat} ${name}`;
  }

  const parts = [];
  const tier = tierNumber(item);
  if (tier) parts.push(`T${tier}`);
  parts.push(name);

  const type = typeOf(item);
  if (type && showType(name, type)) parts.push(type);
  /* Armour also says where it goes: Buckler/Shield, Greaves/Legs, Helm/Head. */
  const slot = armorSlot(item);
  if (slot && showSlot(name, slot)) parts.push(slot);
  /* Weapons also say whether they take one hand or two; ammo and non-weapons
   * stay plain. */
  const hands = cfg.hands === false ? null : handsOf(item);
  if (hands) parts.push(`${hands}H`);
  return parts.join(' \u00b7 ');
}

/** The name a loot-window / pack row shows: quest items say so, as on the plaque. */
export function rowName(item, gameName = null) {
  if (!item) return gameName;
  const name = String(gameName || item.name || '');
  return isQuest(item) ? `Quest: ${name}` : name;
}

/* Ingredient icons: a small glyph by kind, keyed from the name. Only the
 * ingredient group gets one - an icon on every row would be noise. */
const ICON_KINDS = [
  ['fungus', ['mushroom', 'toadstool', 'fungus', 'spore', 'mold', 'mould', 'lichen', 'truffle']],
  ['mineral', ['salt', 'crystal', 'ore', 'stone', 'dust', 'powder', 'resin', 'amber']],
  ['flower', ['flower', 'blossom', 'petal', 'rose', 'lily', 'orchid']],
  ['animal', ['gland', 'venom', 'eye', 'bone', 'blood', 'scale', 'heart', 'tongue', 'claw', 'fang', 'horn', 'silk', 'hair', 'feather', 'wing', 'tusk', 'shell', 'egg', 'skin', 'wrapping', 'bandage', 'web']],
  ['herb', ['leaf', 'root', 'herb', 'weed', 'grass', 'stem', 'bark', 'moss', 'fern', 'bulb']],
];
function ingredientKind(item) {
  if (!item || !/Ingredient/i.test(String(item.group ?? ''))) return null;
  const words = norm(item.name);
  for (const [kind, keys] of ICON_KINDS) {
    if (keys.some((k) => new RegExp(`(^| )${k}(s)?( |$)`).test(words))) return kind;
  }
  return 'herb';
}

/** Mark a pack / loot-window row with its colour keys (the CSS reads them). */
export function decorateRow(el, item) {
  if (!el || !el.dataset) return;
  const tags = tierTags(item);
  if (tags[0]) el.dataset.dfoTier = tags[0];
  if (tags[1]) el.dataset.dfoT2 = tags[1];
  else delete el.dataset.dfoT2;
  if (cfg?.icons !== false) {
    const kind = ingredientKind(item);
    if (kind) el.dataset.dfoIng = kind;
  }
}

/** The colour keys for a row, strongest first (at most two), so a name can
 *  fade between them (quest + gem, quest + metal, gem + ...). */
export function tierTags(item) {
  if (!item || typeof item !== 'object') return [];
  const tags = [];
  if (isQuest(item)) tags.push(QUEST_SLUG);
  const gem = gemSlug(item);
  if (gem) tags.push(`gem-${gem}`);
  if (!tags.length) {
    const mat = materialSlug(item);
    if (mat) tags.push(mat);
  }
  return tags.slice(0, 2);
}

export function lootTier(item) {
  if (isQuest(item)) return QUEST_SLUG;
  if (!cfg?.labels) return null;
  return materialSlug(item);
}

/** The material word: the metal for weapons/plate, the class for leather and
 *  chain (the same words the plaque prints). */
function materialWord(item) {
  const grade = materialOf(item);
  if (grade != null) return MATERIALS[grade];
  if (item.group === 'Armor') {
    const cls = armorClass(item);
    if (cls === 'Leather' || cls === 'Chain') return cls;
  }
  return null;
}
/** The line under the card's name: `T6 . Elven . Long Blade` for weapons,
 *  `T8 . Mithril . Plate` for armour. Falls back to the game's own meta when
 *  there is nothing to say. */
export function cardLine(item) {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name ?? '');
  /* clothing/jewellery: the card line is the slot itself */
  if (item.group !== 'Weapons' && item.group !== 'Armor') {
    const slot = slotLabel(item);
    return slot && showSlot(name, slot) ? slot : null;
  }
  const parts = [];
  const tier = tierNumber(item);
  if (tier) parts.push(`T${tier}`);
  const mat = materialWord(item);
  if (mat) parts.push(mat);
  const kind = typeOf(item);
  // a leather/chain item's class is the material word already printed
  if (kind && showType(name, kind) && norm(kind) !== norm(mat)) parts.push(kind);
  const slot = armorSlot(item);
  if (slot && showSlot(name, slot)) parts.push(slot);
  const hands = cfg?.hands === false ? null : handsOf(item);
  if (hands) parts.push(`${hands}H`);
  return parts.join(' \u00b7 ') || null;
}

/** Extra rows for the inventory's item card. Weapons and armour carry their
 *  tier/material/type in the line under the name (cardLine), so the stats list
 *  only gains a gem's grade or a plain kind. */
export function itemFacts(item) {
  if (!item || typeof item !== 'object') return [];
  const slug = materialSlug(item);
  const tier = tierNumber(item);
  const mat = materialWord(item);
  const rows = [];

  if (item.group === 'Gems' || slug?.startsWith('gem-')) return rows;

  if (item.group === 'Weapons' || item.group === 'Armor') return rows;
  if (slotLabel(item)) return rows; // the card line already says the slot

  const group = String(item.group ?? '');
  const kind = /Ingredient/i.test(group) ? 'Ingredient'
    : /Clothing/i.test(group) ? 'Clothing'
      : group === 'Books' ? 'Book'
        : group === 'Jewellery' ? 'Jewellery'
          : group === 'MiscItems' ? 'Misc item'
              : null;
  if (kind) rows.push(['Kind', kind, null]);
  return rows;
}

/* ------------------------------------------------------------------ style */
function tierCss() {
  const rules = [`
/* One size, one line per item: the plank is 300px by default and the tier
 * label plus the type overflows it, so rows wrapped - and a width that follows
 * the longest row made the whole panel jump while scrolling. A list plaque now
 * has a fixed width and each row stays on one line (a genuinely longer name
 * ellipsises). (:root beats the game sheet, which can load after this.) */
:root .wplaque { max-width: min(480px, 92vw); }
:root .wplaque.has-list { width: min(480px, 92vw); max-width: none; }
:root .wplaque-row { white-space: nowrap; }
:root .wplaque-row > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* Tall lists: the game hangs the plaque under the crosshair and it grows
 * downward into the hotbar. The script below measures it and lifts it up by
 * --dfo-lift so its bottom stays clear of the HUD band. */
:root .wplaque { transform: translateX(-50%) translateY(calc(-1 * var(--dfo-lift, 0px))); }
.dfo-uitweaks-colours .wplaque-list .wplaque-row[data-tier] > span:first-child { color: var(--dfo-ink, var(--dfo-tier)); }
.dfo-uitweaks-colours .wplaque-list .wplaque-row[data-tier]:not([data-rarity]) > span:first-child::before {
  content: ''; display: inline-block; width: 9px; height: 9px; margin-right: 7px;
  vertical-align: 0; background: var(--dfo-tier);
  box-shadow: 0 0 0 1px #0a0b0d, 1px 2px 0 rgba(0,0,0,0.45);
}
.dfo-uitweaks-colours .wplaque-list .wplaque-row[data-tier].sel > span:first-child { text-shadow: 0 0 8px color-mix(in srgb, var(--dfo-tier) 45%, transparent); }
/* gems carry their colour in the name only - no dot in front of the stone */
:root .wplaque-list .wplaque-row[data-tier^="gem-"] > span:first-child::before { content: none !important; }
/* the card NAME keeps the game's own rarity colour; only the summary line
 * under it takes the material colour */
:root body .card[data-dfo-tier] > p.meta { color: var(--dfo-ink, var(--dfo-tier)) !important; }`];
  for (const scheme of SCHEMES) {
    for (const [slug, c] of Object.entries(PALETTES[scheme])) {
      rules.push(`.dfo-uitweaks-scheme-${scheme} .wplaque-row[data-tier="${slug}"], .dfo-uitweaks-scheme-${scheme} [data-dfo-tier="${slug}"] { --dfo-tier: ${c.hex};${c.ink ? ` --dfo-ink: ${c.ink};` : ''} }`);
      rules.push(`.dfo-uitweaks-scheme-${scheme} [data-dfo-t2="${slug}"] { --dfo-tier2: ${c.hex}; }`);
    }
  }
  /* gems keep their own colour under every palette; the dot carries the grade */
  for (const [slug, hex] of Object.values(GEMS)) {
    rules.push(`.wplaque-row[data-tier="gem-${slug}"], [data-dfo-tier="gem-${slug}"] { --dfo-tier: ${hex}; --dfo-ink: ${hex}; }`);
    rules.push(`[data-dfo-t2="gem-${slug}"] { --dfo-tier2: ${hex}; }`);
  }
  for (const grade of GEM_GRADES) {
    for (const [at, stone] of GEM_STONES.entries()) {
      const hex = GEMS[at][1];
      rules.push(`.wplaque-row[data-tier="gem-${grade}-${stone}"], [data-dfo-tier="gem-${grade}-${stone}"] { --dfo-tier: ${hex}; --dfo-ink: ${hex}; }`);
      rules.push(`[data-dfo-t2="gem-${grade}-${stone}"] { --dfo-tier2: ${hex}; }`);
    }
  }
  /* Ingredient icons, masked so they follow the row colour. */
  rules.push(`
:root.dfo-uitweaks-icons .pack-shell .itemrow[data-dfo-ing] .itemname > span::before {
  content: ''; display: inline-block; width: 11px; height: 11px; margin-right: 6px;
  vertical-align: -1px; background: currentColor;
  -webkit-mask: var(--dfo-icon) center / contain no-repeat; mask: var(--dfo-icon) center / contain no-repeat;
}
${ICON_RULES}`);

  /* Pack and loot-window rows: the same colour key the plaque uses. */
  rules.push(`
:root .pack-shell .itemrow[data-dfo-tier] .itemname > span:first-child { color: var(--dfo-ink, var(--dfo-tier)); }
:root .pack-shell .itemrow[data-dfo-tier] .itemname > small { color: color-mix(in srgb, var(--dfo-ink, var(--dfo-tier)) 60%, #b9b2a1); }
:root.dfo-uitweaks-gradient .pack-shell .itemrow[data-dfo-tier][data-dfo-t2] .itemname > span:first-child,
:root.dfo-uitweaks-gradient .wplaque-row[data-tier][data-dfo-t2] > span:first-child {
  background-image: linear-gradient(90deg, var(--dfo-ink, var(--dfo-tier)) 0%, var(--dfo-tier2, var(--dfo-ink, var(--dfo-tier))) 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}`);
  /* Quest items: one magenta under every palette, on the plaque row and the card.
   * The row keeps its dot (unlike gems), so a quest item reads at a glance. */
  rules.push(`
:root .wplaque-row[data-tier="${QUEST_SLUG}"], :root [data-dfo-tier="${QUEST_SLUG}"] { --dfo-tier: ${QUEST_HEX}; --dfo-ink: ${QUEST_HEX}; }
:root .wplaque-row[data-tier="${QUEST_SLUG}"] > span:first-child { color: ${QUEST_HEX}; }
:root .wplaque-row[data-tier="${QUEST_SLUG}"].sel > span:first-child { text-shadow: 0 0 8px ${QUEST_HEX}; }
/* the card: only the game's own "Quest item" line (below the name) takes the
 * colour; the name and the summary line stay as every other item's */
:root body .card[data-dfo-tier="${QUEST_SLUG}"] .boundline { color: ${QUEST_HEX}; }
:root [data-dfo-t2="${QUEST_SLUG}"] { --dfo-tier2: ${QUEST_HEX}; }`);
  return rules.join('\n');
}
function ensureStyle() {
  if (styleEl) return;
  styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = tierCss();
  document.head.appendChild(styleEl);
}
function applyColours() {
  const root = document.documentElement;
  root.classList.toggle('dfo-uitweaks-colours', !!cfg?.colours);
  root.classList.toggle('dfo-uitweaks-gradient', !!cfg?.gradient);
  root.classList.toggle('dfo-uitweaks-icons', cfg?.icons !== false);
  const want = `dfo-uitweaks-scheme-${cfg?.scheme}`;
  for (const cls of [...root.classList]) {
    if (cls.startsWith('dfo-uitweaks-scheme-') && cls !== want) root.classList.remove(cls);
  }
  if (cfg?.scheme) root.classList.add(want);
}

/* ---------------------------------------------------------------- config */
function buildPane(container) {
  container.textContent = '';
  const labelSpan = (text, minWidth = 110) => {
    const el = document.createElement('span');
    el.style.cssText = `color:var(--dim,#b9b2a1);font-size:12px;min-width:${minWidth}px`;
    el.textContent = text;
    return el;
  };
  const line = (css = '') => {
    const el = document.createElement('label');
    el.style.cssText = `display:flex;align-items:center;gap:8px;line-height:2;margin-top:2px;${css}`;
    return el;
  };
  const check = (label, get, set) => {
    const r = line('cursor:pointer');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = get();
    box.onchange = () => { set(box.checked); };
    const text = document.createElement('span');
    text.textContent = label;
    r.append(box, text);
    container.appendChild(r);
    return r;
  };
  const number = (label, min, max, get, set) => {
    const r = line();
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(get());
    input.style.cssText = 'width:64px;background:var(--slate,#171b21);color:var(--bone,#efe8d6);border:1px solid var(--iron,#2b323b);padding:1px 4px';
    input.onchange = () => {
      const v = Math.max(min, Math.min(max, Math.trunc(Number(input.value) || 0)));
      input.value = String(v);
      set(v);
    };
    r.append(labelSpan(label), input);
    container.appendChild(r);
    return r;
  };
  const textField = (label, placeholder, get, set) => {
    const r = line();
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = get();
    input.style.cssText = 'flex:1;min-width:180px;background:var(--slate,#171b21);color:var(--bone,#efe8d6);border:1px solid var(--iron,#2b323b);padding:1px 4px';
    input.onchange = () => set(input.value);
    r.append(labelSpan(label), input);
    container.appendChild(r);
    return r;
  };
  const heading = (text) => {
    const el = document.createElement('div');
    el.style.cssText = 'margin:12px 0 2px;letter-spacing:.16em;text-transform:uppercase;font-size:12px;color:var(--brass,#c08a3e)';
    el.textContent = text;
    container.appendChild(el);
  };

  const note = document.createElement('div');
  note.style.cssText = 'color:var(--dim,#b9b2a1);font-size:12px;margin:6px 0 2px';
  note.textContent = 'Tiers, types and colours apply to the world plaque, the item card, and pack / loot-window rows. Changes apply the next time a plaque or window refreshes.';
  container.appendChild(note);
  heading('Labels and tags');
  check('Tier labels', () => cfg.labels, (v) => { cfg.labels = v; save(); });

  // the type/slot dropdown: off, hide obvious, all
  const typeLine = line();
  typeLine.appendChild(labelSpan('Type / slot'));
  const typeSelect = document.createElement('select');
  typeSelect.style.cssText = 'background:var(--slate,#171b21);color:var(--bone,#efe8d6);border:1px solid var(--iron,#2b323b);padding:1px 4px';
  for (const [value, label] of [['off', 'Off'], ['obvious', 'Hide obvious'], ['all', 'All']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    typeSelect.appendChild(option);
  }
  typeSelect.value = cfg.typeMode ?? TYPE_MODE_DEFAULT;
  typeSelect.onchange = () => { cfg.typeMode = typeSelect.value; save(); };
  typeLine.appendChild(typeSelect);
  container.appendChild(typeLine);

  check('Weapon hands (1H / 2H)', () => cfg.hands, (v) => { cfg.hands = v; save(); });
  check('Mark quest items (magenta, Quest: name)', () => cfg.quests, (v) => { cfg.quests = v; save(); });
  check('Gradient names when an item has two colours', () => cfg.gradient, (v) => { cfg.gradient = v; save(); applyColours(); });
  check('Ingredient icons', () => cfg.icons, (v) => { cfg.icons = v; save(); });
  heading('Colours');
  check('Colour by material', () => cfg.colours, (v) => { cfg.colours = v; save(); applyColours(); });

  const schemes = [
    ['classic', 'Classic (Daggerfall colours)'],
    ['bright', 'Bright'],
    ['colourblind', 'Colour-blind (blue / orange)'],
    ['contrast', 'High contrast'],
  ];
  const schemeLine = line('flex-wrap:wrap;gap:4px 16px');
  schemeLine.appendChild(labelSpan('Colour scheme'));
  for (const [value, label] of schemes) {
    const l = document.createElement('label');
    l.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'dfo-uitweaks-scheme';
    radio.checked = cfg.scheme === value;
    radio.onchange = () => {
      if (!radio.checked) return;
      cfg.scheme = value;
      save();
      applyColours();
    };
    const pal = PALETTES[value];
    const swatch = document.createElement('span');
    swatch.style.cssText = 'display:inline-block;width:26px;height:10px;border:1px solid var(--iron,#2b323b);background:'
      + `linear-gradient(90deg, ${pal.iron.hex} 0 33%, ${pal.silver.hex} 33% 66%, ${pal.daedric.hex} 66% 100%)`;
    const span = document.createElement('span');
    span.textContent = label;
    l.append(radio, swatch, span);
    schemeLine.appendChild(l);
  }
  container.appendChild(schemeLine);

  heading('List');
  number('List rows', ROWS_MIN, ROWS_MAX, () => clampRows(cfg.rows), (v) => { cfg.rows = v; save(); });

}

/* ------------------------------------------------------- plaque geometry */
/* The plaque hangs below the crosshair and grows downward, so a tall list runs
 * into the hotbar. Measure it and lift it by --dfo-lift until its bottom clears
 * the HUD band (but never so far that its top leaves the screen). */
let plaqueEl = null, plaqueRO = null, liftTimer = null;
const HUD_GUARD = 120;

function plaqueLift() {
  const el = plaqueEl;
  if (!el || !el.isConnected) return;
  if (!el.classList.contains('on')) { el.style.removeProperty('--dfo-lift'); return; }
  const top = el.offsetTop;          // transforms do not move the offset box
  const height = el.offsetHeight;
  const limit = (globalThis.innerHeight || 0) - HUD_GUARD;
  const overflow = top + height - limit;
  const lift = Math.max(0, Math.min(overflow, Math.max(0, top - 8)));
  if (lift > 0) el.style.setProperty('--dfo-lift', `${Math.round(lift)}px`);
  else el.style.removeProperty('--dfo-lift');
}

function watchPlaque() {
  const el = document.querySelector('.wplaque');
  if (el && el !== plaqueEl) {
    plaqueEl = el;
    if (typeof ResizeObserver === 'function') {
      plaqueRO?.disconnect();
      plaqueRO = new ResizeObserver(plaqueLift);
      plaqueRO.observe(el);
    }
  }
  plaqueLift();
}

/* -------------------------------------------------------------- lifecycle */
export function install() {
  cfg ??= load();
  ensureStyle();
  applyColours();
  globalThis.__dfoUiTweaks = { lootLabel, lootTier, lootRows, itemFacts, cardLine, tierOf: materialSlug, isQuest, rowName, tierTags, decorateRow };
  watchPlaque();
  liftTimer ??= setInterval(watchPlaque, 400);
}

export function unmount() {
  if (globalThis.__dfoUiTweaks) delete globalThis.__dfoUiTweaks;
  document.documentElement.classList.remove('dfo-uitweaks-colours');
  document.documentElement.classList.remove('dfo-uitweaks-gradient', 'dfo-uitweaks-icons');
  for (const scheme of SCHEMES) document.documentElement.classList.remove(`dfo-uitweaks-scheme-${scheme}`);
  if (liftTimer) { clearInterval(liftTimer); liftTimer = null; }
  if (plaqueRO) { plaqueRO.disconnect(); plaqueRO = null; }
  if (plaqueEl) { plaqueEl.style.removeProperty('--dfo-lift'); plaqueEl = null; }
  if (styleEl) { styleEl.remove(); styleEl = null; }
}

export function mountPane(container) {
  cfg ??= load();
  buildPane(container);
}
