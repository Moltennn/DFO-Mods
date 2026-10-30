/*
 * DFO Online mods - the served build, opened for writing.
 *
 * One job: find the version folder the game will play (a staged channel
 * release, the current one, or a local overlay of the bundled build), open
 * it as a store, and let an installer read/write/remove served files while
 * keeping index.json in step. The rules are the game's own (gameStore.cjs):
 *   - a version folder holds only files that differ from the seed;
 *   - index.json is written whole, atomically, as the last step;
 *   - a path the index does not name is not served.
 *
 * The same store is shared by every mod installer and by the loader; nothing
 * here knows what a "mod" is.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GAME_CHANNEL, GAME_ENTRY, sha256, nextVersion,
  gameRoot, versionDir, readJson, readState, readVersionIndex, chooseTarget,
  resolveSeed, writeFileAtomic, writeJsonAtomic,
} from './game.mjs';
import { MODS_DIR, readMarker, migrateDirs } from './marker.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** .../modloader */
export const MODLOADER_ROOT = path.resolve(HERE, '..');
/** the workspace this modloader sits in (holds extract/ and the mod folders) */
export const WORKSPACE_ROOT = path.resolve(MODLOADER_ROOT, '..');
export const DEFAULT_EXTRACT = path.join(WORKSPACE_ROOT, 'extract', 'squashfs-root', 'resources', 'app', 'dist');

export const ROOT = gameRoot();
export const STATE_FILE = path.join(ROOT, 'state.json');
const ORIGINALS = path.join(MODS_DIR, 'originals.json');

/** Nothing to do *right now*: the only source of a file is the bundled build,
 *  and it is readable only while the app is running/unpacked. Not an error. */
export class Deferred extends Error { }

/** The build the game will play, without writing anything. */
export function inspectTarget() {
  const state = readState(ROOT);
  if (!state) return { error: 'no state.json - launch the game once first' };
  const target = chooseTarget(ROOT, state);
  if (target) {
    const overlay = fs.existsSync(path.join(target.dir, '.dfo-overlay.json'));
    return { state, target, overlay };
  }
  return { state, target: null };
}

function requireSeed(version, { seedDir, app } = {}) {
  const seed = resolveSeed(version, { extractDir: seedDir || DEFAULT_EXTRACT, app });
  if (!seed) return null;
  if (seed.version !== version) { seed.close(); return null; }
  return seed;
}

/**
 * The build to patch, planning the local overlay when there is nothing
 * staged. This is the writing half of inspectTarget: a fresh AppImage leaves
 * the store seed-only, and the game cannot be served from a folder it does
 * not name - so an overlay version folder (seed + 1) is created here.
 */
export function resolveBuild({ seedDir = null, app = null, noOverlay = false, log = () => {} } = {}) {
  migrateDirs();
  const state = readState(ROOT);
  if (!state) return { error: 'no state.json - launch the game once first' };

  const target = chooseTarget(ROOT, state);
  if (target) {
    const seed = requireSeed(state.seed, { seedDir, app });
    if (!seed) log(`warning: the seed v${state.seed} could not be read; files the release shares with the seed cannot be patched`);
    const overlay = fs.existsSync(path.join(target.dir, '.dfo-overlay.json'));
    return { state, target, seed, overlay, fresh: false };
  }

  if (state.current) {
    return { error: `v${state.current} is current but its index does not read - start the game once so the store settles, then retry` };
  }
  if (noOverlay) {
    return { error: `the game plays its bundled copy (v${state.seed}); nothing is staged and --no-overlay is set` };
  }

  const seed = requireSeed(state.seed, { seedDir, app });
  if (!seed) {
    return {
      error: `the game plays its bundled copy (v${state.seed}), but that build's files could not be read - start the game (its AppImage is mounted while it runs), or pass --seed=<extracted dist>`,
    };
  }
  const seedJson = seed.seed();
  if (!seedJson || seedJson.channel !== GAME_CHANNEL || seedJson.version !== state.seed ||
      !Array.isArray(seedJson.files) || !seedJson.files.some((f) => f.path === GAME_ENTRY)) {
    seed.close();
    return { error: `the bundled copy of v${state.seed} did not yield a usable file list` };
  }

  // Reclaim an overlay from an older seed this tool built (the store sweeps
  // them on its own, but a fresh seed may arrive without the game opening).
  const marker = readMarker();
  const version = nextVersion(state.seed);
  if (marker?.overlay && marker.version && marker.version !== version) {
    const old = versionDir(ROOT, marker.version);
    if (marker.version !== state.current && marker.version !== state.ready) {
      try { fs.rmSync(old, { recursive: true, force: true }); } catch { /* swept already */ }
    }
  }

  const dir = versionDir(ROOT, version);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  writeJsonAtomic(path.join(dir, '.dfo-overlay.json'), { version, seed: state.seed, at: new Date().toISOString() });
  const index = {
    channel: GAME_CHANNEL,
    version,
    // every file of the bundled build, owned by the seed - exactly what the
    // store's own readIndex expects of a version folder
    files: seedJson.files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, own: false })),
  };
  const byPath = new Map(index.files.map((f) => [f.path, f]));
  log(`no channel build staged - building a local overlay v${version} from the bundled v${state.seed}`);
  return {
    state, seed, overlay: true, fresh: true,
    target: { version, dir, files: path.join(dir, 'files'), index, byPath, kind: 'overlay', live: state.seed },
  };
}

/** Migrate, resolve, open. The call every installer starts with. */
export function prepare(opts) {
  const build = resolveBuild(opts);
  if (build.error) return build;
  return { ...build, store: openStore(build.target, build.seed) };
}

/**
 * The version folder being patched.
 *   read(rel)   bytes as served now -> { bytes, where } | null
 *   write(rel, bytes) -> bool (false when already exactly that)
 *   remove(rel) -> bool (restore the release's copy, or drop a mod-owned file)
 *   findChunk({prefixes, maxSize, fallbackMinSize, test}) -> chunk
 *   commit()    one atomic index write
 */
export function openStore(target, seed) {
  migrateDirs();
  const { version, dir, files: vFiles, index, byPath } = target;
  fs.mkdirSync(MODS_DIR, { recursive: true });
  const dirty = [];

  function read(rel) {
    const own = path.join(vFiles, rel);
    if (fs.existsSync(own)) return { bytes: fs.readFileSync(own), where: 'version' };
    const fromSeed = seed ? seed.read(rel) : null;
    if (fromSeed) return { bytes: fromSeed, where: 'seed' };
    return null;
  }

  /** The release's own copy of `rel`, once - keyed by version so a later
   *  release's uninstall can never restore an older release's file. A file
   *  the release kept in the seed has no bytes here; its index entry is kept
   *  so uninstall can hand it back to the seed. */
  function backup(rel) {
    const rec = readJson(ORIGINALS) || {};
    const key = `${version}::${rel}`;
    const own = path.join(vFiles, rel);
    const exists = fs.existsSync(own);
    if (rec[key] && !(rec[key].ownFileExisted === false && exists)) return;
    const bytes = exists ? fs.readFileSync(own) : null;
    const e = byPath.get(rel);
    rec[key] = {
      version,
      ownFileExisted: !!bytes,
      ...(bytes ? { b64: bytes.toString('base64') } : {}),
      ...(e ? { index: { size: e.size, sha256: e.sha256, own: !!e.own } } : {}),
    };
    writeJsonAtomic(ORIGINALS, rec);
  }

  /** A file this tool owns (a mod module, the loader, the registry) is
   *  created by us and deleted by us - it has no release original to keep. */
  function forgetBackup(rel) {
    const rec = readJson(ORIGINALS) || {};
    const key = `${version}::${rel}`;
    if (!(key in rec)) return;
    delete rec[key];
    writeJsonAtomic(ORIGINALS, rec);
  }

  function write(rel, bytes, { owned = false } = {}) {
    const dst = path.join(vFiles, rel);
    const hash = sha256(bytes);
    const e = byPath.get(rel);
    if (e && e.own && e.size === bytes.length && e.sha256 === hash && fs.existsSync(dst)) {
      if (owned) forgetBackup(rel); // a stale "original" must not survive
      return false;
    }
    if (owned) forgetBackup(rel); else backup(rel);
    writeFileAtomic(dst, bytes);
    if (e) Object.assign(e, { size: bytes.length, sha256: hash, own: true });
    else { const rec = { path: rel, size: bytes.length, sha256: hash, own: true }; index.files.push(rec); byPath.set(rel, rec); }
    dirty.push(rel);
    return true;
  }

  /** Put `rel` back the way the release serves it. A file this tool created
   *  (`owned`, or no backup record) is deleted and dropped from the index. */
  function remove(rel, { owned = false } = {}) {
    const rec = readJson(ORIGINALS) || {};
    const key = `${version}::${rel}`;
    const r = owned ? null : rec[key];
    const dst = path.join(vFiles, rel);
    const existed = fs.existsSync(dst);
    let changed = false;
    if (r?.ownFileExisted && r.b64) {
      writeFileAtomic(dst, Buffer.from(r.b64, 'base64'));
      const e = byPath.get(rel);
      if (e) Object.assign(e, { size: Buffer.from(r.b64, 'base64').length, sha256: sha256(Buffer.from(r.b64, 'base64')), own: true });
      changed = true;
    } else if (r?.index) {
      try { fs.rmSync(dst); } catch { /* gone */ }
      const e = byPath.get(rel);
      if (e) Object.assign(e, { size: r.index.size, sha256: r.index.sha256, own: !!r.index.own });
      changed = existed;
    } else {
      try { if (existed) { fs.rmSync(dst); changed = true; } } catch { /* gone */ }
      if (byPath.has(rel)) {
        byPath.delete(rel);
        const at = index.files.findIndex((f) => f.path === rel);
        if (at >= 0) index.files.splice(at, 1);
        changed = true;
      }
    }
    if (key in rec) { delete rec[key]; writeJsonAtomic(ORIGINALS, rec); }
    if (changed) dirty.push(rel);
    return changed;
  }

  function findChunk({ prefixes = [], maxSize = Infinity, fallbackMinSize = 0, test }) {
    const assets = index.files.filter((f) =>
      f.path.startsWith('assets/') && f.path.endsWith('.js') && f.size <= maxSize);
    const pref = (f) => prefixes.some((p) => path.posix.basename(f.path).startsWith(p));
    const ordered = [
      ...assets.filter(pref),
      ...assets.filter((f) => !pref(f) && f.size >= fallbackMinSize),
    ];
    const seen = new Set();
    for (const f of ordered) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      const got = read(f.path);
      if (!got) continue;
      const text = got.bytes.toString('utf8');
      if (test(text)) return { rel: f.path, text, where: got.where };
    }
    return null;
  }

  function commit() {
    if (!dirty.length) return;
    writeJsonAtomic(path.join(dir, 'index.json'), index);
  }

  /** What to record in installed.json for a set of served files. */
  function fileMap(rels) {
    const out = {};
    for (const rel of rels) {
      const e = byPath.get(rel);
      if (!e || !e.own) throw new Error(`${rel} is not in the index as an own file`);
      out[rel] = { size: e.size, sha256: e.sha256 };
    }
    return out;
  }

  return { version, dir, vFiles, index, byPath, dirty, read, write, remove, findChunk, commit, fileMap };
}

/** After the index is whole, name a fresh overlay in state.json. Keeps any
 *  release the channel staged meanwhile; the game still plays that next. */
export function finalizeOverlay(build) {
  if (!build.overlay || !build.fresh) return;
  const store = build.store;
  if (!readVersionIndex(ROOT, store.version)) throw new Error('the overlay did not read back - aborting');
  const now = readState(ROOT) || build.state;
  writeJsonAtomic(STATE_FILE, { ...now, current: store.version, previous: null, trial: false, tries: 0 });
  if (!fs.existsSync(path.join(store.dir, 'index.json'))) throw new Error('the overlay was swept before the store could name it - retry');
}

