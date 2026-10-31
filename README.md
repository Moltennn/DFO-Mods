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
  launcher. No system install? Put a portable copy at `node/bin/node`
  (Linux/macOS) or `node\node.exe` (Windows) inside this folder, or set
  `DFO_NODE` to its path. The scripts look in that order: `DFO_NODE`, the
  portable copy, then `node` on PATH.
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

Each script checks which mods apply to the build the game plays, removes the
background sync that earlier versions set up, and creates the **DFO Online
(Mods)** shortcut. Nothing is written into the game: the mods are applied as the
game starts, so there is nothing to repair after an update. Running it again is
harmless.

On a portable/unpacked build, pass the game once so the launcher can find it
later:

```bash
./install.sh --app="/path/to/DFO Online"
install.bat "C:\path\to\DFO Online"
```

### Checks

```bash
node modloader/check.mjs                                  # which mods apply to the build the game plays
node modloader/check.mjs --app="/path/to/DFO Online"      # when the game is not started yet
```

The check applies every mod to the build in memory and writes nothing. It exits
0 when every mod applies, 1 when some do not (the rest still work), and 2 when
the build cannot be read yet (start the game once, or pass `--app=`).

Node.js 18 or newer runs the scripts. A portable copy works too: put it at
`node/bin/node` (Linux/macOS) or `node\node.exe` (Windows) in this folder, or set
`DFO_NODE` to its path.

## Starting the game

The **DFO Online (Mods)** shortcut (desktop entry, desktop shortcut, or
`play.command`) runs `modloader/play.mjs`. Use it instead of the game's own icon:

- It starts a small server on `127.0.0.1` (a free port, chosen each time). The
  server answers for the game's files: the build the store plays, with the mods
  applied as they are read. Then it starts the launcher pointed at that address.
- It stays up while the game runs and stops when the game closes. Nothing runs
  in the background.
- The game store is never written. A channel update cannot undo the mods: the
  next game load sees the new build and applies the mods to it again.
- If a mod does not apply to a new build (its anchors moved), the rest still
  work and `node modloader/check.mjs` names the mod that is out.
- If the game is already running, the shortcut says so and stops. Close it and
  start again: the mods only apply to a game started through the shortcut.

Anything after `--` goes to the game. The resolved game path is remembered in
`modloader/game-path.txt`; pass `--app=` once if detection fails:

```bash
node modloader/play.mjs --app="/path/to/DFO Online.AppImage"
node modloader/play.mjs --app="C:\Program Files\DFO Online\DFO Online.exe"
```

### What this changes

- **Rollback is off for modded play.** The launcher normally falls back to the
  previous build when a new channel build fails to start. Through the server the
  game window skips that check, so a broken channel build stays current until a
  fixed one ships. Play without the mods to keep the automatic fallback.
- **The game's address is local.** Its pages load from `127.0.0.1` rather than
  `dagger://`. Online login was reported working with this launch path.
- **Tested on Linux only** for this launch path. Windows and macOS are not yet
  tested with the server.

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
- **Quest items** are the one row that is not a material: the row reads
  `Quest: <name>` in magenta `#F873FF` (dot and name). In the item card only the game's
  “Quest item” line below the name is magenta; the name and summary line stay
  ordinary. The marker follows its own switch, so it still shows with tier
  labels turned off.

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
/ All), **Weapon hands (1H / 2H)**, **Mark quest items** (magenta, `Quest: name`),
**Gradient names**, **Ingredient icons**, **Colour by material**, **Colour
scheme** (Classic / Bright / Colour-blind blue-orange / High contrast), and
**List rows** (3–20; the game's default is 6).

Pack and loot-window rows get the same treatment: the name takes the material
colour (quest items magenta), the line under it is the card line (`T4 · Steel ·
Long Blade · 1H`), and an item with two colours (quest + gem, quest + metal)
fades between them when **Gradient names** is on. Ingredient rows get a small
glyph by kind (herb, fungus, mineral, flower, animal).

Rows are coloured by material (a dot and the name) in the Classic Daggerfall
palette or a brighter one; a magic/rare/legendary row keeps the game's rarity
dot. The plaque is widened so each item stays on one line, its width stays fixed
while scrolling, and a tall list is lifted clear of the hotbar.

The inventory's item card gets the same facts: the line under the name reads
`T4 · Steel · Plate · Head` (or `T6 · Elven · Short Blade · 2H`), and the stat
list gains the remaining facts. A leather/chain class is not repeated when it is
already the material word.

## Loot Filter

A separate mod that hides junk from the world plaque. It is a list of rules:
each rule is **Show** or **Hide** plus conditions that must all match. Rules are
read top to bottom and the first match decides; an item no rule matches is
shown. Quest items are never hidden. Hidden items never reach the plaque,
and a pile/corpse with nothing left to show is put to sleep so it leaves the
world's sprites and the loot targets too — nothing is ever deleted, and
clearing the rule wakes it intact.

Conditions, each used once per rule:

- **Type** — weapons, armor, gems, clothing, ingredients, misc, books,
  religious items, ammo (`=`, `≠`).
- **Rarity** — common / magic / rare / legendary / artifact (`=`, `≠`, `<`, `≤`,
  `>`, `≥`).
- **Tier** — material tier 1–12 (`=`, `≠`, `<`, `≤`, `>`, `≥`). Only weapons and
  armour have a tier; a tier condition never matches anything else. Tiers run
  Leather 1, Chain 2, Iron 3 … Daedric 12, so weapons start at 3.
- **Stack size** — the count in the stack (`=`, `≠`, `<`, `≤`, `>`, `≥`).
- **Value** — gold (`=`, `≠`, `<`, `≤`, `>`, `≥`).
- **Name** — contains text.
- **Enchanted** (magic rarity or better) and **Artifact** — yes / no.
- **Hands** — one-handed or two-handed weapons.
- **Armour slot** — chest, hands, legs, arms, head, feet, shield (`=`, `≠`). Taken
  from the game's equip table, or from the item name when the template is not in it
  (for example Fur Helmet).

A rule with no conditions matches everything. The list holds up to 20 rules.
Example: *Hide when Rarity = Common and Tier ≤ 2* hides basic common leather
and chain armour; it does not reach weapons, which start at tier 3.

- **Enable loot filter** — the master switch.
- **Show all while holding** — a held key (default **Alt**, ARPG-style) that
  bypasses the filter: every row returns and sleeping piles/corpses wake until
  you let go. Click the key button and press another key to rebind; Backspace /
  Delete sets **None**.

The selected row takes the **item it shows** — a visible row can no longer take
a different item that the filter hid at the same index. **Take all** is the
exception: it still takes everything in the pile, hidden rows included.

**ESC → Mods → Loot Filter** holds the rules; settings live in
`localStorage['dfoLootFilter.config.v2']`. The first run after the update
turns the old switches into rules, so nothing is lost. The old
`dfoLootFilter.config.v1` entry is left in place and is no longer read.

## Troubleshooting

- `node modloader/check.mjs` says which mods apply to the current build and why
  a mod was left out.
- “the build is not readable yet” (the game page shows it): start the game once
  and reload. The Linux AppImage needs its mount; the Windows portable needs its
  unpacked folder. Or pass `--app=`.
- “the game is already running”: close it and start through the shortcut.
- In game, **ESC → Mods → Reload** re-reads the mod files; it does not need a
  page reload.

## Notes

- Earlier versions wrote the mods into the game store (an overlay folder,
  `Game/.dfo-mods/installed.json` and `originals.json`). This version does not
  read those files, and the mods recognise their own changes if they are still
  there, so nothing needs cleaning up. The next channel build replaces them.
- The mods live in their folders (`loot filter`, `skill tracker`, `UI tweaks`,
  each with a `patches.mjs`) and are found automatically; a new mod folder with a
  `patches.mjs` needs no other registration.

See [DEVELOPING.md](DEVELOPING.md) for the loader contract, patch lists, anchor
philosophy, and the full skill formula.
