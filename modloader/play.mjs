#!/usr/bin/env node
/*
 * DFO Online (Mods) - start the game with the mods applied.
 *
 *   node modloader/play.mjs [--app=<AppImage | exe | .app | app folder>] [-- game arguments]
 *
 * Starts a server on 127.0.0.1 (lib/serve.mjs) that serves the game's files with
 * the mods applied, then starts the launcher with DAGGER_DEV_URL pointing at it.
 * The wrapper stays up while the game runs and stops the server when it closes.
 * Nothing in the game store is written.
 *
 * The resolved game path is remembered in modloader/game-path.txt (local only).
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runningAppAsars, installedAppAsars } from './lib/game.mjs';
import { startServer } from './lib/serve.mjs';
import { MODLOADER_ROOT } from './lib/view.mjs';

const argv = process.argv.slice(2);
const APP_ARG = (argv.find((a) => a.startsWith('--app=')) || '').slice('--app='.length)
  || process.env.DFO_GAME || null;
const GAME_ARGS = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : [];
const GAME_FILE = path.join(MODLOADER_ROOT, 'game-path.txt');
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
  for (const asar of installedAppAsars()) {
    const app = normalize(asar);
    if (app) return app;
  }
  return null;
}

/** The program to run for `app`: the .app's own binary on macOS, else the file itself. */
function programOf(app) {
  if (process.platform !== 'darwin' || !/\.app$/i.test(app)) return app;
  const dir = path.join(app, 'Contents', 'MacOS');
  const bin = fs.readdirSync(dir)[0];
  return bin ? path.join(dir, bin) : app;
}

/* ------------------------------------------------------------------- main */
const app = findLauncher();
if (!app) {
  console.error('[dfo-mods] could not find the game. Pass it once:');
  console.error('  node modloader/play.mjs --app="/path/to/DFO Online"');
  process.exit(1);
}
try { fs.writeFileSync(GAME_FILE, `${app}\n`); } catch { /* read-only workspace */ }

/* One wrapper per folder: a second press of the shortcut takes over from the
 * first (its server is replaced), so two servers can never answer one game. */
const LOCK = path.join(MODLOADER_ROOT, 'play.pid');
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
try {
  const pid = Number(fs.readFileSync(LOCK, 'utf8').trim());
  if (pid && pid !== process.pid && alive(pid)) {
    say(`replacing the earlier launcher (pid ${pid})`);
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    for (let i = 0; i < 10 && alive(pid); i++) await sleep(200);
  }
} catch { /* no earlier wrapper */ }
try { fs.writeFileSync(LOCK, `${process.pid}\n`); } catch { /* read-only workspace */ }
const dropLock = () => { try { if (Number(fs.readFileSync(LOCK, 'utf8').trim()) === process.pid) fs.rmSync(LOCK, { force: true }); } catch { /* gone */ } };
process.on('exit', dropLock);
process.on('SIGTERM', () => { dropLock(); process.exit(0); });
process.on('SIGINT', () => { dropLock(); process.exit(0); });

// A game started a moment ago (the shortcut was pressed twice, or it is still
// loading) is not a reason to refuse: wait for it to settle, then check again.
for (let i = 0; i < 20 && runningAppAsars().length > 0; i++) {
  if (i === 0) say('the game is already running - waiting for it to close');
  await sleep(1000);
}
if (runningAppAsars().length > 0) {
  console.error('[dfo-mods] the game is still running. Close it, then start again - it must start through this launcher to get the mods.');
  process.exit(1);
}

const server = await startServer({ app, log: say });
say(`serving the game at ${server.url}`);

const program = programOf(app);
const env = { ...process.env, DAGGER_DEV_URL: server.url };
if (!/\.AppImage$/i.test(program)) env.APPDIR = path.dirname(program);
const child = spawn(program, GAME_ARGS, { cwd: path.dirname(app), env, stdio: 'ignore' });
say(`starting ${path.basename(app)}`);

child.on('error', (e) => {
  console.error(`[dfo-mods] could not start ${program}: ${e.message}`);
  server.close();
  process.exit(1);
});

child.on('exit', async (code) => {
  // The launcher can restart itself (an update); keep serving while a game is up.
  await sleep(3000);
  while (runningAppAsars().length > 0) await sleep(2000);
  say(`the game closed (${code ?? 'signal'})`);
  server.close();
  process.exit(0);
});
