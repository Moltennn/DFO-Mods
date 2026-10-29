/*
 * DFO Online - the mod loader (stable bootstrap, shared by every mod).
 *
 * Served as assets/dfo-mods/boot.js and tagged from play/index.html. It reads
 * assets/dfo-mods/registry.js (written by the mod installers), imports each
 * listed module cache-busted, and owns the lifecycle:
 *
 *   MOD_BUILD   the installer injects a hash of the module text; a different
 *               build on reload means "unmount the old instance, install this"
 *   install()   mount (called by the loader, never at import time)
 *   unmount()   remove everything install() put in the page
 *   mountPane(container)   optional: a section in the ESC menu's Mods pane
 *
 * There are no hotkeys. ESC -> Mods shows one band per mod (name, its
 * MOD_BUILD, a "Reload" button) and "Reload all" on the right of the footer;
 * the same two doors exist as globalThis.__dfoReloadMods() and
 * globalThis.__dfoModsReloadOne(id).
 */
'use strict';

// The registry is a module, so specs resolve the same way boot.js's do:
// relative to assets/dfo-mods/ (e.g. "../dfo-skillhud.js").
const REGISTRY = './registry.js';

if (!globalThis.__dfoMods) globalThis.__dfoMods = { active: new Map(), mods: [], pane: null };
const state = globalThis.__dfoMods;

/** null when the registry itself could not be read (keep what is running). */
async function readRegistry() {
  try {
    const mod = await import(`${REGISTRY}?t=${Date.now()}`);
    const list = Array.isArray(mod.MODS) ? mod.MODS : [];
    return list.filter((e) => e && typeof e.id === 'string' && typeof e.spec === 'string' && e.spec);
  } catch (e) {
    console.error('[dfo-mods] registry failed', e);
    return null;
  }
}

async function loadOne(entry, { force = false } = {}) {
  const id = entry.id;
  const name = entry.name || id;
  const cur = state.active.get(id);
  let module;
  try {
    module = await import(`${entry.spec}?t=${Date.now()}`);
  } catch (e) {
    console.error(`[dfo-mods] ${id}: import failed`, e);
    return `FAILED import  ${id}: ${e.message}`;
  }
  const build = String(module.MOD_BUILD ?? '');
  if (cur && !force && cur.build === build && cur.spec === entry.spec) return `unchanged  ${id}`;

  if (cur) { try { cur.module.unmount?.(); } catch (e) { console.warn(`[dfo-mods] ${id}: unmount`, e); } }
  state.active.set(id, { module, build, name, spec: entry.spec });
  try {
    module.install?.();
  } catch (e) {
    console.error(`[dfo-mods] ${id}: install`, e);
    state.active.delete(id); // a failed mount must not look installed
    return `FAILED install  ${id}: ${e.message}`;
  }
  return `${cur ? 'reloaded' : 'loaded   '}  ${id}${build ? `  (build ${build})` : ''}`;
}

/** Rebuild the Mods pane if it is the one on screen. */
function refreshPane() {
  if (state.pane && state.pane.isConnected) globalThis.__dfoModsPane(state.pane);
}

async function reloadAll(force = false) {
  const list = await readRegistry();
  if (list === null) return 'registry unavailable - keeping the running mods';
  state.mods = list;
  const lines = [];
  const seen = new Set();
  for (const entry of list) {
    seen.add(entry.id);
    lines.push(await loadOne(entry, { force }));
  }
  for (const [id, rec] of [...state.active]) {
    if (seen.has(id)) continue;
    try { rec.module.unmount?.(); } catch (e) { console.warn(`[dfo-mods] ${id}: unmount`, e); }
    state.active.delete(id);
    lines.push(`unloaded   ${id}`);
  }
  console.log(`[dfo-mods]\n  ${lines.join('\n  ') || '(no mods registered)'}`);
  refreshPane();
  return lines.join('\n');
}

async function reloadOne(id) {
  const entry = state.mods.find((m) => m.id === id);
  if (!entry) { console.warn(`[dfo-mods] ${id} is not registered`); return `not registered: ${id}`; }
  const line = await loadOne(entry, { force: true });
  console.log(`[dfo-mods] ${line}`);
  refreshPane();
  return line;
}

globalThis.__dfoReloadMods = reloadAll;
globalThis.__dfoModsReloadOne = reloadOne;
/** What is loaded right now (DevTools). */
globalThis.__dfoModsList = () => [...state.active].map(([id, r]) => ({ id, name: r.name, build: r.build, spec: r.spec }));

/* -------------------------------------------------------------- credits */
const REPO_URL = 'https://github.com/Moltennn/DFO-Mods';
/* The pane's footer bar: credit and build on the left, the global reload on
 * the right - the one row wide enough to carry both, so no button sits alone
 * on a line of its own. */
function creditLine() {
  const line = document.createElement('div');
  line.className = 'dfo-mods-credit';
  line.style.cssText = 'margin-top:16px;padding-top:8px;border-top:1px solid var(--iron,#2b323b);color:var(--dim,#b9b2a1);font-size:12px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between';
  const left = document.createElement('div');
  left.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;min-width:0';
  const by = document.createElement('span');
  by.textContent = 'Made by ';
  const name = document.createElement('span');
  name.textContent = 'Moltenn';
  name.style.cssText = 'color:var(--brass,#c08a3e)';
  const dot = document.createElement('span');
  dot.textContent = '\u00b7';
  const link = document.createElement('a');
  link.href = REPO_URL;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.textContent = 'DFO-Mods on GitHub';
  link.style.cssText = 'color:var(--brass,#c08a3e);text-decoration:none;border-bottom:1px solid currentColor';
  left.append(by, name, dot, link);

  /* the footer is the credit line and one door: Reload all, on the right */
  line.append(left, paneButton('Reload all', () => { reloadAll(true); }));
  return line;
}

/* ------------------------------------------------------------- Mods pane */
/* THE PANE OWNS THE SCROLL. The menu's .px-body is the window's own scroll
 * well - fine for the game's panes, wrong here: it scrolls the whole page
 * (title and rail included). This rule is scoped with :has() to the Mods
 * content (the footer is its tail marker), so while Mods is on screen the
 * body stops scrolling, the journal gives up its 100% min-height, and the
 * pane's own well (.px-qdetail, the container handed to __dfoModsPane)
 * takes the scroll. Switching tab removes the marker, so the game's own
 * behaviour comes back with nothing to clean up. */
let paneStyleInjected = false;
function injectPaneStyle() {
  if (paneStyleInjected || document.getElementById('dfo-mods-style')) return;
  paneStyleInjected = true;
  const st = document.createElement('style');
  st.id = 'dfo-mods-style';
  st.textContent = [
    '.px-body:has(.dfo-mods-credit){overflow-y:hidden!important}',
    '.px-body:has(.dfo-mods-credit) .px-journal{min-height:0!important;height:100%!important}',
    '.px-body:has(.dfo-mods-credit) .px-qdetail{overflow-y:auto!important;min-height:0!important}',
  ].join('\n');
  document.head.appendChild(st);
}

function paneButton(label, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = 'cursor:pointer;background:var(--slate,#171b21);color:var(--bone,#efe8d6);border:1px solid var(--iron,#2b323b);padding:2px 10px;font:inherit';
  b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); onclick(); });
  return b;
}

// ESC menu "Mods" pane: one section per mod that exposes mountPane, with a
// reload for the whole set (its footer bar) and one per mod (its heading).
globalThis.__dfoModsPane = function (container) {
  state.pane = container;
  container.textContent = '';
  injectPaneStyle();

  let any = false;
  for (const [id, rec] of state.active) {
    if (typeof rec.module?.mountPane !== 'function') continue;
    const first = !any;
    any = true;
    const section = document.createElement('section');
    section.className = 'dfo-mod-pane';
    section.dataset.mod = id;
    /* the same rule the footer uses, so each mod is its own band */
    if (!first) section.style.cssText = 'margin-top:14px;padding-top:10px;border-top:1px solid var(--iron,#2b323b)';
    const heading = document.createElement('div');
    heading.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 4px';
    const name = document.createElement('div');
    name.style.cssText = 'display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;min-width:0';
    const title = document.createElement('div');
    title.textContent = rec.name || id;
    title.style.cssText = 'letter-spacing:.18em;text-transform:uppercase;font-size:12px;color:var(--brass,#c08a3e)';
    name.appendChild(title);
    if (rec.build) {
      /* MOD_BUILD next to the mod it belongs to - the loader compares it on reload */
      const build = document.createElement('span');
      build.title = 'MOD_BUILD: which module text is loaded; Reload re-imports when it changes';
      build.textContent = `build ${String(rec.build).slice(0, 8)}`;
      build.style.cssText = 'color:var(--dim,#b9b2a1);font-size:11px;font-variant-numeric:tabular-nums;opacity:.85';
      name.appendChild(build);
    }
    heading.append(name, paneButton('Reload', () => { reloadOne(id); }));
    const body = document.createElement('div');
    body.className = 'dfo-mod-pane-body';
    section.append(heading, body);
    container.appendChild(section);
    try { rec.module.mountPane(body); } catch (e) {
      console.error(`[dfo-mods] ${id}: mountPane`, e);
      const err = document.createElement('div');
      err.textContent = `${rec.name || id}: pane error (see console)`;
      body.appendChild(err);
    }
  }
  if (!any) {
    const n = document.createElement('div');
    n.style.cssText = 'color:#9a9486;font-size:12px';
    n.textContent = 'No installed mod exposes a config pane.';
    container.appendChild(n);
  }
  container.appendChild(creditLine());
};

reloadAll();
