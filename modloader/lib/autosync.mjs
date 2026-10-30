/*
 * DFO Online mods - the autosync scheduler.
 *
 * One trigger for the whole workspace: when the game store changes (an update
 * staged or activated) or the launcher writes config.json (a launch), run
 * `node modloader/sync.mjs`, which re-installs the loader and every mod that
 * registered itself in modloader/mods.json.
 *
 *   Linux   systemd --user: a .path unit feeding a oneshot .service
 *   macOS   a LaunchAgent with WatchPaths (and at login)
 *   Windows a Scheduled Task that runs sync.mjs every 5 minutes
 */
'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { userDataDir, gameRoot } from './game.mjs';
import { MODLOADER_ROOT } from './store.mjs';

const UNIT = 'dfo-mod-sync';
const LAUNCHD_LABEL = 'dev.dfo.modloader';
const LEGACY_LAUNCHD_LABEL = 'dev.dfo.skillhud';
const WIN_TASK = 'DFO Mods Sync';
const WIN_EVERY_MIN = 5;
const SYNC = path.join(MODLOADER_ROOT, 'sync.mjs');

const USER_DATA = userDataDir();
const STATE_FILE = path.join(gameRoot(), 'state.json');
const CONFIG_FILE = path.join(USER_DATA, 'config.json');

function systemd(argv) {
  const r = spawnSync('systemctl', ['--user', ...argv], { stdio: 'inherit' });
  return r.status === 0;
}
function launchctl(argv, quiet = false) {
  const r = spawnSync('launchctl', argv, { stdio: quiet ? 'ignore' : 'inherit' });
  return r.status === 0;
}
function schtasks(argv, quiet = false) {
  const r = spawnSync('schtasks', argv, { stdio: quiet ? 'ignore' : 'inherit' });
  return r.status === 0;
}

function unitDir() { return path.join(os.homedir(), '.config', 'systemd', 'user'); }
function serviceFile() { return path.join(unitDir(), `${UNIT}.service`); }
function pathFile() { return path.join(unitDir(), `${UNIT}.path`); }
function launchdFile(label = LAUNCHD_LABEL) {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}
function launchdLog() { return path.join(os.homedir(), 'Library', 'Logs', 'dfo-modloader.log'); }
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function installSystemd() {
  fs.mkdirSync(unitDir(), { recursive: true });
  fs.writeFileSync(serviceFile(), `[Unit]
Description=DFO Online mods - re-install the loader and every mod into the served build when an update replaces it
After=default.target
# idempotent and cheap; a burst of store writes must not trip the rate limit
StartLimitIntervalSec=0

[Service]
Type=oneshot
SyslogIdentifier=${UNIT}
ExecStart="${process.execPath}" "${SYNC}"
Nice=10
IOSchedulingClass=idle
`);
  // Only PathChanged: an added PathExists on the same path re-fires every time
  // the service exits, which trips the start limit within a second.
  fs.writeFileSync(pathFile(), `[Unit]
Description=Watch the DFO Online store and launcher config for changes

[Path]
PathChanged=${STATE_FILE}
PathChanged=${CONFIG_FILE}
Unit=${UNIT}.service

[Install]
WantedBy=default.target
`);
  if (!systemd(['daemon-reload'])) throw new Error('systemctl --user daemon-reload failed');
  if (!systemd(['enable', '--now', `${UNIT}.path`])) {
    throw new Error(`could not enable ${UNIT}.path - check: systemctl --user status ${UNIT}.path`);
  }
  systemd(['start', `${UNIT}.service`]); // one sync now (failure lands in the journal)
}

function removeSystemd(quiet) {
  if (!fs.existsSync(pathFile()) && !fs.existsSync(serviceFile())) return false;
  systemd(['disable', '--now', `${UNIT}.path`]);
  fs.rmSync(pathFile(), { force: true });
  fs.rmSync(serviceFile(), { force: true });
  systemd(['daemon-reload']);
  if (!quiet) console.log(`watch removed (${UNIT})`);
  return true;
}

function launchdPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(SYNC)}</string>
  </array>
  <key>WatchPaths</key>
  <array>
    <string>${xml(STATE_FILE)}</string>
    <string>${xml(CONFIG_FILE)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(launchdLog())}</string>
  <key>StandardErrorPath</key><string>${xml(launchdLog())}</string>
</dict>
</plist>
`;
}

function removeLaunchd(quiet) {
  let any = false;
  for (const label of [LAUNCHD_LABEL, LEGACY_LAUNCHD_LABEL]) {
    const file = launchdFile(label);
    if (!fs.existsSync(file)) continue;
    const uid = process.getuid ? process.getuid() : 501;
    launchctl(['bootout', `gui/${uid}`, file], true);
    fs.rmSync(file, { force: true });
    any = true;
  }
  if (any && !quiet) console.log(`watch removed (${LAUNCHD_LABEL})`);
  return any;
}

function installLaunchd() {
  const file = launchdFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.dirname(launchdLog()), { recursive: true });
  // drop the old one-mod label on the way in
  const old = launchdFile(LEGACY_LAUNCHD_LABEL);
  if (fs.existsSync(old)) {
    const uid = process.getuid ? process.getuid() : 501;
    launchctl(['bootout', `gui/${uid}`, old], true);
    fs.rmSync(old, { force: true });
  }
  fs.writeFileSync(file, launchdPlist());
  const uid = process.getuid ? process.getuid() : 501;
  launchctl(['bootout', `gui/${uid}`, file], true); // not loaded yet is fine
  if (!launchctl(['bootstrap', `gui/${uid}`, file])) {
    if (!launchctl(['load', '-w', file])) throw new Error(`could not load ${file}`);
  }
  console.log(`watch installed (${LAUNCHD_LABEL}); log: ${launchdLog()}`);
}

/* Windows: a Scheduled Task is the only scheduler that survives a logout, and
 * `schtasks` is present on every supported Windows. A 5-minute poll is coarse
 * but self-healing: it re-runs the same idempotent sync the other platforms do
 * on a file change, so a game update is patched within minutes even if the
 * game is closed (and the staged release is ready before the next launch).
 * The task launches a tiny generated .vbs so no console window flashes. */
function installWindows() {
  const vbs = path.join(MODLOADER_ROOT, 'win-sync.vbs');
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  fs.writeFileSync(vbs, `' generated by the DFO modloader installer\r\nCreateObject("WScript.Shell").Run ${q(`${q(process.execPath)} ${q(SYNC)} --quiet`)}, 0, False\r\n`);
  const tr = `"${path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe')}" "${vbs}"`;
  if (!schtasks(['/create', '/tn', WIN_TASK, '/tr', tr, '/sc', 'minute', '/mo', String(WIN_EVERY_MIN), '/f'])) {
    throw new Error(`could not create the scheduled task "${WIN_TASK}" - run as this user, not an administrator-only shell`);
  }
  schtasks(['/run', '/tn', WIN_TASK], true); // one sync now
  console.log(`watch installed ("${WIN_TASK}", every ${WIN_EVERY_MIN} minutes)`);
}
function removeWindows(quiet) {
  const query = spawnSync('schtasks', ['/query', '/tn', WIN_TASK], { stdio: 'ignore' });
  if (query.status !== 0) return false;
  schtasks(['/delete', '/tn', WIN_TASK, '/f'], quiet);
  fs.rmSync(path.join(MODLOADER_ROOT, 'win-sync.vbs'), { force: true });
  if (!quiet) console.log(`watch removed ("${WIN_TASK}")`);
  return true;
}

/** Install the scheduler for this platform; returns the platform used. */
export function installWatch() {
  if (process.platform === 'linux') { installSystemd(); console.log(`watch installed (${UNIT}.path); journal: journalctl --user -u ${UNIT}`); return 'systemd'; }
  if (process.platform === 'darwin') { installLaunchd(); return 'launchd'; }
  if (process.platform === 'win32') { installWindows(); return 'schtasks'; }
  console.log('the loader is installed, but automatic sync has no scheduler on this platform.');
  console.log(`after a game update, run:  node "${SYNC}"`);
  return 'none';
}

/** Remove the scheduler (both platform homes are harmless to check). */
export function removeWatch({ quiet = false } = {}) {
  let any = false;
  if (process.platform === 'linux') any = removeSystemd(quiet) || any;
  if (process.platform === 'darwin') any = removeLaunchd(quiet) || any;
  if (process.platform === 'win32') any = removeWindows(quiet) || any;
  return any;
}
