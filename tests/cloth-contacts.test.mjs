import {test} from 'node:test';import assert from 'node:assert/strict';
import {appendCloth,createClothDeformer} from '../src/cloth-motion.mjs';
import {defaultFigure,createObject,createFrame} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {Editor} from '../src/editor.mjs';
const geometry=(f,p)=>buildGeometry({version:5,figure_types:[f]},createFrame([p])).objects.get(0);
const fixture=()=>{const {figure}=appendCloth(defaultFigure(),{anchorId:1,angle:Math.PI/2,offset:{x:-18,y:15},width:4,endWidth:4,length:45,rows:12,columns:2});return {figure,object:createObject(figure,1,300,350)};};
test('cloth contacts keep free nodes on the authored side of a body capsule under strong wind',()=>{
 const {figure,object}=fixture(),before=structuredClone(object),cloth=createClothDeformer(figure,{wind:{x:100,y:0},flutter:0,sag:0,collisions:{handles:[1],radius:12}}),loose=createClothDeformer(figure,{wind:{x:100,y:0},flutter:0,sag:0}),source=geometry(figure,object),fixed=geometry(figure,cloth.apply(object,2)),free=geometry(figure,loose.apply(object,2));let prevented=0;
 for(const n of cloth.meshes[0].nodes){const a=source.joints.get(n.id),b=fixed.joints.get(n.id);if(n.row===0)assert.deepEqual(b,a);else{assert.ok(b.x<=288.001);if(free.joints.get(n.id).x>300)prevented++;}}
 assert.ok(prevented>5);assert.deepEqual(object,before);assert.deepEqual(cloth.apply(object,1),cloth.apply(object,1));
});
test('cloth body contacts retain noncloth animation, undo and native publication ownership',async()=>{
 const e=new Editor({demo:false});e.addFigure();e.addCloth({anchorId:1,angle:Math.PI/2,offset:{x:-18,y:15},width:4,length:45,rows:12,columns:2});const before=e.serialize();await e.applyClothMotion({duration:36,cloth:{wind:{x:100,y:0},flutter:0,collisions:{handles:[1],radius:12}}});e.seek(24);assert.deepEqual(e.object.angles.slice(0,10),before.keyframes[0].objects[0].angles.slice(0,10));const after=e.serialize();e.undo();assert.deepEqual(e.serialize(),before);e.redo();assert.deepEqual(e.serialize(),after);
});
test('invalid cloth contacts reject before baking',()=>{const {figure}=fixture();for(const collisions of [{handles:[999]},{handles:[1,1]},{handles:[1],radius:0},'body'])assert.throws(()=>createClothDeformer(figure,{collisions}));});
