/*
 * DFO Online - UI Tweaks: item tier labels in the world plaque (loot piles).
 *
 * The game builds the crosshair plaque's item rows in propBodies-*.js; the
 * installer adds one call into that row builder (and one attribute in the
 * plaque renderer) so this module can name and colour each row. Nothing here
 * touches game data: it reads the item object the game already hands over.
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
  bright: {
    leather: { hex: '#b08355' }, chain: { hex: '#aeb4bd' },
    iron: { hex: '#b8b2a4' }, steel: { hex: '#cdd5df' }, silver: { hex: '#eaf0f6' },
    elven: { hex: '#7fd39a' }, dwarven: { hex: '#d1904f' }, mithril: { hex: '#86c6ff' },
    adamantium: { hex: '#a99bff' }, ebony: { hex: '#c07ad8' }, orcish: { hex: '#8fb552' },
    daedric: { hex: '#ff6050' },
  },
};
const SCHEMES = ['classic', 'bright'];

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

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      // pre-1.1 schemes ('metal' / 'full') both become the classic palette
      const scheme = SCHEMES.includes(raw.scheme) ? raw.scheme : 'classic';
      return {
        labels: raw.labels !== false,
        colours: raw.colours !== false,
        scheme,
        rows: clampRows(raw.rows),
      };
    }
  } catch { /* unreadable - defaults */ }
  return { labels: true, colours: true, scheme: 'classic', rows: ROWS_DEFAULT };
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
/** The colour key for a row: a gem's own colour, or the material slug, or
 *  null when the item is not graded. */
function materialSlug(item) {
  if (!item) return null;
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
function typeOf(item) {
  if (!item) return null;
  if (item.group === 'Armor') return armorClass(item);
  if (item.group !== 'Weapons') return null;
  const byIndex = WEAPON_BY_INDEX[Number(item.templateIndex)];
  if (byIndex) return byIndex;
  return WEAPON_TYPES[norm(item.name)] ?? null;
}

/** The plaque row label. The installer calls this with the raw item and the
 *  game's own computed name (so quality words and epithets survive). */
export function lootLabel(item, gameName = null) {
  if (!cfg?.labels || !item || typeof item !== 'object') return null;
  let name = String(gameName || item.name || 'Item').trim() || 'Item';
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
  // Leather Cuirass / Chain Greaves already carry their class; don't repeat it.
  if (type && !norm(name).includes(norm(type))) parts.push(type);
  return parts.join(' \u00b7 ');
}

export function lootTier(item) {
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
function gemGrade(slug) {
  const parts = String(slug).split('-');
  const grade = parts.length === 3 ? parts[1] : 'plain';
  return { plain: 'Plain', chipped: 'Chipped', flawed: 'Flawed', flawless: 'Flawless', perfect: 'Perfect' }[grade] ?? null;
}

/** The line under the card's name: `T6 . Elven . Long Blade` for weapons,
 *  `T8 . Mithril . Plate` for armour. Falls back to the game's own meta when
 *  there is nothing to say. */
export function cardLine(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.group !== 'Weapons' && item.group !== 'Armor') return null;
  const parts = [];
  const tier = tierNumber(item);
  if (tier) parts.push(`T${tier}`);
  const mat = materialWord(item);
  if (mat) parts.push(mat);
  const kind = typeOf(item);
  if (kind) parts.push(kind);
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

  if (slug && slug.startsWith('gem-')) {
    const word = gemGrade(slug);
    if (word) rows.push(['Gem', word, slug]);
    return rows;
  }

  if (item.group === 'Weapons' || item.group === 'Armor') return rows;

  const group = String(item.group ?? '');
  const kind = /Ingredient/i.test(group) ? 'Ingredient'
    : /Clothing/i.test(group) ? 'Clothing'
      : group === 'Books' ? 'Book'
        : group === 'Jewellery' ? 'Jewellery'
          : group === 'Gems' ? 'Gem'
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
/* the inventory card wears the same material colour as the plaque; the game
 * colours the name by RARITY (aetheric blue, etc.), so override it */
:root body .card[data-dfo-tier] > h3 { color: var(--dfo-ink, var(--dfo-tier)) !important; text-shadow: 1px 1px 0 #050608 !important; }
:root body .card .pair[data-dfo-tier] > dd { color: var(--dfo-ink, var(--dfo-tier)) !important; font-weight: 600; }
:root body .card[data-dfo-tier] > p.meta { color: var(--dfo-ink, var(--dfo-tier)) !important; }`];
  for (const scheme of SCHEMES) {
    for (const [slug, c] of Object.entries(PALETTES[scheme])) {
      rules.push(`.dfo-uitweaks-scheme-${scheme} .wplaque-row[data-tier="${slug}"], .dfo-uitweaks-scheme-${scheme} [data-dfo-tier="${slug}"] { --dfo-tier: ${c.hex};${c.ink ? ` --dfo-ink: ${c.ink};` : ''} }`);
    }
  }
  /* gems keep their own colour under every palette; the dot carries the grade */
  for (const [slug, hex] of Object.values(GEMS)) {
    rules.push(`.wplaque-row[data-tier="gem-${slug}"], [data-dfo-tier="gem-${slug}"] { --dfo-tier: ${hex}; --dfo-ink: ${hex}; }`);
  }
  for (const grade of GEM_GRADES) {
    for (const [at, stone] of GEM_STONES.entries()) {
      const hex = GEMS[at][1];
      rules.push(`.wplaque-row[data-tier="gem-${grade}-${stone}"], [data-dfo-tier="gem-${grade}-${stone}"] { --dfo-tier: ${hex}; --dfo-ink: ${hex}; }`);
    }
  }
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
  note.textContent = 'Loot piles (and any other world plaque) print a tier by material, with the weapon skill or armor class after the name. The list length applies the next time the plaque refreshes (look away and back).';
  container.appendChild(note);
  check('Tier labels', () => cfg.labels, (v) => { cfg.labels = v; save(); });
  check('Colour by material', () => cfg.colours, (v) => { cfg.colours = v; save(); applyColours(); });

  const schemes = [
    ['classic', 'Classic (Daggerfall colours)'],
    ['bright', 'Bright'],
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
    const span = document.createElement('span');
    span.textContent = label;
    l.append(radio, span);
    schemeLine.appendChild(l);
  }
  container.appendChild(schemeLine);

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
  globalThis.__dfoUiTweaks = { lootLabel, lootTier, lootRows, itemFacts, cardLine, tierOf: materialSlug };
  watchPlaque();
  liftTimer ??= setInterval(watchPlaque, 400);
}

export function unmount() {
  if (globalThis.__dfoUiTweaks) delete globalThis.__dfoUiTweaks;
  document.documentElement.classList.remove('dfo-uitweaks-colours');
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
