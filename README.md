# DFO Online Mods

Client-side mods for **DFO Online** (the desktop build), plus the shared loader
they run on. The mods are UI-only at runtime: they read the game's own data,
never write to a server, and never change a character or a save. The loaders and
installers do patch the local game build on disk (a page tag, `boot.js`, the mod
registry, a few game scripts) and re-apply everything after an update. Nothing
is uploaded.

There are three mods: **Skill Tracker** (a HUD panel for skill progress), **UI
Tweaks** (readable loot labels and item cards), and **Loot Filter** (hide junk
from loot piles). The loader (`modloader/`) installs and serves them, and
`install.sh`/`install.bat` set up a launcher that keeps them patched.

*Maintainer documentation (loader internals, patch lists, maths) is in
[DEVELOPING.md](DEVELOPING.md).*

## Requirements

- The **desktop build** of DFO Online: Linux AppImage, Windows `.exe`, or
  macOS `.app`.
- [Node.js](https://nodejs.org/) 18 or newer — only for the installers and the
  launcher.
- A copy of this repository next to the game.

**Browser play is not supported.** The browser build is served by the website;
there is no local build to patch and no version store to overlay.

## Install

### One step

Linux and macOS:

```bash
./install.sh
```

Windows (double-click or from a command prompt):

```bat
install.bat
```

Each script installs the loader, every mod, and the **DFO Online (Mods)**
launcher, then prints the health check. It is idempotent — run it again any
time (including after a game update) to repair the install. There is **no
background service**; the launcher syncs once when you start the game.

On a portable/unpacked build, pass the game once so the launcher can find it
later:

```bash
./install.sh --app="/path/to/DFO Online"
install.bat "C:\path\to\DFO Online"
```

### Manual

To sync the loader and every mod without the launcher script:

```bash
node modloader/sync.mjs
```

A single mod can be installed or repaired on its own with
`node <mod>/install.mjs` (for example `node uitweaks-mod/install.mjs`).

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

Re-running an installer is safe and idempotent.

## Starting the game

The installers create a **DFO Online (Mods)** shortcut (desktop entry, desktop
shortcut, or `play.command`). Use it instead of the game's own icon:

- It starts the game, waits for the build the game bundles to be readable, runs
  `node modloader/sync.mjs` once, and leaves you at the game's Play screen.
- On an installed Windows/macOS build the build is on disk, so it syncs *before*
  the launcher opens; on Linux it waits for the AppImage mount, so press Play
  after the launcher appears.
- If the game is already running, it only syncs — no second copy.
- Nothing runs in the background; the script exists only while it starts the
  game.

`node modloader/play.mjs --sync-only` re-syncs without launching (handy when the
game is already open); `--dry-run` prints the paths it would use. The resolved
game path is remembered in `modloader/game-path.txt`; pass `--app=` once if
detection fails:

```bash
node modloader/play.mjs --app="/path/to/DFO Online.AppImage"
node modloader/play.mjs --app="C:\Program Files\DFO Online\DFO Online.exe"
```

### After a game update

A **channel update** stages a new version while you play; the next launch uses
it and the launcher patches it before you press Play. A **launcher update** (a
new AppImage, `.exe` or `.dmg`) resets the store and the game plays its bundled
copy; the loader builds a local overlay (the bundled build plus the mods) and
points the game at it. If a patch lands while the game page is already loading,
restart once.

The older `node modloader/install.mjs --install-watch` background watcher still
exists for anyone who wants it, but the installers no longer set it up;
`--remove-watch` removes one left by an earlier version.

## The Mods menu

Everything is in the game's **ESC (pause) menu → Mods** (Enhanced skin):

- Each mod gets its own band: name, loaded **build** hash, and a **Reload**
  button.
- **Reload all** sits on the right of the footer; the credit and repo link are
  on the left.
- Each band holds that mod's settings (described below).

A reload re-reads the registry: a mod whose build changed is replaced; a removed
mod is unloaded; an unchanged import leaves the page alone. **There are no mod
hotkeys.**

## Skill Tracker

A HUD panel — a native piece of the game's Alt+U layout system — that tracks the
skills you pick and shows their uses toward the next point:

```
31/69  Critical Strike  32
```

The uses column brightens when the next skill check will grant the point; at a
skill's cap it reads **max** and dims (100 unmastered, 200 under **Master
Skills**). The optional **Skill levels** column on the right uses the game's own
skill text (`32`, or `100 (104)` when the softcap is holding it down).

The panel has no title line; the Alt+U editor names it “Skill tracker”. It
follows the game's own HUD colours and the active Overhauls theme. Drag, scale,
hide, and placement are the game's HUD editor; the mod's pane has **Show/Hide
panel** and **Reset panel placement**.

**ESC → Mods → Skill Tracker**: panel opacity, **Skill levels**, row spacing,
**Show/Hide panel**, reset placement, and the tracked-skill checklist.

The cost of the next point grows with the skill value, the class's advancement
multiplier, the game's `1.04^L` level factor, and (past 100) the mastery
multiplier. Online, `L` is the higher of the character level and a level derived
from the skill sum, so a well-trained character pays more. The full formula is
in [DEVELOPING.md](DEVELOPING.md#skill-tracker).

## UI Tweaks

Every item row in the world plaque carries its material tier, material word, and
type:

```
T5 · Silver Saber · Long Blade · 1H
T4 · Steel Helm · Plate · Head
T2 · Chain Greaves · Legs
```

- **T\<n\>** is the Daggerfall material order: **Leather 1, Chain 2, Iron 3,
  Steel 4, Silver 5, Elven 6, Dwarven 7, Mithril 8, Adamantium 9, Ebony 10,
  Orcish 11, Daedric 12**.
- Weapons show their skill (from the canonical template ids, so artifacts and
  renamed weapons still work) and **1H**/**2H** from the game's weapon table.
- Armour shows its class (**Leather / Chain / Plate**) and its slot: **Chest,
  Hands, Legs, Left/Right arm, Head, Feet, Shield**.
- Clothing and jewellery show the slot they go to (**Chest, Legs, Feet, Cloak,
  Ring, Amulet, Bracer, Mark, …**), from the game's own template→slot table.
- **Ammo** keeps its plain name; **gems** are coloured by stone (Ruby red …
  Pearl cream) and graded gems keep the grade word.

**Type / slot** in the pane picks how much is shown:

| mode | example |
|---|---|
| **Off** | `T4 · Steel Buckler` |
| **Hide obvious** (default) | `T4 · Steel Buckler · Plate · Shield` (or `T4 · Steel Longsword · 1H`, skill omitted because the name says it) |
| **All** | `T4 · Steel Longsword · Long Blade · 1H` |

“Obvious” is the type's own vocabulary: `Cloak` for a formal cloak, `Long Blade`
for a longsword, `Axe` for a battle axe, `Feet` for shoes, and so on. Names that
don't give it away keep the type (`Saber · Long Blade`, `Short Tunic · Chest`).
The item card's summary line follows the same choice.

**ESC → Mods → UI Tweaks**: **Tier labels**, **Type / slot** (Off / Hide obvious
/ All), **Weapon hands (1H / 2H)**, **Colour by material**, **Colour scheme**
(Classic / Bright), and **List rows** (3–20; the game's default is 6).

Rows are coloured by material (a dot and the name) in the Classic Daggerfall
palette or a brighter one; a magic/rare/legendary row keeps the game's rarity
dot. The plaque is widened so each item stays on one line, its width stays fixed
while scrolling, and a tall list is lifted clear of the hotbar.

The inventory's item card gets the same facts: the line under the name reads
`T4 · Steel · Plate · Head` (or `T6 · Elven · Short Blade · 2H`), and the stat
list gains the remaining facts. A leather/chain class is not repeated when it is
already the material word.

## Loot Filter

A separate mod that hides junk from the world plaque. Rules combine as “hide if
any matches”; quest items are never hidden. Hidden items never reach the plaque,
and a pile/corpse with nothing left to show is put to sleep so it leaves the
world's sprites and the loot targets too — nothing is ever deleted, and
clearing the rule wakes it intact.

- **Enable loot filter** — the master switch.
- **Hide types** — weapons, armor, gems, clothing, ingredients, misc, books,
  religious items, ammo.
- **Hide all commons** — anything with no rarity.
- **Hide commons below tier** — commons under the material tier you pick.
- **Hide anything below tier** — the same cut even for magic+ items.
- **Hide below rarity** — common / magic / rare / legendary / artifact.
- **Min value (gold)** — hides anything cheaper.
- **Hide names (comma)** and **Always keep (comma)** — substring lists; keep
  wins.
- **Show all while holding** — a held key (default **Alt**, ARPG-style) that
  bypasses the filter: every row returns and sleeping piles/corpses wake until
  you let go. Click the key button and press another key to rebind; Backspace /
  Delete sets **None**.

The selected row takes the **item it shows** — a visible row can no longer take
a different item that the filter hid at the same index. **Take all** is the
exception: it still takes everything in the pile, hidden rows included.

**ESC → Mods → Loot Filter** holds the rules; settings live in
`localStorage['dfoLootFilter.config.v1']`.

## Troubleshooting

- `node modloader/install.mjs --check` (and a mod's `--check`) says what is
  wrong: “not installed”, “installed for vX, serving vY”, “the game plays its
  bundled copy”.
- If the bundled build could not be read: start the game once and retry (the
  Linux AppImage needs its mount; the Windows portable needs its unpacked
  folder), or pass `--app=`.
- If the **Mods** pane is blank right after a game update, the game started
  before the sync finished. Restart once (or use the launcher) and the pane,
  settings, and credit/link load normally.
- Force a full re-install by deleting `Game/.dfo-mods/installed.json` and
  running `node modloader/sync.mjs` (or the launcher).
- In game, **ESC → Mods → Reload** re-reads the mod files; it does not need a
  page reload.

## Notes

- `Game/.dfo-mods/installed.json` records the loader and every mod; it is
  machine-local.
- Backups of the release's own files live in `Game/.dfo-mods/originals.json`,
  keyed by version. Uninstall restores only the version being uninstalled.
- Uninstalling a mod leaves the loader and the other mods in place; remove the
  loader itself with `node modloader/install.mjs --uninstall`.
- The overlay built after a launcher update is one version number above the
  seed and is superseded by the next real release.

See [DEVELOPING.md](DEVELOPING.md) for the loader contract, patch lists, anchor
philosophy, and the full skill formula.
