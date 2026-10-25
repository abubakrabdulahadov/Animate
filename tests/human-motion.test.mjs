import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {createHumanMotion,humanRig,HUMAN_MOTION_LIMITS} from '../src/human-motion.mjs';
import {prepareHumanMotion} from '../src/human-motion-client.mjs';
import {Editor} from '../src/editor.mjs';
import {defaultFigure,createObject,createFrame,emptyDocument} from '../src/demo.mjs';
import {createStartupDocument} from '../src/startup-document.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {buildContainerV2,decodeDocument} from '../src/native-container.mjs';
import {AgentSession} from '../scripts/agent-session.mjs';
const close=(a,b,tolerance=1e-3)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const fixture=()=>{const e=new Editor({demo:false});e.addFigure();return e;};
const geometry=(figure,pose)=>buildGeometry({version:5,figure_types:[figure]},createFrame([structuredClone(pose)])).objects.get(0);

test('anatomical roles use native topology and sparse handle IDs instead of array slots',()=>{
  const figure=defaultFigure();figure.segments.forEach(s=>{s.segment_id*=11;s.parent_id*=11;});
  const rig=humanRig(figure);assert.deepEqual(rig.leftLeg,[77,88]);assert.equal(rig.head,22);
  const motion=createHumanMotion(figure,createObject(figure,1,200,200),{duration:120});
  assert.ok(motion.sample(60).pose.angles.every(Number.isFinite));
  assert.throws(()=>humanRig(figure,{...rig,leftArm:rig.leftLeg}));
});

test('walk plants stance feet, clears the swing foot and preserves every bone length',()=>{
  for(const distance of [300,-300]){
    const f=defaultFigure(),object=createObject(f,1,200,200),motion=createHumanMotion(f,object,{duration:120,distance,groundY:500});
    let contacts=0,clearance=0;
    for(let tick=8;tick<120;tick++){
      const sample=motion.sample(tick),g=geometry(f,sample.pose);
      for(const side of ['left','right']){
        const foot=g.joints.get(motion.rig[`${side}Leg`][1]),contact=sample.contacts[side];
        if(contact.planted){close(foot.x,contact.point.x);close(foot.y,500);contacts++;}
        else clearance=Math.max(clearance,500-foot.y);
      }
      g.segments.forEach((s,i)=>close(Math.hypot(s.end.x-s.start.x,s.end.y-s.start.y),f.segments[i].length));
    }
    assert.ok(contacts>80);assert.ok(clearance>10);
    close(motion.sample(0).pose.root_x,200);close(motion.sample(119).pose.root_x,200+distance);
    assert.deepEqual(motion.sample(30),motion.sample(30));
    const saved=motion.sample(70);motion.sample(5);assert.deepEqual(motion.sample(70),saved);
  }
});

test('idle, wave and reach retain foot contacts and add distinct upper-body motion',()=>{
  const f=defaultFigure(),object=createObject(f,1,200,200);
  for(const action of ['idle','wave','reach']){
    const motion=createHumanMotion(f,object,{action,duration:120,target:{x:250,y:115}});
    let torsoMin=Infinity,torsoMax=-Infinity,handMin=Infinity,handMax=-Infinity;
    for(let tick=0;tick<120;tick++){
      const s=motion.sample(tick),g=geometry(f,s.pose);
      for(const side of ['left','right']){const foot=g.joints.get(motion.rig[`${side}Leg`][1]);close(foot.x,s.contacts[side].point.x);close(foot.y,s.contacts[side].point.y);}
      torsoMin=Math.min(torsoMin,s.pose.angles[0]);torsoMax=Math.max(torsoMax,s.pose.angles[0]);
      const hand=g.joints.get(motion.rig.rightArm[1]);handMin=Math.min(handMin,hand.y);handMax=Math.max(handMax,hand.y);
    }
    assert.ok(torsoMax-torsoMin>.005);assert.ok(handMax-handMin>(action==='idle'?.1:35));
  }
});

test('unsupported figures and excessive work reject before authoring',()=>{
  const f=defaultFigure(),o=createObject(f,1,200,200);
  assert.throws(()=>createHumanMotion(f,o,{duration:HUMAN_MOTION_LIMITS.frames+1}));
  assert.throws(()=>createHumanMotion(f,o,{duration:2,distance:500}));
  assert.throws(()=>createHumanMotion(f,{...o,scale:0}));
  assert.throws(()=>createHumanMotion(f,o,{action:'reach'}));
  assert.throws(()=>createHumanMotion({...f,_styk:{animationOrigin:{}}},o));
  const spatial=structuredClone(f);spatial.segments[0]._stykRig={spatial:{}};
  assert.throws(()=>createHumanMotion(spatial,o));
});

test('multi-bone spines and scaled pose lengths remain ordinary editable anatomy',()=>{
  const f=defaultFigure();f.segments[0].parent_id=111;
  f.segments.unshift({...f.segments[0],segment_id:111,parent_id:0,length:25});f.segment_count=f.segments.length;
  assert.deepEqual(humanRig(f).spine,[111,1]);
  const object=createObject(f,1,200,200,{scale:1.5,len_flag:1,lengths:f.segments.map(s=>s.length*1.1)});
  const motion=createHumanMotion(f,object,{duration:96,distance:300}),sample=motion.sample(40),g=geometry(f,sample.pose);
  g.segments.forEach((s,i)=>close(s.length,object.lengths[i]*object.scale));
  assert.notEqual(sample.pose.angles[0],sample.pose.angles[1]);
});

test('engine authors native and layer-sheet motions in one reversible command and saves exact poses',async()=>{
  for(const sheet of [false,true]){
    const e=sheet?new Editor({demo:false}).load(createStartupDocument()):fixture();e.select(1);
    const before=e.serialize(),steps=e._undo.length;
    await e.applyHumanMotion({duration:72,distance:220});
    assert.equal(e._undo.length,steps+1);assert.equal(e.totalTicks,72);
    const after=e.serialize();e.seek(35);const p=e.evaluatedFrame.objects[0];
    assert.ok(p.root_x>before.keyframes[0].objects[0].root_x);
    e.undo();assert.deepEqual(e.serialize(),before);e.redo();assert.deepEqual(e.serialize(),after);
    const decoded=await decodeDocument(await buildContainerV2(after,'styk'),'styk'),reopened=new Editor({demo:false}).load(decoded.document);
    reopened.seek(35);close(reopened.evaluatedFrame.objects[0].root_x,p.root_x);
    assert.deepEqual(reopened.evaluatedFrame.objects[0].angles,p.angles);
  }
});

test('other figures and source artwork are preserved while motion remains manually editable',async()=>{
  const e=fixture();e.addFigure();e.select(1);const definition=structuredClone(e.figure),other=structuredClone(e.frame.objects[1]);
  await e.applyHumanMotion({duration:48,distance:160});
  for(const tick of [0,12,47]){e.seek(tick);const {object_slot,...actual}=e.evaluatedFrame.objects.find(o=>o.unique_id===2),{object_slot:oldSlot,...expected}=other;assert.deepEqual(actual,expected);}
  assert.deepEqual(e.report.figure_types[0],definition);
  e.select(1,3);e.poseJoint(530,230);assert.doesNotThrow(()=>e.serialize());
});

test('locks, cancellation and stale document changes never publish prepared motion',async()=>{
  const e=fixture(),layer=e.layerForUid(1);e.setLayerLocked(layer,true);const locked=e.serialize();
  await assert.rejects(e.applyHumanMotion({duration:48}),/Unlock/);assert.deepEqual(e.serialize(),locked);
  e.setLayerLocked(layer,false);const before=e.serialize(),identity=e._nextFrameIdentity;
  const controller=new AbortController(),pending=e.applyHumanMotion({duration:1200,distance:500},{signal:controller.signal});controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(e.serialize(),before);assert.equal(e._nextFrameIdentity,identity);
  const stale=e.applyHumanMotion({duration:1200,distance:500});e.setFPS(30);
  await assert.rejects(stale,{name:'AbortError'});assert.equal(e.report._styk.animation,undefined);assert.equal(e.report.fps,30);
  const draft=fixture();draft.enableFrameDrafts();draft.moveSelection(10,0);const working=draft.serialize();
  await assert.rejects(draft.applyHumanMotion({duration:48}),/working frame/);assert.deepEqual(draft.serialize(),working);
});

test('motions append at a native or sheet tail and agent cancellation reaches the engine',async()=>{
  for(const sheet of [false,true]){
    const e=sheet?new Editor({demo:false}).load(createStartupDocument()):fixture();e.select(1);
    await e.applyHumanMotion({duration:36,distance:100});e.seek(35);const x=e.evaluatedFrame.objects[0].root_x;
    await e.applyHumanMotion({action:'wave',start:36,duration:24});assert.equal(e.totalTicks,60);
    e.seek(36);close(e.evaluatedFrame.objects[0].root_x,x);
  }
  const session=new AgentSession();await session.invoke('editor_addFigure');const before=session.engine.snapshot();
  const controller=new AbortController(),pending=session.invoke('editor_applyHumanMotion',{args:[{duration:1200,distance:500}]},controller.signal);controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(session.engine.snapshot(),before);
});

test('dense unrelated layer poses are bounded before a command is published',async()=>{
  const e=new Editor({demo:false}).load(createStartupDocument()),large=defaultFigure(2),bone=large.segments[0];
  large.segments=Array.from({length:1000},(_,i)=>({...bone,segment_id:i+1,parent_id:0,length:1}));large.segment_count=large.segments.length;
  e.importFigure(large);e.select(1);const before=e.serialize();
  await assert.rejects(e.applyHumanMotion({duration:1200,distance:500}),/own layer/);
  assert.deepEqual(e.serialize(),before);
});

test('the isolated worker uses the same sampler and is disposed after completion and cancellation',async()=>{
  const original=globalThis.Worker,terminated=[];let spawned=0;
  class WebWorker {
    constructor(url){spawned++;this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:data=>parentPort.postMessage(data)};import(${JSON.stringify(String(url))}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
      this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.({message:error.message,preventDefault(){}}));}
    postMessage(data){this.worker.postMessage(data);}
    terminate(){terminated.push(this.worker.terminate());}
  }
  globalThis.Worker=WebWorker;
  try{
    const f=defaultFigure(),o=createObject(f,1,200,200),input={figure:f,object:o,options:{duration:48,distance:150},fps:24};
    const result=await prepareHumanMotion(input);assert.equal(result.poses.length,48);
    assert.deepEqual(result.poses[20],createHumanMotion(f,o,input.options,24).sample(20).pose);
    const controller=new AbortController(),pending=prepareHumanMotion(input,{signal:controller.signal});controller.abort();
    await assert.rejects(pending,{name:'AbortError'});assert.equal(spawned,2);assert.equal(terminated.length,2);
  }finally{globalThis.Worker=original;await Promise.allSettled(terminated);}
});
