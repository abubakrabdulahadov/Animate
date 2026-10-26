import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '../src/editor.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {spatialLight,interpolateLight} from '../src/spatial-light.mjs';
import {spatialMeshSignature} from '../src/spatial-mesh.mjs';
import {interpolateSpatialPose} from '../src/spatial-projection.mjs';
const scene=()=>{const e=new Editor({demo:false});e.addSpatialScene({actors:[{}],boxes:[{position:[0,131,0],size:[1000,20,1000],color:[130,140,150]}],lighting:{shadows:true}});return e;};

test('directional lighting changes visible face tones and invalidates artwork while preserving native definition',()=>{
 const e=scene(),definition=e.figure._styk.spatialMesh,frame=e.evaluatedFrame,previous=buildGeometry(e.report,frame),a=previous.objects.get(0).spatialMesh,object={...frame.objects[0],_stykSpatial:{...frame.objects[0]._stykSpatial,light:spatialLight({direction:[1,0,0],ambient:.1,intensity:1,color:[255,255,255]})}};
 const b=buildGeometry(e.report,{...frame,objects:[object]},{previous,dirtySlots:new Set([0])}).objects.get(0).spatialMesh;
 assert.notDeepEqual(b.materials,a.materials);assert.notDeepEqual(spatialMeshSignature(a,previous.objects.get(0).root),spatialMeshSignature(b,{x:object.root_x,y:object.root_y}));assert.equal(e.figure._styk.spatialMesh,definition);
 assert.ok(b.colors.length<=definition.colors.length*16);assert.ok(b.materials.subarray(0,b.count).every(i=>i<b.colors.length));
 const stable=buildGeometry(e.report,{...frame,objects:[object]},{previous:buildGeometry(e.report,{...frame,objects:[object]}),dirtySlots:new Set([0])}).objects.get(0).spatialMesh;assert.deepEqual(stable.positions,b.positions);
});

test('shadow palettes stay unlit, finite and on the receiver through camera and light movement',()=>{
 const e=scene(),options={duration:48,actors:[{action:'walk',distance:100}],cameraTo:{position:[250,-180,600]},lightingTo:{direction:[.7,-1,.3],color:[220,235,255]}};
 const p=e.previewSpatialSceneMotion(options,25),g=buildGeometry(e.report,{...e.evaluatedFrame,objects:[{...p.pose,object_slot:0}]}).objects.get(0),mesh=g.spatialMesh,definition=e.figure._styk.spatialMesh;
 for(const id of definition.unlit){const packed=p.pose._stykStyle.meshColors[id],rgb=[packed>>>16&255,packed>>>8&255,packed&255];for(let level=0;level<16;level++)assert.deepEqual(mesh.colors[id*16+level],rgb);}
 for(const shadow of e.figure._styk.spatialScene.shadows){const y=p.pose.lengths[e.figure.segments.findIndex(s=>s.segment_id===shadow.translation[1])]-20000;assert.ok(Math.abs(y-120.85)<.001);}
 assert.ok(mesh.positions.every(Number.isFinite));assert.ok(mesh.count>0);
 const dark=e.previewSpatialSceneMotion({...options,lighting:{shadows:false}},25);for(const shadow of e.figure._styk.spatialScene.shadows)assert.equal(dark.pose.lengths[e.figure.segments.findIndex(s=>s.segment_id===shadow.bone)],0);
});

test('light directions interpolate on a stable sphere, including opposite endpoints and native pose tweening',()=>{
 const a=spatialLight({direction:[1,0,0]}),b=spatialLight({direction:[-1,0,0]});for(const t of[0,.25,.5,.75,1]){const l=interpolateLight(a,b,t);assert.ok(Math.abs(Math.hypot(...l.direction)-1)<1e-8);assert.ok(l.direction.every(Number.isFinite));}
 const l=interpolateSpatialPose({_stykSpatial:{light:a}},{_stykSpatial:{light:b}},.5).light;assert.ok(Math.abs(l.direction[0])<1e-8);
});

test('invalid lights and unlit indices reject before changing a native document',()=>{
 const e=scene(),before=e.serialize();for(const light of[{direction:[0,0,0]},{ambient:2},{direction:[Infinity,1,0]},{color:[1.5,0,0]}])assert.throws(()=>e.updateObject({_stykSpatial:{...e.object._stykSpatial,light}}));assert.deepEqual(e.serialize(),before);
 for(const unlit of [[-1],[9999],[0,0]]){const figure=structuredClone(e.figure);figure._styk.spatialMesh.unlit=unlit;assert.throws(()=>e.importFigure(figure));assert.deepEqual(e.serialize(),before);}
});

test('animated shadow strength and visibility persist into the next activity range',async()=>{
 const e=scene();await e.applySpatialSceneMotion({duration:24,lightingTo:{shadowStrength:.6,shadows:false}});e.seek(23);const next=e.previewSpatialSceneMotion({start:23,duration:24},0);assert.equal(next.lighting.shadows,false);assert.ok(Math.abs(next.lighting.shadowStrength-.6)<1e-8);
});

test('a native pose light on an older scene supplies finite shadow defaults in preview',()=>{
 const e=new Editor({demo:false});e.addSpatialScene({actors:[{}]});e.updateObject({_stykSpatial:{...e.object._stykSpatial,light:spatialLight({})}});const p=e.previewSpatialSceneMotion({duration:24},12);assert.ok(Number.isFinite(p.lighting.shadowStrength));assert.equal(p.lighting.shadows,false);assert.ok(p.pose._stykSpatial.light.direction.every(Number.isFinite));
});
