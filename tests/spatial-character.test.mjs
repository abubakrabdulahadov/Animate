import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCartoonCharacter} from '../src/filled-art.mjs';
import {createHumanMotion,humanRig} from '../src/human-motion.mjs';
import {characterViewPose,characterView,characterBones} from '../src/spatial-character.mjs';
import {createObject,createFrame,emptyDocument} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {validateScene} from '../src/pivot/model.mjs';
import {buildContainerV2,decodeDocument} from '../src/native-container.mjs';
import {Editor} from '../src/editor.mjs';
import {createStartupDocument} from '../src/startup-document.mjs';
import {AgentSession} from '../scripts/agent-session.mjs';
import {remapRigReferences} from '../src/rig-constraints.mjs';
import {remapSpatialMesh} from '../src/spatial-mesh.mjs';
import {spatialPoint,quatRotate,quatMultiply,spatialQuaternion} from '../src/rig-spatial.mjs';
const close=(a,b,t=.003)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const geometry=(figure,object)=>buildGeometry({version:5,figure_types:[figure]},createFrame([{...object,object_slot:0}])).objects.get(0);

test('planar shoes cover the trouser end and plant their soles rather than ankle joints',()=>{
 const {figure}=createCartoonCharacter(),object=createObject(figure,1,300,300);
 for(const scale of [.8,1.6])for(const distance of [180,-180]){
  const m=createHumanMotion(figure,{...object,scale},{duration:96,distance,groundY:520});
  for(const tick of [20,40,60,80]){const s=m.sample(tick),g=geometry(figure,s.pose);
   for(const [side,z]of [['left',9],['right',3]])if(s.contacts[side].planted){const shoe=g.polys.find(p=>p.z===z);close(Math.max(...shoe.points.map(p=>p.y)),520);close(s.contacts[side].point.y,520);close(s.contacts[side].ankle.y,520-15*scale);}
  }
 }
});

test('spatial cartoon uses a compact existing native mesh rig with physical feet and facial depth',()=>{
 const {figure,rig}=createCartoonCharacter({dimension:'3d'}),object=createObject(figure,1,300,300),mesh=figure._styk.spatialMesh;
 validateScene({...emptyDocument(),figure_types:[figure],keyframes:[createFrame([object])]});
 assert.ok(figure.segments.length<60);assert.ok(mesh.positions.length/3>5000);assert.ok(mesh.indices.length/3<15000);assert.deepEqual(humanRig(figure),rig);
 assert.ok(mesh.groups.some(g=>g.name==='Back seam'));assert.ok(mesh.groups.some(g=>g.name==='Front pocket'));assert.ok(mesh.basis.includes(figure.segments[0].segment_id));
 assert.ok(geometry(figure,object).spatialMesh.triangles.length>0);
});

test('new characters own their rest frames and toe controls lie at the shoe tip',()=>{
 const a=createCartoonCharacter({dimension:'3d'}),b=createCartoonCharacter({dimension:'3d'}),first=characterBones(a.figure),second=characterBones(b.figure);
 first.get('spine0').segment._stykRig.spatial.origin[0]=55;assert.equal(second.get('spine0').segment._stykRig.spatial.origin[0],0);
 const object=createObject(b.figure,1,300,300),g=geometry(b.figure,object);
 for(const [side,x]of [['left',15],['right',-15]]){const foot=second.get(`${side}Foot`),frame=g.segments[foot.index].spatialFrame,p=spatialPoint(frame,[x,111,37]),toe=g.joints.get(foot.segment.segment_id);close(toe.x,300+p[0]);close(toe.y,300+p[1]);}
});

test('body/head yaw are independent and native projected shoe vertices stay on the physical floor',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),o=createObject(figure,1,300,300);
 for(const distance of [200,-200])for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
  const motion=createHumanMotion(figure,o,{action:'walk',duration:96,distance,groundY:520,view:{yaw,headYaw:.35,perspective:0}});
  for(const tick of [20,40,60,80]){const s=motion.sample(tick),g=geometry(figure,s.pose),positions=g.spatialMesh.positions;
   for(const side of ['left','right'])if(s.contacts[side].planted)close(s.contacts[side].point.y,520);
   let bottom=-Infinity;for(let i=1;i<positions.length;i+=2)bottom=Math.max(bottom,positions[i]);close(bottom,520);
   close(characterView(figure,s.pose).headYaw,.35);assert.ok(s.pose.angles.every(Number.isFinite));
  }
 }
});

test('camera orbit composes in camera coordinates rather than leaning along the character heading',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),o=createObject(figure,1,300,300),roles=characterBones(figure);
 const yaw=1.1,orbitYaw=.35,orbitPitch=.3,m=createHumanMotion(figure,o,{action:'idle',duration:60,view:{yaw,orbitYaw,orbitPitch,perspective:0}}),sample=m.sample(30),g=geometry(figure,sample.pose);
 const frame=g.segments[roles.get('model').index].spatialFrame,actual=spatialPoint(frame,[0,-100,0]);
 const expected=quatRotate(quatMultiply(spatialQuaternion(0,0,-orbitPitch),spatialQuaternion(0,yaw-orbitYaw,0)),[0,-100,0]);
 actual.forEach((n,i)=>close(n,expected[i]));close(actual[0],0);
});

test('source poses and random access remain immutable during orbital carrying',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),o=createObject(figure,1,300,300),before=structuredClone(o),m=createHumanMotion(figure,o,{action:'carry',hand:'both',distance:150,duration:72,view:{orbitYaw:-.5,perspective:.5},viewTo:{orbitYaw:2.5,orbitPitch:.25,headYaw:.4}});
 const a=m.sample(48);m.sample(2);assert.deepEqual(m.sample(48),a);assert.deepEqual(o,before);assert.equal(Object.keys(a.grips).length,2);
 const g=geometry(figure,a.pose);for(const [side,p]of Object.entries(a.grips)){const actual=g.joints.get(m.rig[`${side}Arm`][1]);close(p.x,actual.x);close(p.y,actual.y);}
});

test('spatial reach retains scene-space target semantics after turning and perspective',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),o=createObject(figure,1,300,300);
 for(const yaw of [0,.8,Math.PI/2,Math.PI]){
  const facing=characterViewPose(figure,o,{yaw,perspective:.5}),g=geometry(figure,facing),rig=humanRig(figure),wrist=g.joints.get(rig.rightArm[1]),target={x:wrist.x+12,y:wrist.y-24};
  const m=createHumanMotion(figure,facing,{action:'reach',hand:'right',duration:60,target,view:{yaw,perspective:.5}}),s=m.sample(35),actual=geometry(figure,s.pose).joints.get(rig.rightArm[1]);
  close(actual.x,target.x,.05);close(actual.y,target.y,.05);assert.ok(s.targets.rightArm.error<.05);
 }
});

test('view edits and generated spatial motion are undoable and survive both native timelines',async()=>{
 for(const sheet of [false,true]){const e=sheet?new Editor({demo:false}).load(createStartupDocument()):new Editor({demo:false});const {uid}=e.addCartoonCharacter({dimension:'3d'});e.select(uid);const before=e.serialize();
  e.setCharacterView({yaw:Math.PI,headYaw:Math.PI,perspective:.5,distance:700});close(e.getCharacterView().yaw,Math.PI);const view=e.serialize();e.undo();assert.deepEqual(e.serialize(),before);e.redo();assert.deepEqual(e.serialize(),view);
  await e.applyHumanMotion({action:'carry',hand:'both',duration:36,distance:70,view:{yaw:Math.PI/2},viewTo:{orbitYaw:1.2}});const baked=e.serialize();e.undo();assert.deepEqual(e.serialize(),view);e.redo();assert.deepEqual(e.serialize(),baked);
  const decoded=await decodeDocument(await buildContainerV2(baked,'styk'),'styk'),loaded=new Editor({demo:false}).load(decoded.document);loaded.select(uid);assert.equal(loaded.totalTicks,36);assert.equal(loaded.figure._styk.spatialCartoon,1);
 }
});

test('anatomy follows remapped native IDs, not bone array positions',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),map=new Map(figure.segments.map(s=>[s.segment_id,s.segment_id*7]));
 figure._styk.spatialMesh=remapSpatialMesh(figure._styk.spatialMesh,map);
 for(const s of figure.segments){remapRigReferences(s,map);s.segment_id=map.get(s.segment_id);s.parent_id=map.get(s.parent_id)??0;}
 const m=createHumanMotion(figure,createObject(figure,1,300,300),{action:'carry',duration:48});assert.ok(m.sample(20).pose.angles.every(Number.isFinite));
});

test('manual view controls retain anatomical signs through whole-figure reflection',()=>{
 const e=new Editor({demo:false}),{uid}=e.addCartoonCharacter({dimension:'3d'});e.setCharacterView({yaw:.6,pitch:-.2,roll:.1,headYaw:-.3,headPitch:.15});
 const before=e.getCharacterView();e.select(uid,-1);e.mirrorFigure();const reflected=e.getCharacterView();
 for(const key of ['yaw','pitch','roll','headYaw','headPitch'])close(reflected[key],before[key]);e.setCharacterView({yaw:.8});close(e.getCharacterView().yaw,.8);
});

test('invalid views, unsupported planar cloth, stale edits and cancelled worker work never partially publish',async()=>{
 const session=new AgentSession();const added=await session.invoke('editor_addCartoonCharacter',{args:[{dimension:'3d'}]});const e=session.engine.editor,before=e.serialize();
 await assert.rejects(session.invoke('editor_setCharacterView',{args:[{yaw:NaN}]}));assert.deepEqual(e.serialize(),before);
 for(const options of [{view:{unknown:1}},{viewTo:{orbitPitch:Math.PI}},{cloth:{flutter:4}}])await assert.rejects(e.applyHumanMotion({duration:48,...options}));assert.deepEqual(e.serialize(),before);
 const controller=new AbortController(),pending=session.invoke('editor_applyHumanMotion',{args:[{duration:1200,distance:500}]},controller.signal);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(e.serialize(),before);
 const stale=e.applyHumanMotion({duration:1200,distance:500});e.setFPS(30);await assert.rejects(stale,{name:'AbortError'});assert.equal(e.report.fps,30);assert.equal(e.selectedUid,added.value.uid);
});
