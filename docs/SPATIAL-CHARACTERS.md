# Spatial cartoon characters

`addCartoonCharacter({dimension:'3d'})` creates an articulated, filled 3D character
using the existing native spatial bones, indexed mesh, depth compositing and
perspective. The planar preset remains available as `dimension:'2d'` (the default).
Saved older artwork is not automatically rebuilt or converted.

```js
const {uid}=editor.addCartoonCharacter({
  dimension:'3d', position:{x:400,y:330}, name:'Aziz',
  palette:{shirt:'#659f99',pants:'#405a80'}
});
editor.select(uid);
await editor.applyHumanMotion({
  action:'walk', duration:120, distance:180, groundY:530,
  view:{yaw:Math.PI/2,headYaw:0,perspective:.5,distance:700},
  viewTo:{orbitYaw:Math.PI*.8,orbitPitch:.2,headYaw:-.3}
});
```

The model has separate torso, head, arms, legs, hands and shoes. Eyes, nose,
mouth and hair occupy actual depth on the head. A front pocket and back seam
distinguish the torso's two sides. Depth testing hides facial details when the
head faces away and orders near/far limbs; painter-order tricks or a mirrored
face image are not used. Head turn/tilt are relative to the body. The geometry
uses about 6,500 vertices and 10,200 triangles, but only 45 native controls, so
mesh density does not multiply pose channel size. Palette shading is baked into
the mesh; it is stylized shading, not a dynamic scene lighting system.

## Pose and view controls

`getCharacterView()` reports the native view channels. `setCharacterView(patch)`
edits any of `yaw`, `pitch`, `roll`, `headYaw`, `headPitch`, `perspective`,
`distance` as one native pose edit, retaining normal undo/redo and saving. Angles
are radians. Front is yaw zero; right profile is π/2; back is π; left profile is
−π/2. A head turn is relative to its torso, rather than another whole-body turn.

Native part posing, spatial IK, whole-figure transforms, colors and perspective
remain available through existing methods. Shape/proportion edits can be posed
manually, but the generated gait currently requires the original bone dimensions.

Human motion accepts `view` and `viewTo` only for spatial cartoon characters.
Both accept the native fields above plus `orbitYaw` and `orbitPitch`. Non-heading
view values interpolate over the generated range. Heading takes the short angular
path; gaze leads the shoulders, and the pelvis follows. Missing end fields retain the
start value. A nonzero walk/carry distance defaults to a body heading along its
travel direction; stationary actions retain the source orientation.

`orbitYaw`/`orbitPitch` rotate a camera around the selected character's source
root. Camera rotation is composed in camera coordinates before native Euler
decomposition, so raising the camera does not tip the body sideways. The path is
rotated into that camera's coordinates as well. Perspective projects its depth
and the mesh consistently; the projection center remains at the shot's source
root. `distance` is in unscaled character units, 100–100,000; `perspective` is 0–1.
Orbit pitch stays between −π/2+.05 and π/2−.05. Paths approaching the near plane
reject before publication; increase camera distance for longer depth travel.

This is **a per-character orbit bake**, not a free world camera that reprojects
every unrelated 2D object. Scene pan, zoom and roll still use the normal scene
camera tools. Supply `view` explicitly in each generated shot when camera orbit
semantics matter; native pose channels retain the final projected orientation,
not a second hidden camera/model state. Direct `setCharacterView` uses the
object's native Euler orientation rather than a separate orbital scene camera.

For a shared camera and true occlusion between several actors and solid scenery,
use [Shared 3D scenes](SPATIAL-SCENES.md). The per-character view above remains
available for independent figures.

## Grounding and motion

The existing deterministic planar foot-planted sampler supplies gait timing,
elbow/knee bend and upper-body coordination. Its sagittal motion is lifted into
the character's native spatial rotations. Left/right shoulders and hips retain
their lateral separation. Native 3D leg IK holds each stance ankle at its
world-space plant through curved
travel and body turns, compensating pelvic weight shifts. Shoes retain their
plant heading until the next step and stay level. Root travel follows the heading
as an integrated curved path instead of rotating an already traveled distance.
The shoe mesh and ankle share one articulation.

`action:'turn'` turns in place toward `viewTo.yaw`, stepping each foot in turn
while the gaze leads the shoulders and hips. Both feet settle at the final heading.
It is a spatial-character action; ordinary planar rigs do not accept it.

`groundY` places the **sole**, not the ankle, on the source ground plane. Generated
2D characters now use a 15-unit sole offset and spatial ones use 18 units. Pose
scale is respected. `contacts.left/right.point` reports the projected sole point;
`ankle` reports its joint. In an orbital/perspective view, a physical ground plane
may project to different screen heights at different depths. `grips` similarly
reports actual projected wrist positions for held artwork.

Generation still publishes normal pose keys in one undoable command on both
timelines. Worker input includes only bone geometry/roles, omitting the immutable
mesh. Native STYK/STKZ and normal image/video exports retain the spatial result.
Pivot STK/PIV export has the existing indexed-mesh restrictions.

Reflected characters, pinned spatial IK, changed bone proportions and nonzero
planar whole-figure rotation reject generated motion; use spatial view roll for
shot rotation. Planar cloth baking is not a 3D cloth solver and is not applied to
this mesh. Native manual posing remains available. This preset does not add
collision physics, joint-limit biomechanics or arbitrary imported-model retargeting.

## Verification

- `node --test tests/spatial-character.test.mjs`: soles, native geometry, independent
  head/body rotations, camera quaternion order, deterministic sampling, grips,
  sparse ID remaps, both timeline histories, native saving and cancellation.
- `node tests/spatial-character.browser.mjs`: real depth-rendered views with the
  GPU disabled, facial visibility from front/back, head-only turning and worker
  motion publication. Artifacts are written to `artifacts/spatial-character/`.

See [agent-spatial-character.json](../examples/agent-spatial-character.json).
