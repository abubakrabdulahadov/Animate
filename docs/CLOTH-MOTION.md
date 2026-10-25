# Cloth authoring and motion

Cloth uses ordinary editable native handles and triangle fills. It works through
the engine and agent API, without a new toolbar. It does not change existing
figures automatically or rebuild old videos.

```js
editor.select(uid);
const scarf = editor.addCloth({
  preset:'scarf', anchorId:neckHandleId,
  length:150, width:20, endWidth:14, rows:30, columns:5,
  color:'#d68170'
});
await editor.applyHumanMotion({
  action:'carry', hand:'left', duration:120, distance:180,
  cloth:{wind:{x:-18,y:0}, flutter:6}
});
```

`addCloth` returns the mesh ID, native handle IDs, row/column counts and triangle
count. It appends to the selected reusable figure definition and retains its
instances, existing handles and poses. Like other definition edits, this affects
all instances of that definition. Undo restores the previous topology and poses.
Use a separate definition first when only one character should wear the cloth.

The `scarf`, `cape` and `skirt` presets provide a long narrow strip, a shoulder
drape and a widening waist drape. `anchorId` chooses a native attachment handle
(zero means the figure root). The complete first row stays pinned relative to
that handle. `angle` is a scene-plane angle in radians; `offset:{x,y}` moves the
top edge relative to the anchor in figure units. A skirt starts in front of the
legs; capes and scarves start behind the skeleton. Override `zOrder` when needed.

| Option | Default / range |
| --- | --- |
| `length`, `width`, `endWidth` | Preset dimensions, 1–10,000 figure units. |
| `spacing` | 6 units; determines automatic row count, clamped to 8–128 rows. |
| `rows` | Explicit longitudinal divisions, 2–128. |
| `columns` | Across-width divisions, 2–12; scarf defaults to 3, cape/skirt to 6. |
| `color`, `opacity` | Hex/RGB and 0–1 opacity. |

A default scarf has 84 handles and 120 triangles. A 30-row, 5-column scarf has
186 handles and 300 triangles. More nodes allow a smoother silhouette, but density
alone does not create natural movement. Attachment, falloff, timing and deformation
matter too. Start at 6-unit spacing, then raise density for close shots. Each mesh
is bounded to 2048 vertices / 4096 triangles, with at most 16 meshes per figure;
the existing native figure and motion preparation limits still apply.

## Baking over existing animation

```js
await editor.applyClothMotion({
  start:0, duration:120, after:'hold',
  cloth:{wind:{x:-18,y:0}, flutter:6, sag:8, lag:.035, frequency:1.6}
});
```

This samples the existing evaluated character/prop animation before adding cloth
deformation. It preserves the root movement, noncloth angles and other figures.
It supports ordinary planar props as well as humanoids. It uses the same bounded
worker preparation, cancellation, stale-result checks and single undo publication
as human motion. Saving/reopening and normal exports keep the baked result.

`applyHumanMotion` automatically animates cloth on its generated character; pass
`cloth:false` to leave its cloth controls rigid. Use **one** of automatic human
cloth or a later standalone cloth bake; repeated baking adds deformation to the
already baked source. For a different result, undo the cloth bake first.

The deformation is deterministic stylized drape/flutter, not a collision or
mass/spring simulation. It keeps the top row fixed, progressively releases the
free end, adds world-space wind/sag, bends across the cloth's length and lets
movement lag behind the figure's root velocity. It does not simulate body/ground
collision, tearing, garment sewing, self-collision or 3D cloth. Very strong wind
or manually folded controls can overlap. Keep broad clothing clear of the body
through authored pose, offsets and painter order.

| Motion option | Meaning / allowed range |
| --- | --- |
| `wind:{x,y}` | World-axis displacement in unscaled figure units, each −200–200. |
| `flutter` | Wave amplitude, 0–50 figure units. |
| `sag` | Downward drape, 0–100 figure units. |
| `lag` | Root-velocity response in seconds, 0–0.2. |
| `frequency` | Wave cycles per second, 0–8. |

Preview without editing with `previewClothMotion(settings, seconds)`; inspect
meshes with `getClothMeshes()`. Agent tools are `editor_addCloth`,
`editor_getClothMeshes`, `editor_previewClothMotion`, `editor_applyClothMotion`.
Discover their signatures with `node scripts/agent.mjs --tools cloth`.

New controls and fills stay ordinary native geometry. Coordinate-only markers
describe each control's grid role; native parents and polygon handles retain
ownership of attachment/topology references. Deleting or duplicating part of a
grid may make it unsuitable for another bake: incomplete/ambiguous grids reject
preparation with a clear error rather than publishing partial motion. IK
on cloth controls, spatial/connector figures, re-rooted origins, joined figures,
locked layers, unfinished working-frame drafts and explicit legacy transform
channels are not supported by this baker.

## Verification

`node --test tests/cloth-motion.test.mjs` covers pinned attachments, density,
carry elbow direction, deterministic samples, preservation, history, native
roundtrip, cancellation and tools. `node tests/cloth-motion.browser.mjs` checks
actual workers/disposal, renders cloth with carrying poses, and samples opaque
triangle interiors to detect cracks in the exported image. It uses the existing
backend test host and Chromium with its GPU disabled.
