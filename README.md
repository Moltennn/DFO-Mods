# DFO Online Mods

Client-side mods for **DFO Online** (the desktop build), plus the shared loader
they run on. The **mods** are UI-only at runtime: they read the game's own
data, never write to a server, and never change a character or a save. The
**loaders and installers are not UI-only** — they patch the local game build on
disk (a page tag, `boot.js`, the mod registry, a few game scripts) and re-apply
everything after an update. Nothing is uploaded.

The repository contains four pieces:

- **`modloader/`** — the loader and installer toolkit. It tags the game page,
  serves `assets/dfo-mods/boot.js`, keeps the registry of installed mods, and
  re-applies everything after a game update.
- **`skillhud-mod/`** — the **Skill Tracker** mod: a HUD panel that shows the
  tracked skills' uses toward the next point, configurable from the ESC menu.
- **`uitweaks-mod/`** — the **UI Tweaks** mod: item tier labels and material
  colours in the world plaque (loot piles), configurable from the ESC menu.
- **`lootfilter-mod/`** — the **Loot Filter** mod: player-defined junk rules
  that hide rows from the world plaque, configurable from the ESC menu.

```
README.md                 this file
install.sh                one-step install/repair for Linux and macOS
install.bat               one-step install/repair for Windows
modloader/
  boot.js                 served as assets/dfo-mods/boot.js
  install.mjs             install/check/uninstall the loader; --install-watch
  sync.mjs                autosync: loader + every registered mod
  lib/
    game.mjs              version store + seed discovery (Linux/Windows/macOS)
    store.mjs             open a served build; overlay; read/write/remove
    marker.mjs            Game/.dfo-mods/installed.json (loader + mods)
    registry.mjs          served registry.js + workspace manifest
    loader.mjs            ensure/check/remove the loader
    autosync.mjs          systemd (Linux) / launchd (macOS) / schtasks (Windows)
skillhud-mod/
  skillhud.js             the mod (HUD + ESC pane)
  install.mjs             its patches + registration
uitweaks-mod/
  uitweaks.js             the mod (plaque labels/colours + ESC pane)
  install.mjs             its patches + registration
lootfilter-mod/
  lootfilter.js           the mod (hide rules + ESC pane)
  install.mjs             its hook + registration
```

`modloader/mods.json` is generated on each machine and is not tracked.

## Requirements

- The **desktop build** of DFO Online: Linux AppImage, Windows `.exe`, or
  macOS `.app`.
- [Node.js](https://nodejs.org/) 18 or newer — only for the installers.
- The two folders above, side by side (a clone of this repository gives you
  that).

**Browser play is not supported.** The browser build is served by the website;
there is no local build to patch and no version store to overlay. These tools
edit files on the machine that runs the desktop build.

## Install

### One step (the whole thing)

Linux and macOS:

```bash
./install.sh
```

Windows (double-click or from a command prompt):

```bat
install.bat
```

Either script installs the loader, every mod in the workspace, and the
autosync scheduler, then prints the health check. It is idempotent — run it
again any time (including after a game update) to repair the install.

On a portable/unpacked build, pass the game once so the headless scheduler can
find it later:

```bash
./install.sh --app="/path/to/DFO Online"
install.bat "C:\path\to\DFO Online"
```

The path is remembered in `modloader/app-path.txt` (local only; autosync reads
it back). `node modloader/sync.mjs` alone also works and discovers
`../*-mod/install.mjs` when `modloader/mods.json` has not been generated yet.

### Skill Tracker (installs the loader too)

```bash
cd skillhud-mod
node install.mjs
```

It finds the build the game will play and that build's bundled copy (the
"seed") on its own, installs the shared loader if needed, applies this mod's
patches, and reports the version it patched. On Linux, run it **while the game
is running**: the bundled copy lives inside the AppImage's mount for that
session.

Then start or restart the game.

### UI Tweaks (installs the loader too)

```bash
cd uitweaks-mod
node install.mjs
```

Same rules: it installs the shared loader if needed, patches the two game
chunks that build the world plaque, writes `assets/dfo-uitweaks.js`, and
registers itself. Then start or restart the game.

### Loot Filter (installs the loader too)

```bash
cd lootfilter-mod
node install.mjs
```

It guarantees the plaque's row-filter hook (the same one UI Tweaks installs -
either mod makes it work), writes `assets/dfo-lootfilter.js`, and registers
itself. Then start or restart the game.

### Loader only

```bash
node modloader/install.mjs
```

This installs the page tag, `assets/dfo-mods/boot.js`, an empty
`assets/dfo-mods/registry.js`, and the installed-state record. It loads no mods
until a mod installer registers one.

### Checks and removal

```bash
node modloader/install.mjs --check        # 0 healthy, 1 stale, 2 nothing patchable yet
node skillhud-mod/install.mjs --check
node uitweaks-mod/install.mjs --check
node lootfilter-mod/install.mjs --check

node skillhud-mod/install.mjs --uninstall  # this mod only; loader/mods stay
node uitweaks-mod/install.mjs --uninstall
node lootfilter-mod/install.mjs --uninstall
node modloader/install.mjs --uninstall     # refuses while mods are registered
node modloader/install.mjs --uninstall --force
```

Re-running an installer is safe and idempotent; nothing is rewritten when it is
already in place.

### Where things live

| | game data (patched here) | bundled build (read from) |
|---|---|---|
| **Linux** (AppImage) | `~/.config/Daggerfall JavaScript/Game/` | the running AppImage's mount (`/tmp/.mount_*/resources/app.asar`) |
| **Windows** (setup) | `%APPDATA%\Daggerfall JavaScript\Game\` | `<install folder>\resources\app.asar` |
| **Windows** (portable) | same | the folder the portable `.exe` unpacks into — **start the game, then run the installer while it is running** |
| **macOS** | `~/Library/Application Support/Daggerfall JavaScript/Game/` | `/Applications/DFO Online.app/Contents/Resources/app.asar` |

The data folder can be moved with the game's own `DAGGER_USER_DATA`
environment variable; the installers honour it too.

If auto-detection fails (unusual install path, portable exe that has already
exited, a second copy of the game), point it at the build:

```bash
node install.mjs --app="/path/to/resources/app.asar"
# also accepts: the resources/ folder, the app folder, or DFO Online.app
node install.mjs --app="C:\Program Files\DFO Online"
```

`--seed=<extracted dist>` is a last resort for a build extracted on disk
(`.../resources/app/dist`, with `game-seed.json` beside `dist`).

## Using the mods

Everything is in the game's **ESC (pause) menu → Mods** (Enhanced skin):

- Each mod gets its own band — its name, its loaded **build** hash and a
  **Reload** button — with the same rule between bands that the footer uses.
- **Reload all** sits on the right of the footer bar (the footer carries the
  credit and the repo link on the left).
- Each mod's band holds its settings. For **Skill Tracker**: panel opacity
  (with its percentage), **Skill levels** (each row's skill value in the game's
  own text — `32`, or `100 (104)` when the softcap is holding it down), row
  spacing, **Show/Hide panel**, reset placement, and the tracked-skill
  checklist (three columns when the pane is wide enough, two when it is not).

A reload re-reads the registry: a mod whose `MOD_BUILD` changed is unmounted
and replaced; a mod removed from the registry is unloaded; an unchanged import
never touches the page. **There are no mod hotkeys.**

The same doors exist for DevTools: `globalThis.__dfoReloadMods()`,
`globalThis.__dfoModsReloadOne('skillhud')`, `globalThis.__dfoModsList()`.

## Automatic re-install

A game update replaces the served build, so the loader and every mod must be
re-applied. Install the shared scheduler once:

```bash
node modloader/install.mjs --install-watch
```

It runs `node modloader/sync.mjs` when `Game/state.json` or the launcher's
`config.json` changes (an update staged/activated, a launch):

- **Linux** — systemd user units `dfo-mod-sync.path` + `.service`
  (`journalctl --user -u dfo-mod-sync`).
- **macOS** — LaunchAgent `dev.dfo.modloader`
  (`~/Library/Logs/dfo-modloader.log`).
- **Windows** — Scheduled Task `DFO Mods Sync`, every 5 minutes (no file
  watcher needed; self-healing after a logout).

`sync.mjs` runs the loader installer, then every mod listed in the generated
`modloader/mods.json`, each with `--if-needed`. When that manifest does not
exist yet (a fresh checkout), it discovers `../*-mod/install.mjs` and runs
those once so they register; exit 2 ("nothing patchable right now") is not a
failure.

`node modloader/install.mjs --remove-watch` removes the scheduler.
`node skillhud-mod/install.mjs --install-watch` does the same from the mod's
folder after installing it.

## After a game update

A **channel update** stages a new game version while you play; the next launch
uses it. The installers target that staged version, not the one about to be
deleted.

A **launcher update** (new AppImage / `.exe` / `.dmg`) resets the store and the
game plays the build bundled inside it — which cannot be written to. The tools
then build a **local overlay**: a version folder made of the bundled build plus
the mods, numbered one release above the seed (for example `0.1.12919` →
`0.1.12920`), and point the game at it. The next real release supersedes it. If
a patch lands while the game page is already loading, restart once.

## The loader

`modloader/boot.js` (served as `assets/dfo-mods/boot.js`) imports the served
registry:

```js
// assets/dfo-mods/registry.js
export const MODS = [
  { id: 'skillhud', name: 'Skill Tracker', spec: '../dfo-skillhud.js' },
];
```

`spec` is relative to `assets/dfo-mods/` (the registry module's own folder,
where `boot.js` also lives). A mod module exports:

| export | purpose |
|---|---|
| `MOD_BUILD` | a hash of the module text (the installer injects it); a different value on reload means "replace the running instance" |
| `install()` | mount the mod — called by the loader, **never at import time** |
| `unmount()` | remove everything `install()` added |
| `mountPane(container)` | optional; the loader gives it its own section in ESC → Mods |

The Mods pane renders one band per mod, headed with the registry `name`, the
module's loaded `MOD_BUILD` and a Reload button, divided by the same rule as
the footer. Reloads use the same lifecycle: unmount, re-import, install. The
pane scrolls in its own well (the game's window around it does not move); the
footer keeps the credit and repo link on the left and **Reload all** on the
right.

### Adding a mod

Make a folder beside `modloader/` with an installer and a module, and use the
loader's toolkit:

```js
import { prepare, finalizeOverlay } from '../modloader/lib/store.mjs';
import { readMarker, writeMarker, setModEntry } from '../modloader/lib/marker.mjs';
import { ensureLoader, loaderStatus, loaderRecord } from '../modloader/lib/loader.mjs';
import { upsertRegistry, upsertManifest } from '../modloader/lib/registry.mjs';

const build = prepare({ log: console.log });      // opens the build the game will play
const store = build.store;
const loader = ensureLoader(store, { log: console.log }); // loader tag + boot + registry

// patch/read/write through store:
//   store.findChunk({ ... })
//   store.write('assets/my-mod.js', bytes, { owned: true })
//   store.remove('assets/some-patch.js')

upsertRegistry(store, { id: 'mymod', name: 'My Mod', spec: '../my-mod.js' });
store.commit();                                    // index.json, atomically
finalizeOverlay(build);                            // names a fresh overlay
upsertManifest({ id: 'mymod', name: 'My Mod', dir: '../my-mod' });
```

Then record the loader and the mod in the marker (`Game/.dfo-mods/installed.json`)
so `--check` can verify them, and support `--check`, `--if-needed`,
`--uninstall`, and `--install-watch`. `skillhud-mod/` is the reference
implementation.

## Skill Tracker

A HUD panel — a native piece of the game's HUD-layout system — that tracks the
skills you pick and shows their uses toward the next point:

    31/69  Critical Strike

When enough uses are banked for the next skill check to grant the point, the
uses column brightens (brass, with a soft glow) — the moment to rest or loiter
and let game time pass. At a skill's own cap the uses column reads **max** and
dims: 100 for an unmastered skill, 200 under **Master Skills**. It reads the
same character data the game's own skill screens show.

The panel carries no title line — it is a piece of the HUD, and the Alt+U
editor names it "Skill tracker". An optional **Skill levels** column sits on
the right of each row, using the game's own skill text: the value, and in
parentheses the real value when the softcap is holding it down (`100 (104)`
for an unmastered skill past 100).

The panel uses the game's own `:root` design tokens (`--bone`, `--dim`,
`--brass`, `--brass-hi`, `--dfo-text-font`) with classic-skin fallbacks, so it
follows whatever **Overhauls → UI Overhaul / Plus theme** is active.

### Integration

- **Alt+U (HUD layout editor)**: the panel lives inside the `.hud` root and is
  registered as a piece of the editor's table
  (`{id:'dfoLT', sel:'.hud .dfo-lt', name:'Skill tracker'}`). Dragging, scaling,
  the ✕ hide toggle, double-click reset and placement persistence
  (`hudLayout`) are the game's machinery. If a page was already running when
  the mod was installed and missed the piece, the mod has a small fallback drag
  that writes the same pref; a reload makes everything native.
- **ESC → Mods → Skill Tracker**: the config pane described above.
- **Show/hide**: the pane's **Show/Hide panel** button is the only door. There
  are no mod hotkeys; the game's keyboard focus and pointer input are
  untouched.
- **Only in-world**: the panel is hidden until the game hands the tracker a
  live character, so the title screen and main menu never show it. It works
  with either HUD skin (Enhanced parents it under `.hud`; classic leaves it on
  the page body). The main menu's **Mods** entry still opens and shows the
  settings; the tracker appears when a character loads.

### What it patches

1. `assets/worldTick-*.js` — the skill check keeps `window.__playerEntity`
   pointing at the live character, and the app's debug hook no longer deletes
   it. The hook's minified call alias is captured, never hardcoded.
2. `assets/enhancedMenu-*.js` — one rail entry (`Mods`) and one dispatch arm
   calling `globalThis.__dfoModsPane`.
3. the layout editor's chunk (e.g. `revenantCard-*.js`) — the `dfoLT` piece and
   the piece table exported as `hz`.
4. `assets/dfo-skillhud.js` — the mod itself.

The loader owns the page tag, `assets/dfo-mods/boot.js` and
`assets/dfo-mods/registry.js`. Everything is anchored on structure, not on
chunk hashes or minified names; a missing anchor aborts before writing.

### The maths

The panel mirrors the game's own skill screen, including the level the game
actually uses:

    need = floor(value * skillMult * advancementMultiplier * 1.04^L * 2/5) + 1
    have = floor(uses * (65536 - (reflexes-2 << 13)) / 65536)

For online characters `L` is not the character level (changed at 0.1.12011): it
is `max(level, skillSumLevel)`, where the skill sum counts all primary skills,
all major skills except the lowest, and the highest minor skill, each
softcapped (values above 100 count as 100 unless mastered; mastered values
compress 101–200 into 100–140 plus the 125/150/175/200 milestone bonuses). That
sum maps to a level 1–45 through the game's own curve. For offline characters
`L` is the character level. Mastered skills above 100 use the 1.5×/2×/4× cost
multipliers (100–124 / 125–149 / 150–199) and the game's `skillProgress`
banking.

## UI Tweaks

Every item row in the world plaque (the crosshair panel over a loot pile, a
corpse, a container) carries its material grade, its material word and its
type:

    T5 · Silver Saber · Long Blade
    T4 · Steel Helm · Plate
    T2 · Greaves · Chain

- **T\<n\>** is the item's tier in the Daggerfall material order the game
  itself ranks by: **Leather 1, Chain 2, Iron 3, Steel 4, Silver 5, Elven 6,
  Dwarven 7, Mithril 8, Adamantium 9, Ebony 10, Orcish 11, Daedric 12**.
  Armor packs its class in the high byte and the metal grade in the low one
  (`Steel Helm` = 513, `Daedric Helm` = 521), so leather and chain are their
  own tiers and plate takes its metal's.
- The material word is added only when the game's name does not already carry
  it (the game prefixes Steel and above, not Iron; a leather cuirass already
  says Leather).
- Weapons show the skill they belong to, from the template index
  (Daggerfall's canonical ids, 113–131, so artifacts and renamed weapons still
  report the right skill), with a name fallback for added content. They also
  say **1H** or **2H** from the game's own weapon table: one-handed for
  Dagger/Tanto/Shortsword/Wakazashi/Broadsword/Saber/Longsword/Katana/Mace/
  Battle Axe, two-handed for Staff/Claymore/Dai-Katana/Warhammer/Flail/War
  Axe/both bows. Artifact templates follow the game's special cases (560 two,
  562/563 one); unknown added weapons fall back to the name.
- Armor shows the class the game's own item sheet calls **Type**: Leather,
  Chain or Plate. It also says where it goes, from the game's own equip table:
  **Chest** (cuirass/plate), **Hands** (gauntlets), **Legs** (greaves),
  **Left arm** / **Right arm** (pauldrons), **Head** (helms), **Feet** (boots)
  and **Shield** (buckler, round, kite, tower) — `Steel Buckler · Plate ·
  Shield`, `Chain Greaves · Legs`. The slot is skipped when the name already
  says it (`Tower Shield`, `Warden-Plate`).
- Cosmetic/wearable items show the slot they go to: **Head, Chest, Legs, Feet,
  Gloves, Cloak, Ring, Amulet, Bracelet, Bracer, Mark, Crystal** — e.g.
  `Short Tunic · Chest`, `Casual Pants · Legs`, `The Vestments of Stendarr ·
  Chest`, `Foxglove · Ring`. Only a *worn* item carries an `equipSlot`; one on
  the ground or in the pack does not, so the slot comes from the game's own
  template→slot table (the paper doll's, 133–216) with `equipSlot` first when
  present.
- **Type / slot** picks how much of that type is shown — **Off**, **Hide
  obvious** (the default) or **All**. Hide obvious leaves it off when the name
  already says it in plain language, so the list carries only what it adds.
  The test is the type's own vocabulary, matched on whole words: `Formal
  Cloak` → cloak, `Longsword` → long blade, `Battle Axe` → axe, `Mace`/`Staff`
  → blunt, `Short Bow` → archery, `Shoes` → feet, `Gown`/`Robe`/`Shirt` →
  chest, `Ring`/`Amulet` → ring/amulet, `Leather Cuirass` → leather. Names that
  don't give it away keep the type: `Saber · Long Blade`, `Katana · Long
  Blade`, `Broadsword · Long Blade`, `Short Tunic · Chest`,
  `The Vestments of Stendarr · Chest`, `Foxglove · Ring`, `Wyrmbane · Long
  Blade`. **All** prints it on every row — `Casual Cloak · Cloak`,
  `Longsword of Skill · Long Blade`; **Off** leaves it out entirely. The item
  card's line under the name follows the same choice.
- Ammo (pellets, arrows) carries no grade and no type — it keeps its plain
  name, because its material field is not a metal.
- Gems carry no grade and no type either, but each is printed in its own
  colour: Ruby red, Emerald green, Sapphire blue, Diamond ice white, Jade soft
  green, Turquoise cyan, Malachite deep green, Amber gold, Pearl cream. The
  colour comes from the gem's template index (Ruby 0 … Amber 7, Pearl 77), with
  a name fallback for added gems.
- Graded gems work too — **Chipped, Flawed, Flawless, Perfect** (indices
  `1900 + grade*8 + stone`, and the game already puts the word in the name, so
  `Chipped Emerald` stays). The name keeps the stone's colour; gems never get a
  dot in front (unlike metals), so the grade reads from the word itself.

Rows are coloured by material (a dot, plus the name in the material's colour).
Gems are coloured by their own stone. The **Classic** palette uses the
Daggerfall colours:

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

The dot always uses the exact hex. The name keeps the same colour too, except
where that would be unreadable on the plaque's near-black ground (Iron,
Mithril, Adamantium, Ebony get a lightened ink of the same hue). The **Bright**
palette is the same twelve tiers in lighter, high-contrast colours.

A row the game itself flags as magic/rare/legendary keeps the game's rarity dot,
and the name still takes the material colour. Everything is text-first: the
`T<n>` is there even when the colour is off.

The plaque itself is widened to fit one item per line and **no longer changes
width as you scroll**: the game caps it at 300 px, which wraps a tier label +
name + type, so list plaques get a fixed 480 px (`min(480px, 92vw)`) and each
row stays on one line; a genuinely longer name ellipsises instead of spilling.
The list shows **10 rows** by default instead of the game's 6; **List rows** in
the pane sets 3–20. The plaque hangs below the crosshair and grows downward, so
a tall list is lifted by just enough to keep its bottom clear of the hotbar/HUD
band (never so far that its top leaves the screen).

The same facts go into the inventory's item card, in the same colours. The line
right under the item's name becomes the loot label's summary:

    The Spindle-Blade
    T6 · Elven · Short Blade

    The Last Oath
    T8 · Mithril · Plate

Weapons show tier · material · skill · **1H/2H**, armour tier · material · class
· **slot** (the game's own `Type` still shows Plate/Chain/Leather), and
clothing/jewellery the slot they go to (`Chest`, `Legs`, `Ring`, …). The same
**Type / slot** setting (Off / Hide obvious / All) governs this line. The
material is always computed from the item, so named/artifact pieces that show
no material of their own (e.g. *The Last Oath*) read it here. The item's
**name keeps the game's own rarity colour** (aetheric, magic, …); only the
summary line takes the material colour. Gems get no extra row — the name
already says the grade — and everything else shows a plain `Kind` (Ingredient /
Book / Clothing / Misc).

**ESC → Mods → UI Tweaks** has **Tier labels** (off restores the game's plain
names), **Type / slot** (Off / Hide obvious / All), **Weapon hands (1H / 2H)**,
**Colour by material**, the **Colour scheme** (Classic / Bright) and **List
rows**. Settings live in `localStorage['dfoUiTweaks.config.v1']`.

### What it patches

1. `assets/propBodies-*.js` — the plaque's item-row builder calls
   `__dfoUiTweaks.lootLabel(item, name)` for each row's label and carries the
   tier through as `tier`; it also gets the generic
   `__dfoRowFilter.keep(item)` hook (shared with Loot Filter).
2. `assets/deepWaterRuntime-*.js` — the plaque renderer copies `tier` onto the
   row as `data-tier`; the mod's stylesheet keys the colours off it.
3. `assets/propBodies-*.js` — the plaque's row framer (how many of the pile's
   rows are shown at once, and which slice around the selected one) takes its
   row count from the mod instead of the fixed 6, and the item-model builders
   return nothing when the filter removed every row of a non-empty pile (the
   plaque disappears instead of showing just its title).
4. `assets/enhancedInventory-*.js` — the card's line under the name asks
   `__dfoUiTweaks.cardLine(item)` (tier · material · type), its stat list asks
   `__dfoUiTweaks.itemFacts(item)` for the remaining extra rows, and the card is
   tagged with `data-dfo-tier` so the stylesheet colours the line.
5. `assets/dfo-uitweaks.js` — the mod itself (the label/type/material logic,
   the card facts, the settings and the stylesheet).

The game patches are anchored on the code's shape (the row expression, the
renderer's `data-rarity` line, the framer's signature and test), not on chunk
hashes or minified names — the row builder and framer are renamed every build
(`Tf`/`Pf` at 0.1.13299, `Of`/`Lf` at 0.1.13325), so a helper name is captured,
never hardcoded. A missing anchor aborts before writing. The mod reads only the
item object the game already hands to the row builder — no game data is
written.

## Loot Filter

A separate mod that hides junk from the world plaque. Rules combine as "hide if
any matches"; quest items are never hidden. Hidden items never reach the
plaque, and a pile/corpse with nothing left to show is put to sleep
(`inactive` / `corpseDisabled`) so it leaves the world's sprites and the loot
targets too — nothing is ever deleted, and clearing the rule wakes it intact.

- **Enable loot filter** — the master switch.
- **Hide types** — weapons, armor, gems, clothing, ingredients, misc, books,
  ammo.
- **Hide all commons** — anything with no rarity at all.
- **Hide commons below tier** — commons under the DFO material tier you pick
  (4 hides Leather/Chain/Iron commons, keeps Steel and up).
- **Hide anything below tier** — the same cut applied even to magic+ items.
- **Hide below rarity** — common / magic / rare / legendary / artifact.
- **Min value (gold)** — hides anything cheaper.
- **Hide names (comma)** — substring list, e.g. `pellet, arrow, practice`.
- **Always keep (comma)** — overrides everything, e.g. `ruby, quest`.

Gems have no material tier, so the tier rules leave them alone — use the type
switch or the name list for stones. Filter changes apply the next time the
plaque refreshes (look away and back).

A pile is hidden **as a whole**: if every item in it is filtered out and the
pile was not actually empty, the plaque does not appear at all (no title with an
empty list) and the **3-D pile of items on the ground is hidden too**. (The
plaque half is the "empty pile" guard that UI Tweaks' installer puts in the
item-model builders; the pile/corpse sprites and targets are this mod's.) The drop
is only put to sleep (`inactive` on the dropped-pile manager), never deleted:
its items are untouched, and it wakes up — sprite, plaque and all — as soon as
the filter lets one of them through or is turned off. While hidden it is out of
reach (no plaque, not in Take all), which is the point of hiding it.

**Corpses** behave the same way. A dead body with nothing left to show — every
item filtered **or no items at all** — is hidden as a whole: the foe renderer
skips the 3-D body, the corpse's own billboard sprite is skipped in the draw
list, and its loot target, hover name and plaque go with it
(`corpseDisabled`). The body and its items are untouched — clear the filter and
the corpse is back, sprite and loot and all.

**ESC → Mods → Loot Filter** holds the rules; settings live in
`localStorage['dfoLootFilter.config.v1']`.

### What it patches

1. `assets/propBodies-*.js` — the row builder's generic hook line
   `.filter(e => __dfoRowFilter.keep(...))` (UI Tweaks installs the same line;
   both are idempotent and each writes the chunk preserving the other's work).
2. `assets/world-*.js` — exposes the dropped-pile manager as `__dfoPiles` and
   the foe manager as `__dfoFoes`, so the mod can sleep a whole pile and read a
   corpse's items.
3. `assets/deepWaterRuntime-*.js` — the corpse-body draw and the corpse's
   billboard sprite both ask `__dfoRowFilter.hideCorpse(foe)` (the sprite is
   tagged with its foe at creation); shared with UI Tweaks' data-tier patch,
   which preserves it.
4. `assets/dfo-lootfilter.js` — the mod itself.

Uninstalling leaves the hooks inert; no game data is touched.


## Troubleshooting

- `node modloader/install.mjs --check` and
  `node skillhud-mod/install.mjs --check` say what is wrong ("not installed",
  "installed for vX, serving vY", "the game plays its bundled copy").
- If the bundled copy could not be read: start the game once and retry (the
  Linux AppImage needs its mount; the Windows portable needs its unpacked
  folder), or pass `--app=`.
- Force a full re-install by deleting `Game/.dfo-mods/installed.json`.
- If the **Mods** pane is blank right after a game update, the game started
  before the sync finished: the running session's in-memory index did not yet
  name `boot.js` and the registry, so the page never loaded the loader. The
  Mods tab can still appear because its chunk was an existing file. **Restart
  the game once** and the pane, its settings and the credit/link load normally.
- In game, ESC → Mods → **Reload** logs the loader's result to the DevTools
  console. With DevTools open for a live character, this prints the numbers
  behind a row:

      __dfoMods.active.get('skillhud').module.debugSkill(34)

## Notes

- Backups of the release's own files live in `Game/.dfo-mods/originals.json`,
  keyed by version. Uninstall only restores the version being uninstalled. The
  old `.skillhud-backup/` folder is migrated on first use.
- `Game/.dfo-mods/installed.json` records the loader and every mod. It is
  machine-local.
- Uninstalling Skill Tracker leaves the loader and other mods in place; remove
  the loader itself with `node modloader/install.mjs --uninstall`.
- The overlay is one version number ahead of the seed. If the very next release
  has exactly that number, the game channel skips it; the desktop launcher
  update still delivers it, and everything is re-applied to the new seed
  afterwards.
- A launcher update always leaves the game on its bundled copy until the tools
  build an overlay or a channel release arrives; that is the game's store
  behaviour, not a mod limitation.
