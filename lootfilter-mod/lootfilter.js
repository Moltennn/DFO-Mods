/*
 * DFO Online - Loot Filter: player-defined rules for the world plaque.
 *
 * The game builds the crosshair plaque's item rows in propBodies-*.js. The row
 * builder asks `__dfoRowFilter.keep(item)` (the hook line is shared with UI
 * Tweaks; either installer guarantees it), the plaque model guard removes a
 * pile whose rows are all gone, and this module also sleeps fully hidden
 * ground piles and corpses so their sprites disappear.
 *
 * Rules are checked top to bottom; the first rule whose conditions all match
 * decides (Show keeps the item, Hide drops it). An item no rule matches is shown.
 *
 * The filter is display-first: it never deletes items. A hidden pile or corpse
 * is only taken out of the plaque/targets (inactive / corpseDisabled), so it
 * cannot be grabbed while hidden - clear the rule and it is back intact.
 * Quest items are never hidden.
 */
'use strict';

export const MOD_BUILD = '@BUILD@';

const STORE_KEY = 'dfoLootFilter.config.v2';
const OLD_STORE_KEY = 'dfoLootFilter.config.v1';
const MAX_RULES = 20;

const FILTER_TYPES = ['weapons', 'armor', 'gems', 'clothing', 'ingredients', 'misc', 'books', 'religious', 'ammo'];
const RARITY_RANK = { common: 0, magic: 1, rare: 2, legendary: 3, artifact: 4, aetheric: 5, gilded: 5 };
const RARITY_NAMES = ['Common', 'Magic', 'Rare', 'Legendary', 'Artifact'];

/* Ammo and the Daggerfall material order (Leather 1, Chain 2, Iron 3 ...
 * Daedric 12) — the same scale the tier labels use. */
const AMMO = /(?:^|\s)(pellets?|arrows?|bolts?)$/i;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.trunc(Number(n) || 0)));
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* Weapon hands, from the game's own table (equipRules `Xe`; UI Tweaks has the
 * same one). Unknown templates fall back to the name. */
const WEAPON_HANDS = {
  113: 1, 114: 1, 116: 1, 117: 1, 118: 1, 119: 1, 120: 1, 121: 1, 124: 1, 127: 1,
  115: 2, 122: 2, 123: 2, 125: 2, 126: 2, 128: 2, 129: 2, 130: 2,
  560: 2, 562: 1, 563: 1,
};
const TWO_HAND_WORDS = ['staff', 'claymore', 'dai katana', 'dai-katana', 'warhammer', 'war hammer', 'flail', 'war axe', 'short bow', 'shortbow', 'long bow', 'longbow', 'bow'];
const ONE_HAND_WORDS = ['dagger', 'tanto', 'shortsword', 'short sword', 'wakazashi', 'broadsword', 'broad sword', 'saber', 'sabre', 'longsword', 'long sword', 'katana', 'mace', 'battle axe', 'axe'];

/* Armour slot by template (equipRules Armor group). */
const ARMOR_SLOTS = {
  102: 'chest', 103: 'hands', 104: 'legs', 105: 'arms', 106: 'arms', 107: 'head', 108: 'feet',
  109: 'shield', 110: 'shield', 111: 'shield', 112: 'shield',
};

const label = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const SLOT_VALUES = [['chest', 'Chest'], ['hands', 'Hands'], ['legs', 'Legs'], ['arms', 'Arms'], ['head', 'Head'], ['feet', 'Feet'], ['shield', 'Shield']];
const NUM_OPS = ['=', '!=', '<', '<=', '>', '>='];

/* Every condition a rule can use. `kind` picks the value control and the
 * comparison; `ops` is what the user may choose from. */
const FIELDS = {
  type: { label: 'Type', ops: ['=', '!='], kind: 'enum', values: FILTER_TYPES.map((t) => [t, label(t)]) },
  rarity: { label: 'Rarity', ops: NUM_OPS, kind: 'num', min: 0, max: 4, names: RARITY_NAMES },
  tier: { label: 'Tier', ops: NUM_OPS, kind: 'num', min: 1, max: 12 },
  stack: { label: 'Stack size', ops: NUM_OPS, kind: 'num', min: 1, max: 9999 },
  value: { label: 'Value', ops: NUM_OPS, kind: 'num', min: 0, max: 1000000, unit: ' gold' },
  name: { label: 'Name', ops: ['contains'], kind: 'text' },
  enchanted: { label: 'Enchanted', ops: ['='], kind: 'bool' },
  artifact: { label: 'Artifact', ops: ['='], kind: 'bool' },
  hands: { label: 'Hands', ops: ['=', '!='], kind: 'enum', values: [[1, 'One-handed'], [2, 'Two-handed']] },
  slot: { label: 'Armour slot', ops: ['=', '!='], kind: 'enum', values: SLOT_VALUES },
};

const GUIDE = [
  'How it works',
  'Rules are read top to bottom. The first rule that matches decides.',
  'Show keeps the item, even if a rule further down would hide it.',
  'Hide removes it from the loot list and the ground pile. Take all still takes everything.',
  'Items that match no rule are shown. A rule with no conditions matches everything.',
  'Within a rule, every condition must match. An item with no tier, hand count or armour slot never matches a condition on it.',
  'Quest items are never hidden. Hold the reveal key to see everything.',
  'Changes apply the next time the plaque refreshes (look away and back).',
];

let cfg = null;
/* Held reveal key: while it is down the filter is bypassed (every row shows
 * and sleeping piles/corpses are woken). Bound in install(). */
let revealed = false;
let keyCapture = false;
let keyBound = false;

function prettyKey(key) {
  if (!key || key === 'none') return 'None';
  if (key === ' ') return 'Space';
  if (key === 'Control') return 'Ctrl';
  return String(key).length === 1 ? String(key).toUpperCase() : String(key);
}
function revealMatches(ev) {
  const want = String(cfg?.revealKey ?? 'Alt');
  if (!want || want.toLowerCase() === 'none') return false;
  return ev.key === want || String(ev.key).toLowerCase() === want.toLowerCase();
}
function onRevealDown(ev) {
  if (keyCapture || ev.repeat || !revealMatches(ev)) return;
  if (!revealed) { revealed = true; syncPiles(); }
}
function onRevealUp(ev) {
  if (keyCapture || !revealMatches(ev)) return;
  if (revealed) { revealed = false; syncPiles(); }
}
function onRevealBlur() {
  if (!revealed) return;
  revealed = false;
  syncPiles();
}
function bindReveal() {
  if (keyBound || typeof window === 'undefined') return;
  window.addEventListener('keydown', onRevealDown, true);
  window.addEventListener('keyup', onRevealUp, true);
  window.addEventListener('blur', onRevealBlur);
  keyBound = true;
}
function unbindReveal() {
  if (!keyBound || typeof window === 'undefined') return;
  window.removeEventListener('keydown', onRevealDown, true);
  window.removeEventListener('keyup', onRevealUp, true);
  window.removeEventListener('blur', onRevealBlur);
  keyBound = false;
}

function defaults() {
  return { on: false, revealKey: 'Alt', rules: [] };
}

/* One condition, checked against the field's own rules. Returns null when the
 * saved value is unusable, so a bad entry is dropped instead of breaking the list. */
function cleanCond(raw) {
  const def = raw && typeof raw === 'object' ? FIELDS[raw.f] : null;
  if (!def) return null;
  const op = def.ops.includes(raw.op) ? raw.op : def.ops[0];
  let v = null;
  if (def.kind === 'text') {
    v = String(raw.v ?? '').trim();
    if (!v) return null;
  } else if (def.kind === 'bool') {
    v = raw.v === true;
  } else if (def.kind === 'num') {
    v = Math.trunc(Number(raw.v));
    if (!Number.isFinite(v)) return null;
    v = clamp(v, def.min, def.max);
  } else {
    const hit = def.values.find(([val]) => val === raw.v);
    if (!hit) return null;
    v = hit[0];
  }
  return { f: raw.f, op, v };
}
function cleanRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const when = [];
  const seen = new Set();
  for (const r of Array.isArray(raw.when) ? raw.when : []) {
    const c = cleanCond(r);
    if (c && !seen.has(c.f)) { seen.add(c.f); when.push(c); }
  }
  return { action: raw.action === 'show' ? 'show' : 'hide', when };
}

/* The old switches become rules, in the old precedence: keep names first, then
 * the hide rules. Each hide-name term is its own rule. */
function fromV1(old) {
  const rules = [];
  const terms = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const t of terms(old.keepNames)) rules.push({ action: 'show', when: [{ f: 'name', op: 'contains', v: t }] });
  for (const t of terms(old.hideNames)) rules.push({ action: 'hide', when: [{ f: 'name', op: 'contains', v: t }] });
  for (const key of FILTER_TYPES) {
    if (old.hide?.[key] === true) rules.push({ action: 'hide', when: [{ f: 'type', op: '=', v: key }] });
  }
  if (old.hideCommon === true) rules.push({ action: 'hide', when: [{ f: 'rarity', op: '=', v: 0 }] });
  const commonTier = clamp(old.commonTier, 0, 12);
  if (commonTier > 0) rules.push({ action: 'hide', when: [{ f: 'rarity', op: '=', v: 0 }, { f: 'tier', op: '<', v: commonTier }] });
  const anyTier = clamp(old.anyTier, 0, 12);
  if (anyTier > 0) rules.push({ action: 'hide', when: [{ f: 'tier', op: '<', v: anyTier }] });
  const minRarity = clamp(old.minRarity, 0, 5);
  if (minRarity > 0) rules.push({ action: 'hide', when: [{ f: 'rarity', op: '<', v: minRarity }] });
  const minValue = clamp(old.minValue, 0, 1000000);
  if (minValue > 0) rules.push({ action: 'hide', when: [{ f: 'value', op: '<', v: minValue }] });
  return {
    on: old.on === true,
    revealKey: typeof old.revealKey === 'string' && old.revealKey ? old.revealKey : 'Alt',
    rules: rules.map(cleanRule).filter(Boolean),
  };
}

function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { /* unreadable */ }
  if (raw && typeof raw === 'object') {
    const out = defaults();
    out.on = raw.on === true;
    out.revealKey = typeof raw.revealKey === 'string' && raw.revealKey ? raw.revealKey : 'Alt';
    out.rules = Array.isArray(raw.rules) ? raw.rules.map(cleanRule).filter(Boolean) : [];
    return out;
  }
  let old = null;
  try { old = JSON.parse(localStorage.getItem(OLD_STORE_KEY) || 'null'); } catch { /* unreadable */ }
  if (old && typeof old === 'object') {
    const migrated = fromV1(old);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(migrated)); } catch { /* private mode */ }
    return migrated;
  }
  return defaults();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
}

/** Which of the filter's type switches this item answers to. */
function categoryOf(item) {
  if (!item) return 'misc';
  if (AMMO.test(String(item.name ?? ''))) return 'ammo';
  const group = String(item.group ?? '');
  if (group === 'Gems') return 'gems';
  if (/Clothing/i.test(group)) return 'clothing';
  if (/Ingredient/i.test(group)) return 'ingredients';
  if (group === 'Weapons') return 'weapons';
  if (group === 'Armor') return 'armor';
  if (group === 'Books') return 'books';
  if (group === 'ReligiousItems') return 'religious';
  return 'misc';
}

/** The item's tier in the Daggerfall material order, or null when it has
 *  no metal grade (gems, ingredients, misc). */
function tierOf(item) {
  if (!item) return null;
  const m = Number(item.material);
  if (!Number.isInteger(m) || m < 0) return null;
  const group = String(item.group ?? '');
  if (group === 'Weapons') return m < 10 ? m + 3 : null;
  if (group === 'Armor') {
    const cls = m >> 8;
    if (cls === 0) return 1; // Leather
    if (cls === 1) return 2; // Chain
    const grade = m & 255;
    return grade < 10 ? grade + 3 : null;
  }
  return null;
}

/** The game's rarity word for an item (common when it has none). */
function rarityWord(item) {
  if (!item) return 'common';
  if (item.artifact) return 'artifact';
  if (typeof item.rarity === 'string' && RARITY_RANK[item.rarity] != null) return item.rarity;
  if (item.aetheric) return 'aetheric';
  if (item.gilded) return 'gilded';
  if (item.magic || item.enchantmentPoints > 0 || item.enchant) return 'magic';
  return 'common';
}

/* Any magic-or-better rarity counts. In game, a magic item can carry only its
 * rarity word (rarity: 'magic', magic: false), so the flags alone miss it. */
function isEnchanted(item) {
  return (RARITY_RANK[rarityWord(item)] ?? 0) > 0;
}

/* Whole-word (and simple-plural) match on the normalized name. */
function hasWord(name, word) {
  const padded = ` ${norm(name)} `;
  return padded.includes(` ${word} `) || padded.includes(` ${word}s `)
    || (word.endsWith('s') && padded.includes(` ${word.slice(0, -1)} `));
}

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

/* Armour templates outside 102-112 (Hauberk 515, Fur Helmet 522, ...) fall back
 * to the name, the same way weapons do. */
const SLOT_WORDS = [
  ['head', ['helm', 'helmet', 'cap', 'coif', 'hood', 'visor']],
  ['hands', ['gauntlet', 'gauntlets', 'glove', 'gloves']],
  ['arms', ['spaulder', 'spaulders', 'pauldron', 'pauldrons', 'vambrace', 'vambraces', 'rerebrace']],
  ['legs', ['greaves', 'chausses', 'cuisse', 'cuisses', 'leggings', 'hose']],
  ['feet', ['boots', 'boot', 'sabaton', 'sabatons', 'shoes']],
  ['shield', ['shield', 'buckler', 'kite', 'tower']],
  ['chest', ['cuirass', 'hauberk', 'breastplate', 'jerkin', 'brigandine', 'corselet', 'mail']],
];

/** Armour's slot key, or null for anything that is not a known armour piece. */
function slotOf(item) {
  if (!item || item.group !== 'Armor') return null;
  const byIndex = ARMOR_SLOTS[Number(item.templateIndex)];
  if (byIndex) return byIndex;
  return SLOT_WORDS.find(([, words]) => words.some((w) => hasWord(item.name, w)))?.[0] ?? null;
}

/** The value a condition compares against, or null when the item has none. */
function fieldValue(f, item) {
  switch (f) {
    case 'type': return categoryOf(item);
    case 'rarity': return RARITY_RANK[rarityWord(item)] ?? 0;
    case 'tier': return tierOf(item);
    case 'stack': return Math.max(1, Math.trunc(Number(item.stackCount)) || 1);
    case 'value': return Number(item.value) || 0;
    case 'name': return item.name ? String(item.name) : null;
    case 'enchanted': return isEnchanted(item);
    case 'artifact': return !!item.artifact;
    case 'hands': return handsOf(item);
    case 'slot': return slotOf(item);
  }
  return null;
}

function compare(a, op, b) {
  switch (op) {
    case '=': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
  }
  return false;
}

function condHolds(c, item) {
  const def = FIELDS[c.f];
  const have = fieldValue(c.f, item);
  if (have == null) return false;
  if (def.kind === 'text') {
    const term = norm(c.v);
    return !!term && norm(have).includes(term);
  }
  if (def.kind === 'bool') return have === c.v;
  return compare(have, c.op, c.v);
}

/** A rule with no conditions matches every item. */
function ruleHolds(rule, item) {
  return rule.when.every((c) => condHolds(c, item));
}

/** The plaque row filter. Called by the game's row builder for every item. */
export function keep(item) {
  if (revealed) return true; // the reveal key is held: show everything
  if (!cfg?.on || !item || typeof item !== 'object') return true;
  if (item.questItem) return true; // quest items are never junk
  for (const rule of cfg.rules) {
    if (ruleHolds(rule, item)) return rule.action !== 'hide';
  }
  return true;
}

/** The item behind the selected plaque row. The game's quick-loot took
 *  `items[selectedRow]` from the unfiltered array; once rows are filtered that
 *  index lands on a different, hidden item. Newer builds keep the selected
 *  row's item on the quick-loot state as `dfoItem` (the installer adds it);
 *  older builds hand the plaque state itself, whose rows carry `item`. */
export function pick(state) {
  if (!state) return null;
  if (state.dfoItem) return state.dfoItem;
  const row = state.rows?.[state.row];
  return row && row.item ? row.item : null;
}

/* ------------------------------------------------------------ pile sprites */
/* The dropped-loot manager (exposed as __dfoPiles by the installer) draws the
 * 3-D pile of items on the ground. A pile whose items are all filtered is put
 * to sleep (`inactive`), which the manager skips when it frames the piles, and
 * woken again when the filter lets something through. The items themselves are
 * untouched. */
let pileTimer = null;
const hiddenByUs = new WeakSet();

/* Corpses are dead foes; their loot target and hover name hang off
 * `corpseDisabled`, so a fully filtered body stops being offered (the item
 * model then hides its plaque as usual). */
function syncCorpses() {
  const foes = globalThis.__dfoFoes?.foes;
  if (!Array.isArray(foes)) return;
  for (const foe of foes) {
    if (!foe || !foe.dead || !foe.corpse) continue;
    const hide = hideCorpse(foe);
    if (hide && !foe.corpseDisabled) { foe.corpseDisabled = true; foe._dfoHidden = true; }
    else if (!hide && foe._dfoHidden) { foe.corpseDisabled = false; foe._dfoHidden = false; }
  }
}

function syncPiles() {
  syncCorpses();
  const piles = globalThis.__dfoPiles?._piles;
  if (!Array.isArray(piles)) return;
  for (const pile of piles) {
    if (!pile || pile.dead) continue;
    const items = pile.items;
    if (!Array.isArray(items) || !items.length) continue;
    const hide = hideItems(items);
    if (hide && !pile.inactive) {
      pile.inactive = true;
      hiddenByUs.add(pile);
    } else if (!hide && pile.inactive) {
      /* wake anything the filter put to sleep (or a save left asleep) */
      pile.inactive = false;
      hiddenByUs.delete(pile);
    }
  }
}

/** Nothing on the body would be shown: it is empty, or every item is filtered. */
function hideItems(items) {
  if (!cfg?.on || revealed) return false;
  if (!Array.isArray(items) || items.length === 0) return true;
  return items.every((item) => !keep(item));
}
/** The renderer asks this before standing a dead foe's body (and its sprite). */
export function hideCorpse(foe) {
  if (!cfg?.on || revealed || !foe?.dead) return false;
  return hideItems(foe.entity?.items);
}

/* ---------------------------------------------------------------- config */
let paneRoot = null;

const CONTROL_CSS = 'background:var(--slate,#171b21);color:var(--bone,#efe8d6);border:1px solid var(--iron,#2b323b);padding:1px 4px';
const BUTTON_CSS = 'cursor:pointer;background:var(--slate,#171b21);color:var(--bone,#efe8d6);border:1px solid var(--iron,#2b323b);padding:2px 8px';

function el(tag, css = '', text = '') {
  const node = document.createElement(tag);
  if (css) node.style.cssText = css;
  if (text) node.textContent = text;
  return node;
}
function select(options, value, onChange) {
  const s = el('select', CONTROL_CSS);
  for (const [val, text] of options) {
    const opt = el('option', '', text);
    opt.value = String(val);
    s.appendChild(opt);
  }
  s.value = String(value);
  s.onchange = () => onChange(s.value);
  return s;
}
function button(text, title, onClick, disabled = false) {
  const b = el('button', BUTTON_CSS, text);
  b.type = 'button';
  b.title = title;
  b.disabled = disabled;
  b.onclick = onClick;
  return b;
}

function opText(op) {
  return ({ '!=': '≠', '<=': '≤', '>=': '≥' })[op] ?? op;
}
function valueText(def, v) {
  if (def.kind === 'bool') return v ? 'yes' : 'no';
  if (def.names) return def.names[v] ?? String(v);
  if (def.kind === 'enum') return def.values.find(([x]) => x === v)?.[1] ?? String(v);
  return `${v}${def.unit ?? ''}`;
}
function condText(c) {
  const def = FIELDS[c.f];
  if (def.kind === 'text') return `${def.label} contains "${c.v}"`;
  return `${def.label} ${opText(c.op)} ${valueText(def, c.v)}`;
}
/** The plain-English line shown for a rule in the pane. */
function ruleText(rule) {
  const verb = rule.action === 'show' ? 'Show' : 'Hide';
  if (!rule.when.length) return `${verb} everything`;
  return `${verb} when ${rule.when.map(condText).join(' and ')}`;
}

function defaultValue(def) {
  if (def.kind === 'bool') return true;
  if (def.kind === 'text') return '';
  if (def.kind === 'enum') return def.values[0][0];
  return def.min;
}
function newCond(f) {
  const def = FIELDS[f];
  return { f, op: def.ops[0], v: defaultValue(def) };
}

function swap(list, a, b) {
  if (b < 0 || b >= list.length) return;
  [list[a], list[b]] = [list[b], list[a]];
}

function valueControl(def, c, changed) {
  if (def.kind === 'bool') {
    return select([['yes', 'yes'], ['no', 'no']], c.v ? 'yes' : 'no', (v) => { c.v = v === 'yes'; changed(); });
  }
  if (def.kind === 'text') {
    const input = el('input', `${CONTROL_CSS};flex:1;min-width:140px`);
    input.type = 'text';
    input.placeholder = 'e.g. ruby';
    input.value = c.v;
    input.onchange = () => { c.v = input.value.trim(); changed(); };
    return input;
  }
  if (def.kind === 'enum') {
    const at = def.values.findIndex(([v]) => v === c.v);
    return select(def.values.map(([, text], i) => [i, text]), at, (i) => { c.v = def.values[Number(i)][0]; changed(); });
  }
  if (def.names) {
    return select(def.names.map((text, i) => [i, text]), c.v, (i) => { c.v = Number(i); changed(); });
  }
  const input = el('input', `${CONTROL_CSS};width:86px`);
  input.type = 'number';
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = '1';
  input.value = String(c.v);
  input.onchange = () => {
    const v = clamp(input.value, def.min, def.max);
    input.value = String(v);
    c.v = v;
    changed();
  };
  return input;
}

function condLine(rule, c, j, refresh) {
  const def = FIELDS[c.f];
  const row = el('div', 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:3px 0 0 18px');
  const used = new Set(rule.when.filter((x) => x !== c).map((x) => x.f));
  const fields = Object.keys(FIELDS).filter((k) => k === c.f || !used.has(k)).map((k) => [k, FIELDS[k].label]);
  row.appendChild(select(fields, c.f, (v) => {
    Object.assign(c, newCond(v));
    save();
    buildPane(paneRoot);
  }));
  if (def.ops.length > 1) {
    row.appendChild(select(def.ops.map((o) => [o, opText(o)]), c.op, (v) => { c.op = v; save(); refresh(); }));
  } else {
    row.appendChild(el('span', 'font-size:13px', opText(c.op)));
  }
  row.appendChild(valueControl(def, c, () => { save(); refresh(); }));
  row.appendChild(button('✕', 'Remove this condition', () => {
    rule.when.splice(j, 1);
    save();
    buildPane(paneRoot);
  }));
  return row;
}

function ruleBox(f, rule, i) {
  const box = el('div', 'border:1px solid var(--iron,#2b323b);padding:4px 6px;margin:4px 0');
  const head = el('div', 'display:flex;align-items:center;gap:6px;flex-wrap:wrap');
  head.appendChild(el('span', 'color:var(--dim,#b9b2a1);font-size:12px', `${i + 1}.`));
  head.appendChild(select([['hide', 'Hide'], ['show', 'Show']], rule.action, (v) => {
    rule.action = v;
    save();
    summary.textContent = ruleText(rule);
  }));
  const summary = el('span', 'flex:1;min-width:160px;font-size:13px', ruleText(rule));
  head.appendChild(summary);
  head.append(
    button('↑', 'Move up', () => { swap(f.rules, i, i - 1); save(); buildPane(paneRoot); }, i === 0),
    button('↓', 'Move down', () => { swap(f.rules, i, i + 1); save(); buildPane(paneRoot); }, i === f.rules.length - 1),
    button('✕', 'Delete this rule', () => { f.rules.splice(i, 1); save(); buildPane(paneRoot); }),
  );
  box.appendChild(head);

  const refresh = () => { summary.textContent = ruleText(rule); };
  rule.when.forEach((c, j) => box.appendChild(condLine(rule, c, j, refresh)));

  const used = new Set(rule.when.map((c) => c.f));
  const open = Object.keys(FIELDS).filter((k) => !used.has(k)).map((k) => [k, FIELDS[k].label]);
  if (open.length) {
    const addRow = el('div', 'margin:3px 0 0 18px');
    addRow.appendChild(select([['', '+ Add condition'], ...open], '', (v) => {
      if (!v) return;
      rule.when.push(newCond(v));
      save();
      buildPane(paneRoot);
    }));
    box.appendChild(addRow);
  }
  return box;
}

function buildPane(container) {
  paneRoot = container;
  container.textContent = '';
  const f = cfg ?? (cfg = load());

  const [guideTitle, ...guideLines] = GUIDE;
  const guide = el('div', 'color:var(--dim,#b9b2a1);font-size:12px;margin:2px 0 8px;line-height:1.5');
  guide.appendChild(el('div', 'color:var(--bone,#efe8d6);font-weight:600', guideTitle));
  for (const text of guideLines) guide.appendChild(el('div', '', `• ${text}`));
  container.appendChild(guide);

  const line = (css = '') => el('label', `display:flex;align-items:center;gap:8px;line-height:2;margin-top:2px;${css}`);
  const labelSpan = (text) => el('span', 'color:var(--dim,#b9b2a1);font-size:12px;min-width:150px', text);

  const enable = line('cursor:pointer');
  const enableBox = el('input');
  enableBox.type = 'checkbox';
  enableBox.checked = f.on;
  enableBox.onchange = () => { f.on = enableBox.checked; save(); };
  enable.append(enableBox, el('span', '', 'Enable loot filter'));
  container.appendChild(enable);

  // held reveal key: every row shows while it is down (Alt by default)
  const keyLine = line();
  keyLine.appendChild(labelSpan('Show all while holding'));
  const keyBtn = el('button', `${BUTTON_CSS};min-width:70px`, prettyKey(f.revealKey));
  keyBtn.type = 'button';
  keyBtn.onclick = () => {
    keyCapture = true;
    keyBtn.textContent = 'Press a key…';
    const done = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      window.removeEventListener('keydown', done, true);
      keyCapture = false;
      if (ev.key === 'Escape') { /* cancel */ }
      else if (ev.key === 'Backspace' || ev.key === 'Delete') f.revealKey = 'none';
      else f.revealKey = ev.key;
      save();
      keyBtn.textContent = prettyKey(f.revealKey);
      if (revealed) { revealed = false; syncPiles(); }
    };
    window.addEventListener('keydown', done, true);
  };
  keyLine.appendChild(keyBtn);
  keyLine.appendChild(el('span', 'color:var(--dim,#b9b2a1);font-size:11px', '(hold in game; Backspace = none)'));
  container.appendChild(keyLine);

  container.appendChild(el('div', 'margin-top:10px;color:var(--bone,#efe8d6);font-weight:600', `Rules (${f.rules.length}/${MAX_RULES})`));
  f.rules.forEach((rule, i) => container.appendChild(ruleBox(f, rule, i)));

  container.appendChild(button('+ Add rule', 'Add a rule at the bottom of the list', () => {
    f.rules.push({ action: 'hide', when: [] });
    save();
    buildPane(paneRoot);
  }, f.rules.length >= MAX_RULES));

  const reset = button('Reset loot filter', 'Clears every rule and the settings above', () => {
    cfg = defaults();
    save();
    buildPane(container);
  });
  reset.style.marginTop = '8px';
  container.appendChild(reset);
}

/* -------------------------------------------------------------- lifecycle */
export function install() {
  cfg ??= load();
  globalThis.__dfoRowFilter = { keep, hideCorpse, pick };
  bindReveal();
  syncPiles();
  pileTimer ??= setInterval(syncPiles, 700);
}

export function unmount() {
  if (globalThis.__dfoRowFilter?.keep === keep) delete globalThis.__dfoRowFilter;
  if (pileTimer) { clearInterval(pileTimer); pileTimer = null; }
  unbindReveal();
  revealed = false;
  const piles = globalThis.__dfoPiles?._piles;
  if (Array.isArray(piles)) {
    for (const pile of piles) if (pile && hiddenByUs.has(pile)) { pile.inactive = false; hiddenByUs.delete(pile); }
  }
  for (const foe of globalThis.__dfoFoes?.foes ?? []) {
    if (foe?._dfoHidden) { foe._dfoHidden = false; foe.corpseDisabled = false; }
  }
}

export function mountPane(container) {
  cfg ??= load();
  buildPane(container);
}
