import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {AgentEngine} from '../src/agent-engine.mjs';
import {runJob, atomicOutput} from '../scripts/agent.mjs';

test('agent poses native figures, preserves identities across frames and supports undo', () => {
  const engine = new AgentEngine();
  const uid = engine.execute({op: 'addFigure'}).objects[0].uid;
  const original = engine.snapshot();
  engine.execute({op: 'duration', ticks: 6});
  engine.execute({op: 'duplicateFrame'});
  engine.execute({op: 'move', uid, dx: 100, dy: -20});
  assert.equal(engine.inspect().objects[0].x, original.keyframes[0].objects[0].root_x + 100);
  assert.equal(engine.snapshot().keyframes[0].objects[0].root_x, original.keyframes[0].objects[0].root_x);
  engine.execute({op: 'undo'});
  assert.equal(engine.inspect().objects[0].x, original.keyframes[0].objects[0].root_x);
  engine.execute({op: 'redo'});
  engine.execute({op: 'pose', uid, jointId: 4, x: 600, y: 250});
  assert.notDeepEqual(engine.snapshot().keyframes[1].objects[0].angles, original.keyframes[0].objects[0].angles);
  assert.equal(engine.inspect().objects[0].uid, uid);
  assert.equal(engine.inspect().totalTicks, 7); // Pivot's final key lasts one tick.
});

test('agent rejects unknown commands, fields and missing targets before edits', () => {
  const engine = new AgentEngine(), revision = engine.inspect().revision;
  for (const command of [{op:'load'}, {op:'project', typo:1}, {op:'move',uid:999,dx:1,dy:0},
    {op:'selectFrame',index:99}, {op:'seek',tick:-1}, {op:'move',uid:1,dx:NaN,dy:0}])
    assert.throws(() => engine.execute(command));
  assert.equal(engine.inspect().revision, revision);
});

test('draw creates editable geometry through the native builder', () => {
  const engine = new AgentEngine();
  const state = engine.execute({op:'draw',segments:[{type:'line',length:60,angle:0,start:{x:100,y:100}}]});
  assert.equal(state.objects.length, 1);
  const figure = engine.snapshot().figure_types.find(f => f.figure_type_id === state.objects[0].figureId);
  assert.equal(figure.segments[0].length, 60);
  engine.execute({op:'undo'});
  assert.equal(engine.inspect().objects.length, 0);
});

test('style edits remain undoable and reject invalid widths without altering artwork', () => {
  const engine = new AgentEngine();
  const uid = engine.execute({op:'addFigure'}).objects[0].uid;
  const before = engine.snapshot().figure_types[0].segments[0].color_rgb;
  engine.execute({op:'style',uid,jointId:1,values:{color_rgb:[255,0,0],thickness:20}});
  assert.deepEqual(engine.snapshot().figure_types[0].segments[0].color_rgb,[255,0,0]);
  const revision = engine.inspect().revision;
  assert.throws(() => engine.execute({op:'style',uid,jointId:1,values:{thickness:-1}}));
  assert.equal(engine.inspect().revision, revision);
  engine.execute({op:'undo'});
  assert.deepEqual(engine.snapshot().figure_types[0].segments[0].color_rgb,before);
});

test('jobs save native containers, reopen editable projects and preserve existing output on failure', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'styk-agent-'));
  try {
    const result = await runJob({version:1,name:'Agent roundtrip',commands:[{op:'addFigure'},
      {op:'duration',ticks:6},{op:'duplicateFrame'},{op:'move',uid:1,dx:50,dy:0}],output:'scene.styk'}, {directory});
    const reopened = await runJob({version:1,input:'scene.styk',commands:[]}, {directory});
    assert.equal(reopened.name, 'Agent roundtrip');
    assert.equal(reopened.totalTicks, result.totalTicks);
    assert.equal(reopened.frames, 2);
    const renamed = await runJob({version:1,input:'scene.styk',name:'Renamed',commands:[]}, {directory});
    assert.equal(renamed.name, 'Renamed');
    const previous = await readFile(path.join(directory, 'scene.styk'));
    await assert.rejects(runJob({version:1,commands:[{op:'unknown'}],output:'scene.styk'}, {directory}));
    assert.deepEqual(await readFile(path.join(directory, 'scene.styk')), previous);
    await writeFile(path.join(directory, 'video.webm'), 'previous');
    await assert.rejects(atomicOutput(path.join(directory, 'video.webm'), async sink => {
      await sink.write(new Uint8Array([1,2])); throw new Error('encoder failed');
    }));
    assert.equal(await readFile(path.join(directory, 'video.webm'), 'utf8'), 'previous');
    assert.deepEqual((await readdir(directory)).sort(), ['scene.styk', 'video.webm']);
  } finally { await rm(directory, {recursive:true,force:true}); }
});

test('CLI reads job-relative paths and emits one machine-readable result', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'styk agent cli '));
  try {
    const filename = path.join(directory, 'job.json');
    await writeFile(filename, JSON.stringify({version:1,commands:[{op:'addFigure'}],output:'scene.styk'}));
    const {stdout,stderr} = await promisify(execFile)(process.execPath,
      [fileURLToPath(new URL('../scripts/agent.mjs', import.meta.url)), filename]);
    assert.equal(stderr, '');
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.equal(result.output, path.join(directory, 'scene.styk'));
    assert.equal(result.objects.length, 1);
    assert.ok((await readFile(result.output)).length > 0);
  } finally { await rm(directory, {recursive:true,force:true}); }
});

test('cancellation removes a partial output and preserves the previous file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'styk-agent-cancel-'));
  try {
    const destination = path.join(directory, 'scene.styk'), controller = new AbortController();
    await writeFile(destination, 'previous');
    await assert.rejects(atomicOutput(destination, async sink => {
      await sink.write(new Uint8Array([1,2,3])); controller.abort();
    }, controller.signal), {name:'AbortError'});
    assert.equal(await readFile(destination, 'utf8'), 'previous');
    assert.deepEqual(await readdir(directory), ['scene.styk']);
    await assert.rejects(runJob({version:1,commands:[]}, {signal:controller.signal}), {name:'AbortError'});
  } finally { await rm(directory, {recursive:true,force:true}); }
});
