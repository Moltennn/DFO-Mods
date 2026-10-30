# Developing DFO Online mods

This is the maintainer documentation: how the loader works, how the game build
is chosen, what each mod patches, and the internals you need when a game update
breaks an anchor. For install/use, see [README.md](README.md).

## Repository layout

```
install.sh / install.bat     one-step install/repair + launcher shortcut
play.sh / play.command       launcher entry points (Linux/macOS)
play.bat                     launcher entry point (Windows)
modloader/
  boot.js                    served as assets/dfo-mods/boot.js
  install.mjs                install/check/uninstall the loader
  play.mjs                   start the game, wait for its seed, sync once
  sync.mjs                   one sync: loader + every registered mod
  lib/
    game.mjs                 version store + seed discovery
    store.mjs                open a served build; overlay; read/write/remove
    marker.mjs               Game/.dfo-mods/installed.json
    registry.mjs             served registry.js + workspace manifest
    loader.mjs               ensure/check/remove the loader
    autosync.mjs             optional background watcher (legacy, not installed)
skillhud-mod/
  skillhud.js                the mod (HUD + ESC pane)
  install.mjs                its patches + registration
uitweaks-mod/
  uitweaks.js                the mod (plaque labels/colours + ESC pane)
  install.mjs                its patches + registration
lootfilter-mod/
  lootfilter.js              the mod (hide rules + ESC pane)
  install.mjs                its hook + registration
```

`modloader/mods.json` (workspace manifest), `modloader/app-path.txt`,
`modloader/game-path.txt` and `modloader/win-sync.vbs` are generated on each
machine and are not tracked.

## How the game build is chosen

The launcher keeps a version store in `Game/`:

- `state.json` — `seed`, `current`, `ready`, `previous`.
- `v<version>/index.json` — per-file `sha256`/`size`/`own`. `own: false` means
  the file comes from the build the launcher ships (the **seed**); `own: true`
  means it lives in the version folder.

The installers patch **the build the game will play**, preferring `ready`
(staged while playing; the next launch activates it) over `current`. If neither
exists, they build a **local overlay**: a version folder from the seed's own
`game-seed.json` plus the patched files, numbered `seed + 1`, marked with
`.dfo-overlay.json`, and point `state.current` at it. The next real release
supersedes it.

Seed bytes come from the running build:

- Linux: the AppImage mount (`/tmp/.mount_*/resources/app.asar`), or a path
  given with `--app`/`DFO_APP`.
- Windows/macOS: `<install>/resources/app.asar`, found from the running process
  first, then the usual install folders.
- The workspace `extract/` is a last resort and only when its `package.json`
  version matches the store seed (it goes stale after a launcher update).

`--seed=<extracted dist>` points at an extracted build's `resources/app/dist`.
`resolveSeed` refuses a build whose version does not match the seed.

## The loader

The installer tags `play/index.html` with
`<script type="module" src="../assets/dfo-mods/boot.js">`, writes
`assets/dfo-mods/boot.js` and an `assets/dfo-mods/registry.js`:

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
| `MOD_BUILD` | a hash of the module text (injected by the installer); a changed value means “replace the running instance” on reload |
| `install()` | mount the mod — called by the loader, never at import time |
| `unmount()` | remove everything `install()` added |
| `mountPane(container)` | optional; the loader gives it its own section in ESC → Mods |

The Mods pane renders one band per mod (registry `name`, loaded `MOD_BUILD`,
Reload), dividers matching the footer, and **Reload all** on the right. Reloads
use the same lifecycle: unmount, re-import, install. There are no mod hotkeys.
DevTools hooks: `globalThis.__dfoReloadMods()`,
`globalThis.__dfoModsReloadOne(id)`, `globalThis.__dfoModsList()`,
`globalThis.__dfoModsPane(el)`.

The installer records the loader and each mod in
`Game/.dfo-mods/installed.json` (marker). Files that two installers share
(the plaque row chunk, the corpse chunk) are recorded as **content checks**
(`{rel, has}`) rather than a whole-file hash, so either installer can write the
chunk last; owned module files stay hash-tracked.

## Adding a mod

Make a folder beside `modloader/` with an installer and a module, and use the
loader's toolkit:

```js
import { prepare, finalizeOverlay } from '../modloader/lib/store.mjs';
import { readMarker, writeMarker, setModEntry } from '../modloader/lib/marker.mjs';
import { ensureLoader, loaderStatus, loaderRecord } from '../modloader/lib/loader.mjs';
import { upsertRegistry, upsertManifest } from '../modloader/lib/registry.mjs';

const build = prepare({ log: console.log });      // the build the game will play
const store = build.store;
const loader = ensureLoader(store, { log: console.log });

// patch/read/write through store:
//   store.findChunk({ ... })
//   store.write('assets/my-mod.js', bytes, { owned: true })
//   store.remove('assets/some-patch.js')

upsertRegistry(store, { id: 'mymod', name: 'My Mod', spec: '../my-mod.js' });
store.commit();                                    // index.json, atomically
finalizeOverlay(build);                            // names a fresh overlay
upsertManifest({ id: 'mymod', name: 'My Mod', dir: '../my-mod' });
```

Record the loader and mod in the marker so `--check` can verify them, and
support `--check`, `--if-needed` and `--uninstall`. `--install-watch` is a
legacy opt-in. `skillhud-mod/` is the reference implementation.

**Anchors are structural.** Chunk names and minified identifiers change every
release; installers locate code by a unique shape (a literal, an expression,
a call pattern), capture the renamed identifiers, and abort before writing when
an anchor is missing. Do not add name-based matching.

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
   (world/interior/remote) by shape.
5. `assets/dfo-lootfilter.js` — the mod.

Runtime pieces:

- `keep(item)` — display filter; `/` and name lists, type, rarity, tier, value.
- `pick(state)` — the selected row's own item (or `state.dfoItem`).
- `hideItems`/`hideCorpse` — a pile/corpse whose rows are all hidden is put to
  sleep (`inactive` / `corpseDisabled`), never deleted; the 700 ms sync wakes
  anything the filter no longer hides.
- Reveal key (`revealKey`, default Alt): held → `keep` true and the hide
  helpers false, and the sync wakes everything; release/blur re-sleeps. Bound
  in capture phase on `window`.

## Launcher

`modloader/play.mjs` is the only thing the shortcut runs:

1. resolves the game (workspace `*.AppImage`, `game-path.txt`, installed
   asar→exe/app, or `--app=`),
2. syncs before launch when the seed is already readable (installed
   Windows/macOS), otherwise launches and waits up to 45 s for the seed
   (Linux AppImage mount),
3. runs `modloader/sync.mjs` once and exits; the game is detached.

`--sync-only` syncs without launching; `--dry-run` prints the resolved paths.
If the game is already running, only the sync runs. `game-path.txt` and
`app-path.txt` are local hints; the installers write them when given `--app`.

The old background watcher (`node modloader/install.mjs --install-watch`) is
still in `lib/autosync.mjs` for anyone who wants it (systemd/launchd/schtasks);
it is not installed by default and `install.sh`/`install.bat` remove one left by
an earlier version.

## Checks, backups, uninstall

```bash
node modloader/install.mjs --check
node skillhud-mod/install.mjs --check
node uitweaks-mod/install.mjs --check
node lootfilter-mod/install.mjs --check
```

Exit codes: 0 healthy, 1 stale, 2 nothing patchable right now (no seed).

Backups of the release's own files live in `Game/.dfo-mods/originals.json`,
keyed by version; uninstall restores only the version being uninstalled.
Deleting `Game/.dfo-mods/installed.json` forces a full re-install on the next
sync. `node modloader/install.mjs --uninstall` refuses while mods are
registered; `--force` overrides.

The overlay is one version number above the seed. If the next release happens
to have that number, the channel skips it; a launcher update still delivers it
and everything is re-applied to the new seed.
