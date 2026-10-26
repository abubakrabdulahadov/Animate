import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '../src/editor.mjs';
import {createObject,createFrame,defaultFigure} from '../src/demo.mjs';
import {createHumanMotion} from '../src/human-motion.mjs';
import {createCartoonCharacter} from '../src/filled-art.mjs';
import {characterBones} from '../src/spatial-character.mjs';
import {torsoContact} from '../src/spatial-contacts.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {spatialPoint,quatRotate} from '../src/rig-spatial.mjs';
import {buildContainerV2,decodeDocument} from '../src/native-container.mjs';
import {createStartupDocument} from '../src/startup-document.mjs';
const close=(a,b,t=1e-4)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const cargo={actors:[{name:'Aziz'}],boxes:[{name:'Floor',position:[0,131,0],size:[1200,20,1200],color:[130,150,140]},{name:'Crate',size:[60,50,35],heldBy:{actor:0,hand:'both'},weight:.85}],lighting:{shadows:true}};

test('weighted carrying flexes the knees, leans the torso and uses shorter complete strides',()=>{
 const f=defaultFigure(),o=createObject(f,1,300,300),options={action:'carry',duration:120,distance:240,hand:'both'};
 const light=createHumanMotion(f,o,{...options,carry:{hand:'both',weight:0}}),heavy=createHumanMotion(f,o,{...options,carry:{hand:'both',weight:1}});
 assert.ok(heavy.sample(119).phase>light.sample(119).phase);const a=light.sample(60),b=heavy.sample(60);assert.ok(b.pose.root_y>a.pose.root_y);assert.ok(b.pose.angles[0]>a.pose.angles[0]+.1);close(heavy.sample(0).pose.root_x,300);close(heavy.sample(119).pose.root_x,540);
 for(const side of ['left','right'])assert.ok(heavy.sample(119).contacts[side].planted);
 for(const weight of [-1,1.1,NaN])assert.throws(()=>createHumanMotion(f,o,{carry:{hand:'both',weight}}));
});

test('explicit torso contacts clear a reaching forearm without stretching native bones',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),o=createObject(figure,1,300,300),roles=characterBones(figure),m=createHumanMotion(figure,o,{action:'reach',duration:72,target:{x:325,y:285},collisions:true,view:{yaw:0}}),s=m.sample(40);
 const g=buildGeometry({version:5,figure_types:[figure]},createFrame([s.pose])).objects.get(0),torso=g.segments[roles.get('spine0').index].spatialFrame;
 const p=role=>{const b=roles.get(role),f=g.segments[b.index].spatialFrame;close(f.stretch,1);return spatialPoint(f,b.segment._stykRig.spatial.tip);};
 assert.equal(torsoContact(p('rightUpperArm'),p('rightForearm'),torso).penetrating,false);assert.ok(s.collisions.length>0);
 const original=createHumanMotion(figure,o,{action:'reach',duration:72,target:{x:325,y:285},collisions:false,view:{yaw:0}}).sample(40),old=buildGeometry({version:5,figure_types:[figure]},createFrame([original.pose])).objects.get(0),point=role=>{const b=roles.get(role);return spatialPoint(old.segments[b.index].spatialFrame,b.segment._stykRig.spatial.tip);};assert.equal(torsoContact(point('rightUpperArm'),point('rightForearm'),old.segments[roles.get('spine0').index].spatialFrame).penetrating,true);
});

test('scene collision stops a complete gait before a solid box and strict mode rejects atomically',async()=>{
 const e=new Editor({demo:false});e.addSpatialScene({actors:[{}],boxes:[{name:'Wall',position:[180,0,0],size:[20,250,120]}]});
 const options={duration:96,actors:[{action:'walk',distance:300,view:{yaw:Math.PI/2}}]};
 const stopped=e.previewSpatialSceneMotion(options,95);assert.equal(stopped.blocked[0].box,'Wall');assert.ok(stopped.actors[0].worldRoot[0]<122);for(const side of ['left','right'])assert.ok(stopped.actors[0].contacts[side].planted);
 const free=e.previewSpatialSceneMotion({...options,collisions:'off'},95);close(free.actors[0].worldRoot[0],300);
 const before=e.serialize();await assert.rejects(e.applySpatialSceneMotion({...options,collisions:'error'}),/Wall/);assert.deepEqual(e.serialize(),before);
});

test('crossing actors stop before overlapping and initially overlapping actors reject',()=>{
 const e=new Editor({demo:false});e.addSpatialScene({actors:[{position:[-120,0,0]},{position:[120,0,0]}]});
 const s=e.previewSpatialSceneMotion({duration:96,actors:[{action:'walk',distance:200,view:{yaw:Math.PI/2}},{action:'walk',distance:200,view:{yaw:-Math.PI/2}}]},95);
 assert.ok(s.blocked.some(b=>b.reason==='actor'));assert.ok(240-s.actors[0].worldRoot[0]+s.actors[1].worldRoot[0]>=96);
 assert.throws(()=>new Editor({demo:false}).addSpatialScene({actors:[{},{}]}),/intersect/);
});

test('carried loads follow both wrists, release onto the floor, and remain there after the actor retreats',async()=>{
 const e=new Editor({demo:false});e.addSpatialScene(cargo);const scene=e.figure._styk.spatialScene,prop=scene.props[0],index=new Map(e.figure.segments.map((s,i)=>[s.segment_id,i]));
 const preview=e.previewSpatialSceneMotion({duration:48,actors:[{action:'carry',distance:100}]},24),hands=Object.values(preview.actors[0].worldGrips),center=prop.translation.map(id=>preview.pose.lengths[index.get(id)]-20000);
 for(const k of [0,2])close(center[k],(hands[0][k]+hands[1][k])/2);close(center[1]-25,(hands[0][1]+hands[1][1])/2);
 await e.applySpatialSceneMotion({duration:48,actors:[{action:'carry',distance:100}]});await e.applySpatialSceneMotion({start:48,duration:48,actors:[{action:'putDown'}]});e.seek(95);
 close(e.object.lengths[index.get(prop.release)],2);const placed=prop.translation.map(id=>e.object.lengths[index.get(id)]);close(placed[1]-20000+25,121);
 await e.applySpatialSceneMotion({start:96,duration:48,actors:[{action:'walk',distance:-100}]});e.seek(143);assert.deepEqual(prop.translation.map(id=>e.object.lengths[index.get(id)]),placed);
});

test('weighted scenes, light and released prop state survive undo, native saving and both timelines',async()=>{
 for(const sheet of [false,true]){
  const e=sheet?new Editor({demo:false}).load(createStartupDocument()):new Editor({demo:false});e.addSpatialScene(cargo);const before=e.serialize();await e.applySpatialSceneMotion({duration:36,actors:[{action:'putDown'}]});const after=e.serialize();e.undo();assert.deepEqual(e.serialize(),before);e.redo();assert.deepEqual(e.serialize(),after);
  const doc=(await decodeDocument(await buildContainerV2(after,'styk'),'styk')).document,loaded=new Editor({demo:false}).load(doc);loaded.select(e.selectedUid);loaded.seek(35);e.seek(35);assert.deepEqual(loaded.object._stykSpatial,e.object._stykSpatial);assert.deepEqual(loaded.object.lengths,e.object.lengths);assert.deepEqual(loaded.figure._styk.spatialMesh.unlit,e.figure._styk.spatialMesh.unlit);
 }
});

test('bad lighting and oversized held loads leave the document unchanged',()=>{
 const e=new Editor({demo:false}),before=e.serialize();for(const lighting of [{direction:[0,0,0]},{ambient:2},{intensity:NaN},{color:[256,0,0]},{shadows:true}])assert.throws(()=>e.addSpatialScene({actors:[{}],lighting}));assert.deepEqual(e.serialize(),before);
 assert.throws(()=>e.addSpatialScene({actors:[{}],boxes:[{size:[60,50,200],heldBy:{actor:0}}]}),/deep/);assert.deepEqual(e.serialize(),before);
});

test('putting down releases before standing up and keeps the box fixed while the hands relax',()=>{
 const e=new Editor({demo:false});e.addSpatialScene(cargo);const opt={duration:96,actors:[{action:'putDown'}]},low=e.previewSpatialSceneMotion(opt,62),end=e.previewSpatialSceneMotion(opt,95),prop=e.figure._styk.spatialScene.props[0],index=new Map(e.figure.segments.map((s,i)=>[s.segment_id,i]));
 assert.ok(low.actors[0].load.released&&end.actors[0].load.released);assert.ok(low.actors[0].worldRoot[1]>end.actors[0].worldRoot[1]+40);for(const id of prop.translation)close(low.pose.lengths[index.get(id)],end.pose.lengths[index.get(id)]);
});

test('lowering bends both knees forward and keeps the gaze toward the load',()=>{
 const {figure}=createCartoonCharacter({dimension:'3d'}),roles=characterBones(figure),m=createHumanMotion(figure,createObject(figure,1,0,0),{action:'putDown',duration:96,carry:{hand:'both',weight:.8,loadHeight:50},groundY:121,view:{yaw:0,headPitch:0}}),s=m.sample(57),g=buildGeometry({version:5,figure_types:[figure]},createFrame([s.pose])).objects.get(0);
 for(const side of ['left','right']){const b=roles.get(`${side}Thigh`),p=spatialPoint(g.segments[b.index].spatialFrame,b.segment._stykRig.spatial.tip);assert.ok(p[2]>20,'Knees must bend toward the front of the body');}
 const head=g.segments[roles.get('head').index].spatialFrame,look=quatRotate(head.q,[0,0,1]);assert.ok(look[1]>0,'Gaze must follow the load downward');
});
