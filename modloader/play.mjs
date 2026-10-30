#!/usr/bin/env node
/*
 * DFO Online mods - launch the game and sync the mods first.
 *
 * There is no background service. This script starts the game, waits for the
 * build it bundles ("seed") to become readable, runs `sync.mjs` once, and then
 * leaves the launcher open for you to press Play. On a desktop/macOS install
 * the seed is on disk, so it syncs before the launcher even starts; on Linux
 * the AppImage's mount only appears after launch, so it waits for that.
 *
 *   node modloader/play.mjs [--app=<AppImage|exe|.app|app folder|app.asar>]
 *                           [--sync-only] [--dry-run] [game arguments...]
 *
 * The resolved game path is remembered in modloader/game-path.txt (local only).
 * If the game is already running, only the sync runs.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { readState, resolveSeed, runningAppAsars, installedAppAsars } from './lib/game.mjs';
import { MODLOADER_ROOT, DEFAULT_EXTRACT } from './lib/store.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const SYNC_ONLY = argv.includes('--sync-only');
const APP_ARG = (argv.find((a) => a.startsWith('--app=')) || '').slice('--app='.length)
  || process.env.DFO_GAME || null;
const GAME_ARGS = argv.filter((a) => !a.startsWith('--app=') && a !== '--dry-run' && a !== '--sync-only');
const GAME_FILE = path.join(MODLOADER_ROOT, 'game-path.txt');
const SYNC = path.join(MODLOADER_ROOT, 'sync.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const say = (msg) => console.log(`[dfo-mods] ${msg}`);

/* ------------------------------------------------------- find the launcher */
/** An exe beside a Windows `resources/` folder (the setup/portable install). */
function exeIn(dir) {
  try {
    const names = fs.readdirSync(dir);
    const hit = names.find((n) => /\.exe$/i.test(n) && !/unins|update/i.test(n));
    return hit ? path.join(dir, hit) : null;
  } catch { return null; }
}
/** The `.app` around `…/Contents/Resources/app.asar`. */
function appFromAsar(asar) {
  const m = /^(.*?\.app)\/Contents\/Resources\/app\.asar$/.exec(asar);
  return m ? m[1] : null;
}
/** Accept what the user may point at and return something launchable. */
function normalize(p) {
  if (!p) return null;
  const abs = path.resolve(p);
  if (/\.(AppImage|exe|app)$/i.test(abs)) return fs.existsSync(abs) ? abs : null;
  if (/\.asar$/i.test(abs)) {
    if (process.platform === 'darwin') return appFromAsar(abs);
    if (process.platform === 'win32') return exeIn(path.dirname(path.dirname(abs)));
    return null; // a Linux mount is not launchable
  }
  if (/\.app$/i.test(abs) && fs.existsSync(abs)) return abs;
  if (fs.existsSync(path.join(abs, 'resources', 'app.asar'))) {
    if (process.platform === 'win32') return exeIn(abs);
    if (process.platform === 'darwin') return abs;
  }
  // a plain executable the user pointed at
  try { if (fs.statSync(abs).isFile()) return abs; } catch { /* no */ }
  return null;
}
/** The AppImage/setup/portable/.app to start. */
function findLauncher() {
  const saved = (() => { try { return fs.readFileSync(GAME_FILE, 'utf8').trim(); } catch { return ''; } })();
  const explicit = normalize(APP_ARG) || normalize(saved);
  if (explicit) return explicit;

  const root = path.dirname(MODLOADER_ROOT);
  if (process.platform === 'linux') {
    try {
      const appimage = fs.readdirSync(root).find((n) => /\.AppImage$/i.test(n));
      if (appimage) return path.join(root, appimage);
    } catch { /* no workspace */ }
  }
  // a Windows/macOS install: derive it from the bundled app.asar
  for (const asar of installedAppAsars()) {
    const app = normalize(asar);
    if (app) return app;
  }
  return null;
}

function running() {
  return runningAppAsars().length > 0;
}
function launch(app) {
  say(`starting ${path.basename(app)}`);
  if (process.platform === 'darwin') {
    const r = spawn('open', ['-a', app, ...(GAME_ARGS.length ? ['--args', ...GAME_ARGS] : [])], {
      detached: true, stdio: 'ignore',
    });
    r.unref();
    return;
  }
  const r = spawn(app, GAME_ARGS, { cwd: path.dirname(app), detached: true, stdio: 'ignore' });
  r.on('error', (e) => { console.error(`[dfo-mods] could not start ${app}: ${e.message}`); process.exitCode = 1; });
  r.unref();
}

/* --------------------------------------------------------------- the work */
function readTheState() {
  try { return readState(); } catch { return null; }
}
function seedReady(state) {
  if (!state || !state.seed) return null;
  const seed = resolveSeed(state.seed, { extractDir: DEFAULT_EXTRACT });
  if (!seed) return null;
  const version = seed.version;
  try { seed.close?.(); } catch { /* already closed */ }
  return version;
}
async function waitForSeed(seconds = 45) {
  const state = readTheState();
  if (!state) return null;
  for (let i = 0; i < seconds * 2; i++) {
    const v = seedReady(state);
    if (v) return v;
    await sleep(500);
  }
  return null;
}
function syncNow() {
  say('syncing the loader and every mod');
  const r = spawnSync(process.execPath, [SYNC], { cwd: MODLOADER_ROOT, stdio: 'inherit' });
  if (r.error) { console.error(`[dfo-mods] sync failed: ${r.error.message}`); return 1; }
  return r.status == null ? 1 : r.status;
}

/* ------------------------------------------------------------------- main */
if (SYNC_ONLY) {
  const code = syncNow();
  process.exit(code);
}
const app = findLauncher();
if (!app) {
  console.error('[dfo-mods] could not find the game. Pass it once:');
  console.error('  node modloader/play.mjs --app="/path/to/DFO Online"');
  process.exit(1);
}
if (DRY) {
  console.log(`game: ${app}`);
  console.log(`sync: ${process.execPath} ${SYNC}`);
  process.exit(0);
}
try { fs.writeFileSync(GAME_FILE, `${app}\n`); } catch { /* read-only workspace */ }

// Already running (e.g. the shortcut was used again): just sync, no second copy.
if (running()) {
  say('the game is already running - syncing mods');
  syncNow();
  process.exit(0);
}

const state = readTheState();
const versionBefore = seedReady(state);
if (versionBefore) {
  // Installed macOS/Windows build: the seed is on disk, so sync before launch.
  say(`seed v${versionBefore} is readable - syncing before launch`);
  syncNow();
  launch(app);
  say('mods are in place. Press Play in the launcher.');
} else {
  launch(app);
  const version = await waitForSeed();
  if (version) say(`seed v${version} is readable - syncing`);
  else say('the seed did not appear within 45s - syncing anyway (it may defer)');
  syncNow();
  say('mods are in place. Press Play in the launcher.');
}
