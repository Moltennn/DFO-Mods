#!/usr/bin/env node
/*
 * DFO Online - serve the game from a local address (prototype).
 *
 *   node modloader/serve.mjs [--app=<AppImage | AppRun | exe | .app>]
 *
 * The launcher can load its game window from a URL (DAGGER_DEV_URL, the same
 * switch the dev loop uses). This script starts a server on 127.0.0.1 that
 * answers for the game's files - the version the store plays (its own files,
 * else the bundled build's), read on every request and never written - and then
 * starts the launcher with DAGGER_DEV_URL pointing at it. Nothing in the store
 * changes, so a channel update cannot wipe anything made here.
 *
 * Only the lifetime of this process: it stops the server when the game exits.
 */
'use strict';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  gameRoot, userDataDir, readState, chooseTarget, resolveSeed, GAME_ENTRY,
} from './lib/game.mjs';
import { DEFAULT_EXTRACT, MODLOADER_ROOT } from './lib/store.mjs';

const ROOT = gameRoot();
const argv = process.argv.slice(2);
const APP_ARG = (argv.find((a) => a.startsWith('--app=')) || '').slice('--app='.length) || process.env.DFO_APP || null;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/* ------------------------------------------------------- what the game plays */
let cache = { key: null, target: null, seed: null };
/** The version the store plays, re-read when state.json changes. The bundled
 *  build is opened once it can be found (its AppImage is mounted while it runs). */
function currentBuild() {
  let key = null;
  try { const st = fs.statSync(path.join(ROOT, 'state.json')); key = `${st.mtimeMs}:${st.size}`; } catch { /* none */ }
  if (key !== cache.key) {
    const state = readState(ROOT);
    cache = { key, target: state ? chooseTarget(ROOT, state) : null, seed: cache.seed, state };
  }
  if (!cache.seed && cache.state) {
    const dir = APP_ARG ? (fs.statSync(APP_ARG, { throwIfNoEntry: false })?.isDirectory() ? APP_ARG : path.dirname(path.resolve(APP_ARG))) : null;
    cache.seed = resolveSeed(cache.state.seed, { extractDir: DEFAULT_EXTRACT, app: dir });
  }
  return cache;
}

/** The bytes the launcher would serve for `rel` (paths relative to dist/), or null. */
function fileFor(rel) {
  const { target, seed } = currentBuild();
  if (target) {
    const e = target.byPath.get(rel);
    if (!e) return null;                       // a path the version does not name is not served
    if (e.own) {
      try { return fs.readFileSync(path.join(target.files, rel)); } catch { return null; }
    }
  }
  return seed ? seed.read(rel) : null;
}

/* ------------------------------------------------------------------- arena2 */
function arena2Dir() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(userDataDir(), 'config.json'), 'utf8'));
    return typeof cfg.arena2Path === 'string' ? cfg.arena2Path : null;
  } catch { return null; }
}
function arena2File(name) {
  const dir = arena2Dir();
  if (!dir || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  try {
    const hit = fs.readdirSync(dir).find((f) => f.toUpperCase() === name.toUpperCase());
    return hit ? fs.readFileSync(path.join(dir, hit)) : null;
  } catch { return null; }
}

/* -------------------------------------------------------------------- http */
function handle(req, res) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).split('/').filter(Boolean).join('/');
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  const arena = /^(?:play\/)?arena2\/([^/]+)$/.exec(rel);
  let body = null;
  if (arena) body = arena2File(arena[1]);
  else {
    if (rel === '') rel = GAME_ENTRY;
    body = fileFor(rel);
    if (!body) {
      const index = `${rel}/index.html`;
      body = fileFor(index);
      if (body) rel = index;
    }
  }
  if (!body) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function startServer() {
  const server = http.createServer(handle);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      close: () => server.close(),
    }));
  });
}

/* --------------------------------------------------------------- the launcher */
function findApp() {
  if (APP_ARG) return path.resolve(APP_ARG);
  if (process.platform === 'linux') {
    const root = path.dirname(MODLOADER_ROOT);
    const hit = fs.readdirSync(root).find((n) => /\.AppImage$/i.test(n));
    if (hit) return path.join(root, hit);
  }
  return null;
}

const app = findApp();
if (!app || !fs.existsSync(app)) {
  console.error('[dfo-mods] no game found. Pass it: node modloader/serve.mjs --app=<AppImage>');
  process.exit(1);
}
const { port, close } = await startServer();
const url = `http://127.0.0.1:${port}/play/index.html`;
console.log(`[dfo-mods] serving the game at ${url}`);
const APP_ARGS = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : [];
const child = spawn(app, APP_ARGS, {
  cwd: path.dirname(app),
  env: { ...process.env, APPDIR: path.dirname(app), DAGGER_DEV_URL: url },
  stdio: 'ignore',
});
child.on('error', (e) => { console.error(`[dfo-mods] could not start ${app}: ${e.message}`); close(); process.exit(1); });
child.on('exit', (code) => {
  console.log(`[dfo-mods] the game exited (${code ?? 'signal'})`);
  close();
  process.exit(0);
});
