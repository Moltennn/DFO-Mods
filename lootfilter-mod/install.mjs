#!/usr/bin/env node
/*
 * DFO Online - Loot Filter installer.
 *
 * A MOD installer: it assumes the shared loader (../modloader) and asks it to
 * install itself first. It patches:
 *
 *   assets/propBodies-*.js       the shared row-filter hook (idempotent - UI
 *                                Tweaks installs the same line)
 *   assets/world-*.js            exposes the dropped-pile manager (__dfoPiles)
 *                                and the foe manager (__dfoFoes)
 *   assets/deepWaterRuntime-*.js the corpse body + corpse-sprite draw guards
 *   assets/dfo-lootfilter.js     the mod (rules + ESC pane)
 *   assets/dfo-mods/registry.js  one entry pointing at the mod
 *
 *   node install.mjs                 install/repair
 *   node install.mjs --if-needed     check first
 *   node install.mjs --check         0 healthy, 1 stale, 2 nothing paged yet
 *   node install.mjs --uninstall     restore this mod's file, leave the loader
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
const MOD_SRC = path.join(HERE, 'lootfilter.js');
const MODULE_REL = 'assets/dfo-lootfilter.js';
const ID = 'lootfilter';
const NAME = 'Loot Filter';
const SPEC = '../dfo-lootfilter.js';
const MANIFEST_DIR = path.relative(MODLOADER_ROOT, HERE).split(path.sep).join('/');

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
const die = (msg, code = 1) => { console.error(`lootfilter: ${msg}`); process.exit(code); };

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
  if (!src.includes("'@BUILD@'")) die('lootfilter.js: @BUILD@ placeholder missing');
  const stripped = src.replace(/MOD_BUILD\s*=\s*[`'"][\s\S]*?[`'"]/, 'MOD_BUILD=');
  return sha256(Buffer.from(stripped, 'utf8')).slice(0, 16);
}

function deferOrDie(msg, seed) {
  if (!seed) throw new Deferred(msg);
  die(msg);
}

/* --------------------------------------------------- the pile manager */
/* The dropped-loot manager owns the 3-D pile sprites. Expose it so the mod can
 * hide a pile whose items are all filtered. The manager is the one created with
 * `{renderer, getTexture, uploadRecordFrame}` and later used with
 * `.restoreWorld(` / `.seedPile(`; the names are minified per build. */
function exposePileManager(text) {
  if (text.includes('__dfoPiles=')) return { text, changed: false };
  const RX = /let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(\{renderer:[A-Za-z0-9_$]+,getTexture:[A-Za-z0-9_$]+,uploadRecordFrame:[A-Za-z0-9_$]+\}\)/g;
  let m = null;
  let hit = null;
  while ((m = RX.exec(text))) {
    if (text.includes(`${m[1]}.restoreWorld(`) || text.includes(`${m[1]}.seedPile(`)) { hit = m; break; }
  }
  if (!hit) return { text, missing: true };
  const out = `${text.slice(0, hit.index)}let ${hit[1]}=globalThis.__dfoPiles=${hit[2]}(${text.slice(hit.index + hit[0].indexOf('({') + 1)}`;
  return { text: out, changed: true };
}

/* The foe manager draws dead foes as corpses and owns their loot. Expose it so
 * the mod can hide a corpse whose items are all filtered. */
function exposeFoeManager(text) {
  if (text.includes('__dfoFoes=')) return { text, changed: false };
  const RX = /([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(\{oneVoice:/;
  const m = text.match(RX);
  if (!m) return { text, missing: true };
  return { text: text.replace(RX, `${m[1]}=globalThis.__dfoFoes=${m[2]}({oneVoice:`), changed: true };
}

/* Corpses: the foe renderers "stand" a dead foe's body as a corpse and draw a
 * separate billboard sprite for it. A build can carry more than one renderer
 * (world / interior / remote), so every corpse shape is patched, not the first:
 *
 *   stand   `X.dead&&X.corpse&&[!X.corpseDestroyed&&]<fn>(X)&&X.ai&&(Y.stand(`
 *           the corpse's body draw - skipped when the filter hides the body
 *   marker  `M.pixelKey=X.corpsePixelKey=K` - the corpse sprite remembers its foe
 *   batch   `X.corpseBatch=B,<B>.castOnly=` - the other renderer's corpse sprite
 *   lists   `...[<list>.map(e=>e.batch)]` and `for(let e of <list>)e.castOnly||`
 *
 * Every anchor is a shape the corpse code always has; the minified names around
 * it are captured, never hardcoded. */
const HIDDEN = (x) => `!(globalThis.__dfoRowFilter?.hideCorpse?.(${x}))&&`;
/* A hidden corpse's body is skipped above, but its corpse marker (the sprite
 * drawn at distance / after looting) would then sit there alone - the game
 * only suppresses it while it stands the 3D body. Stop drawing it too. */
const NO_SPRITE = (x) => `${x}.corpseMarker?.batch&&globalThis.__dfoRowFilter?.hideCorpse?.(${x})&&(${x}.corpseMarker.batch.castOnly=!0),`
  + `${x}.corpseBatch&&globalThis.__dfoRowFilter?.hideCorpse?.(${x})&&(${x}.corpseBatch.castOnly=!0),`;
const DRAWN = (x) => `(${x}.dfoFoe&&globalThis.__dfoRowFilter?.hideCorpse?.(${x}.dfoFoe))`;
const CORPSE_PROBE = /([A-Za-z0-9_$]+)\.dead&&\1\.corpse&&/;
const CORPSE_RX = /([A-Za-z0-9_$]+)\.dead&&\1\.corpse&&(?:!\1\.corpseDestroyed&&)?[A-Za-z0-9_$]+\(\1\)&&\1\.ai&&\([A-Za-z0-9_$]+\.stand\(/g;
const MARK_RX = /([A-Za-z0-9_$]+)\.pixelKey=([A-Za-z0-9_$]+)\.corpsePixelKey=([A-Za-z0-9_$]+)(?!,\1\.dfoFoe=)/g;
const BATCH_RX = /([A-Za-z0-9_$]+)\.corpseBatch=([A-Za-z0-9_$]+),(?!\2\.dfoFoe=)(?=[A-Za-z0-9_$]+\.castOnly)/g;
const LIST_RX = /\.\.\.([A-Za-z0-9_$]+)\.map\(e=>e\.batch\)/g;
const BATCHLIST_RX = /for\(let ([A-Za-z0-9_$]+) of ([A-Za-z0-9_$]+)\)\1\.castOnly\|\|([A-Za-z0-9_$]+)\.push\(\1\)/g;

/* ------------------------------------------------------- the row hook */
/* The row builder's item name is the one stable shape (`name:<fn>(e).name||
 * `Something``); the helper is renamed every build. */
const ROW_RX = /name:([A-Za-z0-9_$]+)\(e\)\.name\|\|`Something`,stack:/;
const A_FILTER = ',item:e})),r=n.slice(0,t)';
const ROW_HOOK = 'globalThis.__dfoRowFilter?.keep?.(e.item)??true';
const OLD_HOOK_RX = /\.filter\(e=>globalThis\.__dfoUiTweaks\?\.keepLoot\?\.\(e\.item\)\?\?true\)/;

function ensureRowFilter(text) {
  if (text.includes(ROW_HOOK)) return { text, changed: false };
  if (OLD_HOOK_RX.test(text)) return { text: text.replace(OLD_HOOK_RX, `.filter(e=>${ROW_HOOK})`), changed: true };
  if (text.includes(A_FILTER)) return { text: text.replace(A_FILTER, `,item:e})).filter(e=>${ROW_HOOK}),r=n.slice(0,t)`), changed: true };
  return { text, changed: false, missing: true };
}

/* Quick-loot took `items[selectedRow]` from the pile's unfiltered list. Once
 * rows are filtered that index lands on a different (hidden) item, so make the
 * selection ask the filter for the visible row's own item first; the raw
 * lookup stays as the fallback for non-item plaques. Anchor: the selected-row
 * lookup `Gf(items, state.row, 1/0)`. */
const PICK_HOOK = 'globalThis.__dfoRowFilter?.pick?.(';
const PICK_RX = /([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\.row,1\/0\)/;
function ensureTakePick(text) {
  if (text.includes(PICK_HOOK)) return { text, changed: false };
  const m = text.match(PICK_RX);
  if (!m) return { text, changed: false, missing: true };
  return {
    text: text.replace(PICK_RX, (all, fn, items, state) => `${PICK_HOOK}${state})??${all}`),
    changed: true,
  };
}

/* 0.1.13520 keeps the quick-loot selection as `{key,row,id}` - not the plaque
 * model - so `pick(fp)` cannot see the row's item. Carry it on that state when
 * the model updates: `dfoItem` is ignored by the game's own comparisons. */
const QUICK_RX = /return ([A-Za-z0-9_$]+)==null\?\{key:([A-Za-z0-9_$]+)\.key,row:([A-Za-z0-9_$]+)\}:\{key:\2\.key,row:\3,id:\1\}/;
function ensureQuickState(text) {
  if (text.includes('dfoItem:')) return { text, changed: false };
  const m = text.match(QUICK_RX);
  if (!m) return { text, changed: false, missing: true }; // older build: the plaque state itself
  return {
    text: text.replace(QUICK_RX, (all, id, model, row) => `return ${id}==null?{key:${model}.key,row:${row},dfoItem:${model}.rows?.[${row}]?.item}:{key:${model}.key,row:${row},id:${id},dfoItem:${model}.rows?.[${row}]?.item}`),
    changed: true,
  };
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
  if (rec.build !== computeBuild()) return { ok: false, why: 'lootfilter.js changed since the install' };
  for (const [rel, want] of Object.entries(rec.files || {})) {
    const e = store.byPath.get(rel);
    if (!e || !e.own || e.size !== want.size || e.sha256 !== want.sha256) return { ok: false, why: `${rel} is not the installed copy` };
    try { if (fs.statSync(path.join(store.vFiles, rel)).size !== want.size) return { ok: false, why: `${rel} has the wrong size` }; }
    catch { return { ok: false, why: `${rel} is missing` }; }
  }
  for (const c of rec.checks || []) {
    const got = store.read(c.rel);
    if (!got || !got.bytes.toString('utf8').includes(c.has)) return { ok: false, why: `${c.rel} no longer has the loot-filter hook` };
  }
  if (!readRegistry(store).some((m) => m.id === ID)) return { ok: false, why: 'not registered with the loader' };
  return { ok: true, version: target.version, overlay: !!marker.overlay };
}

/* --------------------------------------------------------------- install */
function installNow() {
  const build = prepare(buildOpts());
  if (build.error) { console.error(`lootfilter: ${build.error}`); return 2; }
  const store = build.store;
  const { state, seed, target, overlay } = build;
  try {
    log(`game version ${store.version}, ${overlay ? 'local overlay' : `channel build (playing v${target.live})`}`);

    const loader = ensureLoader(store, { log });
    const installed = new Set();
    const checks = [];

    // ---- 1. expose the dropped-pile manager (3-D pile sprites) ----------
    {
      const world = store.findChunk({
        test: (t) => t.includes('__dfoPiles=')
          || (t.includes('uploadRecordFrame:') && t.includes('.restoreWorld(') && t.includes('.seedPile(')),
      });
      if (!world) deferOrDie('the world chunk was not found and the bundled build is not readable - start the game, then retry', seed);
      const exposed = exposePileManager(world.text);
      if (exposed.missing) die('the dropped-pile manager was not found - aborting (nothing written)');
      let text = exposed.text;
      if (exposed.changed) log(`  patched ${world.rel} (pile manager exposed)`);
      else log(`  pile manager already exposed (${world.rel})`);
      const foes = exposeFoeManager(text);
      if (foes.missing) die('the foe manager was not found - aborting (nothing written)');
      text = foes.text;
      if (foes.changed) log(`  patched ${world.rel} (foe manager exposed)`);
      else log(`  foe manager already exposed (${world.rel})`);
      if (exposed.changed || foes.changed) store.write(world.rel, Buffer.from(text));
      checks.push({ rel: world.rel, has: '__dfoPiles=' });
      checks.push({ rel: world.rel, has: '__dfoFoes=' });
    }

    // ---- 2. the row-filter hook in the plaque's row builder -------------
    {
      const rows = store.findChunk({
        test: (t) => ROW_RX.test(t) || t.includes('lootLabel') || t.includes(ROW_HOOK) || t.includes(PICK_HOOK),
      });
      if (!rows) deferOrDie('the plaque row chunk was not found and the bundled build is not readable - start the game, then retry', seed);
      const hook = ensureRowFilter(rows.text);
      if (hook.missing) die('the plaque row filter anchor was not found - aborting (nothing written)');
      if (hook.changed) log(`  patched ${rows.rel} (row filter hook)`);
      else log(`  row filter hook already present (${rows.rel})`);
      const take = ensureTakePick(hook.text);
      if (take.missing) die('the quick-loot selection anchor was not found - aborting (nothing written)');
      if (take.changed) log(`  patched ${rows.rel} (quick-loot uses the selected row's item)`);
      else log(`  quick-loot row pick already present (${rows.rel})`);
      const quick = ensureQuickState(take.text);
      if (quick.missing) log(`  quick-loot state carries no row item (older build) - plaque-state pick used`);
      else if (quick.changed) log(`  patched ${rows.rel} (quick-loot state carries the selected item)`);
      else log(`  quick-loot state already carries the selected item (${rows.rel})`);
      store.write(rows.rel, Buffer.from(quick.text));
      checks.push({ rel: rows.rel, has: ROW_HOOK });
      checks.push({ rel: rows.rel, has: PICK_HOOK });
      if (quick.text.includes('dfoItem:')) checks.push({ rel: rows.rel, has: 'dfoItem:' });
    }

    // ---- 3. the corpse body + sprite draws ------------------------------
    {
      const bodies = store.findChunk({ test: (t) => t.includes('hideCorpse') || CORPSE_PROBE.test(t) });
      if (!bodies) deferOrDie('the foe-body renderer was not found and the bundled build is not readable - start the game, then retry', seed);
      let text = bodies.text;

      /* the body draw: one guard per renderer */
      const stands = [...text.matchAll(CORPSE_RX)].length;
      if (!stands && text.includes('.dead&&') && !text.includes('hideCorpse')) {
        die('the corpse body draw anchor was not found - aborting (nothing written)');
      }
      if (stands) {
        text = text.replace(CORPSE_RX, (m, foe) => m.replace(`${foe}.dead&&${foe}.corpse&&`, `${NO_SPRITE(foe)}${foe}.dead&&${foe}.corpse&&${HIDDEN(foe)}`));
        log(`  patched ${bodies.rel} (corpse body draw, ${stands})`);
      } else log(`  corpse body guard already applied (${bodies.rel})`);

      /* the corpse's billboard sprite: remember its foe... */
      const marks = [...text.matchAll(MARK_RX)].length;
      const batches = [...text.matchAll(BATCH_RX)].length;
      if (!marks && !batches && !text.includes('.dfoFoe=')) {
        die('the corpse sprite anchor was not found - aborting (nothing written)');
      }
      if (marks) text = text.replace(MARK_RX, (m, marker, foe) => `${m},${marker}.dfoFoe=${foe}`);
      if (batches) text = text.replace(BATCH_RX, (m, foe, batch) => `${m}${batch}.dfoFoe=${foe},`);
      if (marks || batches) log(`  patched ${bodies.rel} (corpse sprite tagged, ${marks + batches})`);

      /* ...and skip it in every draw list it appears in */
      const lists = [...text.matchAll(LIST_RX)].length;
      const coralists = [...text.matchAll(BATCHLIST_RX)].length;
      if (!lists && !coralists && !/\.dfoFoe&&globalThis\.__dfoRowFilter\?\.hideCorpse\?\.\(/.test(text)) {
        die('the corpse sprite draw list was not found - aborting (nothing written)');
      }
      if (lists) {
        text = text.replace(LIST_RX, (m, arr) => `...${arr}.filter(e=>!${DRAWN('e')}).map(e=>e.batch)`);
      }
      if (coralists) {
        text = text.replace(BATCHLIST_RX, (m, el, arr, out) => `for(let ${el} of ${arr})(${el}.castOnly||${DRAWN(el)})||${out}.push(${el})`);
      }
      if (lists || coralists) log(`  patched ${bodies.rel} (corpse sprite hidden, ${lists + coralists})`);

      store.write(bodies.rel, Buffer.from(text));
      checks.push({ rel: bodies.rel, has: 'hideCorpse' });
    }

    // ---- 4. the mod itself ----------------------------------------------
    const buildId = computeBuild();
    const mod = Buffer.from(fs.readFileSync(MOD_SRC, 'utf8')
      .replace("'@BUILD@'", `'${buildId}'`), 'utf8');
    store.write(MODULE_REL, mod, { owned: true });
    installed.add(MODULE_REL);
    log(`  MOD_BUILD ${buildId}`);

    // ---- 5. register with the loader -------------------------------------
    upsertRegistry(store, { id: ID, name: NAME, spec: SPEC });

    // ---- 6. one atomic index write, then name an overlay -----------------
    store.commit();
    finalizeOverlay(build);

    // ---- 7. installed.json: loader + this mod's file ---------------------
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
      : '\nDone. ESC -> Mods -> Loot Filter has the rules.');
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
  log(version ? `uninstalled from v${version} (the hook stays inert; the loader stays installed)` : 'nothing to uninstall');
  return 0;
}

/* -------------------------------------------------------------------- main */
try {
  if (args.removeWatch) { removeWatch(); process.exit(0); }
  if (args.installWatch) {
    const c = checkInstalled();
    if (!c.ok) { log(c.why); try { installNow(); } catch (e) { console.error(`lootfilter: ${e?.message || e}`); } }
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
  console.error(`lootfilter: ${e?.stack || e}`);
  process.exit(1);
}
