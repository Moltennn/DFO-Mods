/*
 * DFO Online - Skill Tracker patches.
 *
 * The mod's patch, as text. patch(store, log) reads the served chunks it needs
 * through `store`, a read-only view of the build the game plays (modloader/lib/
 * view.mjs), and writes the changed ones back plus the mod's module file. Nothing
 * is written to the game store: modloader/lib/serve.mjs runs this against each
 * build and serves the result.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../modloader/lib/game.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HUD_SRC = path.join(HERE, 'skillhud.js');
export const MODULE_REL = 'assets/dfo-skillhud.js';
export const ID = 'skillhud';
export const NAME = 'Skill Tracker';
export const SPEC = '../dfo-skillhud.js';                 // relative to assets/dfo-mods/
const MARKER = '__DFO_HUD';

const die = (msg) => { throw new Error(msg); };

/** The same hash boot.js compares: the module text with MOD_BUILD emptied. */
function computeBuild() {
  const src = fs.readFileSync(HUD_SRC, 'utf8');
  if (!src.includes("'@BUILD@'")) die('skillhud.js: @BUILD@ placeholder missing');
  const stripped = src.replace(/MOD_BUILD\s*=\s*[`'"][\s\S]*?[`'"]/, 'MOD_BUILD=');
  return sha256(Buffer.from(stripped, 'utf8')).slice(0, 16);
}

function deferOrDie(msg) { die(msg); }

/* --------------------------------------------------------------- install */
export function patch(store, log = () => {}) {
  const seed = null;
  const installed = new Set();
  const checks = [];
  let layoutName = null;
    // ---- 1. the skill-check chunk exposes the live character ------------
    const wt = store.findChunk({
      prefixes: ['worldTick-'],
      fallbackMinSize: 500_000,
      test: (t) => t.includes('lastSkillCheckTime') && t.includes('skillUses') &&
        t.includes('e.lastSkillCheckTime??0)<=360)return[];'),
    });
    if (!wt) deferOrDie('the skill-check chunk was not found and the bundled build is not readable - start the game, then retry', seed);
    log(`  chunk ${wt.rel} (${wt.where})`);
    {
      let text = wt.text;
      if (text.includes(MARKER)) log('  skyhook already applied');
      else {
        const A1 = 'null){if(!e.chargenDone||t-(e.lastSkillCheckTime??0)<=360)return[];e.lastSkillCheckTime=t;';
        const B1 = 'null){typeof window<`u`&&(window.__playerEntity=e,window.__DFO_HUD=1);if(!e.chargenDone||t-(e.lastSkillCheckTime??0)<=360)return[];e.lastSkillCheckTime=t;';
        if (text.includes(A1)) text = text.replace(A1, B1);
        else if (text.includes('window.__playerEntity=e')) log('  skyhook already applied');
        else die('skyhook anchor 1 not found - aborting (nothing written)');

        const A2rx = /(?:(typeof window<`u`&&\()?)([A-Za-z0-9_$]+)\(`shot`\)\?window\.__playerEntity=([A-Za-z0-9_$]+):`__playerEntity`in window&&delete window\.__playerEntity(\))?/;
        const m = text.match(A2rx);
        if (!m) {
          if (!text.includes('delete window.__playerEntity')) log('  skyhook 2b already applied');
          else die('skyhook anchor 2 not found - aborting (nothing written)');
        } else if (m[1] && m[4]) {
          text = text.replace(A2rx, `typeof window<\`u\`&&(window.__playerEntity=${m[3]})`);
        } else {
          text = text.replace(A2rx, `${m[2]}(\`shot\`)?window.__playerEntity=${m[3]}:(window.__playerEntity=${m[3]})`);
        }
        if (store.write(wt.rel, Buffer.from(text))) log(`  patched ${wt.rel}`);
      }
      installed.add(wt.rel);
    }

    // ---- 2. the ESC menu's Mods pane ------------------------------------
    {
      const A_RAIL = '[`screenshots`,`Screenshots`],[`about`,`About`]';
      const B_RAIL = '[`screenshots`,`Screenshots`],[`mods`,`Mods`],[`about`,`About`]';
      const A_DISP = /\{save:([A-Za-z0-9_$]{1,4}),load:([A-Za-z0-9_$]{1,4}),overhauls:([A-Za-z0-9_$]{1,4}),screenshots:([A-Za-z0-9_$]{1,4}),about:([A-Za-z0-9_$]{1,4}),exit:([A-Za-z0-9_$]{1,4})\}\[([A-Za-z0-9_$]{1,4})\]\(r\)/;
      const B_ARM = 'mods:(r)=>{if(typeof globalThis<`u`&&globalThis.__dfoModsPane)globalThis.__dfoModsPane(r)},';
      const OLD_RAIL = '[`screenshots`,`Screenshots`],[`leveltracker`,`Level Tracker`],[`about`,`About`]';
      const OLD_ARM = 'leveltracker:(r)=>{if(typeof globalThis<`u`&&globalThis.__dfoLT)globalThis.__dfoLT(r)},';

      const menu = store.findChunk({
        prefixes: ['enhancedMenu-'],
        test: (t) => (t.includes(A_RAIL) && A_DISP.test(t)) || (t.includes(B_RAIL) && t.includes('__dfoModsPane')) || t.includes(OLD_RAIL),
      });
      if (!menu) deferOrDie('ESC menu anchors not found and the bundled build is not readable - start the game, then retry', seed);
      let text = menu.text;
      if (text.includes(OLD_RAIL)) {
        text = text.replace(OLD_RAIL, A_RAIL).replace(OLD_ARM, '');
        log(`  migrated the old leveltracker entry (${menu.rel})`);
      }
      if (text.includes(B_RAIL) && text.includes('__dfoModsPane')) log(`  esc menu already patched (${menu.rel})`);
      else {
        const m = text.match(A_DISP);
        if (!m) die('ESC menu anchors not found - aborting');
        text = text.replace(A_RAIL, B_RAIL).replace(m[0], m[0].replace('{', `{${B_ARM}`));
        log(`  patched ${menu.rel} (Mods pane)`);
      }
      store.write(menu.rel, Buffer.from(text));
      installed.add(menu.rel);
    }

    // ---- 3. the Alt+U piece table ---------------------------------------
    {
      const A_PIECE = '[{id:`compass`';
      const A_TAIL = ',name:`Junction map`}].map(Object.freeze))';
      const B_TAIL = ',name:`Junction map`},{id:`dfoLT`,sel:`.hud .dfo-lt`,name:`Skill tracker`}].map(Object.freeze))';
      const isCandidate = (t) => t.includes('hudLayout') && t.includes(A_PIECE) &&
        (t.includes(A_TAIL) || t.includes(B_TAIL)) && /export\{/.test(t);
      let piece = store.findChunk({ maxSize: 2_000_000, test: isCandidate });
      if (!piece) piece = store.findChunk({ test: isCandidate });
      if (!piece) deferOrDie('Alt+U piece table not found and the bundled build is not readable - start the game, then retry', seed);

      const tableVar = piece.text.match(/([\w$]+)\s*=\s*Object\.freeze\(\[\{id:`compass`/)?.[1];
      if (!tableVar) die('Alt+U piece table variable not found - aborting');
      let out = piece.text.replace(A_TAIL, B_TAIL);
      const cur = piece.text.match(/\{id:`dfoLT`,sel:`\.hud \.dfo-lt`,name:`([^`]*)`\}/);
      if (cur && cur[1] !== 'Skill tracker') {
        out = out.replace(cur[0], '{id:`dfoLT`,sel:`.hud .dfo-lt`,name:`Skill tracker`}');
        log(`  piece renamed to "Skill tracker" (was "${cur[1]}")`);
      }
      if (!/ as hz[,}]/.test(out)) {
        const before = out;
        out = out.replace(/export\{/, `export{${tableVar} as hz,`);
        if (out === before || !/ as hz[,}]/.test(out)) die('could not expose the piece table (as hz) - aborting');
      }
      if (out === piece.text) log(`  alt+u piece already registered (${piece.rel})`);
      else { store.write(piece.rel, Buffer.from(out)); log(`  patched ${piece.rel} (Alt+U piece)`); }
      installed.add(piece.rel);
      layoutName = path.posix.basename(piece.rel);
    }

    // ---- 4. the mod itself ----------------------------------------------
    const placer = findPlacer(store, store.index);
    if (!placer) log('  warning: the hudPlacer hook chunk was not found - Alt+U will still work on a reload');
    const buildId = computeBuild();
    const hud = Buffer.from(fs.readFileSync(HUD_SRC, 'utf8')
      .replace("'@BUILD@'", `'${buildId}'`)
      .replace("'@PLACER@'", `'${placer ? `./${placer}` : ''}'`)
      .replace("'@LAYOUT@'", `'${layoutName ? `./${layoutName}` : ''}'`), 'utf8');
    store.write(MODULE_REL, hud, { owned: true });
    installed.add(MODULE_REL);
    log(`  MOD_BUILD ${buildId}${placer ? `, placer ${placer}` : ', placer disabled'}`);

}

/** The tiny get/set module the layout editor applies its pieces through. */
function findPlacer(store, index) {
  const CALLER = 'if(e)try{e(t)}catch{}';
  for (const f of index.files) {
    if (!f.path.startsWith('assets/') || !f.path.endsWith('.js') || f.size > 400) continue;
    const got = store.read(f.path);
    if (!got) continue;
    const text = got.bytes.toString('utf8');
    if (!text.includes(CALLER)) continue;
    if (/export\{t as n,n as t\}/.test(text)) return path.posix.basename(f.path);
  }
  return null;
}
