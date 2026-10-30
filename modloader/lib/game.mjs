/*
 * DFO Online - the game store, read the way the game reads it.
 *
 * The launcher keeps the game it plays under <userData>/Game:
 *   state.json          { seed, current, previous, ready, trial, failed }
 *   v<version>/index.json   every file of that version: path, size, sha256,
 *                           and whether that folder holds it (`own`) or the
 *                           install's bundled copy (the SEED) does
 *   v<version>/files/       only the files that differ from the seed
 *
 * Two things this module exists for:
 *
 * 1. WHICH BUILD TO PATCH. `current` is the one playing; `ready` is a release
 *    the channel staged while the game ran - the next launch activates it and
 *    sweeps the folder it replaced. So an installer that only looks at
 *    `current` patched a folder that was about to be deleted.
 *
 * 2. WHERE THE SEED LIVES. A version folder holds only files that differ from
 *    the install's bundled copy; play/index.html and the tiny hudPlacer chunk
 *    are usually NOT in it. Their bytes have to come from the seed. The copy
 *    this repository extracted is from one AppImage - after a launcher update
 *    it is another release, and reading it would splice old bytes into a new
 *    build. So the seed is read from the running AppImage's own app.asar when
 *    one is mounted (the normal case), and only from an extracted copy when
 *    its version matches the store's seed.
 *
 * Plain Node, no Electron, no dependencies.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

/** The channel generation this shell reads (app/lib/gameChannel.cjs). */
export const GAME_CHANNEL = 1;
/** The page the game is opened on; a version without it is not playable. */
export const GAME_ENTRY = 'play/index.html';
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** '1.2.3' -> [1,2,3]; anything else -> null (the shell's own law). */
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Is version a strictly newer than b. Unparseable is never newer. */
export function isNewerVersion(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** The next release number - the only shape a local overlay may take, since
 *  the store compares three numeric parts and nothing else. */
export function nextVersion(v) {
  const p = parseVersion(v);
  if (!p) throw new Error(`not a version: ${v}`);
  return `${p[0]}.${p[1]}.${p[2] + 1}`;
}

/**
 * The folder Electron calls userData. main.cjs pins it explicitly:
 *   app.setPath('userData', path.join(app.getPath('appData'), 'Daggerfall JavaScript'))
 * so it is the same name on every platform:
 *   Linux   ~/.config/Daggerfall JavaScript       (or $XDG_CONFIG_HOME)
 *   Windows %APPDATA%\Daggerfall JavaScript
 *   macOS   ~/Library/Application Support/Daggerfall JavaScript
 * `DAGGER_USER_DATA` overrides it in the game itself, so honour it here too.
 */
export function userDataDir(home = os.homedir()) {
  if (process.env.DAGGER_USER_DATA) return path.resolve(process.env.DAGGER_USER_DATA);
  const appData = process.platform === 'win32'
    ? (process.env.APPDATA || path.join(home, 'AppData', 'Roaming'))
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME || path.join(home, '.config'));
  return path.join(appData, 'Daggerfall JavaScript');
}
export function gameRoot(home = os.homedir()) {
  return path.join(userDataDir(home), 'Game');
}
export function versionDir(root, v) {
  return path.join(root, `v${v}`);
}

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Written whole or not at all: a temporary, flushed, renamed over the old -
 *  the game's own save discipline, and what its index read expects. */
export function writeFileAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.~${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
export const writeJsonAtomic = (file, obj) => writeFileAtomic(file, Buffer.from(JSON.stringify(obj)));

export function readState(root = gameRoot()) {
  const s = readJson(path.join(root, 'state.json'));
  return s && typeof s === 'object' ? s : null;
}

/** A version's index, read and sanity-checked the way gameStore.readIndex
 *  starts out - or null. (The seed hashes are checked only by the game.) */
export function readVersionIndex(root, v) {
  const dir = versionDir(root, v);
  const index = readJson(path.join(dir, 'index.json'));
  if (!index || index.channel !== GAME_CHANNEL || index.version !== v) return null;
  if (!Array.isArray(index.files) || !index.files.length) return null;
  const byPath = new Map();
  for (const f of index.files) {
    if (!f || typeof f.path !== 'string' || !Number.isSafeInteger(f.size)) return null;
    byPath.set(f.path, f);
  }
  if (!byPath.has(GAME_ENTRY)) return null;
  return { version: v, dir, files: path.join(dir, 'files'), index, byPath };
}

/**
 * The build to patch: the staged release (`ready`) when it is the one the next
 * launch plays, else `current`. `live` names the folder the game is running
 * from now, for the log line.
 */
export function chooseTarget(root, state) {
  if (!state) return null;
  const failed = Array.isArray(state.failed) ? state.failed : [];
  const usable = (v) => (v && !failed.includes(v) ? readVersionIndex(root, v) : null);
  if (state.ready && (!state.current || isNewerVersion(state.ready, state.current))) {
    const staged = usable(state.ready);
    if (staged) return { ...staged, kind: 'staged', live: state.current ?? null };
  }
  const current = usable(state.current);
  return current ? { ...current, kind: 'current', live: state.current } : null;
}

/* ------------------------------------------------------------------ asar */
/**
 * A minimal reader for Electron's app.asar: 8-byte pickle, the JSON directory,
 * then the files back to back. Only what this tool needs - stat and read one
 * path - so the bundled build can be read without extracting the AppImage.
 */
export function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    if (fs.readSync(fd, head, 0, 16, 0) !== 16) throw new Error('short asar header');
    const headerSize = head.readUInt32LE(4);
    const jsonSize = head.readUInt32LE(12);
    if (!jsonSize || jsonSize > 64 * 1024 * 1024) throw new Error('implausible asar header');
    const json = Buffer.alloc(jsonSize);
    fs.readSync(fd, json, 0, jsonSize, 16);
    const root = JSON.parse(json.toString('utf8'));
    const dataStart = 8 + headerSize;
    const find = (p) => {
      let node = root;
      for (const seg of String(p).split('/').filter(Boolean)) {
        if (!node || !node.files || !Object.prototype.hasOwnProperty.call(node.files, seg)) return null;
        node = node.files[seg];
      }
      return node || null;
    };
    return {
      stat: find,
      read(p) {
        const e = find(p);
        if (!e || e.files || !Number.isSafeInteger(e.size)) return null;
        const out = Buffer.alloc(e.size);
        if (e.size) fs.readSync(fd, out, 0, e.size, dataStart + Number(e.offset || 0));
        return out;
      },
      close() { try { fs.closeSync(fd); } catch { /* already gone */ } },
    };
  } catch (e) {
    try { fs.closeSync(fd); } catch { /* */ }
    throw e;
  }
}

/* ------------------------------------------------------------- seed sources */
/**
 * A seed source answers, for paths relative to the build root (the `dist/`:
 * 'play/index.html', 'assets/worldTick-….js'):
 *   read(rel)  -> Buffer | null
 *   seed()     -> game-seed.json's { channel, version, files } | null
 *   version    -> the app version the source belongs to
 *   kind       -> how it was found (for the log)
 */
function asarSource(file, kind = 'asar') {
  const asar = openAsar(file);
  let seedCache;
  const pkg = readJsonBuffer(asar.read('package.json'));
  return {
    kind,
    file,
    version: pkg && pkg.version,
    read: (rel) => asar.read(`dist/${rel}`),
    seed: () => {
      if (seedCache === undefined) seedCache = readJsonBuffer(asar.read('game-seed.json'));
      return seedCache;
    },
    close: () => asar.close(),
  };
}
function readJsonBuffer(buf) {
  if (!buf) return null;
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}

/** An extracted build: `<dist>/play/index.html`, `<dist>/../game-seed.json`. */
function dirSource(distDir, version) {
  let seedCache;
  return {
    kind: 'dir',
    file: distDir,
    version,
    read(rel) {
      try { return fs.readFileSync(path.join(distDir, rel)); } catch { return null; }
    },
    seed: () => {
      if (seedCache === undefined) seedCache = readJson(path.join(distDir, '..', 'game-seed.json'));
      return seedCache;
    },
    close() { /* nothing open */ },
  };
}

/** A path the user gave (`--app`), or a nearby file: accept the asar itself,
 *  the `resources/` folder, the app folder, or a macOS `.app` bundle. */
function asarFromPath(p) {
  if (!p) return [];
  const abs = path.resolve(p);
  const out = [];
  const add = (file) => {
    if (!out.includes(file) && fs.existsSync(file)) out.push(file);
  };
  if (/\.asar$/i.test(abs)) add(abs);
  add(path.join(abs, 'app.asar'));
  add(path.join(abs, 'resources', 'app.asar'));
  add(path.join(abs, 'Contents', 'Resources', 'app.asar'));
  return out;
}

/** The game's app.asar as found from a running process, on any platform. */
export function runningAppAsars(tmpdirs = [...new Set([process.env.TMPDIR, os.tmpdir(), '/tmp'].filter(Boolean))]) {
  const out = new Set();

  if (process.platform === 'linux') {
    const mounts = new Set();
    for (const tmp of tmpdirs) {
      try {
        for (const n of fs.readdirSync(tmp)) if (n.startsWith('.mount_')) mounts.add(path.join(tmp, n));
      } catch { /* not there */ }
    }
    // AppImage mounts under a TMPDIR this process does not share
    try {
      for (const pid of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(pid)) continue;
        try {
          const exe = fs.readlinkSync(`/proc/${pid}/exe`);
          const m = /^(\S+\/\.mount_[^/]+)\//.exec(exe);
          if (m) mounts.add(m[1]);
        } catch { /* another user's process, gone */ }
      }
    } catch { /* no procfs */ }
    for (const m of mounts) {
      const file = path.join(m, 'resources', 'app.asar');
      if (fs.existsSync(file)) out.add(file);
    }
  }

  if (process.platform === 'darwin') {
    // "…/DFO Online.app/Contents/MacOS/DFO Online" in the process list
    const r = spawnSync('ps', ['-axo', 'command='], { encoding: 'utf8', timeout: 4000, maxBuffer: 8 * 1024 * 1024 });
    for (const line of String(r.stdout || '').split('\n')) {
      const m = /^(.+?\.app)\/Contents\/MacOS\//.exec(line.trim());
      if (m) out.add(path.join(m[1], 'Contents', 'Resources', 'app.asar'));
    }
  }

  if (process.platform === 'win32') {
    // the setup install and the portable exe both run with resources/ beside
    // the executable (the portable one unpacks under %TEMP% first)
    const runs = [
      ['powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process | ForEach-Object { $_.Path } | Where-Object { $_ }']],
      ['wmic', ['process', 'get', 'ExecutablePath']],
    ];
    for (const [cmd, argv] of runs) {
      const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout: 6000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      if (!r.stdout) continue;
      for (const line of String(r.stdout).split(/\r?\n/)) {
        const exe = line.trim();
        if (!exe || exe === 'ExecutablePath') continue;
        const file = path.join(path.dirname(exe), 'resources', 'app.asar');
        if (fs.existsSync(file)) out.add(file);
      }
      if (out.size) break;
    }
  }

  return [...out];
}

/** Well-known install locations (a game that is not running). */
export function installedAppAsars() {
  const home = os.homedir();
  const out = [];
  const add = (p) => out.push(...asarFromPath(p));
  if (process.platform === 'darwin') {
    add('/Applications/DFO Online.app');
    add(path.join(home, 'Applications', 'DFO Online.app'));
    for (const dir of ['/Applications', path.join(home, 'Applications')]) {
      try {
        for (const n of fs.readdirSync(dir)) if (n.endsWith('.app')) add(path.join(dir, n));
      } catch { /* not there */ }
    }
  }
  if (process.platform === 'win32') {
    const roots = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
      process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const root of roots) {
      add(path.join(root, 'DFO Online'));
      try {
        for (const n of fs.readdirSync(root)) add(path.join(root, n));
      } catch { /* not there */ }
    }
  }
  return out;
}

/**
 * The seed for `version`: the copy bundled in the game the player runs. On
 * Linux that is the running AppImage's mount (there is no file on disk); on
 * Windows/macOS it is `<install>/resources/app.asar`, with the running
 * process first and the usual install folders next. `app` (`--app=`) wins
 * over all of it. An extracted build (`extractDir`) is the last resort and
 * only when its version matches. Null when nothing matches - callers must
 * then refuse rather than splice another release's bytes.
 */
export function resolveSeed(version, { extractDir = null, tmpdirs = null, app = null } = {}) {
  const tmp = tmpdirs || [...new Set([process.env.TMPDIR, os.tmpdir(), '/tmp'].filter(Boolean))];
  const candidates = [
    ...asarFromPath(app || process.env.DFO_APP),
    ...runningAppAsars(tmp),
    ...installedAppAsars(),
  ];
  const seen = new Set();
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      const src = asarSource(file);
      if (src.version === version && src.seed()) return src;
      src.close();
    } catch { /* not readable - try the next */ }
  }
  if (extractDir) {
    const pkg = readJson(path.join(extractDir, '..', 'package.json'));
    if (pkg && pkg.version === version) {
      const src = dirSource(extractDir, version);
      if (src.seed()) return src;
    }
  }
  return null;
}
