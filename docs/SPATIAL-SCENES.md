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
`cameraTo`, `cameraPath`. Actor entries follow creation order and use ordinary
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
It does not import arbitrary 3D models, simulate collisions or add dynamic lights,
shadows, cloth, depth of field or independent scene-object timeline tracks. Box
placement is authored explicitly; actors do not automatically walk around props.

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
