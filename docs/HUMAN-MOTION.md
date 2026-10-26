# Human motion

The native `Editor` can generate coordinated walking, breathing, waving, reaching and carrying for an ordinary planar humanoid. It writes editable pose keys using the
existing document, IK solver and command history. It is available through the
engine and agent API; there is no new toolbar or automatic alteration of existing
animation.

```js
editor.select(uid);
const rig = editor.getHumanRig();
const preview = editor.previewHumanMotion({action:'walk', duration:120}, 30);
const controller = new AbortController();
await editor.applyHumanMotion({
  action:'walk', start:0, duration:120, distance:260
}, {signal:controller.signal});
```

The agent tools are `editor_getHumanRig`, `editor_previewHumanMotion` and
`editor_applyHumanMotion`. `node scripts/agent.mjs --tools human` exposes their
schemas. The last method is asynchronous; JSON batch jobs and persistent tool
sessions await it. SIGINT/SIGTERM in a session propagate to preparation.
See [the example job](../examples/agent-human-motion.json). Built-in 3D cartoon
characters also use this API through the [spatial adapter](SPATIAL-CHARACTERS.md).

## Movement

- Walking advances the pelvis with smooth acceleration and deceleration. The
  gait follows distance traveled rather than an independent animation clock.
  During stance the ankle stays at its world-space plant location; during swing
  it follows a smooth forward arc with clearance above the ground. Stride spacing
  shortens to finish whole strides, so stopping settles both feet onto the floor;
  the requested distance remains exact. The pelvis shifts gently with each support.
- The shared analytic two-link IK solver poses the legs. It preserves effective
  bone lengths; the pelvis lowers if needed to retain reach and avoid fully
  straight knees. Extra artwork inherits its parent bone's angle change.
- Empty arms counter the stepping leg with a small delayed swing, hanging nearly
  straight with a slight forward elbow bend. Carrying keeps its separate supporting
  grip while the free arm relaxes, also when standing. Spine
  segments use offset phases, and the head compensates for torso inclination.
- Idle poses keep the feet fixed while shifting weight and breathing gently.
  Waves ease into a raised arm, wave beside the head, then settle. Reaches arc
  toward a target with a small torso lean and pelvic counterbalance.

This is deterministic stylized animation, not motion capture or a biomechanical
simulation. A useful reference for the footplant problem is
[Kovar, Schreiner and Gleicher, *Footskate Cleanup*](https://research.cs.wisc.edu/graphics/Gallery/kovar.vol/Cleanup/).
The implementation uses StykAnimate's existing solver and native pose semantics.

## Options

| Field | Meaning |
| --- | --- |
| `action` | `walk` (default), `idle`, `wave`, `reach`, `carry`, `putDown`; spatial cartoon characters also accept `turn`. |
| `start` | Zero-based tick; defaults to the playhead. A start beyond the tail uses the last visible pose. |
| `duration` | Number of output ticks, 2–2400; default is approximately two seconds at the document FPS. |
| `distance` | Signed scene-pixel travel for `walk`; default is twice the shorter leg's reach. Other actions use zero. |
| `stepLength` | Maximum scene-pixel stride spacing, 12%–55% of the shorter leg length; default 48%. Actual spacing shortens to complete the final stride. |
| `groundY` | World-space floor height; default is the lower sole height (the ankle for ordinary stick rigs). An explicit height places the character on that floor. |
| `intensity` | 0–1.5, default 1; secondary motion strength. |
| `blend` | Seconds of soft entrance/settling, 0–2; default 0.25. Walk contacts are not marked planted during the initial pose transition. |
| `hand` | `left` or `right` for wave/reach, default `right`; refers to rig roles. |
| `target` | Required world-space `{x,y}` for reach. Targets outside arm reach stop at the limb's reach without stretching. |
| `after` | `hold` (default) keeps the generated final pose until a later existing key. `restore` adds the original pose at the exclusive end when the original animation continues. |
| `rig` | Optional explicit native handle mapping below. |
| `carry` | `{hand:'left'\|'right'\|'both', forward?, height?, weight?, loadHeight?}` keeps a carrying grip during walk/idle; fractions default to .45/.32 of arm reach. |
| `cloth` | Cloth motion settings, or `false` to keep attached cloth rigid; see [Cloth motion](CLOTH-MOTION.md). |
| `view`, `viewTo` | Spatial cartoon character body/head and orbital view endpoints; see [Spatial characters](SPATIAL-CHARACTERS.md). |
| `armBend` | Empty-arm elbow flex in radians, 0–0.35; defaults to 0.1 (about 6°). Zero keeps the arm straight. Applies to walk/carry free arms in 2D and spatial characters. |

`action:'carry'` provides a carrying pose, optionally with `distance` for walking.
It also accepts `hand:'both'`. Carrying selects the lower elbow solution, so the
upper arm hangs down and the forearm rises toward the load. `carry.forward`
(0.1–0.7) and `carry.height` (0.05–0.7) place the hand forward and below the shoulder
as fractions of arm reach. Default carrying keeps the wrist above the elbow.
The sampler/preview returns world-space `grips.left`/`grips.right` coordinates for
held artwork. Generate the character poses before attaching props to their hand
handles; joined groups must be detached before motion generation. Walking can
use `carry:{hand:'left'}` while the other arm swings freely.

`carry.weight` is a normalized load, 0–1 (default zero), rather than kilograms.
Heavier loads add forward torso lean, pelvic counterbalance, knee flexion,
shorter steps and less secondary sway. Distance and duration remain explicit;
raise duration when a slower walk is wanted. Zero retains the unweighted grip.

`action:'putDown'` lowers the pelvis, bends the knees forward and follows the
load down with the arms. `carry.loadHeight` is the load's height in scene units
(default 40% of leg reach); the final grip aims at `groundY-loadHeight`.
`load` reports weight, lowering and release state. The character releases the load near the lowest pose, then stands and relaxes
its arms during the remaining range. Shared 3D scenes attach box
loads to these grips and preserve the released box as native pose state.
Targets outside physical reach retain a residual; a scene refuses to release a
box if its hands cannot bring the base to the floor without stretching.

Motion is sampled once per output tick. Walking requires at least twelve samples
per complete stride; increase duration for a longer distance. Preview returns the
pose, foot contacts, target errors, normalized phase and transition weight without
modifying the document. Planted contact points are constraints; reach targets can
have a reported residual when unreachable.

For generated cartoon artwork, contact `point` is the sole and `ankle` is the
joint, so shoe thickness does not sink below or float above the intended ground.
Ordinary stick rigs have zero sole offset. Spatial cartoon characters reuse this
sampler through a native spatial adapter; other spatial rigs remain unsupported.

## Anatomy and compatibility

Automatic detection follows native topology and named left/right limbs. It
supports the built-in Walker/Blue figures and ordinary rigs with 1–8 connected
spine bones, one head, two two-link arms and two two-link legs. Optional named
foot segments are kept level. Extra ambiguous branches require an explicit map:

```json
{
  "spine": [1, 2],
  "head": 3,
  "leftArm": [4, 5],
  "rightArm": [6, 7],
  "leftLeg": [8, 9],
  "rightLeg": [10, 11],
  "leftFoot": 12,
  "rightFoot": 13
}
```

IDs are native handles, not array positions. The pelvis is the figure root;
legs attach there, and arms/head attach to the spine tip. Mapped limbs must be
straight articulated bones with positive lengths. Existing scales and authored
lengths are respected. Managed IK controllers remain enabled but become unpinned
in generated poses so normal pose evaluation reproduces the baked result; target
positions and bend continuity are refreshed for later manual posing.

The planar sampler rejects joined figures, static main bones, other spatial/connector rigs,
re-rooted animation origins and extra pinned controllers. It does not retarget
3D rigs. Explicit legacy figure X/Y/rotation channels must be baked or removed
before generating pose motion. Locked layers and unfinished native working-frame
drafts reject generation before publication. Other figures and artwork are
preserved; apply motion to a character on its own layer in dense scenes.

## Document, history and resource lifetime

Native documents receive a figure pose channel. Layer-sheet documents receive
ordinary layer keys. Generated time extends unlocked tracks that previously
ended at the animation tail, preserving the background and other held artwork.
Source media and figure definitions are not recreated. Existing keys outside the
requested range remain, with boundary poses marking the edit; adding boundaries
can change interpolation in their neighboring spans. `restore` may intentionally
return to a different original position at the range boundary.

Generation publishes one command, including its new pose sources. Undo removes
those sources, redo restores them, and STYK saving/reopening retains the result.
The output remains manually editable and exports through the normal renderer and
file formats without a new runtime motion format.

Browser preparation runs in a disposable worker. Source input includes bone
geometry and the selected pose, omitting embedded artwork and unrelated scenes.
Node uses the same sampler with cooperative yields. Both preparation and staging
check cancellation, selection/document identity and revision before publication;
stale work is discarded. Workers terminate after success, failure, timeout or
abort. No cross-document motion cache or background queue is retained.

Limits bound each operation: 2400 poses, 500,000 selected-bone samples, a 64 MiB
serialized-pose estimate, 100,000 captured layer objects and 1,000,000 layer-bone
samples. These are authoring limits, not a guarantee on total process memory.

## Verification

```sh
node --test tests/human-motion.test.mjs
node tests/human-motion.browser.mjs
node scripts/smoke-human-motion.mjs
```

The browser test uses actual workers with Chromium's GPU disabled, checks
cancellation/disposal and cooperative interaction, and exports a real PNG. It
uses the existing local backend test host. The smoke script exports an 18-second
comparison and gesture demo, plus an editable STYK project and decoded contact
sheet, to `artifacts/human-motion/`. It requires Chromium, FFmpeg and FFprobe.
Reported timings describe the named fixture and machine only.
