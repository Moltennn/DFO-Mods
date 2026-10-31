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

/** The patched build, rebuilt when the store's state changes (a channel update). */
function buildCache({ app, log }) {
  let key = null;
  let pending = null;
  const stateKey = () => {
    try { const st = fs.statSync(path.join(ROOT, 'state.json')); return `${st.mtimeMs}:${st.size}`; } catch { return 'none'; }
  };
  return function get() {
    const k = stateKey();
    if (pending && key === k) return pending;
    key = k;
    pending = (async () => {
      const build = openBuild({ app });
      if (build.error) throw new Error(build.error);
      const view = viewOf(build);
      const mods = await discoverMods();
      const out = runPatches(view, mods, log);
      log(`build v${build.version}: ${out.registry.length} mod${out.registry.length === 1 ? '' : 's'} applied`
        + (out.failed.length ? `, ${out.failed.length} not applied` : ''));
      return { version: build.version, view, registry: out.registry, failed: out.failed };
    })();
    pending.catch(() => { if (key === k) { key = null; pending = null; } });
    return pending;
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

  let build;
  try { build = await get(); } catch (e) { return send(res, 503, 'text/plain', `the build is not readable yet: ${e.message}`); }
  if (rel === REGISTRY_REL) return send(res, 200, MIME['.js'], renderRegistry(build.registry));

  if (rel === '') rel = GAME_ENTRY;
  let hit = build.view.read(rel);
  if (!hit) {
    const index = `${rel}/index.html`;
    const alt = build.view.read(index);
    if (alt) { hit = alt; rel = index; }
  }
  if (!hit) return send(res, 404, 'text/plain');
  const body = rel === GAME_ENTRY ? injectTag(hit.bytes) : hit.bytes;
  return send(res, 200, mimeOf(rel), body);
}

/** Start the server on 127.0.0.1 (an OS-chosen port). `app` names the launcher, for the bundled build. */
export function startServer({ app = null, log = () => {} } = {}) {
  const get = buildCache({ app, log });
  const server = http.createServer((req, res) => {
    respond(req, res, get).catch((e) => {
      log(`request failed: ${e?.message || e}`);
      if (!res.headersSent) send(res, 500, 'text/plain', 'error');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}/${GAME_ENTRY}`,
      close: () => server.close(),
      get,
    }));
  });
}

