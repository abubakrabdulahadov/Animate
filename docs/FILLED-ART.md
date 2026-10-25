# Filled cartoon characters and graphics

The engine and agent API can create a full-color 2D character whose visible
artwork is entirely native filled contours. The internal controls remain editable
but do not appear as skeleton strokes in exports. Existing stick figures keep
their current appearance; this is an explicit authoring choice.

For coherent front/side/back views, independent head turns and orbital perspective,
use `dimension:'3d'`: see [Spatial characters](SPATIAL-CHARACTERS.md). The default
`dimension:'2d'` remains a planar artwork preset.

```js
const {uid,rig}=editor.addCartoonCharacter({
  name:'Aziz', position:{x:420,y:300}, expression:'happy',
  palette:{skin:'#efc49c',shirt:'#68a6a0',pants:'#405d81',hair:'#554035'}
});
editor.select(uid);
await editor.applyHumanMotion({action:'carry',hand:'left',duration:96,distance:150});
editor.addCloth({preset:'scarf',anchorId:rig.spine.at(-1),color:'#d58b76'});
```

Create clothing before generating the human motion when automatic cloth motion
is wanted. A later standalone cloth bake can also animate cloth over an existing
pose sequence; see [Cloth motion](CLOTH-MOTION.md).

The preset includes a two-part torso, rounded upper/lower limbs, hands, shoes,
ears, hair, eyes, brows and a mouth. The returned `rig` uses native handle IDs.
It works with the existing walking, carrying, waving, idle and reaching sampler
without a second skeleton or a special render path. Appearance options are:

- `expression`: `happy`, `neutral` or `sad` at creation.
- `palette`: hex/RGB colors for `skin`, `shirt`, `pants`, `shoes`, `hair`, `iris`.
- `name`, and an optional scene `position:{x,y}` through the editor method.
- `dimension`: `2d` or `3d`.

Imported assets use the normal figure/range planner, saving and one undo command.
All contours and their handles remain native editable geometry. Automatic rig
detection follows the internal anatomy, not polygon vertices. Ordinary joint
rotation carries attached artwork with its bone; torso contours bridge the chest
and pelvis. The head's recognition control is transparent as well as initially
hidden, preserving invisibility through native visibility normalization on save.

This is a stylized planar asset preset, not a general character design or skinning
system. It is designed for joint rotation and fixed-length IK. Stretching,
bending, re-rooting or changing bone proportions may require editing the artwork
too. The planar preset does not add facial animation, 3D turning, imported SVG retargeting or
automatic conversion of an existing character. Size and whole-figure rotation
use the existing figure transform tools. A fresh character has 691 native controls
and 31 visible filled contours; normal pose preparation budgets still apply.

Planar shoes now cover the rounded trouser ends and use an explicit sole offset
for grounding; source `groundY` refers to the sole surface. See the spatial
character guide for the matching 3D foot attachment and view controls.

## Filled UI-style artwork

```js
editor.addFilledShape({
  shape:'roundedRect', width:240, height:80, radius:20,
  color:'#648b83', opacity:1, position:{x:700,y:150}
});
```

`shape` supports `roundedRect`, `pill`, `ellipse`, `star`, `speechBubble`.
Dimensions are 2–10,000 figure units. Rounded corner `radius` is bounded by half
the smaller dimension. Speech bubbles accept `tail:'left'|'right'` and keep their
tail in the same contour, avoiding overlapping translucent fill pieces. All
presets accept `color`, `opacity` (0–1), `name`, and an editor `position`.

These are static native graphics suitable for animated buttons, panels, badges
and dialogue bubbles. They do not create interactive application UI controls or
change the editor's interface. Add editable text separately through the existing
text asset tools; these shape constructors do not rasterize a label.

Agent tools are `editor_addCartoonCharacter` and `editor_addFilledShape` in the
`cartoon` category. Both return the native result through the normal agent call
contract. See [agent-cartoon.json](../examples/agent-cartoon.json).

## Verification

`node --test tests/filled-art.test.mjs` covers all-fill artwork, native rig
recognition/motion, shape bounds, invalid-input atomicity, undo/redo, native
roundtrip and agent calls. `node tests/filled-art.browser.mjs` renders a comparison
with Chromium's GPU disabled and checks that the cartoon exposes zero painted
skeleton primitives. Its PNG is written to `artifacts/filled-art/`.
