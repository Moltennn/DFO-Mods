/*
 * DFO Online - "Skill tracker" mod (hot-reloadable, read-only, client-side)
 *
 * The HUD is a native piece of the game's Alt+U HUD-layout editor:
 * it lives inside the .hud root and the installer adds a piece entry
 * (id `dfoLT`) to the editor's piece table, so dragging, scaling, the ✕
 * hide toggle and placement persistence are the game's own machinery.
 * The mod itself therefore owns no drag code and no position.
 *
 * Theming: all colors/fonts come from the game's own Bitcoin tokens on
 * :root (--ink --slate --iron --bone --brass --dim --display
 * --dfo-text-font), with classic-skin fallbacks. Switching the skin in
 * Overhauls > UI Overhaul reloads the page, so a static check at install
 * is enough; Plus themes restyle via the same variables automatically.
 * Row/panel classes are deliberately namespaced (lt-*) — the game's own
 * sheet styles generic `.row`s living under .hud and would otherwise
 * leak its paddings/borders into our rows.
 *
 * Config UI lives under the ESC menu's "Mods" pane via mountPane.
 * Loaded by assets/dfo-mods/boot.js; ESC -> Mods reloads. MOD_BUILD is a hash
 * of this text with the MOD_BUILD value emptied (injected by the installer).
 */

export const MOD_BUILD = '@BUILD@';
/* Alt+U (HUD layout) hook: the installer injects the tiny hudPlacer hook
 * chunk's path here; calling its `t` export re-runs the layout editor's
 * piece application (P), which stamps our node with data-hm + placement.
 * Only used to attach the panel to the native machinery after mount. */
const PLACER = '@PLACER@';
/* Alt+U (HUD layout) layout-editor chunk: the installer verifies its piece
 * table and re-exports it as `hz`. If an editor run misses our node (e.g. a
 * page that still runs the chunk from before the current install), the mod
 * imports the chunk once more cache-busted, reads `hz`, and stamps itself
 * natively: the piece CSS (translate/scale/hide via --hmx/--hmy/--hms) is
 * inline-props driven, so a stamped node is a first-class piece. */
const LAYOUT = '@LAYOUT@';

// ---- skill tables (index order = classic skill order) ----------------
const SKILL_NAMES = [
  'Medical', 'Etiquette', 'Streetwise', 'Jumping', 'Orcish', 'Harpy',
  'Giantish', 'Dragonish', 'Nymph', 'Daedric', 'Spriggan', 'Centaurian',
  'Impish', 'Lockpicking', 'Mercantile', 'Pickpocket', 'Stealth',
  'Swimming', 'Climbing', 'Backstabbing', 'Dodging', 'Running',
  'Destruction', 'Restoration', 'Illusion', 'Alteration', 'Thaumaturgy',
  'Mysticism', 'Short Blade', 'Long Blade', 'Hand-to-Hand', 'Axe',
  'Blunt Weapon', 'Archery', 'Critical Strike',
];
const PICKABLE = SKILL_NAMES
  .map((n, i) => [i, n])
  .filter(([i, n]) => !/^(Orcish|Harpy|Giantish|Dragonish|Nymph|Daedric|Spriggan|Centaurian|Impish)$/.test(n));
const QI = [12, 1, 1, 5, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 1, 2, 2, 1, 2, 1, 4, 50, 1, 2, 1, 1, 2, 1, 2, 2, 2, 2, 2, 1, 8];
const SOFT_CAP_MILESTONES = [[125, 2], [150, 3], [175, 4], [200, 6]];
const STORE_KEY = 'dfoLevelTracker.config.v2';
const ROW_GAP_DEFAULT = 2;        // px between rows (out of the box)
const ROW_GAP_MIN = 0, ROW_GAP_MAX = 10;

// ---------------------------------------------------------------- config
let cfg = load();

/** Fill in any key an older/split config lacked, clamping the knob range. */
function normalize(c) {
  if (!c || !Array.isArray(c.tracked)) return null;
  c.tracked = c.tracked.filter((i) => Number.isInteger(i) && SKILL_NAMES[i]);
  if (!c.tracked.length) return null;
  const op = c.opacity; c.opacity = typeof op === 'number' && op >= .05 && op <= 1 ? op : .92;
  c.hidden = c.hidden === true;
  c.skillLevels = c.skillLevels !== false;
  c.rowGap = Math.min(ROW_GAP_MAX, Math.max(ROW_GAP_MIN, Math.round(c.rowGap ?? ROW_GAP_DEFAULT)));
  delete c.hideKey; // the keybind is gone; drop it from older configs
  delete c.showLevel; // superseded by skillLevels (per-row skill text)
  return c;
}
function builtDefaults(e) {
  const picked = [];
  [primaryOf(e), majorOf(e), minorOf(e)].forEach((arr) => {
    (arr || []).slice(0, 3).forEach((i) => {
      if (picked.indexOf(i) < 0 && picked.length < 6) picked.push(i);
    });
  });
  if (!picked.length) [34, 21, 17, 16, 30, 20].forEach((i) => { if (picked.indexOf(i) < 0) picked.push(i); });
  return { tracked: picked, opacity: .92, hidden: false, skillLevels: true, rowGap: ROW_GAP_DEFAULT };
}
function primaryOf(e) { return e && e.career && e.career.primarySkills; }
function majorOf(e) { return e && e.career && e.career.majorSkills; }
function minorOf(e) { return e && e.career && e.career.minorSkills; }
function load() {
  // v1 configs kept only tracked/opacity; anything else is re-defaulted.
  try {
    const v2 = normalize(JSON.parse(localStorage.getItem(STORE_KEY) || 'null'));
    if (v2) return v2;
    // fall through to v2-merged defaults so the full shape always exists
    const v1 = JSON.parse(localStorage.getItem('dfoLevelTracker.config.v1') || 'null');
    if (v1 && Array.isArray(v1.tracked))
      return normalize({ ...builtDefaults(entity()), tracked: v1.tracked.filter((i) => SKILL_NAMES[i]), opacity: v1.opacity, hidden: false });
  } catch (e) { }
  return null;
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { } }

// ----------------------------------------------------------- game maths
// Mirrors the game's own skill screen (worldTick's Vqe/yL/vL and the
// skillSoftcap chunk). 0.1.12011 changed the level used in the cost from
// `e.level` to a derived level: online characters earn against their
// level-up skill sum, not their character level - on a well-trained
// character that is far higher, so the cost is far larger.
function skillValue(e, t) { return (e.skills || [])[t] || 0; }
function scaledUses(e, t) {
  const raw = (e.skillUses || [])[t] || 0;
  const r = 65536 - ((e.reflexes ?? 2) - 2 << 13);
  return Math.floor((raw * r) / 65536);
}
function masteryOn(e) { return e?._online === true || e?.masterSkills === true; }
function isMastered(e, t) {
  return Array.isArray(e?.masteredSkills) && e.masteredSkills.includes(t) && masteryOn(e);
}
/* skillSoftcap: a player skill above 100 counts as 100 unless it is a
 * mastered skill with Master Skills on. */
function displaySkill(e, t) {
  const v = skillValue(e, t);
  if (!e?.isPlayer || !(v > 100)) return v;
  return isMastered(e, t) ? v : 100;
}
/* skillSoftcap I(): mastery compresses 101..200 into 100..140, plus the
 * milestone bonuses (Expert/Master/Grandmaster/Legend at 125/150/175/200). */
function softcap(v) {
  if (!(v > 100)) return v;
  const t = Math.max(0, Math.min(200, v));
  let bonus = 0;
  for (const [at, b] of SOFT_CAP_MILESTONES) if (t >= at) bonus += b;
  return Math.floor(100 + (t - 100) * 0.25 + bonus);
}
/* aL in the game: 5 * softcap(200) + 100 = 800. */
const SKILL_SUM_MAX = 5 * softcap(200) + 100;
/* worldTick lL(): the level 1..45 a level-up skill sum stands for. */
function levelUpLevel(base, cur) {
  const n = SKILL_SUM_MAX - base;
  if (!(n > 0)) return 45;
  const r = Math.min(cur - base, n);
  return Math.max(1, Math.min(45, Math.floor((28 * n + 647 * r) / (15 * n))));
}
/* worldTick Wo(): all primary skills, all major skills but the lowest, and
 * only the highest minor skill - each softcapped. */
function levelUpSkillSum(e) {
  const c = e?.career;
  if (!c) return 0;
  const v = (t) => softcap(displaySkill(e, t));
  let sum = 0;
  for (const t of c.primarySkills || []) sum += v(t);
  let lowest = Infinity;
  for (const t of c.majorSkills || []) { const x = v(t); sum += x; if (x < lowest) lowest = x; }
  if (lowest !== Infinity) sum -= lowest;
  let highest = -Infinity;
  for (const t of c.minorSkills || []) { const x = v(t); if (x > highest) highest = x; }
  if (highest !== -Infinity) sum += highest;
  return sum;
}
/* worldTick vL(): offline (or no career yet) the character level; online the
 * higher of that and the level the skill sum stands for. */
function effectiveLevel(e) {
  const lvl = e?.level ?? 1;
  if (e?._online !== true || !e.career || !Array.isArray(e.skills)) return lvl;
  const sum = levelUpSkillSum(e);
  const cur = e.currentLevelUpSkillSum;
  return Math.max(lvl, levelUpLevel(e.startingLevelUpSkillSum ?? sum, cur >= sum ? cur : sum));
}
function needsUses(e, t) {
  const v = skillValue(e, t);
  const m = (e.career && e.career.advancementMultiplier) || 1;
  return Math.floor(v * QI[t] * m * Math.pow(1.04, effectiveLevel(e)) * 2 / 5) + 1;
}
/* skillSoftcap N(): 1.5x/2x/4x for 100-124 / 125-149 / 150+ (200 is cap). */
function masteryMult(v) {
  if (!(v >= 100)) return 1;
  if (v < 125) return 1.5;
  if (v < 150) return 2;
  return 4;
}
function skillInfo(e, t) {
  const info = { name: SKILL_NAMES[t] || 'Skill ' + t, value: skillValue(e, t), have: 0, need: null, ready: false, held: null };
  const v = info.value, uses = scaledUses(e, t);
  if (v >= 100) {
    if (isMastered(e, t)) {
      if (v >= 200) return (info.held = 'cap'), info;
      const need = needsUses(e, t) * masteryMult(v);
      const progress = (e.skillProgress || [])[t] || 0;
      info.need = need;
      info.have = Math.floor(progress * need) + uses;
      info.ready = progress + uses / need >= 1;
      info.name += ' M';
      return info;
    }
    info.held = 'hold100';
    info.need = needsUses(e, t);
    info.have = uses;
    return info;
  }
  info.need = needsUses(e, t);
  info.have = uses;
  info.ready = info.have >= info.need;
  return info;
}
function entity() {
  return window.__playerEntity && window.__playerEntity.chargenDone ? window.__playerEntity : null;
}

/** A skill's enchantment/racial/mod bonus, the game's `yt` in wagonKinds. */
function skillBonus(e, t) {
  let n = e?._enchantMods?.skillMods?.[t] ?? 0;
  for (const ef of e?.activeEffects ?? []) {
    if (ef?.kind === 'racialOverride' && !ef.ended) n += ef.skillMods?.[t] ?? 0;
  }
  return n + (e?._mods?.skills?.[t] ?? 0);
}

/** The game's own skill text (wagonKinds `St` / the pause STATS grid): the
 *  softcapped skill with bonuses, and the real value in parentheses when the
 *  softcap is what is keeping it down - "100 (104)" for an unmastered skill
 *  past 100, or just "87" when the two agree. */
function skillLevelText(e, t) {
  const raw = Number(e?.skillOverrides?.[t] ?? skillValue(e, t)) || 0;
  const bonus = skillBonus(e, t);
  const shown = displaySkill(e, t) + bonus;
  const real = raw + bonus;
  return real === shown ? String(shown) : `${shown} (${real})`;
}

/** Diagnostics for DevTools - the numbers behind one row:
 *  __dfoMods.active.get('../dfo-skillhud.js').module.debugSkill(34) */
export function debugSkill(t) {
  const e = entity();
  if (!e) return null;
  return { level: e.level, effectiveLevel: effectiveLevel(e), skillSum: levelUpSkillSum(e), ...skillInfo(e, t) };
}

// ------------------------------------------------------------------ HUD
let el = null, listEl = null, styleEl = null, timer = null;
let renderer = null; // per-instance row renderer (rebuilt in buildHud)

/* The game's own piece boxes (.hud .hud-temp etc.), verbatim as observed:
 * darker inkroot ground, a 1px ring plus a 2px offset drop, square corners.
 * All colors via the game's tokens where they exist; classic-skin fallbacks
 * stand in where they don't. Row spacing (:lt-rowgap) is user-adjustable. */
const CSS = `
/* the piece box itself */
#dfo-leveltracker{position:fixed;top:16px;right:16px;left:auto;bottom:auto;
  min-width:150px;max-width:300px;z-index:40;
  background-color:rgba(12,14,18,.84);
  box-shadow:0 0 0 1px #050608, 2px 2px 0 1px rgba(0,0,0,.35);
  font:12px/1.2 var(--dfo-text-font,Georgia,serif);color:var(--bone,#efe8d6);
  -webkit-font-smoothing:none;padding:5px 7px 4px;user-select:none;-webkit-user-select:none;
  --lt-rowgap:${ROW_GAP_DEFAULT}px}
/* UI colour (Enhanced Plus theme): the game repaints its own HUD pieces by
 * :root[data-plus-theme=...] and redefines --ink/--slate/--iron on :root; the
 * chips (.hud-temp, .hud-qstag) then take the theme's chip ground. Mirror it
 * with the one token the theme guarantees, keeping the piece translucent over
 * the world. Slate is the base theme and writes no sheet - it keeps the
 * observed default ground above. */
:root[data-plus-theme]:not([data-plus-theme="slate"]) #dfo-leveltracker{
  background-color:color-mix(in srgb, var(--slate,#171b21) 90%, transparent)}
#dfo-leveltracker .lt-list{display:grid;grid-template-columns:max-content 1fr max-content;column-gap:7px;
  row-gap:var(--lt-rowgap)}
/* With Skill levels off there are two cells per row; drop the third column so
 * the two-column flow cannot drift a cell into it. The explicit grid-columns
 * below also keep uses/name anchored even if the template is out of step. */
#dfo-leveltracker.lt-no-levels .lt-list{grid-template-columns:max-content 1fr}
#dfo-leveltracker .lt-row{display:contents}
#dfo-leveltracker .lt-row .uses{grid-column:1;font-variant-numeric:tabular-nums;
  justify-self:end;color:var(--dim,#b9b2a1)}
#dfo-leveltracker .lt-row .nm{grid-column:2;white-space:nowrap}
#dfo-leveltracker .lt-row .lvl{grid-column:3;justify-self:end;color:var(--dim,#b9b2a1);
  font-variant-numeric:tabular-nums;font-size:11px;white-space:nowrap}
#dfo-leveltracker.lt-no-levels .lt-row .lvl{display:none}
#dfo-leveltracker .lt-row.ready .uses{color:var(--brass-hi,#f3cf86);font-weight:600;text-shadow:0 0 7px rgba(243,207,134,.55)}
#dfo-leveltracker .lt-row.held .uses,#dfo-leveltracker .lt-row.held .nm{opacity:.4}
#dfo-leveltracker .lt-none{grid-column:1/-1;color:var(--dim,#b9b2a1);font-size:12px}
/* Alt+U piece machinery, mirrored: the game's own sheet declares these for
 * pieces in ITS chunk build; this mirror keeps the panel a first-class piece
 * even before the built-in chunk gets re-loaded (page reload/restart).
 * Same exact shapes the editor stamps/reads back: */
.dfo-lt[data-hm]{translate:var(--hmx,0px) var(--hmy,0px);scale:var(--hms,1)}
.dfo-lt[data-hm-off]:not([data-hm-edit]){visibility:hidden!important}
.dfo-lt[data-hm-off][data-hm-edit]{opacity:.35!important;filter:grayscale(1)!important}
/* editor affordance (mirrored while the Alt+U editor is open) */
.dfo-lt[data-hm]{cursor:grab}
.dfo-lt.dfo-lt-edit{outline:2px dashed var(--brass,#c08a3e)!important}
`;
function ensureStyle() {
  if (styleEl) return;
  styleEl = document.createElement('style');
  styleEl.id = 'dfo-leveltracker-style';
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);
}

/** Build the per-row DOM once, then only update text: the list is rearranged
 *  only when the tracked set changes, not on every 350 ms tick. */
function rowRenderer() {
  const rows = new Map(); // skill index -> {row,nm,us,text,name,cls}
  let key = null;
  return (list, e, tracked) => {
    if (!e) {
      if (key !== 'none') {
        key = 'none';
        rows.clear();
        list.textContent = '';
        const n = document.createElement('div');
        n.className = 'lt-none';
        n.textContent = '(no character loaded)';
        list.appendChild(n);
      }
      return;
    }
    const want = 'e:' + tracked.join(',');
    if (want !== key) {
      key = want;
      const order = [];
      for (const t of tracked) {
        let r = rows.get(t);
        if (!r) {
          const row = document.createElement('div');
          row.className = 'lt-row';
          const nm = document.createElement('span'); nm.className = 'nm';
          const us = document.createElement('span'); us.className = 'uses';
          const lv = document.createElement('span'); lv.className = 'lvl';
          row.append(us, nm, lv);
          r = { row, nm, us, lv, text: '', name: '', lvlText: '', cls: '' };
          rows.set(t, r);
        }
        order.push(r.row);
      }
      for (const [t, r] of rows) if (!tracked.includes(t)) { rows.delete(t); r.row.remove(); }
      list.replaceChildren(...order);
    }
    for (const t of tracked) {
      const info = skillInfo(e, t);
      const r = rows.get(t);
      // at the skill's own cap there is no progress to show: both 100 (the
      // ceiling without Master Skills) and 200 (the cap with it) read "max",
      // never a held/max distinction the player has to decode
      const txt = info.held ? 'max' : info.have + '/' + info.need;
      const cls = 'lt-row' + (info.ready ? ' ready' : '') + (info.held ? ' held' : '');
      if (r.text !== txt) { r.us.textContent = txt; r.text = txt; }
      if (r.name !== info.name) { r.nm.textContent = info.name; r.name = info.name; }
      const lvl = skillLevelText(e, t);
      if (r.lvlText !== lvl) { r.lv.textContent = lvl; r.lvlText = lvl; }
      if (r.cls !== cls) { r.row.className = cls; r.cls = cls; }
    }
  };
}

function buildHud() {
  if (el) return;
  ensureStyle();
  renderer = rowRenderer();
  el = document.createElement('div');
  el.id = 'dfo-leveltracker';
  el.classList.add('dfo-lt');
  // no title line: the panel is a piece of the game's HUD (the Alt+U editor
  // names it "Skill tracker"), and its rows are self-explanatory
  listEl = document.createElement('div');
  listEl.className = 'lt-list';
  el.appendChild(listEl);
  // the layout editor only manages pieces it finds under .hud — if the root
  // isn't there yet (world still loading), keep it on body until render()
  // reparents us, then nudge the placer hook so the editor stamps our node.
  (document.querySelector('.hud') || document.body).appendChild(el);
  cfg.hidden && (el.style.display = 'none');
}

let placerKicked = false, stampBusy = false, stampTimer = null;
let drags = null;
function prefStore() {
  try { const s = globalThis.daggerShell?.storage; if (s) return s; } catch (e) { }
  return localStorage ?? null;
}
/** Read + parse the shared hudLayout pref; the game may have anything in it. */
function readLayout(storage) {
  try {
    const raw = storage.getItem('hudLayout');
    return (raw && JSON.parse(raw)) || { };
  } catch (e) { return { }; }
}
/* Alt+U drag fallback: the built-in editor only drags pieces it stamped from
 * its own chunk build (module cache). If it missed us, drag here — native
 * cursor/keys, persisted to the same hudLayout pref the editor reads. */
function enableDrag() {
  if (drags || !el) return;
  const down = (ev) => {
    if (!el || !ev.isPrimary) return;
    if (!(document.getElementById('hud-layout-banner') || document.getElementById('hud-layout-handles'))) return;
    if (el.hasAttribute('data-hm-edit')) return; // native machinery owns it
    if (!el.dataset.hm) return;
    const ev0 = { x: ev.clientX, y: ev.clientY };
    const translate = getComputedStyle(el).translate.split(/[ ,]+/).map(Number);
    const x0 = Number.isFinite(translate[0]) ? translate[0] : 0;
    const y0 = Number.isFinite(translate[1]) ? translate[1] : 0;
    el.setPointerCapture?.(ev.pointerId);
    el.classList.add('dfo-lt-edit'); el.style.cursor = 'grabbing';
    let moved = false;
    let last = { x: x0, y: y0 };
    const move = (m) => {
      moved = true;
      last = { x: x0 + m.clientX - ev0.x, y: y0 + m.clientY - ev0.y };
      el.style.setProperty('--hmx', `${last.x}px`);
      el.style.setProperty('--hmy', `${last.y}px`);
      if (!el.hasAttribute('data-hm-moved')) el.setAttribute('data-hm-moved', '');
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      el.classList.remove('dfo-lt-edit'); el.style.cursor = '';
      const st = prefStore();
      if (moved && st) {
        const lay = readLayout(st);
        lay.dfoLT = { ...(lay.dfoLT ?? { }), x: last.x, y: last.y };
        st.setItem('hudLayout', JSON.stringify(lay));
      } else if (!moved) {
        el.style.removeProperty('--hmx');
        el.style.removeProperty('--hmy');
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    ev.preventDefault(); ev.stopPropagation();
  };
  const dbl = () => dropPlacement(); // double-click reset, like the game's own
  el.addEventListener('pointerdown', down, true);
  el.addEventListener('dblclick', dbl);
  drags = [down, dbl];
}
function ensureStamp() {
  if (!el || !document.querySelector('.hud') || stampBusy || !el.closest('.hud')) return;
  if (!el.dataset.hm) {
    stampBusy = true;
    layoutEntry().then((piece) => {
      if (piece && el && !el.dataset.hm) { el.dataset.hm = 'dfoLT'; applyPlacementProps(); }
    }).finally(() => { stampBusy = false; });
  }
}
function syncParent() {
  if (!el) return;
  const hud = document.querySelector('.hud');
  if (hud && el.parentElement !== hud) {
    el.style.display = ''; // brief re-anchor; native placement takes over next
    hud.appendChild(el);
    placerKicked = false;
  }
  if (!placerKicked && hud) {
    placerKicked = true;
    // ideal: let the game's own placer hook re-run piece application…
    if (PLACER && !PLACER.startsWith('@')) {
      import(PLACER).then((m) => {
        // the caller is exported as `t` (verified by the installer's anchors)
        if (typeof m?.t === 'function') m.t(document);
      }).catch(() => { });
    }
    // …then verify, and self-stamp from the chunk's own table if missed:
    clearTimeout(stampTimer);
    stampTimer = setTimeout(ensureStamp, 600);
  }
  // the built-in chunk redraw can strip an unknown piece at any time —
  // keep the stamp alive on every render tick (cheap, idempotent).
  ensureStamp();
}
// the piece entry the installer registered for us, from the very chunk that
// stamps pieces (read once through a fresh import, then memoized — the
// table in that chunk is frozen, so one lifetime read is enough)
let layoutPiece = null, layoutPieceRead = false;
function layoutEntry() {
  if (!LAYOUT || LAYOUT[0] === '@') return Promise.resolve(null);
  if (layoutPieceRead) return Promise.resolve(layoutPiece);
  return import(LAYOUT + '?dfoLT=' + MOD_BUILD)
    .then((m) => { layoutPiece = m?.hz?.find?.((p) => p.id === 'dfoLT') ?? null; })
    .catch(() => { layoutPiece = null; })
    .then(() => { layoutPieceRead = true; return layoutPiece; });
}
function applyPlacementProps() {
  const st = prefStore();
  if (!st) return;
  const o = readLayout(st).dfoLT ?? { };
  if (o.x || o.y) { el.style.setProperty('--hmx', `${Number.isFinite(o.x) ? o.x : 0}px`); el.style.setProperty('--hmy', `${Number.isFinite(o.y) ? o.y : 0}px`); }
  if (o.s && o.s !== 1) el.style.setProperty('--hms', String(o.s));
}
function dropPlacement() {
  const st = prefStore();
  if (st) {
    const lay = readLayout(st);
    delete lay.dfoLT;
    st.setItem('hudLayout', JSON.stringify(lay));
  }
  if (el) for (const p of ['--hmx', '--hmy', '--hms']) el.style.removeProperty(p);
  el?.removeAttribute('data-hm-moved');
  render();
}
function place() {
  if (!el) return;
  // Only over a live character. The title screen and main menu have no
  // player entity, so the panel stays out of them. This works with both
  // HUD skins: the Enhanced HUD has a .hud root to parent the panel, the
  // classic HUD has none and the panel stays on body.
  const show = !!entity() && !cfg.hidden;
  const display = show ? '' : 'none';
  if (el.style.display !== display) el.style.display = display;
  if (!el.hasAttribute('data-hm-off')) el.style.opacity = String(cfg.opacity);
}
let rowGapCache = null;
function render() {
  if (!el) return;
  syncParent();
  place();
  if (rowGapCache !== cfg.rowGap) { rowGapCache = cfg.rowGap; el.style.setProperty('--lt-rowgap', cfg.rowGap + 'px'); }
  el.classList.toggle('lt-no-levels', cfg.skillLevels === false);
  const e = entity();
  renderer(listEl, e, e ? cfg.tracked.slice().sort((a, b) => a - b) : []);
}

// -------------------------------------------------------- config pane
/** ESC menu → Mods: the loader hands us the pane container. */
export function mountPane(container) {
  // the loader renders the section heading (the mod's name) above this
  container.textContent = '';
  const note = (t) => {
    const n = document.createElement('div');
    n.style.cssText = 'color:var(--dim,#b9b2a1);font-size:12px;margin:2px 0 8px';
    n.textContent = t; container.appendChild(n);
  };
  const row = (label, control) => {
    const r = document.createElement('label');
    r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:14px;line-height:2;cursor:pointer';
    const l = document.createElement('span'); l.textContent = label;
    r.appendChild(l); r.appendChild(control); container.appendChild(r);
  };
  const e = entity();
  const btn = (t, onclick) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
    b.style.cssText = 'cursor:pointer;background:var(--slate,#171b21);color:var(--bone,#efe8d6);border:1px solid var(--iron,#2b323b);padding:2px 10px';
    onclick && (b.onclick = onclick); return b; };

  /* The slider and a value label, in the same box the row-spacing slider uses,
   * so both sliders start at the same x and the numbers line up under each
   * other. */
  const opWrap = document.createElement('span');
  opWrap.style.cssText = 'display:flex;gap:6px;align-items:center;justify-content:flex-end';
  const op = document.createElement('input'); op.type = 'range'; op.min = '30'; op.max = '100';
  op.value = String(Math.round((cfg.opacity ?? .92) * 100)); op.style.width = '140px';
  const opLabel = document.createElement('span');
  opLabel.style.cssText = 'color:var(--dim,#b9b2a1);font-size:12px;min-width:34px;text-align:right;font-variant-numeric:tabular-nums';
  opLabel.textContent = op.value + '%';
  op.oninput = () => {
    cfg.opacity = op.value / 100; save(); place();
    opLabel.textContent = op.value + '%';
  };
  opWrap.append(op, opLabel);
  row('Panel opacity', opWrap);

  // skill level on each row (the game's own "100 (104)" text)
  const lv = document.createElement('input'); lv.type = 'checkbox';
  lv.checked = cfg.skillLevels !== false;
  lv.onchange = () => { cfg.skillLevels = lv.checked; save(); render(); };
  row('Skill levels', lv);

  // px between rows: 0 = fully packed, 10 = airy
  const gap = document.createElement('input'); gap.type = 'range'; gap.min = String(ROW_GAP_MIN); gap.max = String(ROW_GAP_MAX);
  gap.step = '1'; gap.value = String(cfg.rowGap); gap.style.width = '140px';
  const gapLabel = document.createElement('span');
  gapLabel.style.cssText = 'color:var(--dim,#b9b2a1);font-size:12px;min-width:34px;text-align:right;font-variant-numeric:tabular-nums';
  gapLabel.textContent = cfg.rowGap + 'px';
  const gapWrap = document.createElement('span'); gapWrap.style.cssText = 'display:flex;gap:6px;align-items:center;justify-content:flex-end';
  gapWrap.append(gap, gapLabel);
  gap.oninput = () => { cfg.rowGap = Math.min(ROW_GAP_MAX, Math.max(ROW_GAP_MIN, Math.round(+gap.value))); save(); render(); gapLabel.textContent = cfg.rowGap + 'px'; };
  row('Row spacing', gapWrap);

  // the one show/hide door: ESC -> Mods -> Skill Tracker
  const hidden = cfg.hidden === true;
  const tog = document.createElement('span'); tog.style.cssText = 'display:flex;gap:6px';
  tog.appendChild(btn(hidden ? 'Show panel' : 'Hide panel', () => {
    cfg.hidden = !(cfg.hidden === true); save(); place();
  }));
  row('Panel', tog);

  const rst = btn('Reset panel placement', () => dropPlacement());
  row('Panel placement', rst);

  const grid = document.createElement('div');
  // three across when the pane is wide (it usually is), two when it is not;
  // 34 skills fit in 12 rows instead of 17
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:2px 18px;margin:10px 0 4px';
  PICKABLE.forEach(([i, name]) => {
    const l = document.createElement('label');
    l.style.cssText = 'display:flex;align-items:center;gap:6px;line-height:1.7;cursor:pointer;font-size:13px';
    const b = document.createElement('input'); b.type = 'checkbox';
    b.checked = cfg.tracked.indexOf(i) >= 0;
    b.onchange = () => {
      if (b.checked) { if (cfg.tracked.indexOf(i) < 0) cfg.tracked.push(i); }
      else cfg.tracked = cfg.tracked.filter(x => x !== i);
      save(); render();
    };
    const val = document.createElement('span');
    val.style.cssText = 'color:var(--dim,#b9b2a1)';
    val.textContent = e ? String(skillValue(e, i)) : '';
    l.appendChild(b);
    l.appendChild(document.createTextNode(' ' + name));
    l.appendChild(val);
    grid.appendChild(l);
  });
  container.appendChild(grid);
  // No character line here: the loader's footer carries the build hash, and
  // the career skills already show as the highlighted rows under Class skills.
  if (!e) note('Load a character to see its skills. Alt+U unlocks HUD placement — drag "Skill tracker" like any other piece.');
}

// ------------------------------------------------------- install/uninstall
export function install() {
  if (el) return; // already running
  if (cfg == null) { cfg = builtDefaults(entity()); save(); }
  buildHud();
  if (cfg.hidden) el.style.display = 'none'; else el.style.display = '';
  el.style.opacity = String(cfg.opacity);
  el.style.setProperty('--lt-rowgap', cfg.rowGap + 'px');
  enableDrag(); render();
  timer = setInterval(render, 350);
}
export function unmount() {
  if (timer) { clearInterval(timer); timer = null; }
  if (drags && el) { el.removeEventListener('pointerdown', drags[0], true); el.removeEventListener('dblclick', drags[1]); drags = null; }
  clearTimeout(stampTimer);
  if (el) { el.remove(); el = null; listEl = null; renderer = null; }
  if (styleEl) { styleEl.remove(); styleEl = null; }
}
// Outside the loader (a legacy direct <script type="module"> tag), mount on
// import; under boot.js the loader owns install/unmount, so an unchanged
// re-import never touches the page.
if (typeof document !== 'undefined' && !globalThis.__dfoMods) install();
