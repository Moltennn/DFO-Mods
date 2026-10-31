#!/usr/bin/env node
/*
 * DFO Online mods - install check.
 *
 *   node modloader/install.mjs
 *
 * Nothing is installed into the game: the launcher serves the mods itself
 * (lib/serve.mjs, started by play.mjs), so there is no loader or mod file in the
 * game store and nothing to repair after an update. This removes the background
 * sync that earlier installs left behind, then reports which mods apply to the
 * build the game plays. It exits 0 whenever the install itself went through.
 */
'use strict';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { removeWatch } from './lib/watch-cleanup.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

if (argv.includes('--remove-watch')) {
  removeWatch();
  process.exit(0);
}

removeWatch();
const r = spawnSync(process.execPath, [path.join(HERE, 'check.mjs'), ...argv.filter((a) => a.startsWith('--app='))], { stdio: 'inherit' });
if (r.status === 2) {
  console.log('\nThe game has not been started yet on this machine. Start it once through the "DFO Online (Mods)" shortcut, then run this again if a mod does not apply.');
}
process.exit(0);
