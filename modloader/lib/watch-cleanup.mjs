/*
 * DFO Online mods - removes the background sync that earlier installs set up.
 *
 * The launcher now serves the mods itself (lib/serve.mjs), so nothing runs in
 * the background. Installs made before that left a Linux systemd unit, a macOS
 * LaunchAgent or a Windows Scheduled Task behind; this removes them.
 */
'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const UNIT = 'dfo-mod-sync';
const LAUNCHD_LABEL = 'dev.dfo.modloader';
const LEGACY_LAUNCHD_LABEL = 'dev.dfo.skillhud';
const WIN_TASK = 'DFO Mods Sync';

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

function removeSystemd(quiet) {
  if (!fs.existsSync(pathFile()) && !fs.existsSync(serviceFile())) return false;
  systemd(['disable', '--now', `${UNIT}.path`]);
  fs.rmSync(pathFile(), { force: true });
  fs.rmSync(serviceFile(), { force: true });
  systemd(['daemon-reload']);
  if (!quiet) console.log(`watch removed (${UNIT})`);
  return true;
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


function removeWindows(quiet) {
  const query = spawnSync('schtasks', ['/query', '/tn', WIN_TASK], { stdio: 'ignore' });
  if (query.status !== 0) return false;
  schtasks(['/delete', '/tn', WIN_TASK, '/f'], quiet);
  fs.rmSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'win-sync.vbs'), { force: true });
  if (!quiet) console.log(`watch removed ("${WIN_TASK}")`);
  return true;
}

/** Remove the scheduler (both platform homes are harmless to check). */
export function removeWatch({ quiet = false } = {}) {
  let any = false;
  if (process.platform === 'linux') any = removeSystemd(quiet) || any;
  if (process.platform === 'darwin') any = removeLaunchd(quiet) || any;
  if (process.platform === 'win32') any = removeWindows(quiet) || any;
  return any;
}
