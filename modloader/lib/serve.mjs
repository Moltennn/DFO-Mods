/*
 * DFO Online mods - the game's files, served from this machine with the mods
 * applied.
 *
 * The launcher is started with DAGGER_DEV_URL pointing here (play.mjs), so the
 * game window loads its pages from this server instead of dagger://. Every
 * request is answered from the build the store plays, read through a view
 * (view.mjs) that the mods' patches write into in memory. The store is never
 * written, so a channel update cannot undo a patch: the next request sees the
 * new build and the patches run against it again.
 *
 * What it adds to the game's own pages:
 *   play/index.html               one <script type="module"> for the loader
 *   assets/dfo-mods/boot.js       the loader (modloader/boot.js)
 *   assets/dfo-mods/registry.js   which mods applied to this build
 *   the mods' changed chunks and module files, as patched
 */
'use strict';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { GAME_ENTRY, userDataDir } from './game.mjs';
import { ROOT, MODLOADER_ROOT, openBuild, viewOf } from './view.mjs';
import { discoverMods, runPatches, renderRegistry } from './mods.mjs';

const BOOT = path.join(MODLOADER_ROOT, 'boot.js');
const BOOT_REL = 'assets/dfo-mods/boot.js';
const REGISTRY_REL = 'assets/dfo-mods/registry.js';
const TAG = '<script type="module" src="../assets/dfo-mods/boot.js"></script>';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const mimeOf = (rel) => MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream';

/**
 * The patched build, rebuilt when the store's state changes (a channel update).
 *
 * A session is PINNED to the build its page loaded from: pages name their chunks
 * (`weaponRig-ip_E-Xp2.js`), and a new build has different names - switching the
 * view under an open page would 404 the game's own imports. So a request for the
 * game's entry page pins the current build, and everything after it answers from
 * that build. A file the pinned build does not have is read from the newest build
 * (or the seed), so a chunk load that starts after an update still resolves.
 */
function buildCache({ app, log }) {
  let key = null;
  let pending = null;
  let pinned = null;
  let pinnedKey = null;
  const stateKey = () => {
    try { const st = fs.statSync(path.join(ROOT, 'state.json')); return `${st.mtimeMs}:${st.size}`; } catch { return 'none'; }
  };
  async function buildNow(k) {
    const build = openBuild({ app });
    if (build.error) throw new Error(build.error);
    const view = viewOf(build);
    const mods = await discoverMods();
    const out = runPatches(view, mods, log);
    log(`build v${build.version}: ${out.registry.length} mod${out.registry.length === 1 ? '' : 's'} applied`
      + (out.failed.length ? `, ${out.failed.length} not applied` : ''));
    return { key: k, version: build.version, view, registry: out.registry, failed: out.failed };
  }
  return {
    /** The newest build (what the store plays now). */
    current() {
      const k = stateKey();
      if (pending && key === k) return pending;
      key = k;
      pending = buildNow(k);
      pending.catch(() => { if (key === k) { key = null; pending = null; } });
      return pending;
    },
    /** The build this session answered from: pinned at its entry page. */
    pinned() {
      if (pinned && pinnedKey === key) return pinned;
      pinned = null;
      return null;
    },
    async pin() {
      const k = stateKey();
      if (pinned && pinnedKey === k) return pinned;
      pinned = await this.current();
      pinnedKey = k;
      log(`session pinned to v${pinned.version}`);
      return pinned;
    },
  };
}

function arena2File(name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  let dir = null;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(userDataDir(), 'config.json'), 'utf8'));
    dir = typeof cfg.arena2Path === 'string' ? cfg.arena2Path : null;
  } catch { return null; }
  if (!dir) return null;
  try {
    const hit = fs.readdirSync(dir).find((f) => f.toUpperCase() === name.toUpperCase());
    return hit ? fs.readFileSync(path.join(dir, hit)) : null;
  } catch { return null; }
}

function injectTag(bytes) {
  const html = bytes.toString('utf8');
  if (html.includes('dfo-mods/boot.js') || !html.includes('</body>')) return bytes;
  return Buffer.from(html.replace('</body>', `  ${TAG}\n</body>`), 'utf8');
}

function send(res, status, type, body = 'not found') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

async function respond(req, res, get) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).split('/').filter(Boolean).join('/');
  } catch {
    return send(res, 400, 'text/plain', 'bad request');
  }
  if (rel === BOOT_REL) return send(res, 200, MIME['.js'], fs.readFileSync(BOOT));

  const arena = /^(?:play\/)?arena2\/([^/]+)$/.exec(rel);
  if (arena) {
    const body = arena2File(arena[1]);
    return body ? send(res, 200, 'application/octet-stream', body) : send(res, 404, 'text/plain');
  }

  if (rel === '') rel = GAME_ENTRY;
  let build;
  try {
    // the game's own page starts a session: pin the build it loads from
    build = rel === GAME_ENTRY ? await get.pin() : (get.pinned() ?? await get.current());
  } catch (e) {
    return send(res, 503, 'text/plain', `the build is not readable yet: ${e.message}`);
  }
  if (rel === REGISTRY_REL) return send(res, 200, MIME['.js'], renderRegistry(build.registry));

  let hit = build.view.read(rel);
  if (!hit) {
    const index = `${rel}/index.html`;
    const alt = build.view.read(index);
    if (alt) { hit = alt; rel = index; }
  }
  if (!hit && build !== (get.pinned() ?? build)) {
    // a chunk the page asks for that the pinned build does not have: the newest
    // build's copy is still a file of the game
    try {
      const fresh = await get.current();
      if (fresh !== build) {
        hit = fresh.view.read(rel);
        if (hit) log(`${rel} is not in v${build.version} - served from v${fresh.version}`);
      }
    } catch { /* leave the 404 */ }
  }
  if (!hit) return send(res, 404, 'text/plain');
  const body = rel === GAME_ENTRY ? injectTag(hit.bytes) : hit.bytes;
  return send(res, 200, mimeOf(rel), body);
}

/**
 * The port the game is served on. It is FIXED on purpose: the page's origin
 * (host and port) is where the browser keeps localStorage - the mods' settings -
 * and the game's in-page data-folder pick. A new port every launch would look
 * like a new site and lose both. DFO_MODS_PORT overrides it; if it is taken the
 * server falls back to a free port for that launch only (settings do not carry
 * across that launch).
 */
export const DEFAULT_PORT = 47831;

/** Start the server on 127.0.0.1. `app` names the launcher, for the bundled build. */
export function startServer({ app = null, log = () => {}, port = Number(process.env.DFO_MODS_PORT) || DEFAULT_PORT } = {}) {
  const get = buildCache({ app, log });
  const server = http.createServer((req, res) => {
    respond(req, res, get).catch((e) => {
      log(`request failed: ${e?.message || e}`);
      if (!res.headersSent) send(res, 500, 'text/plain', 'error');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code !== 'EADDRINUSE' || !port) { reject(e); return; }
      log(`port ${port} is taken by another program - using a free port for this launch (mod settings will not carry over)`);
      server.listen(0, '127.0.0.1', () => resolve(done()));
    });
    server.once('listening', () => resolve(done()));
    server.listen(port, '127.0.0.1');
    const done = () => ({
      url: `http://127.0.0.1:${server.address().port}/${GAME_ENTRY}`,
      close: () => server.close(),
      get,
    });
  });
}

