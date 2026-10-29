/*
 * DFO Online - Loot Filter: player-defined junk for the world plaque.
 *
 * The game builds the crosshair plaque's item rows in propBodies-*.js. The
 * row builder calls `globalThis.__dfoRowFilter.keep(item)` for every item in a
 * pile (UI Tweaks installs that one hook line; either installer guarantees it),
 * so this mod owns the rules and the settings, and nothing else.
 *
 * Display-only: the row never reaches the plaque, but Take all and the
 * container window still see every item. Quest items are never hidden.
 */
'use strict';

export const MOD_BUILD = '@BUILD@';

const STORE_KEY = 'dfoLootFilter.config.v1';

const FILTER_TYPES = ['weapons', 'armor', 'gems', 'clothing', 'ingredients', 'misc', 'books', 'ammo'];
const RARITY_RANK = { common: 0, magic: 1, rare: 2, legendary: 3, artifact: 4, aetheric: 5, gilded: 5 };

/* Ammo and the Daggerfall material order (Leather 1, Chain 2, Iron 3 ...
 * Daedric 12) — the same scale the tier labels use. */
const AMMO = /(?:^|\s)(pellets?|arrows?|bolts?)$/i;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.trunc(Number(n) || 0)));
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

let cfg = null;

function defaults() {
  return {
    on: false,
    hide: Object.fromEntries(FILTER_TYPES.map((k) => [k, false])),
    hideCommon: false,
    commonTier: 0,
    anyTier: 0,
    minRarity: 0,
    minValue: 0,
    hideNames: '',
    keepNames: '',
  };
}
function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { /* unreadable */ }
  const f = raw && typeof raw === 'object' ? raw : {};
  const out = defaults();
  out.on = f.on === true;
  for (const key of FILTER_TYPES) out.hide[key] = f.hide?.[key] === true;
  out.hideCommon = f.hideCommon === true;
  out.commonTier = clamp(f.commonTier, 0, 12);
  out.anyTier = clamp(f.anyTier, 0, 12);
  out.minRarity = clamp(f.minRarity, 0, 5);
  out.minValue = clamp(f.minValue, 0, 1000000);
  out.hideNames = String(f.hideNames ?? '');
  out.keepNames = String(f.keepNames ?? '');
  return out;
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
}

function parseList(text) {
  return String(text ?? '').split(',').map((s) => norm(s)).filter(Boolean);
}
function listHas(list, name) {
  for (const term of parseList(list)) if (name.includes(term)) return true;
  return false;
}

/** Which of the pane's type switches this item answers to. */
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

/** The plaque row filter. Called by the game's row builder for every item. */
export function keep(item) {
  if (!cfg?.on || !item || typeof item !== 'object') return true;
  if (item.questItem) return true; // quest items are never junk

  const name = norm(item.name);
  if (listHas(cfg.keepNames, name)) return true;
  if (listHas(cfg.hideNames, name)) return false;
  if (cfg.hide[categoryOf(item)]) return false;

  const rank = RARITY_RANK[rarityWord(item)] ?? 0;
  if (cfg.minRarity > 0 && rank < cfg.minRarity) return false;
  if (cfg.hideCommon && rank === 0) return false;

  const tier = tierOf(item);
  if (tier != null) {
    if (cfg.anyTier > 0 && tier < cfg.anyTier) return false;
    if (cfg.commonTier > 0 && rank === 0 && tier < cfg.commonTier) return false;
  }
  if (cfg.minValue > 0 && (Number(item.value) || 0) < cfg.minValue) return false;
  return true;
}

/* ---------------------------------------------------------------- config */
function buildPane(container) {
  container.textContent = '';
  const f = cfg ?? load();

  const labelSpan = (text) => {
    const el = document.createElement('span');
    el.style.cssText = 'color:var(--dim,#b9b2a1);font-size:12px;min-width:150px';
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
    box.onchange = () => set(box.checked);
    const span = document.createElement('span');
    span.textContent = label;
    r.append(box, span);
    container.appendChild(r);
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
      const v = clamp(input.value, min, max);
      input.value = String(v);
      set(v);
    };
    r.append(labelSpan(label), input);
    container.appendChild(r);
  };
  const textField = (label, placeholder, get, set) => {
    const r = line();
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = get();
    input.style.cssText = 'flex:1;min-width:190px;background:var(--slate,#171b21);color:var(--bone,#efe8d6);border:1px solid var(--iron,#2b323b);padding:1px 4px';
    input.onchange = () => set(input.value);
    r.append(labelSpan(label), input);
    container.appendChild(r);
  };

  const note = document.createElement('div');
  note.style.cssText = 'color:var(--dim,#b9b2a1);font-size:12px;margin:2px 0 6px';
  note.textContent = 'Hides rows from the loot list only; Take all still takes everything. Quest items are never hidden. Applies the next time the plaque refreshes (look away and back).';
  container.appendChild(note);

  check('Enable loot filter', () => f.on, (v) => { f.on = v; save(); });

  const typesLine = line('flex-wrap:wrap;gap:2px 14px;align-items:flex-start');
  typesLine.appendChild(labelSpan('Hide types'));
  const typesWrap = document.createElement('span');
  typesWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px 14px';
  for (const key of FILTER_TYPES) {
    const l = document.createElement('label');
    l.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;text-transform:capitalize';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!f.hide[key];
    box.onchange = () => { f.hide[key] = box.checked; save(); };
    const span = document.createElement('span');
    span.textContent = key;
    l.append(box, span);
    typesWrap.appendChild(l);
  }
  typesLine.appendChild(typesWrap);
  container.appendChild(typesLine);

  check('Hide all commons', () => f.hideCommon, (v) => { f.hideCommon = v; save(); });
  number('Hide commons below tier', 0, 12, () => f.commonTier, (v) => { f.commonTier = v; save(); });
  number('Hide anything below tier', 0, 12, () => f.anyTier, (v) => { f.anyTier = v; save(); });

  const rarityLine = line();
  const rarity = document.createElement('select');
  rarity.style.cssText = 'background:var(--slate,#171b21);color:var(--bone,#efe8d6);border:1px solid var(--iron,#2b323b);padding:1px 4px';
  for (const [value, label] of [[0, 'Off'], [1, 'Magic'], [2, 'Rare'], [3, 'Legendary'], [4, 'Artifact']]) {
    const opt = document.createElement('option');
    opt.value = String(value);
    opt.textContent = label;
    rarity.appendChild(opt);
  }
  rarity.value = String(f.minRarity);
  rarity.onchange = () => { f.minRarity = clamp(rarity.value, 0, 5); save(); };
  rarityLine.append(labelSpan('Hide below rarity'), rarity);
  container.appendChild(rarityLine);

  number('Min value (gold)', 0, 1000000, () => f.minValue, (v) => { f.minValue = v; save(); });
  textField('Hide names (comma)', 'e.g. pellet, arrow, practice', () => f.hideNames, (v) => { f.hideNames = v; save(); });
  textField('Always keep (comma)', 'e.g. ruby, quest', () => f.keepNames, (v) => { f.keepNames = v; save(); });

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset loot filter';
  reset.style.cssText = 'margin-top:6px;cursor:pointer;background:var(--slate,#171b21);color:var(--bone,#efe8d6);border:1px solid var(--iron,#2b323b);padding:2px 10px';
  reset.onclick = () => {
    cfg = defaults();
    save();
    buildPane(container);
  };
  container.appendChild(reset);
}

/* -------------------------------------------------------------- lifecycle */
export function install() {
  cfg ??= load();
  globalThis.__dfoRowFilter = { keep };
}

export function unmount() {
  if (globalThis.__dfoRowFilter?.keep === keep) delete globalThis.__dfoRowFilter;
}

export function mountPane(container) {
  cfg ??= load();
  buildPane(container);
}
