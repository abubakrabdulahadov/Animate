import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHumanMotion} from '../src/human-motion.mjs';
import {createCartoonCharacter} from '../src/filled-art.mjs';
import {defaultFigure,createObject,createFrame} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {characterBones} from '../src/spatial-character.mjs';
import {spatialPoint,quatRotate} from '../src/rig-spatial.mjs';
import {AgentSession} from '../scripts/agent-session.mjs';
const angle=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const geometry=(figure,object)=>buildGeometry({version:5,figure_types:[figure]},createFrame([{...object,object_slot:0}])).objects.get(0);

test('empty walking arms remain nearly straight with a small forward elbow bend in both travel directions',()=>{
 for(const figure of [defaultFigure(),createCartoonCharacter().figure])for(const distance of [200,-200]){
  const m=createHumanMotion(figure,createObject(figure,1,300,300),{duration:96,distance}),indices=new Map(figure.segments.map((s,i)=>[s.segment_id,i]));
  for(let tick=12;tick<96;tick++){
   const {pose}=m.sample(tick),g=geometry(figure,pose);
   for(const side of ['left','right']){
    const [upper,lower]=m.rig[`${side}Arm`],a=indices.get(upper),b=indices.get(lower),start=g.segments[a].start,elbow=g.joints.get(upper),wrist=g.joints.get(lower);
    assert.ok(angle(pose.angles[a],pose.angles[b])<=.10001,'Empty elbow must not form a deep chevron');
    const cross=(wrist.x-start.x)*(elbow.y-start.y)-(wrist.y-start.y)*(elbow.x-start.x);
    assert.ok(cross*Math.sign(distance)>=-1e-3,'Elbow must bend slightly forward, not backwards');
    assert.ok(elbow.y>start.y&&wrist.y>elbow.y);assert.ok(angle(pose.angles[a],Math.PI/2)<.35,'Upper arm stays near the torso');
    const reach=figure.segments[a].length+figure.segments[b].length;assert.ok(Math.hypot(wrist.x-start.x,wrist.y-start.y)>reach*.998);
   }
  }
 }
});

test('armBend zero makes walking arms straight and invalid backward bends reject',()=>{
 const f=defaultFigure(),o=createObject(f,1,300,300),m=createHumanMotion(f,o,{duration:72,distance:160,armBend:0}),indices=new Map(f.segments.map((s,i)=>[s.segment_id,i]));
 for(const tick of [20,35,50,71])for(const side of ['left','right']){const s=m.sample(tick),[a,b]=m.rig[`${side}Arm`];assert.ok(angle(s.pose.angles[indices.get(a)],s.pose.angles[indices.get(b)])<1e-6);}
 for(const armBend of [-.1,.5,NaN])assert.throws(()=>createHumanMotion(f,o,{armBend}));
});

test('carrying keeps its supporting grip while the empty arm relaxes, including when standing',()=>{
 const f=defaultFigure(),o=createObject(f,1,300,300);
 for(const distance of [0,160,-160]){
  const straight=createHumanMotion(f,o,{action:'carry',hand:'left',duration:72,distance,armBend:0}),flexed=createHumanMotion(f,o,{action:'carry',hand:'left',duration:72,distance,armBend:.3});
  for(const tick of [20,40,60,71]){const a=straight.sample(tick),b=flexed.sample(tick);assert.deepEqual(a.grips,b.grips);
   assert.deepEqual(a.pose.angles.slice(2,4),b.pose.angles.slice(2,4));assert.ok(angle(a.pose.angles[4],a.pose.angles[5])<1e-6);
   assert.ok(angle(b.pose.angles[4],b.pose.angles[5])>.24);
  }
 }
 for(const action of ['idle','wave','reach']){
  const options={action,duration:72,target:{x:340,y:220}},a=createHumanMotion(f,o,{...options,armBend:0}),b=createHumanMotion(f,o,{...options,armBend:.3});assert.deepEqual(a.sample(30).pose,b.sample(30).pose);
 }
});

test('spatial walking uses the same shallow forward bend after body and camera turns',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),o=createObject(figure,1,300,300),roles=characterBones(figure);
 for(const distance of [160,-160])for(const yaw of [0,Math.PI/2,Math.PI]){
  const m=createHumanMotion(figure,o,{duration:72,distance,view:{yaw,orbitYaw:.4,orbitPitch:.2}});
  for(const tick of [20,40,60,71]){const g=geometry(figure,m.sample(tick).pose),q=g.segments[roles.get('model').index].spatialFrame.q;
   for(const side of ['left','right']){
    const vectors=[`${side}UpperArm`,`${side}Forearm`].map(role=>{const r=roles.get(role),frame=g.segments[r.index].spatialFrame,s=r.segment._stykRig.spatial,a=spatialPoint(frame,s.origin),b=spatialPoint(frame,s.tip);return b.map((v,i)=>v-a[i]);});
    const [a,b]=vectors,cos=a.reduce((sum,n,i)=>sum+n*b[i],0)/(Math.hypot(...a)*Math.hypot(...b));assert.ok(Math.acos(Math.max(-1,Math.min(1,cos)))<=.10001);
    const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],local=quatRotate([-q[0],-q[1],-q[2],q[3]],cross);assert.ok(local[0]>=-1e-6,'Spatial elbow keeps anatomical forward bend');
   }
  }
 }
});

test('agents can request straight free arms on a carrying spatial character',async()=>{
 const session=new AgentSession(),added=await session.invoke('editor_addCartoonCharacter',{args:[{dimension:'3d'}]});
 await session.invoke('editor_applyHumanMotion',{args:[{action:'carry',hand:'left',duration:48,distance:100,armBend:0}],selection:{uid:added.value.uid}});
 const e=session.engine.editor;e.seek(24);const g=geometry(e.figure,e.evaluatedFrame.objects.find(o=>o.unique_id===added.value.uid)),roles=characterBones(e.figure);
 const vectors=['rightUpperArm','rightForearm'].map(role=>{const r=roles.get(role),frame=g.segments[r.index].spatialFrame,s=r.segment._stykRig.spatial,a=spatialPoint(frame,s.origin),b=spatialPoint(frame,s.tip);return b.map((v,i)=>v-a[i]);});
 const [a,b]=vectors,dot=a.reduce((n,v,i)=>n+v*b[i],0)/(Math.hypot(...a)*Math.hypot(...b));assert.ok(Math.acos(Math.min(1,dot))<1e-6);
});
