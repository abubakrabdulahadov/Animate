# Shared 3D scenes

`addSpatialScene` creates one editable native figure containing up to eight
cartoon actors and 128 solid box props. All actors, their limbs and the scenery
share a camera, perspective and depth pass. An actor can walk behind a bench or
another actor without changing layer order. Existing unrelated figures retain
their usual layer composition; this command does not convert them into a 3D world.

```js
const {uid,actors}=editor.addSpatialScene({
  name:'At the station', position:{x:480,y:280},
  actors:[
    {name:'Aziz',position:[-100,0,0],palette:{shirt:'#4f9590'}},
    {name:'Nila',position:[100,0,-120]}
  ],
  boxes:[
    {name:'Floor',position:[0,131,0],size:[800,20,800],color:[116,143,144]},
    {name:'Bench',position:[0,80,-150],size:[200,20,65],color:[152,118,86]}
  ]
});
editor.select(uid);
await editor.applySpatialSceneMotion({
  duration:144,
  actors:[
    {action:'walk',distance:180,view:{yaw:.7},viewTo:{yaw:2.2}},
    {action:'turn',view:{yaw:-.6},viewTo:{yaw:1.8}}
  ],
  camera:{position:[60,-100,700],target:[0,-15,0],focalLength:700},
  cameraTo:{position:[390,-170,500],target:[40,-15,0]}
});
```

Scene world coordinates use X right, Y down and Z toward the default camera.
Actor `position` locates its pelvis reference; default soles lie 121 units below
that reference. Box `position` is its center and `size` contains positive XYZ
lengths. A floor centered at Y=131 with thickness 20 has its top at Y=121.
Actor presets accept `name`, `palette`, `expression`, `position`. Box colors are
RGB byte arrays. `position` on `addSpatialScene` is the 2D composition center.
An optional `camera` sets the initial view on creation.

`applySpatialSceneMotion` accepts `start`, `duration`, `after`, `actors`, `camera`,
`cameraTo`, `cameraPath`, `collisions`, `lighting`, `lightingTo`. Actor entries follow creation order and use ordinary
[human motion options](HUMAN-MOTION.md), including spatial `view`/`viewTo` headings
and `action:'turn'`. Omitted entries stand idle. Later ranges start from the saved actor world positions and camera view at that
range’s start; omitted camera fields retain that view. One common duration and timeline
range applies to the entire scene. Per-actor orbit and perspective are rejected:
use the common camera instead. Per-actor ground heights are relative to that
actor's reference position.

Camera fields are world `position`, world `target`, `focalLength` (100–10,000),
and `roll` in radians. Default eye is `[0,-40,700]`, target `[0,-20,0]`, focal length
700. Missing end fields hold their start values. Default `cameraPath:'orbit'`
interpolates eye direction around the moving target and eye distance separately,
so a front-to-back camera move does not cross the center of the scene. Opposite
directions use a deterministic perpendicular arc. `cameraPath:'linear'` gives a
straight dolly. Both ease smoothly at their endpoints. Actor roots within 100
units of or behind the camera reject preparation; geometry near the camera uses
the existing native near-plane clipping. There is no camera collision avoidance.

`previewSpatialSceneMotion(options,tick)` returns the native pose, sampled common
camera, and individual actor motion reports without publishing. Agent tools are
`editor_addSpatialScene`, `editor_previewSpatialSceneMotion`,
`editor_applySpatialSceneMotion` in the `cartoon` category.

The mesh is immutable definition data. XYZ translation uses existing native slide
joints, orientations use native spatial bones, and generation writes normal pose
keys. Character controls remain individually editable within the scene figure.
Scene motion publishes as one undoable command on either timeline, retains native
saving/reopening and uses the same bounded worker, cancellation and stale-result
checks as human motion. Native preparation limits (2,400 ticks, 500,000 bone samples,
64 MiB estimated pose data) still apply. Scene scale/rotation, bone proportions
and pinned IK must be restored before generation. Existing projects are unchanged.

The current scene builder supports built-in cartoon actors and opaque box props.
It does not import arbitrary 3D models or simulate rigid-body dynamics or cloth.
Depth of field and independent scene-object timeline tracks are not added. Box
placement is authored explicitly; actors stop before obstacles rather than
automatically finding a route around them.

Verification: `node --test tests/spatial-scene.test.mjs` covers common projection,
actor/scenery geometry, both timelines, native reopening, agent tools, cancellation
and rejected work. `node tests/spatial-scene.browser.mjs` exercises the actual
worker and export painter with the GPU disabled, verifies front/back occlusion
by pixels, and writes captures to `artifacts/grounded-turns/`.

A local CPU comparison on Node 24.11.0 sampled the same 600-frame spatial walk,
body heading .3→1.5 and orbit .2/.1, three times. Median preparation increased
from 57.5 ms to 279.8 ms with native 3D foot constraints; maximum individual sample
was 5.8 ms. This is a preparation tradeoff, not a playback or GPU benchmark.
The resulting keys use the existing playback path. The repeatable script and
raw runs are in `artifacts/grounded-turns/benchmark.mjs` and `benchmark.json`.

## Loads and placement

A box can specify `heldBy:{actor:0,hand:'both'}` and normalized `weight:0.85`.
Hands are `left`, `right` or `both`; actor indices follow creation order. Each
hand supports at most one box. A carried box stays upright, follows the chosen
wrist or both wrists' midpoint, and uses the actor's heading. Its top center is
the grip height. The scene selects a forward grip from the box depth to keep it
clear of the torso; boxes too deep for the original arms reject creation.

```js
editor.addSpatialScene({
  actors:[{name:'Aziz'}],
  boxes:[
    {name:'Floor',position:[0,131,0],size:[1000,20,1000]},
    {name:'Crate',size:[60,50,35],color:[171,117,69],
     heldBy:{actor:0,hand:'both'},weight:.9}
  ],
  lighting:{direction:[-.7,-1,.4],ambient:.52,intensity:.72,
    color:[255,239,215],shadows:true}
});
await editor.applySpatialSceneMotion({duration:72,
  actors:[{action:'carry',distance:120}]});
await editor.applySpatialSceneMotion({start:72,duration:72,
  actors:[{action:'putDown'}]});
```

`putDown` derives grip height from the actual box size, places its base on the
actor's ground plane and releases it. A hidden native control retains release
state across later ranges, undo and native saving. Later walking leaves the box
where it was placed, and it becomes an obstacle. The actor may retreat from its
own just-placed box even when the conservative clearance margins initially touch.
Automatic picking up, hand exchange and articulated fingers remain separate work.

## Contacts

`collisions:'stop'` is the default for generated shared scenes. A bounded
preflight sweeps conservative horizontal clearance proxies against solid box
bounds and other actors, shortening travel to finish a complete gait before
contact. Loaded actors reserve more space. Preview `blocked` identifies the box
or other actor and adjusted distance. An initially intersecting scene rejects;
`collisions:'error'` rejects any blocked path instead of shortening it.
`collisions:'off'` retains authored travel for deliberate contact staging.
`collider:false` makes an individual static box decorative. Floors at or below
the soles are receivers; raised platforms are obstacles, not automatic stair steps.

These are kinematic safety constraints, not triangle-level collision physics.
Margins can stop actors earlier than their visible surfaces; they do not model
3D clothing, hair, arbitrary meshes, impacts, bounce or sliding contact.
Existing planar cloth can opt into [body capsule constraints](CLOTH-MOTION.md). Dropped
loads become static box obstacles. No complete route planner is introduced.

Spatial loaded/placing arms also avoid an ellipsoid torso core using native IK.
Direct reaching retains its exact target semantics by default; pass
`collisions:true` in the character's motion options to prioritize torso clearance,
or `false` to retain an authored grip. Corrections are reported in actor preview
`collisions`, and bone lengths remain unchanged. Scene-generated head tilt starts
neutral unless supplied in `view.headPitch`, avoiding accumulated gait compensation
between successive activity ranges.

## Directional light and ground shadows

Creation accepts `lighting` with world-space `direction` toward the light,
`ambient` (0–1), `intensity` (0–2), RGB `color`, `shadows` (default false),
`groundY` (default 121), and `shadowStrength` (0–.8, default .32).
`lighting`/`lightingTo` on a motion range animate the same fields. Direction is
normalized and interpolates on a sphere; color and strengths blend smoothly.
Shadow visibility changes at the midpoint when its endpoints differ.
The light remains in world coordinates as the camera moves, and later ranges
retain its current native pose. Existing scenes without lighting keep their
previous appearance. General native spatial meshes can also use
`_stykSpatial.light` with direction, ambient, intensity and color.

Surface shading evaluates articulated face normals before perspective and uses
16 bounded diffuse levels per original palette entry. It adds directional color
to the preset's existing stylized palette shading, not physically based materials.
Both accelerated and compatibility painting consume the same evaluated colors;
normal native image/video exports preserve the result.

Enable `shadows:true` when creating the scene to allocate editable body and foot
shadow controls. A box floor must have its top at `groundY`, and the light must
point upward (`direction.y < -.1`). Moving shadows use soft concentric opaque
ellipses projected along the light onto that receiving plane. They are stylized
contact/cast approximations, not silhouette shadow maps: they do not shadow other
actors or raised props, include crate silhouettes, or add reflections. Footprints
near the edge of the receiver hide rather than spill onto the empty background.
Set motion `lighting.shadows:false` to hide them; adding shadow geometry to an
older scene requires creating that scene with shadows enabled.

`node --test tests/weighted-scene.test.mjs tests/spatial-light.test.mjs` verifies
loaded poses, contacts, release persistence, bounded palettes, native reopening
and light interpolation. `node tests/weighted-scene.browser.mjs` checks actual
worker publication, visible light/shadow differences and cancellation, and writes
the nine-second delivery example to `artifacts/weighted-scene/`.

A local macOS ARM64 / Node 24.11.0 comparison evaluated the same two-actor,
120-frame scene three times, including motion sampling and mesh geometry.
Median CPU times were 343 ms before these changes, 340 ms without optional light,
368 ms with directional light and 383 ms with light and ground shadows.
The unlit scene had 13,036 vertices / 20,500 triangles; shadows added 1,248 vertices
and 1,152 triangles. Derived palettes stayed at 1,056/1,184 entries. These are CPU
preparation measurements, not presentation frame rates or a GPU benchmark;
GC heap deltas are not a memory-footprint measurement. The workload and raw runs
are in `artifacts/weighted-scene/benchmark.mjs` and `benchmark.json`.

The complete DOM-free authoring job is
[agent-weighted-scene.json](../examples/agent-weighted-scene.json). Old projects
without the new pose-light fields retain their previous appearance; projects
saved with lighting require a build that supports those fields.
