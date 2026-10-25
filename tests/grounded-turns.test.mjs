import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCartoonCharacter} from '../src/filled-art.mjs';
import {createHumanMotion} from '../src/human-motion.mjs';
import {createObject,createFrame,defaultFigure} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {characterBones,characterView} from '../src/spatial-character.mjs';
import {spatialPoint,quatRotate,quatMultiply,spatialQuaternion} from '../src/rig-spatial.mjs';
import {inverseQuaternion} from '../src/ik-spatial.mjs';
const close=(a,b,t=1e-5)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const geometry=(f,p)=>buildGeometry({version:5,figure_types:[{...f,_styk:{...f._styk,spatialMesh:undefined}}]},createFrame([p])).objects.get(0);

test('walk decelerates to two grounded feet for fractional strides and both directions',()=>{
 for(const f of [defaultFigure(),createCartoonCharacter().figure])for(const distance of [7,75,100,137,-137,250]){
  const m=createHumanMotion(f,createObject(f,1,300,300),{duration:120,distance,groundY:550}),s=m.sample(119),g=geometry(f,s.pose);
  for(const side of ['left','right']){assert.ok(s.contacts[side].planted);close(s.contacts[side].point.y,550);const p=g.joints.get(m.rig[`${side}Leg`][1]);close(p.y,s.contacts[side].ankle.y);}
  close(s.pose.root_x,300+distance);assert.ok(Number.isInteger(s.phase));
 }
});

test('curved native 3D walks keep stance ankles fixed in world space, with preserved limb lengths',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),roles=characterBones(figure);
 for(const scale of [.7,1.4])for(const distance of [150,-150]){
  const orbitYaw=.35,orbitPitch=.2;
  const m=createHumanMotion(figure,createObject(figure,1,300,300,{scale}),{duration:96,distance,groundY:530,view:{yaw:.2,orbitYaw,orbitPitch,perspective:.6},viewTo:{yaw:2.3,orbitYaw:.9,orbitPitch:.35}});let previous={},plants=0;
  for(let tick=12;tick<96;tick++){
   const s=m.sample(tick),g=geometry(figure,s.pose),inv=inverseQuaternion(quatMultiply(spatialQuaternion(0,0,-s.view.orbitPitch),spatialQuaternion(0,-s.view.orbitYaw,0)));
   for(const side of ['left','right']){
    const bone=roles.get(`${side}Shin`),frame=g.segments[bone.index].spatialFrame,local=spatialPoint(frame,bone.segment._stykRig.spatial.tip),p=quatRotate(inv,local.map(v=>v*scale)).map((v,i)=>v+s.worldRoot[i]);
    if(previous[side]?.planted&&s.contacts[side].planted){previous[side].p.forEach((v,i)=>close(p[i],v));plants++;}
    previous[side]={p,planted:s.contacts[side].planted};
    for(const role of [`${side}Thigh`,`${side}Shin`]){const b=roles.get(role),f=g.segments[b.index].spatialFrame,a=spatialPoint(f,b.segment._stykRig.spatial.origin),z=spatialPoint(f,b.segment._stykRig.spatial.tip);close(Math.hypot(...z.map((v,i)=>v-a[i])),b.segment.length);}
   }
  }
  assert.ok(plants>50);const a=m.sample(45);m.sample(2);assert.deepEqual(m.sample(45),a);
 }
});

test('turning looks first, then twists the torso, then turns the pelvis, while feet step independently',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),m=createHumanMotion(figure,createObject(figure,1,0,0),{action:'turn',duration:120,groundY:121,view:{yaw:0},viewTo:{yaw:Math.PI}}),roles=characterBones(figure);
 const early=m.sample(30),body=characterView(figure,early.pose),head=body.yaw+early.view.torsoYaw+body.headYaw;
 assert.ok(head>body.yaw+early.view.torsoYaw&&early.view.torsoYaw>0,'Gaze leads the shoulders and pelvis');
 assert.ok(!m.sample(25).contacts.left.planted&&m.sample(25).contacts.right.planted);
 assert.ok(m.sample(60).contacts.left.planted&&!m.sample(60).contacts.right.planted);
 const end=m.sample(119);close(end.view.yaw,Math.PI);close(end.view.headYaw,0);close(end.view.torsoYaw,0);
 const g=geometry(figure,end.pose);for(const side of ['left','right']){assert.ok(end.contacts[side].planted);close(end.contacts[side].point.y,121);const p=g.segments[roles.get(`${side}Foot`).index].spatialFrame;const v=quatRotate(p.q,[0,0,1]);close(v[2],-1);}
});

test('turns take the short angular path across the heading wrap',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),m=createHumanMotion(figure,createObject(figure,1,0,0),{action:'turn',duration:60,view:{yaw:3.05},viewTo:{yaw:-3.05}});
 assert.ok(Math.abs(m.sample(59).view.yaw-3.05)<.2);
 assert.throws(()=>createHumanMotion(defaultFigure(),createObject(defaultFigure(),1,0,0),{action:'turn'}));
});
