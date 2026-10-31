/*
 * DFO Online mods - a read-only view of the build the game plays.
 *
 * `openBuild` finds what the launcher would serve: the version folder the store
 * plays (its own files, else the bundled build's), or the bundled build alone.
 * `viewOf` wraps it in the calls the mod patches make (read, write, findChunk,
 * index). A write lands in the view's own map and never in the store, so the
 * patches can run against any build the channel brings, as often as it brings
 * them.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, GAME_ENTRY, gameRoot, readState, chooseTarget, resolveSeed } from './game.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MODLOADER_ROOT = path.resolve(HERE, '..');
export const WORKSPACE_ROOT = path.resolve(MODLOADER_ROOT, '..');
const DEFAULT_EXTRACT = path.join(WORKSPACE_ROOT, 'extract', 'squashfs-root', 'resources', 'app', 'dist');

export const ROOT = gameRoot();

/** The build the game plays now, or `{ error }` when it cannot be read yet. */
export function openBuild({ app = null } = {}) {
  const state = readState(ROOT);
  if (!state) return { error: 'no state.json - launch the game once first' };
  const seed = resolveSeed(state.seed, { extractDir: DEFAULT_EXTRACT, app });
  const target = chooseTarget(ROOT, state);
  if (target) {
    return {
      version: target.version,
      files: target.index.files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, own: !!f.own })),
      read(rel) {
        const e = target.byPath.get(rel);
        if (!e) return null;
        if (e.own) {
          try { return fs.readFileSync(path.join(target.files, rel)); } catch { return null; }
        }
        return seed ? seed.read(rel) : null;
      },
      seed,
    };
  }
  if (!seed) {
    return { error: `the game plays its bundled copy (v${state.seed}) and it cannot be read - start the game once, or pass --app=` };
  }
  const listing = seed.seed()?.files ?? [];
  return {
    version: state.seed,
    files: listing.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, own: false })),
    read: (rel) => seed.read(rel),
    seed,
  };
}

/** A mutable view over `build`: writes stay in memory. */
export function viewOf(build) {
  const entries = new Map(build.files.map((f) => [f.path, { ...f }]));
  const overlay = new Map();
  const index = { files: [...entries.values()] };

  const read = (rel) => {
    if (overlay.has(rel)) return { bytes: overlay.get(rel), where: 'overlay' };
    const bytes = build.read(rel);
    return bytes ? { bytes, where: 'build' } : null;
  };

  return {
    version: build.version,
    index,
    read,
    /** Stores `bytes` for `rel` in this view. False when it already holds exactly that. */
    write(rel, bytes) {
      const hash = sha256(bytes);
      const e = entries.get(rel);
      if (e && e.own && e.size === bytes.length && e.sha256 === hash) return false;
      overlay.set(rel, bytes);
      if (e) Object.assign(e, { size: bytes.length, sha256: hash, own: true });
      else {
        const n = { path: rel, size: bytes.length, sha256: hash, own: true };
        entries.set(rel, n);
        index.files.push(n);
      }
      return true;
    },
    /** The first served .js file (under assets/) whose text passes `test`. */
    findChunk({ prefixes = [], maxSize = Infinity, fallbackMinSize = 0, test }) {
      const assets = index.files.filter((f) => f.path.startsWith('assets/') && f.path.endsWith('.js') && f.size <= maxSize);
      const pref = (f) => prefixes.some((p) => path.posix.basename(f.path).startsWith(p));
      const ordered = [...assets.filter(pref), ...assets.filter((f) => !pref(f) && f.size >= fallbackMinSize)];
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
    },
    /** Patches call this when they are done; the view needs no index write. */
    commit() {},
    /** A copy of this view's state, to put back if a patch fails part way. */
    snapshot() {
      return { overlay: new Map(overlay), entries: [...entries].map(([k, v]) => [k, { ...v }]) };
    },
    restore(snap) {
      overlay.clear();
      for (const [k, v] of snap.overlay) overlay.set(k, v);
      entries.clear();
      for (const [k, v] of snap.entries) entries.set(k, v);
      index.files = [...entries.values()];
    },
    /** The bytes this view changed, by path. */
    changed() {
      return overlay;
    },
  };
}
