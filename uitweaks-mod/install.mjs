#!/usr/bin/env node
/*
 * DFO Online - UI Tweaks installer.
 *
 * A MOD installer: it assumes the shared loader (../modloader) and asks it to
 * install itself first. It patches:
 *
 *   assets/propBodies-*.js       the plaque's item rows (label + tier), the
 *                                shared row-filter hook and the "empty pile"
 *                                model guard, and the row framer's row count
 *   assets/deepWaterRuntime-*.js the plaque renderer (data-tier attribute)
 *   assets/enhancedInventory-*.js the item card (summary line, extra facts,
 *                                data-dfo-tier colour key)
 *   assets/dfo-uitweaks.js       the mod
 *   assets/dfo-mods/registry.js  one entry pointing at the mod
 *
 * Chunk files shared with other mod installers are recorded as content checks
 * (not whole-file hashes), so either installer can write them last.
 *
 *   node install.mjs                 install/repair
 *   node install.mjs --if-needed     check first
 *   node install.mjs --check         0 healthy, 1 stale, 2 nothing paged yet
 *   node install.mjs --uninstall     restore this mod's files, leave the loader
 *   node install.mjs --install-watch / --remove-watch
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../modloader/lib/game.mjs';
import {
  inspectTarget, prepare, openStore, finalizeOverlay, Deferred, MODLOADER_ROOT,
} from '../modloader/lib/store.mjs';
import { readMarker, writeMarker, modEntry, removeModEntry } from '../modloader/lib/marker.mjs';
import { ensureLoader, loaderStatus, loaderRecord } from '../modloader/lib/loader.mjs';
import {
  readRegistry, upsertRegistry, removeRegistry, upsertManifest, removeManifest,
} from '../modloader/lib/registry.mjs';
import { installWatch, removeWatch } from '../modloader/lib/autosync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD_SRC = path.join(HERE, 'uitweaks.js');
const MODULE_REL = 'assets/dfo-uitweaks.js';
const ID = 'uitweaks';
const NAME = 'UI Tweaks';
const SPEC = '../dfo-uitweaks.js';
const MANIFEST_DIR = path.relative(MODLOADER_ROOT, HERE).split(path.sep).join('/');
const MARKER = '__dfoUiTweaks';

const argv = process.argv.slice(2);
const args = {
  check: argv.includes('--check'),
  ifNeeded: argv.includes('--if-needed'),
  uninstall: argv.includes('--uninstall'),
  installWatch: argv.includes('--install-watch'),
  removeWatch: argv.includes('--remove-watch'),
  noOverlay: argv.includes('--no-overlay'),
  quiet: argv.includes('--quiet'),
  force: argv.includes('--force'),
  seed: (argv.find((a) => a.startsWith('--seed=')) || '').slice('--seed='.length) || null,
  app: (argv.find((a) => a.startsWith('--app=')) || '').slice('--app='.length) || null,
  help: argv.includes('--help') || argv.includes('-h'),
};
const log = (...a) => { if (!args.quiet) console.log(...a); };
const die = (msg, code = 1) => { console.error(`uitweaks: ${msg}`); process.exit(code); };

if (args.help) {
  console.log(`usage: node install.mjs [--check|--if-needed|--uninstall|--install-watch|--remove-watch]
                  [--no-overlay] [--app=<app.asar|app folder>] [--seed=<extracted dist>]
                  [--quiet] [--force]`);
  process.exit(0);
}

const buildOpts = () => ({ seedDir: args.seed, app: args.app, noOverlay: args.noOverlay, log });

/** The same hash boot.js compares: the module text with MOD_BUILD emptied. */
function computeBuild() {
  const src = fs.readFileSync(MOD_SRC, 'utf8');
  if (!src.includes("'@BUILD@'")) die('uitweaks.js: @BUILD@ placeholder missing');
  const stripped = src.replace(/MOD_BUILD\s*=\s*[`'"][\s\S]*?[`'"]/, 'MOD_BUILD=');
  return sha256(Buffer.from(stripped, 'utf8')).slice(0, 16);
}

function deferOrDie(msg, seed) {
  if (!seed) throw new Deferred(msg);
  die(msg);
}

/* ------------------------------------------------------------------ rows */
/* Anchors are structural, not minified names: the item-name helper is
 * renamed every build (`Gt` at 0.1.13266, `In` at 0.1.13299), so capture it. */
const ROW_RX = /name:([A-Za-z0-9_$]+)\(e\)\.name\|\|`Something`,stack:/;
const A_TIER = 'r.rarity&&(i.dataset.rarity=r.rarity);';
const B_TIER = 'r.rarity&&(i.dataset.rarity=r.rarity);r.tier!=null&&(i.dataset.tier=String(r.tier));';
/* the inventory item card's stat list: add our rows right after "Hands" */
const A_CARD = 'm(`Type`,o.armorType),m(`Hands`,o.hands);';
/* the line under the card's name (material/stack) - the mod puts the summary there */
const A_META = 'let d=[o.material,o.stack?`${o.stack} of them`:null].filter(Boolean).join(` · `);d&&l.append(U(`p`,`meta`,d));';
const B_META = 'let d=globalThis.__dfoUiTweaks?.cardLine?.(e)||[o.material,o.stack?`${o.stack} of them`:null].filter(Boolean).join(` · `);d&&l.append(U(`p`,`meta`,d));';
const OLD_FACTS = 'if(typeof globalThis<`u`&&globalThis.__dfoUiTweaks?.itemFacts)for(let _f of globalThis.__dfoUiTweaks.itemFacts(e))m(_f[0],_f[1]);';
const PREV_FACTS = 'if(typeof globalThis<`u`&&globalThis.__dfoUiTweaks?.itemFacts){const _c=p.closest(`.card`),_t=globalThis.__dfoUiTweaks.tierOf?.(e);_c&&_t&&(_c.dataset.dfoTier=_t);for(const _f of globalThis.__dfoUiTweaks.itemFacts(e)){m(_f[0],_f[1]);_f[2]&&p.lastElementChild&&(p.lastElementChild.dataset.dfoTier=_f[2])}}';
const B_FACTS = 'if(typeof globalThis<`u`&&globalThis.__dfoUiTweaks?.itemFacts){for(const _f of globalThis.__dfoUiTweaks.itemFacts(e)){m(_f[0],_f[1]);_f[2]&&p.lastElementChild&&(p.lastElementChild.dataset.dfoTier=_f[2])}queueMicrotask(()=>{const _c=p.closest(`.card`),_t=globalThis.__dfoUiTweaks.tierOf?.(e);_c&&_t&&(_c.dataset.dfoTier=_t)})}';
const B_CARD = A_CARD + B_FACTS;

const A_ROWS_FALLBACK = 'function Pf(e,t=-1,n=0,r=6){';
const ROWS_RX = /function ([A-Za-z0-9_$]+)\(e,t=-1,n=0,r=6\)\{let i=e\?\.rows\?\.length\?\?0;if\(!e\|\|e\.kind!==`items`/;
const A_FILTER = ',item:e})),r=n.slice(0,t)';
/* the loot filter is its own mod; the row builder calls this generic hook so
 * either installer can provide it and the other's patches survive */
const ROW_HOOK = 'globalThis.__dfoRowFilter?.keep?.(e.item)??true';
const OLD_HOOK_RX = /\.filter\(e=>globalThis\.__dfoUiTweaks\?\.keepLoot\?\.\(e\.item\)\?\?true\)/;

/* ---- "hide the pile as a whole" --------------------------------------------
 * The row builder filters rows; when it removed every item of a pile the model
 * ends up with no rows but is not "empty", and the plaque still appears with
 * just its title. Make `empty` mean "the pile was born empty", and let the two
 * item-model builders return null (no plaque) when the filter ate everything.
 */
const BUILDER_RX = /function ([A-Za-z0-9_$]+)\(e,t=6\)\{let n=([A-Za-z0-9_$]+)\(e\)\.map/;
const A_EMPTY = 'return{shown:r,rest:n.length-r.length,empty:n.length===0}';

function guardEmptyPiles(text) {
  const head = text.match(BUILDER_RX);
  if (!head) return { text, missing: true };
  const [, builder, arrFn] = head;
  let out = text;
  if (!out.includes(`${arrFn}(e).length===0`)) {
    if (!out.includes(A_EMPTY)) return { text, missing: true };
    out = out.replace(A_EMPTY, `return{shown:r,rest:n.length-r.length,empty:${arrFn}(e).length===0}`);
  }
  const RX = new RegExp(`let\\{shown:([A-Za-z0-9_$]+),rest:([A-Za-z0-9_$]+),empty:([A-Za-z0-9_$]+)\\}=${builder}\\(([^;]{1,90}?),1\\/0\\)([,;])`, 'g');
  let guards = 0;
  out = out.replace(RX, (all, shown, rest, empty, args, sep) => {
    guards++;
    const guard = `;if(!${shown}.length&&!${empty})return null;`;
    return sep === ','
      ? `let{shown:${shown},rest:${rest},empty:${empty}}=${builder}(${args},1/0)${guard}let `
      : `let{shown:${shown},rest:${rest},empty:${empty}}=${builder}(${args},1/0)${guard}`;
  });
  return { text: out, guards, missing: guards === 0 };
}

function ensureRowFilter(text) {
  if (text.includes(ROW_HOOK)) return { text, changed: false };
  if (OLD_HOOK_RX.test(text)) return { text: text.replace(OLD_HOOK_RX, `.filter(e=>${ROW_HOOK})`), changed: true };
  if (text.includes(A_FILTER)) return { text: text.replace(A_FILTER, `,item:e})).filter(e=>${ROW_HOOK}),r=n.slice(0,t)`), changed: true };
  return { text, changed: false, missing: true };
}

/* ----------------------------------------------------------------- check */
function checkInstalled() {
  const { state, target } = inspectTarget();
  if (!state) return { ok: false, code: 2, why: 'no state.json - launch the game once first' };
  if (!target) {
    return {
      ok: false, code: 2,
      why: state.current
        ? `v${state.current} is current but its index does not read`
        : `the game plays its bundled copy (v${state.seed}); no channel build to patch yet`,
    };
  }
  const marker = readMarker();
  if (!marker || marker.version !== target.version) return { ok: false, why: `not installed for v${target.version}` };
  const store = openStore(target, null);
  if (!loaderStatus(store, marker)) return { ok: false, why: 'the mod loader is missing or stale' };
  const rec = modEntry(marker, ID);
  if (!rec) return { ok: false, why: `not installed for v${target.version}` };
  if (rec.build !== computeBuild()) return { ok: false, why: 'uitweaks.js changed since the install' };
  for (const [rel, want] of Object.entries(rec.files || {})) {
    const e = store.byPath.get(rel);
    if (!e || !e.own || e.size !== want.size || e.sha256 !== want.sha256) return { ok: false, why: `${rel} is not the installed copy` };
    try { if (fs.statSync(path.join(store.vFiles, rel)).size !== want.size) return { ok: false, why: `${rel} has the wrong size` }; }
    catch { return { ok: false, why: `${rel} is missing` }; }
  }
  for (const c of rec.checks || []) {
    const got = store.read(c.rel);
    if (!got || !got.bytes.toString('utf8').includes(c.has)) return { ok: false, why: `${c.rel} no longer has the UI Tweaks patch` };
  }
  if (!readRegistry(store).some((m) => m.id === ID)) return { ok: false, why: 'not registered with the loader' };
  return { ok: true, version: target.version, overlay: !!marker.overlay };
}

/* --------------------------------------------------------------- install */
function installNow() {
  const build = prepare(buildOpts());
  if (build.error) { console.error(`uitweaks: ${build.error}`); return 2; }
  const store = build.store;
  const { state, seed, target, overlay } = build;
  try {
    log(`game version ${store.version}, ${overlay ? 'local overlay' : `channel build (playing v${target.live})`}`);

    const loader = ensureLoader(store, { log });
    const installed = new Set();
    const checks = [];

    // ---- 1. the plaque's item rows --------------------------------------
    {
      const rows = store.findChunk({
        test: (t) => ROW_RX.test(t) || (t.includes(MARKER) && t.includes('lootTier')),
      });
      if (!rows) deferOrDie('the plaque row chunk was not found and the bundled build is not readable - start the game, then retry', seed);
      let text = rows.text;
      if (text.includes(MARKER)) log(`  tier labels already applied (${rows.rel})`);
      else {
        const m = text.match(ROW_RX);
        if (!m) die('the plaque row anchor was not found - aborting (nothing written)');
        const nameFn = m[1];
        const out = `name:globalThis.__dfoUiTweaks?.lootLabel?.(e,${nameFn}(e).name)||${nameFn}(e).name||\`Something\`,tier:globalThis.__dfoUiTweaks?.lootTier?.(e)??null,stack:`;
        text = text.replace(ROW_RX, out);
        log(`  patched ${rows.rel} (plaque rows)`);
      }
      const hook = ensureRowFilter(text);
      if (hook.missing) die('the plaque row filter anchor was not found - aborting (nothing written)');
      if (hook.changed) log(`  patched ${rows.rel} (row filter hook)`);
      else log(`  row filter hook already present (${rows.rel})`);
      text = hook.text;
      if (text.includes(',1/0);if(!')) log(`  empty-pile guard already applied (${rows.rel})`);
      else {
        const guarded = guardEmptyPiles(text);
        if (guarded.missing) die('the plaque model builders were not found - aborting (nothing written)');
        text = guarded.text;
        log(`  patched ${rows.rel} (empty piles hidden, ${guarded.guards} site${guarded.guards === 1 ? '' : 's'})`);
      }
      store.write(rows.rel, Buffer.from(text));
      checks.push({ rel: rows.rel, has: 'lootLabel' });
      checks.push({ rel: rows.rel, has: 'return null;' });
    }

    // ---- 2. the plaque renderer: carry the tier to the DOM ---------------
    {
      const renderer = store.findChunk({
        test: (t) => t.includes(A_TIER) || t.includes('i.dataset.tier=String(r.tier)'),
      });
      if (!renderer) deferOrDie('the plaque renderer chunk was not found and the bundled build is not readable - start the game, then retry', seed);
      let text = renderer.text;
      if (text.includes('i.dataset.tier=String(r.tier)')) log(`  data-tier already applied (${renderer.rel})`);
      else {
        if (!text.includes(A_TIER)) die('the plaque renderer anchor was not found - aborting (nothing written)');
        text = text.replace(A_TIER, B_TIER);
        log(`  patched ${renderer.rel} (plaque renderer)`);
      }
      store.write(renderer.rel, Buffer.from(text));
      checks.push({ rel: renderer.rel, has: 'i.dataset.tier=String(r.tier)' });
    }

    // ---- 3. the plaque's row framer: how many rows fit ------------------
    {
      const framer = store.findChunk({
        test: (t) => t.includes('lootRows?.()') || ROWS_RX.test(t) || t.includes(A_ROWS_FALLBACK),
      });
      if (!framer) deferOrDie('the plaque row framer was not found and the bundled build is not readable - start the game, then retry', seed);
      let text = framer.text;
      if (text.includes('lootRows?.()')) log(`  row length already applied (${framer.rel})`);
      else {
        const m = text.match(ROWS_RX);
        if (!m) die('the plaque row framer anchor was not found - aborting (nothing written)');
        const fn = m[1];
        text = text.replace(ROWS_RX,
          `function ${fn}(e,t=-1,n=0,r=globalThis.__dfoUiTweaks?.lootRows?.()??6){let i=e?.rows?.length??0;if(!e||e.kind!==\`items\``);
        log(`  patched ${framer.rel} (row framer)`);
      }
      store.write(framer.rel, Buffer.from(text));
      checks.push({ rel: framer.rel, has: 'lootRows?.()' });
    }

    // ---- 4. the inventory item card -------------------------------------
    {
      const card = store.findChunk({
        test: (t) => t.includes(A_CARD) || t.includes('cardLine?.(e)'),
      });
      if (!card) deferOrDie('the inventory item card was not found and the bundled build is not readable - start the game, then retry', seed);
      let text = card.text;
      if (text.includes('queueMicrotask')) log(`  item card already extended (${card.rel})`);
      else if (text.includes(PREV_FACTS) || text.includes(OLD_FACTS)) {
        text = text.replace(PREV_FACTS, B_FACTS).replace(OLD_FACTS, B_FACTS);
        log(`  upgraded ${card.rel} (item card)`);
      } else {
        if (!text.includes(A_CARD)) die('the inventory item card anchor was not found - aborting (nothing written)');
        text = text.replace(A_CARD, B_CARD);
        log(`  patched ${card.rel} (item card)`);
      }
      if (text.includes('cardLine?.(e)')) log(`  card meta line already applied (${card.rel})`);
      else if (text.includes(A_META)) {
        text = text.replace(A_META, B_META);
        log(`  patched ${card.rel} (card meta line)`);
      } else die('the item card meta anchor was not found - aborting (nothing written)');
      store.write(card.rel, Buffer.from(text));
      checks.push({ rel: card.rel, has: 'dataset.dfoTier' });
      checks.push({ rel: card.rel, has: 'cardLine?.(e)' });
    }

    // ---- 5. the mod itself ----------------------------------------------
    const buildId = computeBuild();
    const mod = Buffer.from(fs.readFileSync(MOD_SRC, 'utf8')
      .replace("'@BUILD@'", `'${buildId}'`), 'utf8');
    store.write(MODULE_REL, mod, { owned: true });
    installed.add(MODULE_REL);
    log(`  MOD_BUILD ${buildId}`);

    // ---- 6. register with the loader -------------------------------------
    upsertRegistry(store, { id: ID, name: NAME, spec: SPEC });

    // ---- 7. one atomic index write, then name an overlay -----------------
    store.commit();
    finalizeOverlay(build);

    // ---- 8. installed.json: loader + this mod's files --------------------
    const marker = readMarker();
    const sameVersion = marker?.version === store.version;
    const next = {
      ...(sameVersion ? marker : {}),
      version: store.version,
      overlay: !!overlay,
      seed: state.seed,
      at: new Date().toISOString(),
      loader: loaderRecord(store, loader),
      mods: {
        ...(sameVersion ? (marker.mods ?? {}) : {}),
        [ID]: { build: buildId, files: store.fileMap(installed), checks },
      },
    };
    writeMarker(next);
    upsertManifest({ id: ID, name: NAME, dir: MANIFEST_DIR });

    log(overlay
      ? `\nDone. The game plays v${store.version}; restart it once if it is running.`
      : '\nDone. Reload the game page; ESC -> Mods -> UI Tweaks has the switches.');
    return 0;
  } catch (e) {
    if (e instanceof Deferred) { log(e.message); return 2; }
    throw e;
  } finally {
    seed?.close?.();
  }
}

/* --------------------------------------------------------------- uninstall */
function uninstall() {
  const { state, target } = inspectTarget();
  const marker = readMarker();
  const version = target?.version || marker?.version || state?.current || null;
  if (target) {
    const store = openStore(target, null);
    const rec = modEntry(marker, ID);
    const rels = new Set([MODULE_REL]);
    if (marker?.version === store.version && rec?.files) for (const rel of Object.keys(rec.files)) rels.add(rel);
    for (const rel of rels) store.remove(rel, { owned: rel === MODULE_REL });
    removeRegistry(store, ID);
    store.commit();
  }
  removeManifest(ID);
  if (marker) writeMarker(removeModEntry(marker, ID));
  log(version ? `uninstalled from v${version} (the loader stays installed)` : 'nothing to uninstall');
  return 0;
}

/* -------------------------------------------------------------------- main */
try {
  if (args.removeWatch) { removeWatch(); process.exit(0); }
  if (args.installWatch) {
    const c = checkInstalled();
    if (!c.ok) { log(c.why); try { installNow(); } catch (e) { console.error(`uitweaks: ${e?.message || e}`); } }
    installWatch();
    process.exit(0);
  }
  if (args.uninstall) process.exit(uninstall());

  if (args.check) {
    const c = checkInstalled();
    log(c.ok
      ? `up to date: v${c.version}${c.overlay ? ' (local overlay)' : ''}`
      : `needs install: ${c.why}`);
    process.exit(c.ok ? 0 : (c.code || 1));
  }

  if (args.ifNeeded && !args.force) {
    const c = checkInstalled();
    if (c.ok) { log(`up to date: v${c.version}${c.overlay ? ' (local overlay)' : ''}`); process.exit(0); }
    log(c.why);
  }

  const code = installNow();
  process.exit(args.ifNeeded && code === 2 ? 0 : code);
} catch (e) {
  console.error(`uitweaks: ${e?.stack || e}`);
  process.exit(1);
}
