# Agent API

Agents can build arbitrary jointed figures, polygons, sprites and outlined text,
pose rigs, edit layers, animate properties, apply effects and work with sound
without opening the editor UI. The API calls the existing native `Editor`; it
shares its validation, document semantics and bounded undo history.

There are three entry points:

```sh
node scripts/agent.mjs --stdio            # persistent tool session over JSONL
node scripts/agent.mjs --tools shapes     # discover tools and argument schemas
node scripts/agent.mjs examples/agent-shapes.json  # batch job
```

Use Node 24.11 or newer. Editing, project saving, media compilation and tool
queries run in Node. PNG/SVG previews and video exports also require the locked
npm dependencies and a Chromium runtime:

```sh
npm ci
npx playwright install chromium
```

Alternatively set `STYK_BROWSER_PATH` to an installed Chrome/Chromium executable.
This source-only interface runs locally. File paths are trusted local paths;
there is no shell evaluation or remote processing of projects.

## Persistent tools

Start `--stdio` once and send one JSON object per line. Each request runs in the
same project, preserving selection, playhead, native IDs, history and clipboards.
The tool catalogue contains names, categories, descriptions, native signatures,
asynchronous flags and JSON input schemas. Discover a category at a time to keep
an agent's context small.

```jsonl
{"id":1,"tool":"tools_list","arguments":{"category":"shapes"}}
{"id":2,"tool":"editor_addFigure","arguments":{}}
{"id":3,"tool":"editor_addPolygon","arguments":{"args":[[0,1,3],{"color":"#ffbb55"}],"selection":{"uid":1}}}
{"id":4,"tool":"engine_query","arguments":{"view":"geometry","uid":1}}
{"id":5,"tool":"project_preview","arguments":{"path":"preview.png","tick":0}}
{"id":6,"tool":"project_save","arguments":{"path":"scene.styk"}}
```

Each response is one JSON line, with the same `id`:

```json
{"id":3,"ok":true,"result":{"value":{"polyfill_id":1},"state":{"revision":3}}}
```

The example abbreviates the native value and state. Errors return
`{id,ok:false,error,revision}`; malformed JSON returns an error and the next
request can continue. EOF ends the session after its active command finishes.
SIGINT/SIGTERM cancel file/export work and close the runtime.

Native commands take `args` in the same positional order as the editor method.
Omit optional trailing arguments. A successful call returns a detached `value`
and a state summary containing the selected UID, joint ID and active layer ID.
Use returned identities in later calls; never assume the editor's next ID.
The `args` array is limited to sixteen positional arguments.

Native method signatures in the catalogue document their real option fields.
The owning `src/editor-*.mjs` modules and linked feature contracts describe the
full semantics. Common signatures are written explicitly for methods wrapped
by the editor's frame-draft dispatcher.

### Context and units

Every `editor_*` tool accepts optional context:

```json
{
  "args": [300, 180, {"stretch": true, "snap": false}],
  "selection": {"uid": 7, "jointId": 24},
  "at": {"tick": 36}
}
```

`selection` accepts `uid`, `uids`, `jointId`, `polygonId`, and `layerId`.
`jointId` and `polygonId` are stable native IDs; the adapter resolves their array
indexes after topology changes. A joint or polygon needs one figure. `uid:null`
clears the selection, useful before drawing a new figure. `at` accepts either a
stored `frame` index or an evaluated `tick`. Context is checked before selection
or playhead changes. Lock handling follows each native command: layer-sheet
edits enforce locks, while low-level native-frame setters retain their existing
programmatic behavior. The summary's `documentTimeline` identifies the model.

Coordinates are scene pixels, angles are radians, frame indexes and ticks are
zero-based, and audio times are seconds. Colors follow the native method:
`addPolygon` accepts hex/RGB; `setSceneColor` uses unsigned ARGB; figure raw
colors use native COLORREF. Use the typed style commands when possible.

### Authoring domains

| Category | Available work |
| --- | --- |
| `figures`, `ranges` | Insert/import, duplicate, group transforms, alignment, attachments, multi-frame edits and definition replacement. |
| `shapes` | Lines/circles, polygon fills, segment styles, outlines, gradients, ordering, splitting, duplication and reparenting. |
| `rig`, `spatial` | Joint posing, IK, connectors, weighted joints, Smart Stretch and existing 3D pose controls. |
| `selection` | Single/group, joint, branch and polygon selection. |
| `frames`, `sheet` | Native frames, exposure sheets, timing, easing, clipboards and synchronous/asynchronous in-between planning. |
| `layers` | Layers, folders, assignments, ordering, visibility, locking and focus. |
| `animation` | Native/property tracks, key insertion, sampling, easing, moving, scaling, duplication and deletion. |
| `camera`, `scene` | Camera keys and motions, follow settings, background colors, images and gradients. |
| `colors`, `effects` | Palettes, recoloring, effect stacks, presets, effect clips and animated parameters. |
| `movieclips` | Create, enter/leave, edit playback, split, make unique, expand and bake nested animation. |
| `audio` | Tracks, clips, timing, trims, fades, gains, mute/solo, splitting, duplication and clipboards. |
| `history` | Existing undo and redo. |

The explicit catalogue exposes JSON-callable authoring commands. Callback
transactions, pointer gestures, private methods, document-session internals,
worker installation and raster brush resource ownership remain JavaScript APIs.
Use `project_new`/`project_open` for document replacement and `asset_image` for
portable raster artwork. Low-level inspector patches cannot change native IDs,
parent relationships or pose-array topology; use the structural commands.
Each native command retains its own history semantics. A sequence of tool calls
is not a single transaction, and completed edits remain after a later error.

### Read tools

`engine_inspect` reads the current summary. `engine_query` supports:

- `objects`: evaluated native poses, optionally filtered by `uid`.
- `figures`: definition IDs and counts; `figure` reads one complete definition by
  `figureId`, including its native segments, fills and embedded media.
- `geometry`: evaluated world-space joints, segment endpoints and polygon points
  for a `uid` or the selected figure.
- `layers`, `timeline`, `animation`: layer descriptors, frame timing and channel
  summaries. `keys` reads keys from a `channelId`.
- `audio`, `scene`: track/clip state, asset summaries, backgrounds and camera.
- `effects`, `cameraMotions`: native effect parameters and camera motion vocabulary.
- `capabilities`: tool categories, animation property vocabulary and units.
- `document`: explicit full detached snapshot, also available as `engine_snapshot`.

List views accept `offset` and `limit` (1–1000, default 100). A geometry query
paginates joints, segments and polygons independently with the same offset/limit.
Audio summaries omit recording bytes. Full document/definition reads are explicit
operations; ordinary edits do not serialize the document. `engine_validate`
checks a detached native snapshot without writing a file.

### Files and media

| Tool | Arguments |
| --- | --- |
| `project_new` | Optional `name`, `document`; replaces the current session. |
| `project_open` | `path` to a native project. |
| `project_save` | `path` ending in `.styk`. |
| `project_preview` | PNG/SVG `path`, optional `tick`, `width`, `height`. |
| `project_export` | MP4/WebM/PNG/SVG `path`, optional `options`. |
| `asset_figure` | Native `.styk`, `.stkz` or `.stykmov` `path`, optional `position:{x,y}`. |
| `asset_image` | PNG `path`, optional `name`, `position`; or `uid` and `parentId` for sprite attachment. |
| `asset_text` | `options:{text,fontSize?,bold?,italic?,color?,opacity?,...}`, optional `fontPath`, `position`. |
| `asset_audio` | PCM WAV `path`, optional `trackId`, `start` in seconds. |

Text uses the existing portable vector compiler and bundled OFL Noto Sans fonts;
a custom local TTF/OTF can be supplied. Its outlines remain embedded and editable
without installed fonts. PNGs and WAV recordings are embedded through the existing
media/document contracts. Import errors preserve the current project. Other
recording/image formats can be converted locally before import, or supplied in a
native project through its existing codecs. PIV/STK/Stick Nodes decoding still
belongs to the local codec service; the Node adapter does not launch that service.

Export options are `start`, exclusive `end`, `width`, `height`, `smoothing`
(`edges`, `none`, `sprites`), and `audio` (default true). PNG/SVG use `tick` instead
of a range. Image tick defaults to the current playhead; video defaults to the
whole animation at its native FPS and canvas dimensions. Native project saving
retains the original document dimensions and all embedded audio/media.

Headless exports load a blank local Chromium runtime, then reuse the existing
frame worker, audio mixer and encoders. Muted/solo tracks, gains, clip offsets and
fades follow the shared audio model. Codec availability depends on the browser;
unsupported encoders report a failure. Compressed audio already in a project uses
the browser decoder's existing size/duration limits; PCM WAV needs no external
service. No external URLs are fetched by the headless page.

Output streams to a sibling temporary file and replaces the destination only
after a complete flush. Failed or cancelled exports preserve the previous file.
The destination directory must exist. Stdio paths resolve against the process's
working directory; batch paths resolve against the job file's directory.

## Batch jobs and JavaScript

Version-1 JSON jobs and the original short commands remain supported. Advanced
commands are `tools`, `query`, `snapshot`, `validate`, and `call`:

```json
{
  "version": 1,
  "commands": [
    {"op":"addFigure"},
    {"op":"call","method":"addPolygon","args":[[0,1,3],{"color":"#ffbb55"}]},
    {"op":"query","view":"geometry","uid":1}
  ],
  "output": "scene.styk"
}
```

Advanced calls are awaited, including asynchronous baking and in-between work.
The final advanced command's result is returned in the job's `result` field.
Batch export settings go in the existing `video` field, including `tick` for
PNG/SVG output; for example `"video":{"width":1280,"height":720,"audio":true}`.
Use a persistent session when the next command depends on an allocated identity.
Copy [agent-shapes.json](../examples/agent-shapes.json) to a working directory for
a polygon example with animated native poses and in-between generation.

The short command surface remains: `inspect`, `project`, `addFigure`,
`importFigure`, `draw`, `selectFrame`, `seek`, `duplicateFrame`, `deleteFrame`,
`duration`, `move`, `rotate`, `scale`, `pose`, `style`, `deleteFigure`, `camera`,
`background`, `undo`, `redo`. Field definitions follow the existing version-1
examples and `AgentEngine.execute` dispatcher. In particular, `pose` uses a native
`jointId`, `move` uses `uid,dx,dy`, and `style` accepts
`values:{color_rgb?,thickness?,transparency?}`.

Native Pivot timing is preserved: the final key lasts one tick. Set a key's
`duration` before duplicating it to hold that pose. The original `agent-walk.json`
has 13 ticks (6 + 6 + 1). Layer-sheet documents retain their exposure semantics.
Use property/pose keys or native in-between planning when smooth motion is needed.

```js
import {AgentEngine} from './src/agent-engine.mjs';
import {AgentSession} from './scripts/agent-session.mjs';

const engine = new AgentEngine();
engine.execute({op: 'addFigure'});
const polygon = engine.call({method:'addPolygon', args:[[0,1,3], {color:'#ffbb55'}]});
await engine.callAsync({method:'insertInbetweenFramesAsync', args:[0.5, [0]]});
const world = engine.query({view:'geometry', uid:1});

const session = new AgentSession({engine, directory:process.cwd()});
await session.invoke('project_save', {path:'scene.styk'});
```

`project_save` includes pending nested movieclip edits in the root project and
keeps the active editing scope open. Image/video previews use the active scope.
`snapshot()` reads that active scope; `projectSnapshot()` reads the validated
root project. Methods that return the Editor itself return `value:null` over
the tool interface, with their resulting state in `state`.

`engine.editor` retains direct JavaScript access to the native Editor for
runtime-owned integrations. Calls within one session are sequential; concurrent
session/native asynchronous calls are rejected. Stdio applies input backpressure,
accepts at most 16 MiB per request/response and has no unbounded parsed-command
queue. Use paginated queries or native saving for large results. Batch files have
a 16 MiB input limit and at most 10,000 commands; native inputs retain their
256 MiB compressed-file bound. Decoded documents still need to fit in memory.
The protocol is JSONL; an agent host can use the returned tool schemas as its
function definitions. It does not interpret natural language or run an MCP server.

## Verification

```sh
node --test tests/agent-engine.test.mjs tests/agent-tools.test.mjs
node scripts/smoke-agent.mjs
node scripts/smoke-agent-tools.mjs
```

The smoke scripts need Chromium, `ffmpeg` and `ffprobe`. The advanced smoke creates
native polygon artwork, outlined text, a PNG sprite and an embedded WAV, saves and
reopens the project, exports PNG/SVG previews and both video containers, decodes
the soundtrack to check audibility, and verifies a resized silent subrange.
Artifacts are written under `artifacts/agent-tools-smoke/`.
