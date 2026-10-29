#!/usr/bin/env node
/*
 * DFO Online - Loot Filter installer.
 *
 * A MOD installer: it assumes the shared loader (../modloader) and asks it to
 * install itself first. It owns exactly its own pieces:
 *
 *   assets/propBodies-*.js      the generic row-filter hook (kept idempotent so
 *                               UI Tweaks and this mod can both guarantee it)
 *   assets/dfo-lootfilter.js    the mod (rules + ESC pane)
 *   assets/dfo-mods/registry.js one entry pointing at the mod
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
  const A = '=pLe({oneVoice:';
  if (!text.includes(A)) return { text, missing: true };
  return { text: text.replace(A, '=globalThis.__dfoFoes=pLe({oneVoice:'), changed: true };
}

/* The corpse body is drawn by the foe renderer: a dead foe with a corpse is
 * "stood" as a foe body. Skip that draw when the filter hides the whole body. */
const CORPSE_RX = /([A-Za-z0-9_$]+)\.dead&&\1\.corpse&&!\1\.corpseDestroyed&&/;

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
        test: (t) => ROW_RX.test(t) || t.includes('lootLabel') || t.includes(ROW_HOOK),
      });
      if (!rows) deferOrDie('the plaque row chunk was not found and the bundled build is not readable - start the game, then retry', seed);
      const hook = ensureRowFilter(rows.text);
      if (hook.missing) die('the plaque row filter anchor was not found - aborting (nothing written)');
      if (hook.changed) log(`  patched ${rows.rel} (row filter hook)`);
      else log(`  row filter hook already present (${rows.rel})`);
      store.write(rows.rel, Buffer.from(hook.text));
      checks.push({ rel: rows.rel, has: ROW_HOOK });
    }

    // ---- 3. the corpse body draw ----------------------------------------
    {
      const bodies = store.findChunk({ test: (t) => t.includes('hideCorpse') || CORPSE_RX.test(t) });
      if (!bodies) deferOrDie('the foe-body renderer was not found and the bundled build is not readable - start the game, then retry', seed);
      let text = bodies.text;
      if (text.includes('hideCorpse')) log(`  corpse body guard already applied (${bodies.rel})`);
      else {
        const m = text.match(CORPSE_RX);
        if (!m) die('the corpse body draw anchor was not found - aborting (nothing written)');
        text = text.replace(CORPSE_RX, `${m[1]}.dead&&${m[1]}.corpse&&!${m[1]}.corpseDestroyed&&!(globalThis.__dfoRowFilter?.hideCorpse?.(${m[1]}))&&`);
        log(`  patched ${bodies.rel} (corpse body draw)`);
      }
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
