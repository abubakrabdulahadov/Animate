import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHumanMotion} from '../src/human-motion.mjs';
import {createCartoonCharacter} from '../src/filled-art.mjs';
import {defaultFigure,createObject,createFrame} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {spatialPoint,quatRotate,quatMultiply,spatialQuaternion} from '../src/rig-spatial.mjs';
import {inverseQuaternion} from '../src/ik-spatial.mjs';
import {characterBones} from '../src/spatial-character.mjs';
import {Editor} from '../src/editor.mjs';
import {createStartupDocument} from '../src/startup-document.mjs';
import {buildContainerV2,decodeDocument} from '../src/native-container.mjs';
import {AgentSession} from '../scripts/agent-session.mjs';
const close=(a,b,t=1e-4)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,a.reduce((sum,n,i)=>sum+n*b[i],0)/(Math.hypot(...a)*Math.hypot(...b)))));
const geometry=(f,p)=>buildGeometry({version:5,figure_types:[{...f,_styk:{...f._styk,spatialMesh:undefined}}]},createFrame([p])).objects.get(0);
const figures=()=>[defaultFigure(),createCartoonCharacter().figure,createCartoonCharacter({dimension:'3d'}).figure];
function boneVectors(f,g,chain){return chain.map(id=>{const bone=g.segments.find(s=>s.seg.segment_id===id);if(bone.spatialFrame){const a=spatialPoint(bone.spatialFrame,bone.seg._stykRig.spatial.origin),b=spatialPoint(bone.spatialFrame,bone.seg._stykRig.spatial.tip);return b.map((v,i)=>v-a[i]);}return[bone.end.x-bone.start.x,bone.end.y-bone.start.y,0];});}

test('unloaded standing starts upright with near-straight knees instead of retaining a crouched source',()=>{
 for(const f of figures())for(const scale of [.75,1.4]){
  const m=createHumanMotion(f,createObject(f,1,300,300,{scale}),{action:'idle',duration:120,groundY:550});let feet;
  for(const tick of [0,12,40,70,119]){const s=m.sample(tick),g=geometry(f,s.pose);
   for(const side of ['left','right']){assert.ok(s.contacts[side].planted);assert.ok(angle(...boneVectors(f,g,m.rig[`${side}Leg`]))<.145,'Idle knees should flex less than about eight degrees');}
   if(!f._styk?.spatialCartoon){for(const id of m.rig.spine){const a=s.pose.angles[f.segments.findIndex(b=>b.segment_id===id)];assert.ok(Math.abs(a+Math.PI/2)<.012);}const now=Object.values(s.contacts).map(c=>c.point);if(feet)for(let i=0;i<2;i++){close(now[i].x,feet[i].x);close(now[i].y,feet[i].y);}feet=now;}
   else for(const side of ['left','right'])close(s.contacts[side].point.y,550);
  }
 }
});

test('ordinary walking stays upright with low foot clearance, shallow support knees and exact travel',()=>{
 for(const f of figures())for(const distance of [200,-200]){
  const m=createHumanMotion(f,createObject(f,1,300,300),{duration:120,distance,groundY:550});
  for(let tick=12;tick<120;tick++){const s=m.sample(tick),g=geometry(f,s.pose);assert.equal(s.airborne,false);
   for(const side of ['left','right']){const flex=angle(...boneVectors(f,g,m.rig[`${side}Leg`]));assert.ok(flex<.79,'Walking should not use a running/crouching knee fold');if(s.contacts[side].planted)assert.ok(flex<.64);}
   if(!f._styk?.spatialCartoon)for(const id of m.rig.spine)assert.ok(Math.abs(s.pose.angles[f.segments.findIndex(b=>b.segment_id===id)]+Math.PI/2)<.025);
   else{const r=characterBones(f).get('spine0'),up=quatRotate(g.segments[r.index].spatialFrame.q,[0,-1,0]);assert.ok(Math.acos(Math.max(-1,Math.min(1,-up[1])))<.025);}
  }
  const end=m.sample(119);close(f._styk?.spatialCartoon?end.worldRoot[0]:end.pose.root_x-300,distance,.001);
 }
});

test('running has genuine flight, arm pumping, preserved bone lengths and grounded support in 2D and 3D',()=>{
 for(const f of figures())for(const distance of [450,-450]){
  const m=createHumanMotion(f,createObject(f,1,300,300),{action:'run',duration:120,distance,groundY:550});let flights=0,plants=0,bentArms=0;
  for(let tick=12;tick<120;tick++){const s=m.sample(tick),g=geometry(f,s.pose);if(s.airborne){flights++;assert.ok(!s.contacts.left.planted&&!s.contacts.right.planted);for(const side of ['left','right'])assert.ok(s.contacts[side].point.y<549.999);}
   for(const side of ['left','right']){for(const role of ['Leg','Arm']){const ids=m.rig[side+role],vectors=boneVectors(f,g,ids);vectors.forEach((v,i)=>close(Math.hypot(...v),f.segments.find(b=>b.segment_id===ids[i]).length));if(role==='Arm'&&angle(...vectors)>1)bentArms++;}if(s.contacts[side].planted){plants++;close(s.contacts[side].point.y,550,.005);}}
  }
  assert.ok(flights>2);assert.ok(plants>20);assert.ok(bentArms>40);const a=m.sample(40);m.sample(3);assert.deepEqual(m.sample(40),a);
  for(const side of ['left','right'])assert.ok(m.sample(119).contacts[side].planted);
 }
});

test('running options reject invalid work and support straight arms explicitly',()=>{
 const f=defaultFigure(),o=createObject(f,1,0,0);for(const options of[{distance:0},{duration:2,distance:500},{stepLength:10000},{armBend:2}])assert.throws(()=>createHumanMotion(f,o,{action:'run',...options}));
 const run=createHumanMotion(f,o,{action:'run'}),walk=createHumanMotion(f,o);assert.ok(run.settings.distance>walk.settings.distance*2);assert.ok(run.settings.armBend>1);const straight=createHumanMotion(f,o,{action:'run',armBend:0}).sample(20);for(const role of ['leftArm','rightArm']){const [a,b]=run.rig[role].map(id=>f.segments.findIndex(s=>s.segment_id===id));close(straight.pose.angles[a],straight.pose.angles[b]);}
});

test('running bakes as one undoable native command on either timeline and survives reopening',async()=>{
 for(const sheet of [false,true]){const e=sheet?new Editor({demo:false}).load(createStartupDocument()):new Editor({demo:false});const {uid}=e.addCartoonCharacter({dimension:'3d'});e.select(uid);const before=e.serialize(),undos=e._undo.length;
  await e.applyHumanMotion({action:'run',duration:72,distance:260});assert.equal(e._undo.length,undos+1);const after=e.serialize();e.undo();assert.deepEqual(e.serialize(),before);e.redo();assert.deepEqual(e.serialize(),after);
  const opened=new Editor({demo:false}).load((await decodeDocument(await buildContainerV2(after,'styk'),'styk')).document);opened.select(uid);opened.seek(30);e.seek(30);assert.deepEqual(opened.object.angles,e.object.angles);
 }
});

test('agents can run and shared scenes shorten running before an obstacle',async()=>{
 const session=new AgentSession(),added=await session.invoke('editor_addCartoonCharacter',{args:[{dimension:'3d'}]});const result=await session.invoke('editor_applyHumanMotion',{args:[{action:'run',duration:72,distance:260}],selection:{uid:added.value.uid}});assert.equal(result.value.frames,72);
 const e=new Editor({demo:false});e.addSpatialScene({actors:[{}],boxes:[{name:'Wall',position:[200,0,0],size:[20,250,100]}]});const s=e.previewSpatialSceneMotion({duration:96,actors:[{action:'run',distance:400,armBend:1.2,stepLength:80}]},95);assert.equal(s.blocked[0].box,'Wall');assert.ok(s.actors[0].worldRoot[0]<142);assert.equal(s.actors[0].airborne,false);
});

test('curved spatial running holds world-space stance plants through a moving perspective camera',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),roles=characterBones(figure),m=createHumanMotion(figure,createObject(figure,1,300,300),{action:'run',duration:120,distance:300,groundY:550,view:{yaw:.3,orbitYaw:.2,orbitPitch:.15,perspective:.5},viewTo:{yaw:1.8,orbitYaw:.8,orbitPitch:.3}});const previous={};let checks=0;
 for(let tick=12;tick<120;tick++){const s=m.sample(tick),g=geometry(figure,s.pose),inv=inverseQuaternion(quatMultiply(spatialQuaternion(0,0,-s.view.orbitPitch),spatialQuaternion(0,-s.view.orbitYaw,0)));
  for(const side of ['left','right']){const b=roles.get(`${side}Shin`),raw=spatialPoint(g.segments[b.index].spatialFrame,b.segment._stykRig.spatial.tip),p=quatRotate(inv,raw).map((v,k)=>v+s.worldRoot[k]),planted=s.contacts[side].planted;if(planted&&previous[side]?.planted){p.forEach((v,k)=>close(v,previous[side].point[k]));checks++;}previous[side]={point:p,planted};}
 }assert.ok(checks>20);
});
