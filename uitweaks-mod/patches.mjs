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
const TIER_ATTR = 'r.tier!=null&&(i.dataset.tier=String(r.tier));';
/* the ingredient glyph key rides the row model to the renderer, like the tier */
const ING_ATTR = 'r.ing!=null&&(i.dataset.dfoIng=r.ing);';
const B_TIER = A_TIER + TIER_ATTR + ING_ATTR;
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
/* The pack/loot-window row builder (in the same chunk as the card): rows are
 * `button.itemrow` with `span.itemname`. Every identifier in it is minifier
 * output - the create-element helper, the decorator and the selection pair were
 * `W`/`El`/`P`+`F` at 0.1.13940 and `H`/`Xl`/`M`+`N` at 0.1.14461 - so capture
 * the whole run by its shape and rebuild it with the names this build uses. */
const ROW_CORE_RX = /([A-Za-z0-9_$]+)\.append\(([A-Za-z0-9_$]+)\(`span`,`count`,String\(n\.stack\)\)\);let ([A-Za-z0-9_$]+)=\2\(`span`,`itemname`\);\3\.append\(\2\(`span`,null,n\.name\+\(n\.stack\?` ×\$\{n\.stack\}`:``\)\)\);let ([A-Za-z0-9_$]+)=\[n\.material,n\.word,n\.lit\?`lit`:null,n\.quest==null\?null:([A-Za-z0-9_$]+)\(\)\]\.filter\(Boolean\)\.join\(` · `\);/;
/* A pack row already carries its stack as the corner `.count` badge, so the
 * name must not repeat " ×N" there (the tier/gem colour made it read as part
 * of the name). A loot-window row has no badge, so it keeps the count. The
 * side is the argument the badge checks against `local`. */
const ROW_COUNT_RX = /n\.stack&&([A-Za-z0-9_$]+)===`local`&&([A-Za-z0-9_$]+)\.append\(([A-Za-z0-9_$]+)\(`span`,`count`,String\(n\.stack\)\)\)/;
const ROW_NAME_OLD_SUFFIX = '+(n.stack?` ×${n.stack}`:``)';
const ROWS_RX = /function ([A-Za-z0-9_$]+)\(e,t=-1,n=0,r=6\)\{let i=e\?\.rows\?\.length\?\?0;if\(!e\|\|e\.kind!==`items`/;
/* the row list is sliced by the builder's own parameter names; capture them */
const ROW_FILTER_RX = /,item:e\}\)\),([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\.slice\(0,([A-Za-z0-9_$]+)\)/;
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
  if (ROW_FILTER_RX.test(text)) {
    return {
      text: text.replace(ROW_FILTER_RX, (all, out, list, limit) => `,item:e})).filter(e=>${ROW_HOOK}),${out}=${list}.slice(0,${limit})`),
      changed: true,
    };
  }
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
      const ING_MODEL = 'ing:globalThis.__dfoUiTweaks?.ingredientKind?.(e)??null,';
      const TIER_MODEL = 'tier:globalThis.__dfoUiTweaks?.lootTier?.(e)??null,';
      if (!text.includes(MARKER)) {
        const m = text.match(ROW_RX);
        if (!m) die('the plaque row anchor was not found - aborting (nothing written)');
        const nameFn = m[1];
        const out = `name:globalThis.__dfoUiTweaks?.lootLabel?.(e,${nameFn}(e).name)||${nameFn}(e).name||\`Something\`,${TIER_MODEL}${ING_MODEL}stack:`;
        text = text.replace(ROW_RX, out);
        log(`  patched ${rows.rel} (plaque rows)`);
      } else {
        log(`  tier labels already applied (${rows.rel})`);
        /* a build patched by an older version of this mod: add the glyph key */
        if (!text.includes('ingredientKind') && text.includes(`${TIER_MODEL}stack:`)) {
          text = text.replace(`${TIER_MODEL}stack:`, `${TIER_MODEL}${ING_MODEL}stack:`);
          log(`  patched ${rows.rel} (ingredient glyph key)`);
        }
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
      checks.push({ rel: rows.rel, has: 'ingredientKind' });
      checks.push({ rel: rows.rel, has: 'return null;' });
    }

    // ---- 2. the plaque renderer: carry the tier to the DOM ---------------
    {
      const renderer = store.findChunk({
        test: (t) => t.includes(A_TIER) || t.includes(TIER_ATTR),
      });
      if (!renderer) deferOrDie('the plaque renderer chunk was not found and the bundled build is not readable - start the game, then retry', seed);
      let text = renderer.text;
      if (text.includes(TIER_ATTR)) {
        log(`  data-tier already applied (${renderer.rel})`);
        /* a build patched by an older version of this mod: add the glyph key */
        if (!text.includes(ING_ATTR)) {
          text = text.replace(TIER_ATTR, TIER_ATTR + ING_ATTR);
          log(`  patched ${renderer.rel} (plaque row glyph key)`);
        }
      } else {
        if (!text.includes(A_TIER)) die('the plaque renderer anchor was not found - aborting (nothing written)');
        text = text.replace(A_TIER, B_TIER);
        log(`  patched ${renderer.rel} (plaque renderer)`);
      }
      store.write(renderer.rel, Buffer.from(text));
      checks.push({ rel: renderer.rel, has: TIER_ATTR });
      checks.push({ rel: renderer.rel, has: ING_ATTR });
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
          text = text.replace(CARD_META_RX, (all, u, model, body, W) =>
            `${u}=globalThis.__dfoUiTweaks?.cardLine?.(${model}.item)||[${model}.material,${model}.stack?\`\${${model}.stack} of them\`:null].filter(Boolean).join(\` · \`);`
            /* when the line is the game's own count ("2 of them"), it is not a
             * material line and must not take the item's colour */
            + `const _plain=!globalThis.__dfoUiTweaks?.cardLine?.(${model}.item);`
            + `${u}&&${body}.append(${W}(\`p\`,\`meta\`,${u}));`
            + `{const _c=${body}.closest?.(\`.card\`)||${body},_t=globalThis.__dfoUiTweaks?.tierOf?.(${model}.item);`
            + `_c&&_t&&(!_plain||globalThis.__dfoUiTweaks?.isQuest?.(${model}.item))&&(_c.dataset.dfoTier=_t)}`);
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

      /* the pack and loot-window rows share one builder: label, tag line and
       * colour key. The identifiers are this build's own (captured below). */
      if (!text.includes('rowName?.')) {
        const core = ROW_CORE_RX.exec(text);
        if (!core) die('the pack/loot row builder anchor was not found - aborting (nothing written)');
        const [, rowVar, el, nameVar, metaVar] = core;
        const side = ROW_COUNT_RX.exec(text)?.[1];
        if (!side) die('the pack/loot row stack badge was not found - aborting (nothing written)');
        const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const decorRx = new RegExp(`([A-Za-z0-9_$]+)\\(${esc(rowVar)},e\\);let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)===e&&([A-Za-z0-9_$]+)===t;`);
        const decor = decorRx.exec(text);
        if (!decor) die('the pack/loot row decorator anchor was not found - aborting (nothing written)');

        const nameLine = `${nameVar}.append(${el}(\`span\`,null,(globalThis.__dfoUiTweaks?.rowName?.(e,n.name)??n.name)+(n.stack&&${side}!==\`local\`?\` ×\${n.stack}\`:\`\`)));`;
        const metaLine = `${metaVar}=globalThis.__dfoUiTweaks?.cardLine?.(e)||[n.material,n.lit?\`lit\`:null,n.quest==null?null:(n.quest||\`Quest\`)].filter(Boolean).join(\` · \`);`;
        const rebuilt = `${rowVar}.append(${el}(\`span\`,\`count\`,String(n.stack)));`
          + `let ${nameVar}=${el}(\`span\`,\`itemname\`);${nameLine}`
          + `let ${metaLine}`;
        text = text.replace(core[0], () => rebuilt);
        text = text.replace(decor[0], () => `${decor[1]}(${rowVar},e),globalThis.__dfoUiTweaks?.decorateRow?.(${rowVar},e);let ${decor[2]}=${decor[3]}===e&&${decor[4]}===t;`);
        log(`  patched ${card.rel} (pack/loot rows)`);
      } else {
        log(`  pack/loot rows already patched (${card.rel})`);
        /* a build patched by an older version of this mod: drop the repeated count */
        const side = ROW_COUNT_RX.exec(text)?.[1];
        if (side && text.includes(ROW_NAME_OLD_SUFFIX)) {
          text = text.replace(ROW_NAME_OLD_SUFFIX, '+(n.stack&&' + side + '!==`local`?` ×${n.stack}`:``)');
          log(`  patched ${card.rel} (stack count shown once)`);
        }
      }

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
