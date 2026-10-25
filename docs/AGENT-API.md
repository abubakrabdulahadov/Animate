# Agent API

Agents can edit animations through the native editor engine without opening or
controlling the application UI. The DOM-free JavaScript API runs in Node; the
batch CLI accepts JSON and returns machine-readable JSON. It uses the existing
document model, command history, pose solver and native container codec.

## Run a job

Use Node 24.11 or newer, from the repository root:

```sh
node scripts/agent.mjs examples/agent-walk.json
node scripts/agent.mjs --help
```

The example writes `examples/agent-walk.styk`, which the application can open and
edit. Copy the example to your own working directory before using it as a template.
Paths resolve relative to the JSON job file, including `input` and `output`.
The output directory must exist. An omitted input starts an empty scene with a
reusable Walker figure definition; `addFigure` inserts its first instance.

```json
{
  "version": 1,
  "input": "agent-walk.styk",
  "commands": [{"op": "inspect"}],
  "output": "agent-walk.webm"
}
```

Success prints one JSON object with `ok:true`, the document dimensions, FPS,
frame/tick counts, figure and joint IDs, current objects and the output path.
Errors print `{ok:false,error:...}` to stderr and exit with status 1. Command
errors identify the zero-based command index. Commands run sequentially and stop
at the first failure; an unsuccessful job publishes no output. Saving and video
export replace the destination only after a complete temporary file is flushed.
SIGINT/SIGTERM cancel the job and preserve any previous output.

Jobs have a 16 MiB input limit and at most 10,000 commands; native project inputs
have the existing 256 MiB compressed-file limit. Editing and snapshotting still
require the decoded document in memory. This is a local trusted automation API,
not a server for executing untrusted jobs.

## Commands

Every command has an `op`; the table lists its other fields. Unknown operations
and fields are rejected. Coordinates are scene pixels, angles are radians,
frame indexes and ticks are zero-based. Use returned native IDs rather than
assuming array positions or newly allocated IDs.

| Operation | Fields | Result |
| --- | --- | --- |
| `inspect` | None | Read the current scene summary. |
| `project` | Optional `width`, `height`, `fps` | Change project dimensions or frame rate. |
| `addFigure` | Optional `figureId` | Insert an instance of an existing definition at the scene center. |
| `importFigure` | `document` | Import a decoded native figure document through the existing import command. |
| `draw` | `segments`, optional `uid` | Add lines/circles to an instance, or create a new figure when `uid` is omitted. |
| `selectFrame` | `index` | Select an existing native keyframe for editing. |
| `seek` | `tick` | Inspect an evaluated animation tick. |
| `duplicateFrame` | None | Duplicate the current keyframe and select its copy. |
| `deleteFrame` | None | Delete the current keyframe. |
| `duration` | `ticks` | Set current key duration, or total duration for a layer-sheet document. |
| `move` | `uid`, `dx`, `dy` | Move a figure through the editor's translation command. |
| `rotate` | `uid`, `radians` | Rotate a figure. |
| `scale` | `uid`, positive `factor` | Scale a figure. |
| `pose` | `uid`, `jointId`, `x`, `y` | Pose a native joint with the existing constraints and IK solver. |
| `style` | `uid`, `jointId`, `values` | Change `color_rgb`, `thickness` or `transparency` through the segment command. |
| `deleteFigure` | `uid` | Delete an instance. |
| `camera` | `values` | Set any of `x`, `y`, `scale`, `angle_rad`. |
| `background` | `argb` | Set a background color as an unsigned ARGB integer. |
| `undo`, `redo` | None | Use the existing bounded command history. |

Each `draw.segments` item accepts `parentId`, `type`, `length`, `angle`,
`thickness`, `start:{x,y}`. Supported types are `line`, `circle`, `circleFill`,
`circleClear`, `squareLine`; defaults match the editor's builder command.
`style.values.color_rgb` contains three bytes; `transparency` is 0–255.

The API preserves native timing: Pivot's final key lasts one tick. To hold a
pose for six ticks, set `duration:6` before duplicating that key. The example has
13 ticks (6 + 6 + 1). It creates discrete poses; it does not generate a walk cycle
or invent in-between poses. Agents can supply successive poses for every frame.
Layer-sheet and authored-channel documents retain their existing editor timing
and command semantics. Prefer `selectFrame` for native frame edits; `seek` is
for evaluated tick inspection.

## JavaScript

```js
import {AgentEngine} from './src/agent-engine.mjs';

const engine = new AgentEngine();
const {objects} = engine.execute({op: 'addFigure'});
engine.execute({op: 'move', uid: objects[0].uid, dx: 50, dy: 0});
const editableDocument = engine.snapshot();
```

`inspect()` returns a summary; `snapshot()` returns a detached validated native
document for saving. `engine.editor` exposes the existing `Editor` for advanced
JavaScript integrations. `runJob` in `scripts/agent.mjs` also accepts an optional
`{directory, signal}` for Node callers.

## Video export

MP4 and WebM use the same worker frame exporter and WebCodecs encoders as the app,
in a blank headless Chromium page. No editor UI, Electron window, Python service,
UI selectors, or external processing is involved. Frames are produced sequentially;
encoded output streams to the temporary file in bounded chunks. Native editing
and saving need no browser or npm packages.

Install the locked dependencies and the browser once:

```sh
npm ci
npx playwright install chromium
```

Alternatively, set `STYK_BROWSER_PATH` to an installed Chromium/Chrome executable.
Choose `.mp4` or `.webm` as the job output. Optional `video:{"start":0,"end":12}`
selects a tick range with an exclusive end; the default exports the entire
animation at its native FPS and canvas size. Codec availability depends on the
browser/OS, and failures are reported rather than silently switching formats.

This initial API exports **silent video**. It does not export project audio,
decode `.piv`/Stick Nodes files, provide an MCP/HTTP service, or interpret natural
language. Import existing `.styk` projects or provide decoded native documents
through JavaScript. Media must be embedded or available among local repository
assets; network media and backend-only source URLs are unsupported.

Verification:

```sh
node --test tests/agent-engine.test.mjs
node scripts/smoke-agent.mjs
```

The smoke test also requires `ffprobe` and `ffmpeg`. It encodes both containers,
checks decoded dimensions/FPS/frame count, checks visible motion, and writes
videos, decoded first-frame images and a report under `artifacts/agent-smoke/`.
