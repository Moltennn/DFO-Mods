# Developing DFO Online mods

This is the maintainer documentation: how the loader works, how the game build
is chosen, what each mod patches, and the internals you need when a game update
breaks an anchor. For install/use, see [README.md](README.md).

## Repository layout

```
install.sh / install.bat     check the mods + create the launcher shortcut
play.sh / play.command       launcher entry points (Linux/macOS)
play.bat                     launcher entry point (Windows)
find-node.sh / find-node.bat locate Node.js 18+ (DFO_NODE, node/, then PATH)
modloader/
  play.mjs                   start the game: the server, then the launcher
  check.mjs                  apply every mod to the build the game plays, in memory
  install.mjs                remove the old background sync, then run the check
  boot.js                    the loader, served as assets/dfo-mods/boot.js
  lib/
    view.mjs                 the build the game plays, read-only, with an in-memory overlay
    mods.mjs                 discover ../*-mod/patches.mjs; run patches; the registry
    serve.mjs                the local server the launcher loads the game from
    game.mjs                 store state, seed discovery, asar reader
    watch-cleanup.mjs        removes a background sync left by an earlier version
skillhud-mod/
  skillhud.js                the mod (HUD + ESC pane)
  patches.mjs                its patches, as text (patch(store, log))
uitweaks-mod/
  uitweaks.js                the mod (plaque labels/colours + ESC pane)
  patches.mjs                its patches, as text
lootfilter-mod/
  lootfilter.js              the mod (hide rules + ESC pane)
  patches.mjs                its patches, as text
```

`modloader/app-path.txt` and `modloader/game-path.txt` are local hints, written
when a path is given with `--app`; they are not tracked.

## How the game build is chosen

The store (`Game/`, in the user data folder) has:

- `state.json` — `seed`, `current`, `ready`, `previous`.
- `v<version>/index.json` — per-file `sha256`/`size`/`own`. `own: false` means
  the file comes from the build the launcher ships (the **seed**); `own: true`
  means it lives in the version folder.

`lib/view.mjs` reads the build the launcher would serve, the same way the
launcher does: a path the version's index names is its own file when `own`, else
the seed's; a path the index does not name is not served. `ready` is the next
build and `current` the one played now; `chooseTarget` picks between them as the
launcher does.

Nothing is written to the store. The patches run against an in-memory copy of
the build on each channel change, and the server answers from that copy. The
store's own update rules (staging, activation, rollback) are untouched.

The seed comes from the running build: the AppImage mount on Linux (or
`--app`/`DFO_APP`), `<install>/resources/app.asar` on Windows/macOS, and the
workspace `extract/` only when its version matches. `resolveSeed` refuses a
build whose version does not match.

## The loader

The server serves the loader; nothing is written to the game:

- `play/index.html` gets `<script type="module" src="../assets/dfo-mods/boot.js">`
  before `</body>`, when it is not already there.
- `assets/dfo-mods/boot.js` is `modloader/boot.js`.
- `assets/dfo-mods/registry.js` is generated per build from the mods that
  applied:

```js
export const MODS = [
  { id: 'skillhud', name: 'Skill Tracker', spec: '../dfo-skillhud.js' },
];
```

`spec` is relative to `assets/dfo-mods/` (the registry module's own folder).
`boot.js` imports the registry, imports every module cache-busted, and calls
`install()` on each one. It remembers each running `MOD_BUILD`; on a reload it
unmounts the old instance and installs the new one. **The loader owns the
lifecycle** — a mod must never mount at import time.

A mod module exports:

| export | purpose |
|---|---|
| `MOD_BUILD` | a hash of the module text (injected by the patches); a changed value means “replace the running instance” on reload |
| `install()` | mount the mod — called by the loader, never at import time |
| `unmount()` | remove everything `install()` added |
| `mountPane(container)` | optional; the loader gives it its own section in ESC → Mods |

The Mods pane renders one band per mod (registry `name`, loaded `MOD_BUILD`,
Reload), dividers matching the footer, and **Reload all** on the right. Reloads
use the same lifecycle: unmount, re-import, install. There are no mod hotkeys.
DevTools hooks: `globalThis.__dfoReloadMods()`,
`globalThis.__dfoModsReloadOne(id)`, `globalThis.__dfoModsList()`,
`globalThis.__dfoModsPane(el)`.

Chunks that two mods patch are handled by the patches themselves: each one
checks for its own marker (or the other's), so either can run first.

## Adding a mod

Make a folder beside `modloader/` with a `patches.mjs` and the mod's module:

```js
export const ID = 'mymod';
export const NAME = 'My Mod';
export const SPEC = '../dfo-mymod.js';        // relative to assets/dfo-mods/
export const MODULE_REL = 'assets/dfo-mymod.js';

export function patch(store, log = () => {}) {
  // store: a read-only view of the build the game plays
  //   store.findChunk({ prefixes, maxSize, fallbackMinSize, test })  -> { rel, text }
  //   store.read(rel)                                                  -> { bytes } | null
  //   store.write(rel, bytes)                                          -> changed?
  // Throw when an anchor is missing: the mod is then left out of this build
  // and every other mod still applies.
  const chunk = store.findChunk({ test: (t) => t.includes('some anchor') });
  if (!chunk) throw new Error('the anchor chunk was not found');
  store.write(chunk.rel, Buffer.from(chunk.text.replace('some anchor', 'patched anchor')));
  store.write(MODULE_REL, Buffer.from(/* the module text */ ''));
}
```

`modloader/lib/mods.mjs` finds every `../*-mod/patches.mjs` in id order, so there
is no registration to edit. `node modloader/check.mjs` shows whether the patch
applies to the current build. `skillhud-mod/patches.mjs` is the reference.

**Anchors are structural.** Chunk names and minified identifiers change every
release; patches locate code by a unique shape (a literal, an expression, a call
pattern), capture the renamed identifiers, and throw before writing when a shape
is missing.

## Skill Tracker

Patches:

1. `assets/worldTick-*.js` — the skill check keeps `window.__playerEntity`
   pointing at the live character, and the app's debug hook no longer deletes
   it. The hook's minified call alias is captured.
2. `assets/enhancedMenu-*.js` — one rail entry (`Mods`) and one dispatch arm
   calling `globalThis.__dfoModsPane`.
3. the layout editor's chunk (e.g. `revenantCard-*.js`) — the `dfoLT` piece and
   the piece table exported as `hz`.
4. `assets/dfo-skillhud.js` — the mod itself.

The maths (the game's own `worldTick`/`skillSoftcap`, mirrored in
`skillhud.js`):

```
need = floor(skill * QI[t] * advancementMultiplier * 1.04^L * 2/5) + 1
have = floor(uses * (65536 - ((reflexes-2) << 13)) / 65536)
```

`L` is the character level offline; online it is
`max(level, levelSum)` where:

```
sum = primary skills + all majors except the lowest + the highest minor,
      each softcapped
softcap(v) = v                                     (v <= 100)
           = 100 + (min(v,200)-100)*0.25 + milestones  (v > 100)
milestones: 125:+2, 150:+3, 175:+4, 200:+6  (max 140)
levelSum = clamp(floor((28n + 647r) / (15n)), 1, 45)
n = 800 - startingLevelUpSkillSum
r = min(max(currentLevelUpSkillSum, sum) - starting, n)
```

Unmastered values above 100 count as 100 in the sum; mastered values compress
101–200 into 100–140 plus the milestone bonuses. Mastered skills above 100 use
the 1.5×/2×/4× cost multipliers (100–124 / 125–149 / 150–199) and the game's
`skillProgress` banking. `debugSkill(t)` on the loaded module prints the parts.

## UI Tweaks

Patches:

1. `assets/propBodies-*.js` — the plaque's item-row builder calls
   `__dfoUiTweaks.lootLabel(item, name)` for each row's label and carries the
   tier through; the generic `__dfoRowFilter.keep(item)` hook (shared with Loot
   Filter); the row framer takes its row count from `lootRows()`; the item-model
   builders return null when the filter removed every row of a non-empty pile.
2. `assets/deepWaterRuntime-*.js` — the plaque renderer copies `tier` onto the
   row as `data-tier`.
3. `assets/enhancedInventory-*.js` — the card's line under the name asks
   `__dfoUiTweaks.cardLine(item)`, its stat list asks `itemFacts(item)`, and the
   card gets `data-dfo-tier`.
4. `assets/dfo-uitweaks.js` — the mod.

Label internals:

- Tier order: Leather 1, Chain 2, Iron 3, Steel 4, Silver 5, Elven 6, Dwarven 7,
  Mithril 8, Adamantium 9, Ebony 10, Orcish 11, Daedric 12.
- Tier comes from `material` (armor: class in the high byte, metal grade in the
  low byte; 513 = Steel Helm, 521 = Daedric Helm; leather/chain carry no grade).
- Weapon skills use template indices 113–131 (canonical Daggerfall ids) with a
  name fallback for added content. Handedness: one hand for
  113,114,116–121,124,127; two for 115,122,123,125,126,128,129,130; artifacts
  560 two, 562/563 one; unknown templates fall back to the name.
- Armor slots: 102 Chest, 103 Hands, 104 Legs, 105/106 Left/Right arm,
  107 Head, 108 Feet, 109–112 Shield.
- Clothing/jewellery slots use the game's template→slot table (`equipRules`):
  Mens/WomensClothing 141–216, Jewellery 133–139, with `equipSlot` first for a
  worn item.
- Type/slot modes: `off`, `obvious` (skip when the name uses the type's own
  words), `all`. The vocabulary lives in `OBVIOUS_WORDS`; a class that equals
  the material word (leather/chain) is not repeated on the card.
- Gems: template 0 Ruby … 7 Amber, 77 Pearl; graded gems `1900 + grade*8 + stone`
  with the grade word already in the name. Coloured by stone, no dot.
- Quest items (`item.questItem`) are their own colour key: `lootTier` returns
  `quest` (not a material slug), the row label is `Quest: <name>`, and the same
  key reaches the card's `data-dfo-tier`, so the card's "Quest item" boundline
  goes magenta `#F873FF` (below the name only - the name and meta line stay ordinary). The
  `quests` switch (default on) gates it on its own, independent of `labels`. In game a magic item may carry
  only `rarity: 'magic'`; a quest item is marked by `questItem` regardless.

Classic palette (the Bright palette is the same tiers in lighter colours):

| tier | material | colour | hex |
|---|---|---|---|
| 1 | Leather | brown | `#8B4513` |
| 2 | Chain | silver | `#C0C0C0` |
| 3 | Iron | dark grey | `#4A4A4A` |
| 4 | Steel | mid grey | `#808080` |
| 5 | Silver | pale silver | `#D3D3D3` |
| 6 | Elven | bright silver | `#E0E0E0` |
| 7 | Dwarven | gold | `#DAA520` |
| 8 | Mithril | navy | `#191970` |
| 9 | Adamantium | matte black | `#2F2F2F` |
| 10 | Ebony | glossy black | `#1A1A1A` |
| 11 | Orcish | green | `#2E8B57` |
| 12 | Daedric | red | `#B22222` |

Iron, Mithril, Adamantium and Ebony get a lightened ink for the name on the
plaque ground. A row the game flags as magic/rare/legendary keeps the game's
rarity dot; the name still takes the material colour.

Plaque geometry: list plaques use a fixed `min(480px, 92vw)` width (the game
caps at 300 px and wraps labels), 10 rows by default (`List rows` 3–20, the
game hard-caps at 6), and `--dfo-lift` keeps a tall list clear of the HUD.
`lootLabel` is also used by the item card's summary line; the card's own `Type`
still shows the class.

## Loot Filter

Rules combine as “hide if any matches”; quest items are never hidden. Types
come from `group` (weapons, armor, gems, clothing, ingredients, misc, books,
religious items, ammo); the game's `ReligiousItems` group (prayer beads,
symbols, candles, the Holy Tome) is its own `religious` switch.

Patches:

1. `assets/propBodies-*.js` — the shared row-filter hook
   `.filter(e => __dfoRowFilter.keep(e.item))`.
2. `assets/propBodies-*.js` — quick-loot selection: the game took
   `items[selectedRow]` from the unfiltered pile. The installer wraps that
   lookup with `__dfoRowFilter.pick(state)` first (and on 0.1.13520+ stores the
   selected row's item as `dfoItem` on the quick-loot state, which has no
   rows). The raw index stays as the fallback for non-item plaques.
3. `assets/world-*.js` — exposes the dropped-pile manager as `__dfoPiles` and
   the foe manager as `__dfoFoes`.
4. `assets/deepWaterRuntime-*.js` — the corpse body draw and the corpse's
   billboard sprite ask `__dfoRowFilter.hideCorpse(foe)`; the sprite is tagged
   with its foe at creation. The installer patches every corpse renderer
   (world/interior/remote) by shape. A hidden corpse's marker batch is also
   marked `castOnly` at the start of each renderer's corpse loop: the body is
   skipped, and the game only suppresses the marker while it stands the body,
   so without this an emptied body was left showing its sprite.
5. `assets/dfo-lootfilter.js` — the mod.

Runtime pieces:

- `keep(item)` — display filter; walks the ordered rule list (first match wins).
  Conditions read `fieldValue(field, item)` (type, rarity, tier, stack, value,
  name, enchanted, artifact, hands, slot); a missing value never matches. The
  v1 switches are converted once by `fromV1`. `enchanted` is any rarity above
  common: in game a magic item can carry only `rarity: 'magic'` with `magic: false`.
  Armour slots come from the Armor template table (102-112), then from the name.
- `pick(state)` — the selected row's own item (or `state.dfoItem`).
- `hideItems`/`hideCorpse` — a pile/corpse whose rows are all hidden is put to
  sleep (`inactive` / `corpseDisabled`), never deleted; the 700 ms sync wakes
  anything the filter no longer hides.
- Reveal key (`revealKey`, default Alt): held → `keep` true and the hide
  helpers false, and the sync wakes everything; release/blur re-sleeps. Bound
  in capture phase on `window`.

## Launcher

`modloader/play.mjs` is what the shortcut runs:

1. resolves the game (workspace `*.AppImage`, `game-path.txt`, installed
   asar→exe/app, or `--app=`),
2. starts `lib/serve.mjs` on `127.0.0.1` (an OS-chosen port),
3. starts the launcher with `DAGGER_DEV_URL` set to that server's game page,
   and stays up while the game runs (the launcher can restart itself, so it waits
   for the game to close, not just for its own child).

Everything after `--` goes to the game. If the game is already running, the
wrapper says so and exits: the mods only apply to a game it started.

`DAGGER_DEV_URL` makes the launcher return early when it opens the game window,
so the window skips the rollback, load-failure and crash handlers that run for
`dagger://` games. This is the accepted trade-off for modded play (README,
"What this changes").

## Checks

```bash
node modloader/check.mjs                 # which mods apply to the build the game plays
node modloader/check.mjs --app=<path>    # when the game is not running yet
```

Exit codes: 0 every mod applies, 1 some do not (their anchors moved), 2 the build
cannot be read yet (no state, or the seed is not readable).

Earlier versions wrote into the store (`Game/.dfo-mods/`, overlay folders,
`installed.json`, `originals.json`). Nothing reads those any more; a patch
recognises its own changes if they are still in a build, so they do no harm.
Uninstalling is removing the mod's folder.

