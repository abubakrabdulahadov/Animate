import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {Readable,Writable} from 'node:stream';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AgentEngine} from '../src/agent-engine.mjs';
import {AgentSession,serveAgent,agentLines} from '../scripts/agent-session.mjs';
import {pcmWave} from '../src/audio-pcm.mjs';
import {runJob} from '../scripts/agent.mjs';
import {buildContainerV2} from '../src/native-container.mjs';
import {createStartupDocument} from '../src/startup-document.mjs';

const fixture=()=>{const e=new AgentEngine();e.execute({op:'addFigure'});return e;};

test('tool catalogue exposes native authoring domains and schemas, excluding runtime infrastructure',()=>{
  const e=fixture(),tools=e.tools();
  assert.equal(new Set(tools.map(t=>t.name)).size,tools.length);
  for(const t of tools){assert.equal(typeof e.editor[t.method],'function');assert.equal(t.inputSchema.additionalProperties,false);}
  for(const category of ['shapes','rig','spatial','layers','animation','camera','movieclips','effects','audio'])assert.ok(tools.some(t=>t.category===category));
  assert.ok(e.tools({method:'addPolygon'})[0].description.includes('handleIds'));
  assert.ok(e.tools({method:'setMovieclipPlayback'})[0].signature.includes('allFrames'));
  for(const method of ['constructor','_record','load','transaction','detachDocument','setLayerMigrationPlanner','beginDrag'])assert.throws(()=>e.call({method}));
  assert.throws(()=>e.tools({category:'typo'}));
  tools[0].inputSchema.properties.args.maxItems=9999;
  assert.equal(e.tools()[0].inputSchema.properties.args.maxItems,16);
});

test('native polygon and topology tools preserve editable fills, IDs and undo',()=>{
  const e=fixture();
  const polygon=e.call({method:'addPolygon',args:[[0,1,3],{color:'#ff7700',opacity:.6}],selection:{uid:1}}).value;
  assert.equal(polygon.polyfill_id,1);
  assert.equal(e.query({view:'geometry',uid:1}).polygons.items[0].points.length,3);
  const before=e.snapshot();
  e.call({method:'moveBuilderSegment',args:[4,{parentId:5}],selection:{uid:1}});
  e.call({method:'updateSegmentStyle',args:[{color:'#0099ff'}],selection:{uid:1,jointId:4}});
  const figure=e.query({view:'figure'});
  assert.equal(figure.segments.find(s=>s.segment_id===4).parent_id,5);
  e.call({method:'undo'});e.call({method:'undo'});
  assert.deepEqual(e.snapshot(),before);
  e.call({method:'updatePolygon',args:[0,{color:'#00ff00'}],selection:{uid:1,polygonId:1}});
  assert.deepEqual(e.query({view:'figure'}).polyfills[0].color_rgb,[0,255,0]);
});

test('selection preflight rejects missing handles at another tick without changing the playhead or document',()=>{
  const e=fixture();e.execute({op:'duration',ticks:6});e.execute({op:'duplicateFrame'});e.execute({op:'addFigure'});e.execute({op:'selectFrame',index:0});
  const before=e.inspect();
  assert.throws(()=>e.call({method:'poseJoint',args:[100,100],at:{tick:6},selection:{uid:2,jointId:999}}));
  assert.deepEqual(e.inspect(),before);
  e.call({method:'moveSelection',args:[25,0],at:{tick:6},selection:{uid:2}});
  assert.equal(e.inspect().tick,6);assert.equal(e.query({view:'objects',uid:2}).items[0].root_x,505);
  assert.throws(()=>e.call({method:'moveSelection',args:[0,0],selection:{uids:null}}));
});

test('layers, folders and animated properties are editable through the same tool interface',()=>{
  const e=fixture(),layer=e.call({method:'createLayer',args:['Props']}).value;
  e.call({method:'assignFiguresToLayer',args:[[1],layer.id]});
  const folder=e.call({method:'createLayerFolder',args:['Scene props',[layer.id]]}).value;
  assert.ok(folder);
  assert.equal(e.editor.layerForUid(1),layer.id);
  e.call({method:'addAnimationKeys',args:[[
    {target:{kind:'figure',uid:1},property:'opacity',tick:0,value:1,interpolation:'linear'},
    {target:{kind:'figure',uid:1},property:'opacity',tick:10,value:0},
  ]]});
  e.call({method:'seek',args:[5]});
  assert.ok(Math.abs(e.query({view:'objects',uid:1}).items[0].field28-128)<=1);
  const channel=e.query({view:'animation'}).items[0];
  assert.equal(e.query({view:'keys',channelId:channel.id,offset:1,limit:1}).items[0].tick,10);
  assert.ok(e.query({view:'capabilities'}).animationProperties.polygon.includes('color'));
  assert.ok(e.query({view:'effects',limit:100}).items.some(t=>t.type==='glow'));
});

test('native return values and paginated queries cannot mutate the live document',()=>{
  const e=fixture(),definition=e.query({view:'figure'});definition.segments[0].length=999;
  assert.equal(e.query({view:'figure'}).segments[0].length,78);
  const added=e.call({method:'addFigure'}).value;added.root_x=999;
  assert.equal(e.query({view:'objects',uid:added.unique_id}).items[0].root_x,480);
  assert.equal(e.query({view:'geometry',uid:1,offset:2,limit:2}).joints.items.length,2);
  assert.throws(()=>e.query({view:'geometry',limit:1001}));
  const before=e.snapshot();
  for(const [method,patch]of [['updateSegment',{segment_id:99}],['updateSegment',{thickness:-1}],
    ['updateObject',{angles:[]}],['updateObject',{scale:NaN}]])assert.throws(()=>e.call({method,args:[patch],selection:{uid:1,jointId:1}}));
  assert.deepEqual(e.snapshot(),before);
});

test('asynchronous native planning is awaited and retains undo semantics',async()=>{
  const e=fixture();e.execute({op:'duration',ticks:6});e.execute({op:'duplicateFrame'});e.execute({op:'move',uid:1,dx:60,dy:0});
  const before=e.snapshot();
  assert.throws(()=>e.call({method:'insertInbetweenFramesAsync',args:[.5,[0]]}),/callAsync/);
  const pending=e.callAsync({method:'insertInbetweenFramesAsync',args:[.5,[0]]});
  assert.throws(()=>e.execute({op:'undo'}),/running/);
  await pending;assert.equal(e.inspect().frames,3);
  e.execute({op:'undo'});assert.deepEqual(e.snapshot(),before);
});

test('saving during nested movieclip editing preserves the root project and pending child artwork',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'styk-tools-clip-'));
  try{
    const session=new AgentSession({directory,engine:new AgentEngine({name:'Root animation'})}),e=session.engine;
    const clip=e.call({method:'createEmptyMovieclip',args:['Wing']}).value;
    e.call({method:'addFigure',args:[clip.figure_type_id]});
    assert.equal(e.call({method:'enterMovieclip',args:[clip.figure_type_id]}).value,null);
    e.call({method:'addSegment',args:[{length:37,angle:.3}]});
    assert.equal(e.inspect().scope.length,1);
    await session.invoke('project_save',{path:'nested.styk'});
    assert.equal(e.inspect().scope.length,1,'Saving must retain the current scope.');
    await session.invoke('project_open',{path:'nested.styk'});
    assert.equal(session.engine.inspect().name,'Root animation');
    const root=session.engine.snapshot(),saved=root.figure_types.find(f=>f.figure_type_id===clip.figure_type_id);
    assert.equal(root.keyframes[0].objects[0].figure_type_id,clip.figure_type_id);
    assert.equal(saved._styk.movieclip.document.figure_types[0].segments[0].length,37);
    assert.equal(session.engine.inspect().scope.length,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('layer locks are honored by native agent edits',()=>{
  const e=new AgentEngine({document:createStartupDocument()}),uid=e.inspect().objects[0].uid,layer=e.editor.layerForUid(uid);
  e.call({method:'setLayerLocked',args:[layer,true]});
  const before=e.snapshot();
  try{e.call({method:'moveSelection',args:[100,0],selection:{uid}});}catch(error){assert.match(error.message,/lock/i);}
  assert.deepEqual(e.snapshot(),before);
});

test('a focus-locked context cannot redirect a command to a previously selected figure',()=>{
  const e=fixture(),first=e.editor.layerForUid(1),second=e.call({method:'createLayer',args:['Other']}).value;
  e.call({method:'addFigure'});
  e.call({method:'setLayerFocus',args:[[first],{lock:true}]});
  e.call({method:'select',args:[1]});
  const before=e.snapshot();
  assert.throws(()=>e.call({method:'moveSelection',args:[100,0],selection:{uid:2}}),/focus/);
  assert.deepEqual(e.snapshot(),before);
  assert.equal(e.editor.layerForUid(2),second.id);
});

test('text, PNG and WAV imports remain editable, embedded and reopen through project tools',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'styk-tools-media-'));
  try{
    const session=new AgentSession({directory});
    const text=await session.invoke('asset_text',{options:{text:'Salom, osmon!',fontSize:28,bold:true},position:{x:200,y:100}});
    assert.ok(text.value.unique_id);
    assert.ok(session.engine.query({view:'figure',figureId:text.value.figure_type_id}).text_assets.length);
    await writeFile(path.join(directory,'pixel.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
    await session.invoke('asset_image',{path:'pixel.png'});
    const channel=Float32Array.from({length:4800},(_,i)=>Math.sin(i*.1)*.1);
    await writeFile(path.join(directory,'tone.wav'),new Uint8Array(await pcmWave([channel]).arrayBuffer()));
    await session.invoke('asset_audio',{path:'tone.wav'});
    assert.equal(session.engine.query({view:'audio'}).assets.length,1);
    await session.invoke('project_save',{path:'media.styk'});
    const before=session.engine.snapshot();
    await session.invoke('project_new',{name:'Other'});await session.invoke('project_open',{path:'media.styk'});
    assert.deepEqual(session.engine.snapshot(),before);
    const saved=session.engine.snapshot();
    await writeFile(path.join(directory,'walker.stkz'),await buildContainerV2(fixture().snapshot(),'stkz'));
    await session.invoke('asset_figure',{path:'walker.stkz',position:{x:100,y:150}});
    assert.equal(session.engine.inspect().objects.length,saved.keyframes[0].objects.length+1);
    await session.invoke('editor_undo');assert.deepEqual(session.engine.snapshot(),saved);
    await assert.rejects(session.invoke('project_open',{path:'missing.styk'}));
    assert.deepEqual(session.engine.snapshot(),saved);
    await assert.rejects(session.invoke('asset_audio',{path:'pixel.png'}));
    assert.deepEqual(session.engine.snapshot(),saved);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('stdio preserves state, correlates responses, and continues after malformed requests',async()=>{
  let text='';const output=new Writable({write(chunk,_encoding,done){text+=chunk;done();}});
  const requests=['bad json',JSON.stringify({id:'create',tool:'editor_addFigure',arguments:{}}),
    JSON.stringify({id:2,tool:'editor_addPolygon',arguments:{args:[[0,1,3],{color:'#dd6600'}],selection:{uid:1}}}),
    JSON.stringify({id:3,tool:'engine_query',arguments:{view:'geometry',uid:1}}),
    JSON.stringify({id:4,tool:'editor_constructor',arguments:{}}),JSON.stringify({id:5,tool:'engine_inspect'})].join('\n');
  await serveAgent({input:Readable.from([requests]),output});
  const responses=text.trim().split('\n').map(JSON.parse);
  assert.equal(responses.length,6);assert.equal(responses[0].ok,false);
  assert.equal(responses[1].id,'create');assert.equal(responses[3].result.polygons.total,1);
  assert.equal(responses[4].ok,false);assert.equal(responses[5].result.objects.length,1);
});

test('stream framing preserves split UTF-8 and rejects oversized lines before execution',async()=>{
  const bytes=Buffer.from('yorug‘lik\nkeyingi'),lines=[];
  for await(const line of agentLines(Readable.from([bytes.subarray(0,6),bytes.subarray(6,8),bytes.subarray(8)])))lines.push(line);
  assert.deepEqual(lines,['yorug‘lik','keyingi']);
  await assert.rejects(async()=>{for await(const _line of agentLines(Readable.from(['12345']),4)){}},/size limit/);
});

test('persistent CLI handles sequential calls and exits on EOF or idle cancellation',async()=>{
  const run=async(cancel=false)=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/agent.mjs',import.meta.url)),'--stdio']);
    let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('stdio CLI did not exit.'));},5000);
    child.on('error',reject);child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    if(cancel)child.stdout.once('data',()=>child.kill('SIGINT'));
    child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
    child.stdin.write(JSON.stringify({id:1,tool:'editor_addFigure'})+'\n');
    if(!cancel)child.stdin.end(JSON.stringify({id:2,tool:'engine_inspect'})+'\n');
  });
  const complete=await run();assert.equal(complete.code,0);assert.equal(complete.stderr,'');
  const responses=complete.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(responses.length,2);assert.equal(responses[1].result.objects.length,1);
  const cancelled=await run(true);assert.equal(cancelled.code,0);assert.equal(cancelled.stderr,'');
});

test('batch jobs expose the final tool result and stdio CLI emits only JSON',async()=>{
  const result=await runJob({version:1,commands:[{op:'addFigure'},{op:'call',method:'addPolygon',args:[[0,1,3]]}]});
  assert.equal(result.result.value.polyfill_id,1);
  const directory=await mkdtemp(path.join(tmpdir(),'styk-tools-cli-'));
  try{
    const filename=path.join(directory,'query.json');await writeFile(filename,JSON.stringify({version:1,commands:[{op:'query',view:'capabilities'}]}));
    const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/agent.mjs',import.meta.url)),filename]);
    assert.equal(JSON.parse(stdout).result.version,2);
    assert.ok((await readFile(filename)).length);
  }finally{await rm(directory,{recursive:true,force:true});}
});
