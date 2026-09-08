# Personalised name playables

Two mechanics, one channel. The player types a name once; it appears anywhere you
put it, on that scene and on every scene after it.

| Mechanic in the Template dropdown       | id           | What it is                                              |
| --------------------------------------- | ------------ | ------------------------------------------------------- |
| **Name box (type in)**                   | `nameinput`  | The field, with a live caret. Takes the keystrokes.      |
| **Name result (shows what was typed)**   | `nameresult` | A read-only area that draws the name and fits it inside. |

Both are game mounts, so both are boxes you drag, resize and rotate on the canvas
like any other element.

## The four-scene flow from the brief

**Scene 1 — "Type your dog's name"**

1. Add a game mount, template **Name box (type in)**. Size it to the white field.
2. Style it exactly like a text element: font, size, weight, colour, alignment, plus
   the field's own fill, corner radius, border and inset under **Field box**.
3. **Preview text** is the "type here" line, styled independently of the typed text:
   its own font, size, weight, letter spacing, italic, colour and opacity, plus
   _Gap from the cursor_. It is a different piece of copy doing a different job, so it
   is not tied to the answer's styling — it defaults to a lighter weight for exactly
   that reason. Leave font / size / weight at blank-or-0 and that one property follows
   the field instead. The line disappears on the first keystroke and comes back if the
   player clears the field.
4. **Cursor** is the caret: shape (bar / block / underline), colour, weight, height
   as a percentage of the font, blink speed in ms (0 = steady), and _Gap either side
   of the cursor_ — the space between it and the typed text. Both gaps take negative
   numbers, which tucks the cursor closer to the letters.
5. The **arrow button is not part of this mechanic.** Place it as an ordinary button
   or image element on top of the field and give it whatever navigation you want. The
   name box never ends the scene by itself, so the player can keep editing until they
   tap on.

**Scenes 2–3 — the name on the product shot**

Add a second mount on the same scene, template **Name result**, and drag it over the
patch in the product photo. It fills in as the player types — same scene, same
channel, no wiring.

**Scene 4 — the name on the hero shot**

Another **Name result**, its own size, its own angle. The value came from scene 1 and
is still there: it lives in the playable, not in the scene.

## The result area

- **The area is the mount's box.** Drag its corners to say where the lettering may go.
- **Rotating it — two ways, and the difference matters:**
  - **Angle** (the round handle above the selection box, <kbd>Shift</kbd> for 15° steps,
    or the number in the Inspector) turns **the area itself**. The fit rectangle tilts
    with it, so a name set diagonally across a patch has the whole diagonal to grow
    into. **This is the one to use for a tilted patch.**
  - **Turn the text only** under **Area** turns the lettering inside an upright area,
    with `Slant` for a skew. The fit allows for the turned footprint — a tilted word is
    wider and taller than the same word upright — so a long name still cannot escape
    the rectangle you drew. It just has less room to work with than a tilted area gives
    it.
- **Centring**: the text is centred in the area in both axes by default (`Align`
  center, `Vertical align` middle), and stays centred when turned — the label pivots
  about the area's centre, not a corner.
- **Fit to the area**: `shrink to fit` (the default — a long name shrinks, a short one
  keeps its size), `fill the area` (scales up as well, so the lettering always fills
  the space), or `never resize`. `Shrink limit %` stops it going microscopic.
- **Outline the area on the canvas** draws a dashed box while you place it. It is
  never drawn in play.
- **Shown before anything is typed** is what the area reads on the canvas and in the
  first frames of the ad, so the layout is never empty.

## Keyboards

`Keyboard` on the name box:

- **auto (device, then built-in)** — the default. Asks for the device keyboard, waits
  `Wait before falling back` ms, and if nothing came up (no typing, no viewport shift)
  raises the playable's own A–Z pad instead. Once it has fallen back it stays fallen
  back for the session.
- **device only** — never draws a pad. Right when you know the placement allows the
  OS keyboard.
- **built-in only** — never asks for the OS keyboard. The most predictable option
  across networks, and the one to pick if a network rejects creatives that raise a
  keyboard.

The built-in pad has its own section: QWERTY or ABC, optional number row, height as a
percentage of the screen, key colour, key text, radius, gap and the DONE / space
labels. It takes the field's typeface. `Letter case entered` decides what its keys
insert — `Capitalized` (default), `UPPERCASE` or `lowercase`.

Two sounds are bindable on the name box under **Sound**: _On each letter typed_ and
_When they finish typing_.

## Channels

Every box and every result carries a `Channel`, default `name`. Same channel = same
value. Use a second channel (`pet2`, `city`) only when there are two separate things
to type. `Max characters` and `Allowed characters` on the box are what keep a name
inside the art it has to fit — the limit ships at **15 characters**.

## Things worth knowing

- Casing is per element. The channel keeps what was typed; each result applies its own
  _Letter case_, so the field can show "Brownie" while the patch shows "BROWNIE".
- A name box does not fire `gameWin`, so **don't set the scene to advance on game
  win** — use a CTA, a button, a tap or a timer.
- Avoid scene tap-advance on a scene with a name box: a tap on the field is a tap on
  the scene.
- The name survives a scene change and an orientation flip. It is **cleared by any page
  load or refresh** — deliberately: a reload is a new player, and opening the ad with
  the previous one's name already in the box reads as broken. Nothing is written to
  storage.
