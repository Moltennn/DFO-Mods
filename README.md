[Español](README.es.md)
# DFO Online Mods

Three small, client-side mods for the desktop version of **DFO Online**:
**Skill Tracker**, **UI Tweaks** and **Loot Filter**. They change what the
interface shows. Nothing is uploaded, and no character, save or server data is
touched.

The mods load when the game is started through the **DFO Online (Mods)**
shortcut. What each one does is in [MODS.md](MODS.md); how the loader and the
patches work is in [DEVELOPING.md](DEVELOPING.md).

## Requirements

- The desktop build of DFO Online: Linux AppImage, Windows `.exe`, or macOS
  `.app`.
- [Node.js](https://nodejs.org/) 18 or newer. No system install? Put a portable
  copy at `node/bin/node` (Linux/macOS) or `node\node.exe` (Windows) in this
  folder, or set `DFO_NODE` to its path.
- This folder kept next to the game.

Browser play is not supported: the website serves that build, so there is
nothing local to patch.

## Install

Linux and macOS:

```bash
./install.sh
```

Windows:

```bat
install.bat
```

This creates a **DFO Online (Mods)** shortcut. Nothing is written into the game,
so a game update needs no reinstall; running it again is harmless.

If the game is portable or was not found, point at it once:

```bash
./install.sh --app="/path/to/DFO Online"
install.bat "C:\path\to\DFO Online"
```

## Starting the game

Use the **DFO Online (Mods)** shortcut instead of the game's own icon — the mods
only load through it.

- If the game is already open, close it first.
- Keep the shortcut's window open while you play — it is what serves the mods.
- After a game update, start it the same way. The mods re-apply themselves.
- Online play works as usual.

## The Mods menu

Each mod has its settings in the game's **ESC (pause) menu → Mods**. **Reload**
reloads a mod after it is updated. Everything there is described in
[MODS.md](MODS.md).

## Troubleshooting

- **A mod is missing after a game update.** The game changed, so the mod needs
  its matching update: pull the latest version of this folder. To see which mods
  are applied: `node modloader/check.mjs`.
- **“The game is already running.”** Close the game and start it through the
  shortcut again. If the game really is closed, run the shortcut with
  `--force` (`play.bat --force`, or `./play.sh --force`).
- **“The build is not readable yet.”** Start the game once without the shortcut
  so it downloads its build, then use the shortcut again.
- **In game**, **ESC → Mods → Reload** reloads the mods without restarting the
  game.

### If it will not start

The shortcut normally starts the game for you. If it cannot, you can serve the
mods and start the game yourself:

```bash
./play.sh --serve-only          # Windows: play.bat --serve-only
```

It prints the exact command to start the game with, and keeps running until you
press Ctrl+C. The game then loads the mods as usual. Keep that window open while
you play.

## Documentation

- [MODS.md](MODS.md) — what each mod does and what its settings mean.
- [DEVELOPING.md](DEVELOPING.md) — the loader, the patches and the formulas.
