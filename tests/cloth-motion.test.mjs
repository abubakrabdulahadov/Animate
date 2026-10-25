import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendCloth,clothMeshes,createClothDeformer,CLOTH_LIMITS} from '../src/cloth-motion.mjs';
import {createHumanMotion} from '../src/human-motion.mjs';
import {Editor} from '../src/editor.mjs';
import {defaultFigure,createObject,createFrame} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {createStartupDocument} from '../src/startup-document.mjs';
import {buildContainerV2,decodeDocument} from '../src/native-container.mjs';
import {AgentSession} from '../scripts/agent-session.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-3,`${a} != ${b}`);
const geom=(f,o)=>buildGeometry({version:5,figure_types:[f]},createFrame([structuredClone(o)])).objects.get(0);
const fixture=sheet=>{const e=sheet?new Editor({demo:false}).load(createStartupDocument()):new Editor({demo:false});if(!sheet)e.addFigure();e.select(1);return e;};

test('cloth presets create dense editable native grids with stable IDs and triangle fills',()=>{
  for(const preset of ['scarf','cape','skirt']){
    const f=defaultFigure();f.segments.forEach(s=>{s.segment_id*=13;s.parent_id*=13;});const before=structuredClone(f);
    const {figure,mesh}=appendCloth(f,{preset,anchorId:13});assert.deepEqual(f,before);
    assert.ok(mesh.vertices>=80);assert.equal(figure.polyfills.length,mesh.rows*mesh.columns*2);
    assert.deepEqual(figure.segments.slice(0,10),before.segments);assert.equal(new Set(figure.segments.map(s=>s.segment_id)).size,figure.segments.length);
    const valid=new Set(figure.segments.map(s=>s.segment_id));assert.ok(figure.polyfills.every(p=>p.segment_ids.every(id=>valid.has(id))));
    assert.equal(clothMeshes(figure)[0].nodes.filter(n=>n.row===0).length,mesh.columns+1);
  }
  const coarse=appendCloth(defaultFigure(),{spacing:15}),fine=appendCloth(defaultFigure(),{spacing:3});assert.ok(fine.mesh.vertices>coarse.mesh.vertices);
});

test('cloth attachment stays pinned while the free end bends with finite, deterministic independent samples',()=>{
  const {figure,mesh}=appendCloth(defaultFigure(),{anchorId:1,rows:24,columns:5}),source=createObject(figure,1,300,350,{scale:1.4}),before=structuredClone(source);
  const cloth=createClothDeformer(figure,{wind:{x:-30,y:2},flutter:8}),a=cloth.apply(source,1.2),original=geom(figure,source),g=geom(figure,a);
  for(const n of cloth.meshes[0].nodes){const p=g.joints.get(n.id),q=original.joints.get(n.id);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));if(n.row===0){close(p.x,q.x);close(p.y,q.y);}}
  const tail=cloth.meshes[0].nodes.find(n=>n.row===mesh.rows);assert.ok(Math.hypot(g.joints.get(tail.id).x-original.joints.get(tail.id).x,g.joints.get(tail.id).y-original.joints.get(tail.id).y)>10);
  assert.deepEqual(cloth.apply(source,0),source);
  cloth.apply(source,9);assert.deepEqual(cloth.apply(source,1.2),a);assert.deepEqual(source,before);
  for(let i=0;i<10;i++){close(a.angles[i],source.angles[i]);close(a.lengths[i],figure.segments[i].length);}
});

test('human walking automatically deforms attached cloth and can explicitly disable it',()=>{
  const {figure}=appendCloth(defaultFigure(),{anchorId:1}),o=createObject(figure,1,300,350);
  const natural=createHumanMotion(figure,o,{duration:120,distance:200}),rigid=createHumanMotion(figure,o,{duration:120,distance:200,cloth:false});
  const a=natural.sample(60).pose,b=rigid.sample(60).pose;
  assert.deepEqual(a.angles.slice(0,10),b.angles.slice(0,10));assert.ok(a.angles.slice(10).some((v,i)=>Math.abs(v-b.angles[10+i])>.01));
  assert.equal(a.len_flag,1);
});

test('invalid density, missing anchors and altered cloth topology reject without editing',()=>{
  const f=defaultFigure();for(const options of [{rows:129,columns:12},{rows:4.5},{anchorId:999},{preset:'silk'},{color:'red'},{offset:{x:NaN,y:0}},{spacing:0}])assert.throws(()=>appendCloth(f,options));
  const {figure}=appendCloth(f);figure.segments.pop();assert.throws(()=>clothMeshes(figure),/topology/);
  const good=appendCloth(f).figure;assert.throws(()=>createClothDeformer(good,{wind:{x:Infinity,y:0}}));
  assert.throws(()=>createClothDeformer(good,{wind:{x:0,y:0},unknown:true}));
  assert.ok(CLOTH_LIMITS.vertices<30000);
});

test('adding cloth preserves poses in all frames and is exactly undoable and persistent',async()=>{
  for(const sheet of [false,true]){
    const e=fixture(sheet);e.moveSelection(17,0);const before=e.serialize(),oldAngles=e.object.angles.slice(),mesh=e.addCloth({preset:'cape',anchorId:1,rows:12});
    assert.deepEqual(e.object.angles.slice(0,10),oldAngles);assert.equal(e.getClothMeshes()[0].vertices,mesh.vertices);
    const after=e.serialize(),saved=await decodeDocument(await buildContainerV2(after,'styk'),'styk');assert.equal(clothMeshes(saved.document.figure_types[0])[0].nodes.length,mesh.vertices);
    assert.deepEqual(saved.document.figure_types[0].polyfills[0]._stykCloth,{id:mesh.id});
    e.undo();assert.deepEqual(e.serialize(),before);e.redo();assert.deepEqual(e.serialize(),after);
  }
});

test('cloth baking preserves existing walking and noncloth pose channels, with one undo on both timelines',async()=>{
  for(const sheet of [false,true]){
    const e=fixture(sheet);e.addCloth({anchorId:1,rows:10,columns:3});await e.applyHumanMotion({duration:60,distance:130,cloth:false});
    const samples=[];for(const tick of [0,20,40,59]){e.seek(tick);samples.push(structuredClone(e.evaluatedFrame.objects[0]));}
    const before=e.serialize();await e.applyClothMotion({start:0,duration:60,cloth:{wind:{x:-25,y:0}}});
    for(const [i,tick]of [0,20,40,59].entries()){e.seek(tick);const o=e.evaluatedFrame.objects[0];close(o.root_x,samples[i].root_x);close(o.root_y,samples[i].root_y);o.angles.slice(0,10).forEach((a,j)=>close(a,samples[i].angles[j]));}
    const after=e.serialize();e.undo();assert.deepEqual(e.serialize(),before);e.redo();assert.deepEqual(e.serialize(),after);
  }
});

test('cloth tools handle locked layers, cancellation and stale edits without partial publication',async()=>{
  const session=new AgentSession();await session.invoke('editor_addFigure');await session.invoke('editor_addCloth',{args:[{anchorId:1}]});
  assert.equal((await session.invoke('editor_getClothMeshes')).value.length,1);
  const e=session.engine.editor,before=e.serialize(),controller=new AbortController();
  const pending=session.invoke('editor_applyClothMotion',{args:[{duration:1000}]},controller.signal);controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(e.serialize(),before);
  const stale=e.applyClothMotion({duration:1000});e.setFPS(30);await assert.rejects(stale,{name:'AbortError'});
  e.setLayerLocked(e.layerForUid(1),true);const locked=e.serialize();assert.throws(()=>e.addCloth(),/Unlock/);await assert.rejects(e.applyClothMotion({duration:10}),/Unlock/);assert.deepEqual(e.serialize(),locked);
});

test('cloth baking accepts ordinary nonhumanoid props and refuses figures with no mesh',async()=>{
  const e=fixture(false),f=structuredClone(e.figure);f.segments=f.segments.slice(0,1);f.segment_count=1;e.replaceFigureDefinition(f.figure_type_id,f);
  const before=e.serialize();await assert.rejects(e.applyClothMotion({duration:24}),/Add a cloth/);assert.deepEqual(e.serialize(),before);
  e.addCloth({anchorId:1,rows:8});await e.applyClothMotion({duration:24});assert.equal(e.totalTicks,24);
});

test('carry chooses the lower elbow, keeps wrists above it and preserves grip and limb lengths',()=>{
  for(const hand of ['left','right','both'])for(const distance of [0,200,-200]){
    const f=defaultFigure(),motion=createHumanMotion(f,createObject(f,1,300,350),{action:'carry',hand,duration:120,distance});
    for(const tick of [20,50,90,119]){
      const sample=motion.sample(tick),g=geom(f,sample.pose),shoulder=g.joints.get(1);
      for(const side of ['left','right'])if(hand===side||hand==='both'){
        const [upper,lower]=motion.rig[`${side}Arm`],elbow=g.joints.get(upper),wrist=g.joints.get(lower);
        assert.ok(elbow.y>shoulder.y+5);assert.ok(elbow.y>wrist.y+5,`${side} elbow must hang below wrist`);close(sample.grips[side].x,wrist.x);close(sample.grips[side].y,wrist.y);
      }
      g.segments.forEach((s,i)=>close(Math.hypot(s.end.x-s.start.x,s.end.y-s.start.y),f.segments[i].length));
    }
  }
});

test('walking can retain one carrying arm while the other swings freely',()=>{
  const f=defaultFigure(),o=createObject(f,1,300,350),m=createHumanMotion(f,o,{duration:120,distance:200,carry:{hand:'left'}});
  const a=m.sample(35),b=m.sample(65);assert.deepEqual(Object.keys(a.grips),['left']);assert.notEqual(a.pose.angles[4],b.pose.angles[4]);
  assert.throws(()=>createHumanMotion(f,o,{carry:{hand:'up'}}));assert.throws(()=>createHumanMotion(f,o,{action:'wave',carry:{hand:'left'}}));
});
