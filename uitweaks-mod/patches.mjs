/*
 * DFO Online - UI Tweaks patches.
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
const MOD_SRC = path.join(HERE, 'uitweaks.js');
export const MODULE_REL = 'assets/dfo-uitweaks.js';
export const ID = 'uitweaks';
export const NAME = 'UI Tweaks';
export const SPEC = '../dfo-uitweaks.js';
const MARKER = '__dfoUiTweaks';

const die = (msg) => { throw new Error(msg); };

/** The same hash boot.js compares: the module text with MOD_BUILD emptied. */
function computeBuild() {
  const src = fs.readFileSync(MOD_SRC, 'utf8');
  if (!src.includes("'@BUILD@'")) die('uitweaks.js: @BUILD@ placeholder missing');
  const stripped = src.replace(/MOD_BUILD\s*=\s*[`'"][\s\S]*?[`'"]/, 'MOD_BUILD=');
  return sha256(Buffer.from(stripped, 'utf8')).slice(0, 16);
}

function deferOrDie(msg) { die(msg); }

/* ------------------------------------------------------------------ rows */
/* Anchors are structural, not minified names: the item-name helper is
 * renamed every build (`Gt` at 0.1.13266, `In` at 0.1.13299), so capture it. */
const ROW_RX = /name:([A-Za-z0-9_$]+)\(e\)\.name\|\|`Something`,stack:/;
const A_TIER = 'r.rarity&&(i.dataset.rarity=r.rarity);';
const B_TIER = 'r.rarity&&(i.dataset.rarity=r.rarity);r.tier!=null&&(i.dataset.tier=String(r.tier));';
/* the inventory item card's stat list: add our rows right after "Hands" */
const A_CARD = 'm(`Type`,o.armorType),m(`Hands`,o.hands);';
/* 0.1.13448 moved the card to a model object (the item is `a.item`) and renamed
 * the row helper; capture both from the game's own "Type"/"Hands" pair. */
const CARD_STATS_RX = /([A-Za-z0-9_$]+)\(`Type`,([A-Za-z0-9_$]+)\.armorType\),\1\(`Hands`,\2\.hands\);/;
/* the line under the card's name (material/stack) - the mod puts the summary there */
const A_META = 'let d=[o.material,o.stack?`${o.stack} of them`:null].filter(Boolean).join(` · `);d&&l.append(U(`p`,`meta`,d));';
const B_META = 'let d=globalThis.__dfoUiTweaks?.cardLine?.(e)||[o.material,o.stack?`${o.stack} of them`:null].filter(Boolean).join(` · `);d&&l.append(U(`p`,`meta`,d));';
/* the same line in the 0.1.13448 shape: `let u=[a.material,...];u&&c.append(W(`p`,`meta`,u));` */
const CARD_META_RX = /([A-Za-z0-9_$]+)=\[([A-Za-z0-9_$]+)\.material,\2\.stack\?`\$\{\2\.stack\} of them`:null\]\.filter\(Boolean\)\.join\(` · `\);\1&&([A-Za-z0-9_$]+)\.append\(([A-Za-z0-9_$]+)\(`p`,`meta`,\1\)\)/;
const OLD_FACTS = 'if(typeof globalThis<`u`&&globalThis.__dfoUiTweaks?.itemFacts)for(let _f of globalThis.__dfoUiTweaks.itemFacts(e))m(_f[0],_f[1]);';
const PREV_FACTS = 'if(typeof globalThis<`u`&&globalThis.__dfoUiTweaks?.itemFacts){const _c=p.closest(`.card`),_t=globalThis.__dfoUiTweaks.tierOf?.(e);_c&&_t&&(_c.dataset.dfoTier=_t);for(const _f of globalThis.__dfoUiTweaks.itemFacts(e)){m(_f[0],_f[1]);_f[2]&&p.lastElementChild&&(p.lastElementChild.dataset.dfoTier=_f[2])}}';
const B_FACTS = 'if(typeof globalThis<`u`&&globalThis.__dfoUiTweaks?.itemFacts){for(const _f of globalThis.__dfoUiTweaks.itemFacts(e)){m(_f[0],_f[1]);_f[2]&&p.lastElementChild&&(p.lastElementChild.dataset.dfoTier=_f[2])}queueMicrotask(()=>{const _c=p.closest(`.card`),_t=globalThis.__dfoUiTweaks.tierOf?.(e);_c&&_t&&(_c.dataset.dfoTier=_t)})}';
const B_CARD = A_CARD + B_FACTS;

const A_ROWS_FALLBACK = 'function Pf(e,t=-1,n=0,r=6){';
/* the pack/loot-window row: name + the small meta line, built in the same
 * chunk as the card. Rows are `button.itemrow` with `span.itemname`. */
const ROW_NAME = 'c.append(W(`span`,null,n.name+(n.stack?` ×${n.stack}`:``)));';
const ROW_NAME_NEW = 'c.append(W(`span`,null,(globalThis.__dfoUiTweaks?.rowName?.(e,n.name)??n.name)+(n.stack?` ×${n.stack}`:``)));';
const ROW_META = 'let l=[n.material,n.word,n.lit?`lit`:null,n.quest==null?null:Fo()].filter(Boolean).join(` · `);';
const ROW_META_NEW = 'let l=globalThis.__dfoUiTweaks?.cardLine?.(e)||[n.material,n.word,n.lit?`lit`:null,n.quest==null?null:Fo()].filter(Boolean).join(` · `);';
const ROW_DECOR = 'El(o,e);let s=P===e&&F===t;';
const ROW_DECOR_NEW = 'El(o,e),globalThis.__dfoUiTweaks?.decorateRow?.(o,e);let s=P===e&&F===t;';
const ROWS_RX = /function ([A-Za-z0-9_$]+)\(e,t=-1,n=0,r=6\)\{let i=e\?\.rows\?\.length\?\?0;if\(!e\|\|e\.kind!==`items`/;
const A_FILTER = ',item:e})),r=n.slice(0,t)';
/* the loot filter is its own mod; the row builder calls this generic hook so
 * either installer can provide it and the other's patches survive */
const ROW_HOOK = 'globalThis.__dfoRowFilter?.keep?.(e.item)??true';
const OLD_HOOK_RX = /\.filter\(e=>globalThis\.__dfoUiTweaks\?\.keepLoot\?\.\(e\.item\)\?\?true\)/;

/* ---- "hide the pile as a whole" --------------------------------------------
 * The row builder filters rows; when it removed every item of a pile the model
 * ends up with no rows but is not "empty", and the plaque still appears with
 * just its title. Make `empty` mean "the pile was born empty", and let the two
 * item-model builders return null (no plaque) when the filter ate everything.
 */
const BUILDER_RX = /function ([A-Za-z0-9_$]+)\(e,t=6\)\{let n=([A-Za-z0-9_$]+)\(e\)\.map/;
const A_EMPTY = 'return{shown:r,rest:n.length-r.length,empty:n.length===0}';

function guardEmptyPiles(text) {
  const head = text.match(BUILDER_RX);
  if (!head) return { text, missing: true };
  const [, builder, arrFn] = head;
  let out = text;
  if (!out.includes(`${arrFn}(e).length===0`)) {
    if (!out.includes(A_EMPTY)) return { text, missing: true };
    out = out.replace(A_EMPTY, `return{shown:r,rest:n.length-r.length,empty:${arrFn}(e).length===0}`);
  }
  const RX = new RegExp(`let\\{shown:([A-Za-z0-9_$]+),rest:([A-Za-z0-9_$]+),empty:([A-Za-z0-9_$]+)\\}=${builder}\\(([^;]{1,90}?),1\\/0\\)([,;])`, 'g');
  let guards = 0;
  out = out.replace(RX, (all, shown, rest, empty, args, sep) => {
    guards++;
    const guard = `;if(!${shown}.length&&!${empty})return null;`;
    return sep === ','
      ? `let{shown:${shown},rest:${rest},empty:${empty}}=${builder}(${args},1/0)${guard}let `
      : `let{shown:${shown},rest:${rest},empty:${empty}}=${builder}(${args},1/0)${guard}`;
  });
  return { text: out, guards, missing: guards === 0 };
}

function ensureRowFilter(text) {
  if (text.includes(ROW_HOOK)) return { text, changed: false };
  if (OLD_HOOK_RX.test(text)) return { text: text.replace(OLD_HOOK_RX, `.filter(e=>${ROW_HOOK})`), changed: true };
  if (text.includes(A_FILTER)) return { text: text.replace(A_FILTER, `,item:e})).filter(e=>${ROW_HOOK}),r=n.slice(0,t)`), changed: true };
  return { text, changed: false, missing: true };
}

/* --------------------------------------------------------------- install */
export function patch(store, log = () => {}) {
  const seed = null;
  const installed = new Set();
  const checks = [];
  let layoutName = null;
    // ---- 1. the plaque's item rows --------------------------------------
    {
      const rows = store.findChunk({
        test: (t) => ROW_RX.test(t) || (t.includes(MARKER) && t.includes('lootTier')),
      });
      if (!rows) deferOrDie('the plaque row chunk was not found and the bundled build is not readable - start the game, then retry', seed);
      let text = rows.text;
      if (text.includes(MARKER)) log(`  tier labels already applied (${rows.rel})`);
      else {
        const m = text.match(ROW_RX);
        if (!m) die('the plaque row anchor was not found - aborting (nothing written)');
        const nameFn = m[1];
        const out = `name:globalThis.__dfoUiTweaks?.lootLabel?.(e,${nameFn}(e).name)||${nameFn}(e).name||\`Something\`,tier:globalThis.__dfoUiTweaks?.lootTier?.(e)??null,stack:`;
        text = text.replace(ROW_RX, out);
        log(`  patched ${rows.rel} (plaque rows)`);
      }
      const hook = ensureRowFilter(text);
      if (hook.missing) die('the plaque row filter anchor was not found - aborting (nothing written)');
      if (hook.changed) log(`  patched ${rows.rel} (row filter hook)`);
      else log(`  row filter hook already present (${rows.rel})`);
      text = hook.text;
      if (text.includes(',1/0);if(!')) log(`  empty-pile guard already applied (${rows.rel})`);
      else {
        const guarded = guardEmptyPiles(text);
        if (guarded.missing) die('the plaque model builders were not found - aborting (nothing written)');
        text = guarded.text;
        log(`  patched ${rows.rel} (empty piles hidden, ${guarded.guards} site${guarded.guards === 1 ? '' : 's'})`);
      }
      store.write(rows.rel, Buffer.from(text));
      checks.push({ rel: rows.rel, has: 'lootLabel' });
      checks.push({ rel: rows.rel, has: 'return null;' });
    }

    // ---- 2. the plaque renderer: carry the tier to the DOM ---------------
    {
      const renderer = store.findChunk({
        test: (t) => t.includes(A_TIER) || t.includes('i.dataset.tier=String(r.tier)'),
      });
      if (!renderer) deferOrDie('the plaque renderer chunk was not found and the bundled build is not readable - start the game, then retry', seed);
      let text = renderer.text;
      if (text.includes('i.dataset.tier=String(r.tier)')) log(`  data-tier already applied (${renderer.rel})`);
      else {
        if (!text.includes(A_TIER)) die('the plaque renderer anchor was not found - aborting (nothing written)');
        text = text.replace(A_TIER, B_TIER);
        log(`  patched ${renderer.rel} (plaque renderer)`);
      }
      store.write(renderer.rel, Buffer.from(text));
      checks.push({ rel: renderer.rel, has: 'i.dataset.tier=String(r.tier)' });
    }

    // ---- 3. the plaque's row framer: how many rows fit ------------------
    {
      const framer = store.findChunk({
        test: (t) => t.includes('lootRows?.()') || ROWS_RX.test(t) || t.includes(A_ROWS_FALLBACK),
      });
      if (!framer) deferOrDie('the plaque row framer was not found and the bundled build is not readable - start the game, then retry', seed);
      let text = framer.text;
      if (text.includes('lootRows?.()')) log(`  row length already applied (${framer.rel})`);
      else {
        const m = text.match(ROWS_RX);
        if (!m) die('the plaque row framer anchor was not found - aborting (nothing written)');
        const fn = m[1];
        text = text.replace(ROWS_RX,
          `function ${fn}(e,t=-1,n=0,r=globalThis.__dfoUiTweaks?.lootRows?.()??6){let i=e?.rows?.length??0;if(!e||e.kind!==\`items\``);
        log(`  patched ${framer.rel} (row framer)`);
      }
      store.write(framer.rel, Buffer.from(text));
      checks.push({ rel: framer.rel, has: 'lootRows?.()' });
    }

    // ---- 4. the inventory item card -------------------------------------
    {
      const card = store.findChunk({
        test: (t) => CARD_STATS_RX.test(t) || CARD_META_RX.test(t)
          || t.includes(A_CARD) || t.includes('cardLine?.'), 
      });
      if (!card) deferOrDie('the inventory item card was not found and the bundled build is not readable - start the game, then retry', seed);
      let text = card.text;

      /* the stat rows: our facts go right after the game's Type/Hands pair */
      if (!text.includes('itemFacts')) {
        const stats = CARD_STATS_RX.exec(text);
        if (stats) {
          const [, rowFn, model] = stats;
          text = text.replace(CARD_STATS_RX, (all) => `${all}if(typeof globalThis<\`u\`&&globalThis.__dfoUiTweaks?.itemFacts)for(const _f of globalThis.__dfoUiTweaks.itemFacts(${model}.item))${rowFn}(_f[0],_f[1]);`);
          log(`  patched ${card.rel} (item card facts)`);
        } else if (text.includes(A_CARD)) {
          text = text.replace(A_CARD, B_CARD);
          log(`  patched ${card.rel} (item card facts)`);
        } else {
          die('the inventory item card stat rows were not found - aborting (nothing written)');
        }
      } else log(`  item card facts already applied (${card.rel})`);

      /* the summary line under the name, and the card's colour key */
      if (!text.includes('cardLine?.')) {
        const meta = CARD_META_RX.exec(text);
        if (meta) {
          text = text.replace(CARD_META_RX, (all, u, model, body, W) => `${u}=globalThis.__dfoUiTweaks?.cardLine?.(${model}.item)||[${model}.material,${model}.stack?\`\${${model}.stack} of them\`:null].filter(Boolean).join(\` · \`);${u}&&${body}.append(${W}(\`p\`,\`meta\`,${u}));{const _c=${body}.closest?.(\`.card\`)||${body},_t=globalThis.__dfoUiTweaks?.tierOf?.(${model}.item);_c&&_t&&(_c.dataset.dfoTier=_t)}`);
          log(`  patched ${card.rel} (card meta line)`);
        } else if (text.includes(A_META)) {
          text = text.replace(A_META, B_META);
          log(`  patched ${card.rel} (card meta line)`);
        } else if (text.includes(PREV_FACTS) || text.includes(OLD_FACTS)) {
          text = text.replace(PREV_FACTS, B_FACTS).replace(OLD_FACTS, B_FACTS);
          log(`  upgraded ${card.rel} (item card tier key)`);
        } else {
          die('the item card meta anchor was not found - aborting (nothing written)');
        }
      } else log(`  card meta line already applied (${card.rel})`);

      /* the pack and loot-window rows share one builder: label, tag line and colour key */
      if (!text.includes('rowName?.')) {
        if (!text.includes(ROW_NAME) || !text.includes(ROW_META) || !text.includes(ROW_DECOR)) {
          die('the pack/loot row builder anchor was not found - aborting (nothing written)');
        }
        text = text.replace(ROW_NAME, ROW_NAME_NEW).replace(ROW_META, ROW_META_NEW).replace(ROW_DECOR, ROW_DECOR_NEW);
        log(`  patched ${card.rel} (pack/loot rows)`);
      } else log(`  pack/loot rows already patched (${card.rel})`);

      /* A row's condition word ("New", "Worn") and the generic "quest item"
       * line are noise: drop the condition, and let a quest item show its quest
       * there instead. Works on both the fresh and the already-patched text. */
      const COND = '[n.material,n.word,n.lit?`lit`:null,n.quest==null?null:Fo()]';
      const COND_NEW = '[n.material,n.lit?`lit`:null,n.quest==null?null:(n.quest||`Quest`)]';
      if (text.includes(COND)) {
        text = text.replace(COND, COND_NEW);
        log(`  rows: condition word dropped, quest name in its place (${card.rel})`);
      }
      if (text.includes('Io(a.quest)')) {
        text = text.replace('Io(a.quest)', '(a.quest||`Quest`)');
        log(`  card: quest name instead of "Quest item" (${card.rel})`);
      }

      store.write(card.rel, Buffer.from(text));
      checks.push({ rel: card.rel, has: 'dataset.dfoTier' });
      checks.push({ rel: card.rel, has: 'cardLine?.' });
      checks.push({ rel: card.rel, has: 'rowName?.' });
      checks.push({ rel: card.rel, has: 'decorateRow?.' });
    }

    // ---- 5. the mod itself ----------------------------------------------
    const buildId = computeBuild();
    const mod = Buffer.from(fs.readFileSync(MOD_SRC, 'utf8')
      .replace("'@BUILD@'", `'${buildId}'`), 'utf8');
    store.write(MODULE_REL, mod, { owned: true });
    installed.add(MODULE_REL);
    log(`  MOD_BUILD ${buildId}`);

}
