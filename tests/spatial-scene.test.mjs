import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '../src/editor.mjs';
import {createSpatialScene,createSpatialSceneMotion} from '../src/spatial-scene.mjs';
import {createObject,createFrame,emptyDocument} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {validateScene} from '../src/pivot/model.mjs';
import {buildContainerV2,decodeDocument} from '../src/native-container.mjs';
import {createStartupDocument} from '../src/startup-document.mjs';
import {AgentSession} from '../scripts/agent-session.mjs';
import {spatialPoint,spatialQuaternion,quatRotate,quatMultiply} from '../src/rig-spatial.mjs';
import {inverseQuaternion} from '../src/ik-spatial.mjs';
const close=(a,b,t=.005)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const options={actors:[{name:'Aziz',position:[-70,0,0]},{name:'Nila',position:[70,0,-120],palette:{shirt:'#b67867'}}],boxes:[{name:'Floor',position:[0,131,0],size:[600,20,600],color:[100,130,140]},{name:'Pillar',position:[0,20,80],size:[20,200,25]}]};
const motion={duration:48,actors:[{action:'walk',distance:100,view:{yaw:1.2},viewTo:{yaw:2.1}},{action:'turn',viewTo:{yaw:-1.4}}],camera:{position:[0,-80,700],target:[0,-10,0]},cameraTo:{position:[350,-180,550],target:[0,-10,0],roll:.06}};

test('shared native scene mesh contains separate editable actor bones and solid scenery',()=>{
 const f=createSpatialScene(options),o=createObject(f,1,400,300),m=createSpatialSceneMotion(f,o,motion,24),s=m.sample(25),report={...emptyDocument(),figure_types:[f],keyframes:[createFrame([s.pose])]};validateScene(report);
 const g=buildGeometry(report,report.keyframes[0]).objects.get(0),mesh=g.spatialMesh;
 assert.equal(mesh.vertexCount,6514*2+16);assert.equal(mesh.plan.triangles,10244*2+24);assert.ok(mesh.count>5000);assert.ok(mesh.zMax>mesh.zMin);
 const groups=f._styk.spatialMesh.groups;assert.deepEqual(groups.map(g=>g.name),['Aziz','Nila','Floor','Pillar']);assert.ok(f.segments.length<150);
 const before=structuredClone(s);m.sample(0);assert.deepEqual(m.sample(25),before);
});

test('one camera transforms every actor with the same world-space perspective',()=>{
 const f=createSpatialScene(options),o=createObject(f,1,400,300),m=createSpatialSceneMotion(f,o,motion,24),s=m.sample(25),g=buildGeometry({version:5,figure_types:[f]},createFrame([s.pose])).objects.get(0);
 const c=s.camera,d=c.target.map((v,i)=>v-c.position[i]),yaw=Math.atan2(-d[0],-d[2]),pitch=Math.atan2(d[1],Math.hypot(d[0],d[2])),q=inverseQuaternion(quatMultiply(spatialQuaternion(0,yaw,pitch),spatialQuaternion(c.roll,0,0)));
 for(const [i,a]of f._styk.spatialScene.actors.entries()){
  const root=a.figure.segments.find(b=>b._stykCharacterRole==='model'),id=new Map(a.ids).get(root.segment_id),b=g.segments[f.segments.findIndex(b=>b.segment_id===id)],actual=spatialPoint(b.spatialFrame,[0,0,0]);
  const local=s.actors[i],world=[local.pose.root_x,local.pose.root_y,local.worldRoot[2]].map((v,k)=>v+a.position[k]-c.position[k]),v=quatRotate(q,world),den=-v[2]/c.focalLength;
  close(s.pose.root_x+actual[0]/(1-actual[2]/c.focalLength),400+v[0]/den);close(s.pose.root_y+actual[1]/(1-actual[2]/c.focalLength),300+v[1]/den);
 }
});

test('shared scene motion is one reversible publication on both timelines and survives native reopening',async()=>{
 for(const sheet of [false,true]){
  const e=sheet?new Editor({demo:false}).load(createStartupDocument()):new Editor({demo:false}),{uid}=e.addSpatialScene(options);e.select(uid);const before=e.serialize(),undos=e._undo.length;
  await e.applySpatialSceneMotion(motion);assert.equal(e._undo.length,undos+1);assert.equal(e.totalTicks,48);const after=e.serialize();e.undo();assert.deepEqual(e.serialize(),before);e.redo();assert.deepEqual(e.serialize(),after);
  const loaded=new Editor({demo:false}).load((await decodeDocument(await buildContainerV2(after,'styk'),'styk')).document);loaded.select(uid);loaded.seek(25);e.seek(25);assert.deepEqual(loaded.object.angles,e.object.angles);assert.equal(loaded.figure._styk.spatialScene.actors.length,2);
 }
});

test('scene cancellation, stale edits, bad cameras and work limits preserve the document',async()=>{
 const e=new Editor({demo:false}),{uid}=e.addSpatialScene(options);e.select(uid);const before=e.serialize(),controller=new AbortController(),pending=e.applySpatialSceneMotion({...motion,duration:500},{signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(e.serialize(),before);
 const stale=e.applySpatialSceneMotion({...motion,duration:500});e.setFPS(30);await assert.rejects(stale,{name:'AbortError'});
 const after=e.serialize();await assert.rejects(e.applySpatialSceneMotion({...motion,camera:{position:[0,0,0],target:[0,0,0]}}));assert.deepEqual(e.serialize(),after);
 await assert.rejects(e.applySpatialSceneMotion({...motion,duration:2401}));
 assert.throws(()=>createSpatialScene({actors:[]}));assert.throws(()=>createSpatialScene({...options,boxes:[{size:[1,-1,1]}]}));
});

test('agent tools create and animate a shared 3D scene without the UI',async()=>{
 const s=new AgentSession(),made=await s.invoke('editor_addSpatialScene',{args:[options]});assert.ok(made.value.uid);
 const result=await s.invoke('editor_applySpatialSceneMotion',{args:[motion],selection:{uid:made.value.uid}});assert.equal(result.value.frames,48);
 const p=await s.invoke('editor_previewSpatialSceneMotion',{args:[motion,20]});assert.equal(p.value.actors.length,2);assert.ok(p.value.camera.position[0]>0);
});

test('later scene ranges retain the current camera and actor world positions',async()=>{
 const e=new Editor({demo:false});e.addSpatialScene(options);await e.applySpatialSceneMotion(motion);e.seek(47);
 const scene=e.figure._styk.spatialScene,index=new Map(e.figure.segments.map((s,i)=>[s.segment_id,i])),before=structuredClone(e.object);
 const preview=e.previewSpatialSceneMotion({start:47,duration:36,actors:[{action:'idle'},{action:'idle'}]},0);
 for(const a of scene.actors)for(const k of [0,2])close(preview.pose.lengths[index.get(a.translation[k])],before.lengths[index.get(a.translation[k])]);
 const camera=scene.camera.camera,b=e.figure.segments[index.get(camera)],q=p=>spatialQuaternion(p.angles[index.get(camera)]-b.angle_rad,p.angles[index.get(b._stykRig.spatial.turn)],p.angles[index.get(b._stykRig.spatial.pitch)]);
 const a=q(before),z=q(preview.pose);close(Math.abs(a.reduce((v,n,i)=>v+n*z[i],0)),1,.00001);
});

test('front-to-back orbital camera keeps its radius and a linear crossing rejects atomically',async()=>{
 const e=new Editor({demo:false});e.addSpatialScene({actors:[{}]});
 const options={duration:36,camera:{position:[0,0,700],target:[0,0,0]},cameraTo:{position:[0,0,-700],target:[0,0,0]}};
 const middle=e.previewSpatialSceneMotion(options,17.5);close(Math.hypot(...middle.camera.position),700);assert.ok(middle.camera.position[0]>699);
 const before=e.serialize();await assert.rejects(e.applySpatialSceneMotion({...options,cameraPath:'linear'}),/approaches|camera/);assert.deepEqual(e.serialize(),before);
});
