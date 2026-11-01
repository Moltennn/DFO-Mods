# The mods

What each mod does and what its settings mean. Installing and starting the game
is in [README.md](README.md); how the patches work is in
[DEVELOPING.md](DEVELOPING.md).

## The Mods menu

Everything lives in the game's **ESC (pause) menu → Mods** (Enhanced skin):

- Each mod gets its own band: its name, the version it loaded, and a **Reload**
  button.
- **Reload all** sits on the right of the footer; the credit and repo link are on
  the left.
- Each band holds that mod's settings.

Reload re-reads the mod files and restarts the mods that changed; a mod you
removed is unloaded. **There are no mod hotkeys.**

## Skill Tracker

A panel on the HUD that tracks the skills you pick and shows how far each one is
from its next point:

```
31/69  Critical Strike  32
```

The uses column brightens when the next skill check will grant the point; at a
skill's cap it reads **max** and dims (100 unmastered, 200 under **Master
Skills**). The optional **Skill levels** column on the right uses the game's own
skill text (`32`, or `100 (104)` when a softcap is holding it down).

The panel has no title line; the game's Alt+U layout editor names it “Skill
tracker”. It follows the game's HUD colours and the active theme. Moving,
scaling, hiding and placing it are the game's own HUD editor; the mod's pane has
**Show/Hide panel** and **Reset panel placement**.

**ESC → Mods → Skill Tracker**: panel opacity, **Skill levels**, row spacing,
**Show/Hide panel**, reset placement, and the checklist of tracked skills.

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
- Weapons show their weapon skill and **1H**/**2H**.
- Armour shows its class (**Leather / Chain / Plate**) and its slot: **Chest,
  Hands, Legs, Left/Right arm, Head, Feet, Shield**.
- Clothing and jewellery show the slot they go to (**Chest, Legs, Feet, Cloak,
  Ring, Amulet, Bracer, Mark, …**).
- **Ammo** keeps its plain name; **gems** are coloured by stone (Ruby red …
  Pearl cream) and graded gems keep the grade word.
- **Quest items** are the one row that is not a material: the row reads
  `Quest: <name>` in magenta (dot and name). In the item card only the game's
  “Quest item” line below the name is magenta.

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
fades between them when **Gradient names** is on. A stack's count is shown once,
not repeated in the name. Ingredient rows get a small glyph by kind (herb,
fungus, mineral, flower, animal), on the world plaque as well as in the pack.

Rows are coloured by material (a dot and the name) in the Classic Daggerfall
palette or a brighter one; a magic/rare/legendary row keeps the game's rarity
dot. The plaque is widened so each item stays on one line, its width stays fixed
while scrolling, and a tall list is lifted clear of the hotbar.

The inventory's item card gets the same facts: the line under the name reads
`T4 · Steel · Plate · Head` (or `T6 · Elven · Short Blade · 2H`), and the stat
list gains the remaining facts. A leather/chain class is not repeated when it is
already the material word.

## Loot Filter

Hides junk from the world plaque. It is a list of rules: each rule is **Show** or
**Hide** plus conditions that must all match. Rules are read top to bottom and
the first match decides; an item no rule matches is shown. Quest items are never
hidden. Hidden items never reach the plaque, and a pile or corpse with nothing
left to show is put to sleep so it leaves the world's sprites and loot targets
too — nothing is ever deleted, and clearing the rule wakes it intact. A hidden
item also loses its own little world sprite, so only the loot you keep is drawn
on the ground.

Conditions, each used once per rule:

- **Type** — weapons, armor, gems, clothing, ingredients, potions, food, misc,
  books, religious items, ammo (`=`, `≠`). *Food* is the edible provisions
  (rations, fruit, bread, meat, raw meat, fish); *potions* covers every potion.
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
- **Armour slot** — chest, hands, legs, arms, head, feet, shield (`=`, `≠`).

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

**ESC → Mods → Loot Filter** holds the rules.
