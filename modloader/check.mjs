#!/usr/bin/env node
/*
 * DFO Online mods - apply the mods to the build the game plays, in memory, and
 * say what applies. Writes nothing.
 *
 *   node modloader/check.mjs [--app=<AppImage | app.asar | app folder>]
 *
 * Exit: 0 every mod applies, 1 some do not (their anchors are missing in this
 * build - the mod is left out, the rest still work), 2 the build cannot be read
 * yet (start the game once, or pass --app=).
 */
'use strict';

import { openBuild, viewOf } from './lib/view.mjs';
import { discoverMods, runPatches } from './lib/mods.mjs';

const argv = process.argv.slice(2);
const app = (argv.find((a) => a.startsWith('--app=')) || '').slice('--app='.length) || process.env.DFO_APP || null;

const build = openBuild({ app });
if (build.error) {
  console.error(build.error);
  process.exit(2);
}
const view = viewOf(build);
const mods = await discoverMods();
const out = runPatches(view, mods, (m) => console.log(m));
console.log(`v${build.version}: ${out.registry.length} of ${mods.length} mod${mods.length === 1 ? '' : 's'} apply`);
process.exit(out.failed.length ? 1 : 0);
