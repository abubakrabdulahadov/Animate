import {createCartoonCharacter} from './filled-art.mjs';
import {createObject} from './demo.mjs';
import {createHumanMotion,HUMAN_MOTION_LIMITS} from './human-motion.mjs';
import {remapRigReferences} from './rig-constraints.mjs';
import {spatialQuaternion,quaternionPose,quatRotate,quatMultiply} from './rig-spatial.mjs';
import {inverseQuaternion} from './ik-spatial.mjs';
import {snapshotPoseObject} from './pose-snapshot.mjs';

const finite=(n,label,min=-10000,max=10000)=>{if(!Number.isFinite(n)||n<min||n>max)throw new RangeError(`${label} must be between ${min} and ${max}.`);return n;};
const vector=(v,label)=>{if(!Array.isArray(v)||v.length!==3)throw new TypeError(`${label} needs [x,y,z].`);return v.map(n=>finite(n,label));};
const record=(v,keys,label)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw new TypeError(`Invalid ${label}.`);};
const ease=u=>u*u*u*(u*(u*6-15)+10);
const mix=(a,b,t)=>a+(b-a)*t;
const TRACK=20000;

/** Compile actors and solid scenery into one native articulated mesh. A single
 * depth pass gives crossing actors and props real mutual occlusion. */
export function createSpatialScene(options={}){
 record(options,['name','actors','boxes'],'spatial scene');
 const {actors=[],boxes=[]}=options;
 if(!Array.isArray(actors)||!actors.length||actors.length>8||!Array.isArray(boxes)||boxes.length>128)throw new RangeError('A scene needs 1–8 actors and at most 128 boxes.');
 const figure={figure_type_id:1,name:String(options.name??'3D scene').slice(0,255),segments:[],polyfills:[],image_assets:[],text_assets:[],_styk:{spatialScene:{version:1,actors:[]},colorMode:'segments'}};
 const add=(name,parent=0,length=0,angle=0,spatial)=>{const id=figure.segments.length+1;figure.segments.push({segment_id:id,parent_id:parent,length,angle_rad:angle,bend_rad:0,thickness:0,primitive_code:0,aux_code:0,flags:0,segment_type:'line',segment_kind:'line',visible:false,color_rgb:[0,0,0],name,...(spatial?{_stykRig:{spatial}}:{})});return id;};
 const basis=[add('Scene origin'),add('Scene X',0,30),add('Scene Y',0,30,Math.PI/2)];
 const bone=(name,parent,origin=[0,0,0],tip=[0,1,0],motion)=>{const turn=add(`${name} turn`),pitch=add(`${name} pitch`);return add(name,parent,Math.hypot(...tip.map((v,i)=>v-origin[i])),Math.atan2(tip[1]-origin[1],tip[0]-origin[0]),{parent,origin,tip,turn,pitch,...(motion?{motion}:{})});};
 const slides=(name,parent)=>[0,1,2].map(axis=>{const tip=[0,0,0];tip[axis]=TRACK;const id=bone(`${name} ${'XYZ'[axis]}`,parent,[0,0,0],tip,{type:'slide',min:-TRACK,max:TRACK});parent=id;return id;});
 const lens=slides('Lens',0),camera=bone('World camera',lens[2]);
 const cameraPosition=slides('Camera position',camera);
 figure._styk.spatialScene.camera={lens,camera,position:cameraPosition};
 const mesh={positions:[],bones:[],weights:[],indices:[],colors:[],materials:[],basis,groups:[]},palette=new Map();
 const color=rgb=>{const key=rgb.join();if(!palette.has(key)){if(mesh.colors.length>=1024)throw new RangeError('Scene exceeds the native color palette limit.');palette.set(key,mesh.colors.length);mesh.colors.push([...rgb]);}return palette.get(key);};
 for(const [i,actor]of actors.entries()){
  record(actor,['name','palette','expression','position'],'scene actor');const position=vector(actor.position??[0,0,0],'actor.position');
  const {figure:source}=createCartoonCharacter({dimension:'3d',name:actor.name??`Actor ${i+1}`,palette:actor.palette,expression:actor.expression});
  const translation=slides(`Actor ${i+1} position`,cameraPosition[2]),ids=new Map(source.segments.map((s,index)=>[s.segment_id,figure.segments.length+index+1]));
  for(const original of source.segments){const s=structuredClone(original);remapRigReferences(s,ids);s.segment_id=ids.get(original.segment_id);s.parent_id=ids.get(original.parent_id)??0;
   if(s._stykCharacterRole==='model'){s._stykRig.spatial.parent=translation[2];s.parent_id=translation[2];}
   delete s._stykCharacterRole;figure.segments.push(s);
  }
  const m=source._styk.spatialMesh,offset=mesh.positions.length/3,material=m.colors.map(color),start=mesh.indices.length/3;
  mesh.positions.push(...m.positions);mesh.bones.push(...m.bones.map(n=>ids.get(n)??0));mesh.weights.push(...m.weights);mesh.indices.push(...m.indices.map(n=>n+offset));mesh.materials.push(...m.materials.map(n=>material[n]));
  mesh.groups.push({name:source.name,start,count:m.indices.length/3});
  const {spatialMesh,...metadata}=source._styk;
  figure._styk.spatialScene.actors.push({name:source.name,position,translation,ids:[...ids],figure:{...source,_styk:metadata}});
 }
 const scenery=bone('Scenery',cameraPosition[2]);
 for(const [i,box]of boxes.entries()){
  record(box,['name','position','size','color'],'scene box');const p=vector(box.position??[0,121,0],'box.position'),size=vector(box.size??[100,20,100],'box.size');if(size.some(n=>n<=0))throw new RangeError('Box dimensions must be positive.');
  const rgb=box.color??[80,100,120];if(!Array.isArray(rgb)||rgb.length!==3||rgb.some(n=>!Number.isInteger(n)||n<0||n>255))throw new TypeError('Box color needs RGB bytes.');
  const start=mesh.indices.length/3,at=mesh.positions.length/3;
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){mesh.positions.push(p[0]+x*size[0]/2,p[1]+y*size[1]/2,p[2]+z*size[2]/2);mesh.bones.push(scenery,0,0,0);mesh.weights.push(1,0,0,0);}
  const faces=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
  for(const [j,[a,b,c,d]]of faces.entries()){const mat=color(rgb.map(n=>Math.round(n*(.72+j*.045))));mesh.indices.push(at+a,at+b,at+c,at+a,at+c,at+d);mesh.materials.push(mat,mat);}
  mesh.groups.push({name:String(box.name??`Box ${i+1}`),start,count:12});
 }
 figure._styk.spatialMesh=mesh;figure.segment_count=figure.segments.length;
 return figure;
}

export function createSpatialSceneMotion(figure,object,options={},fps=24){
 const scene=figure._styk?.spatialScene;if(scene?.version!==1)throw new Error('Select a native spatial scene.');
 record(options,['start','duration','after','actors','camera','cameraTo','cameraPath'],'spatial scene motion');
 const duration=options.duration??Math.round(fps*2);
 if(!Number.isInteger(duration)||duration<2||duration>HUMAN_MOTION_LIMITS.frames||duration*figure.segments.length>HUMAN_MOTION_LIMITS.boneSamples||JSON.stringify(object).length*2*duration>HUMAN_MOTION_LIMITS.poseBytes)throw new RangeError('Spatial scene motion exceeds the pose preparation limit.');
 if(object.join||object.scale!==1||object.image_text_flags||Math.abs(object.angles[0]-figure.segments[0].angle_rad)>1e-7)throw new Error('Generate scene motion on an independent scene at its original scale and rotation.');
 if(Object.values(object._stykIK??{}).some(c=>c.enabled&&c.pinned)||Object.values(object._stykSpatial?.shape??{}).some(s=>(s.width??1)!==1||(s.taper??0)!==0)||object.len_flag&&figure.segments.some((s,i)=>!s._stykRig?.spatial?.motion&&Math.abs(object.lengths[i]-s.length)>1e-6))throw new Error('Release scene IK pins and restore original proportions before generating scene motion.');
 if(options.after!==undefined&&!['hold','restore'].includes(options.after))throw new Error('after must be hold or restore.');
 if(options.cameraPath!==undefined&&!['orbit','linear'].includes(options.cameraPath))throw new Error('cameraPath must be orbit or linear.');
 const actorOptions=options.actors??[];if(!Array.isArray(actorOptions)||actorOptions.length>scene.actors.length)throw new RangeError('actors must match the scene actor order.');
 const index=new Map(figure.segments.map((s,i)=>[s.segment_id,i]));
 const cameraSettings=(patch,base)=>{record(patch,['position','target','focalLength','roll'],'scene camera');const c={...base,...patch};c.position=vector(c.position,'camera.position');c.target=vector(c.target,'camera.target');finite(c.focalLength,'focalLength',100,10000);finite(c.roll,'camera.roll',-Math.PI*4,Math.PI*4);if(Math.hypot(...c.position.map((v,i)=>v-c.target[i]))<1)throw new RangeError('Camera position must differ from target.');return c;};
 const currentTravel=id=>object.len_flag?object.lengths[index.get(id)]-TRACK:0;
 const currentFocal=currentTravel(scene.camera.lens[2]);
 let sourceCamera={position:[0,-40,700],target:[0,-20,0],focalLength:700,roll:0};
 const cameraBone=figure.segments[index.get(scene.camera.camera)],cameraBend=object.angles[index.get(scene.camera.camera)]-cameraBone.angle_rad;
 if(currentFocal>=100){
  const position=scene.camera.position.map(id=>-currentTravel(id)),turn=object.angles[index.get(cameraBone._stykRig.spatial.turn)],pitch=object.angles[index.get(cameraBone._stykRig.spatial.pitch)];
  const q=spatialQuaternion(cameraBend,turn,pitch),world=inverseQuaternion(q),forward=quatRotate(world,[0,0,-700]);
  const direction=quatRotate(world,[0,0,-1]),yaw=Math.atan2(-direction[0],-direction[2]),tilt=Math.atan2(direction[1],Math.hypot(direction[0],direction[2]));
  const noRoll=inverseQuaternion(spatialQuaternion(0,yaw,tilt)),right=quatRotate(noRoll,quatRotate(world,[1,0,0]));
  sourceCamera={position,target:position.map((v,i)=>v+forward[i]),focalLength:currentFocal,roll:Math.atan2(right[1],right[0])};
 }
 const base=cameraSettings(options.camera??{},sourceCamera),end=cameraSettings(options.cameraTo??{},base);
 const motions=scene.actors.map((a,i)=>{
  const opt=actorOptions[i]??{action:'idle'};
  if(opt.view?.orbitYaw||opt.view?.orbitPitch||opt.viewTo?.orbitYaw||opt.viewTo?.orbitPitch||opt.view?.perspective||opt.viewTo?.perspective)throw new Error('Use the shared scene camera instead of per-actor orbit or perspective.');
  const source=createObject(a.figure,i+1,0,0);
  for(const [sourceId,targetId]of a.ids){const si=a.figure.segments.findIndex(s=>s.segment_id===sourceId),ti=index.get(targetId);source.angles[si]=object.angles[ti]-(a.figure.segments[si]._stykRig?.spatial?.origin?cameraBend:0);}
  return createHumanMotion(a.figure,source,{...opt,duration,groundY:opt.groundY??121,view:{...opt.view,perspective:0},viewTo:{...opt.viewTo,perspective:0}},fps);
 });
 return {settings:{duration},rig:null,sample(tick){
  finite(tick,'sample tick',0,duration-1);const t=ease(tick/(duration-1)),c={position:base.position.map((v,i)=>mix(v,end.position[i],t)),target:base.target.map((v,i)=>mix(v,end.target[i],t)),focalLength:mix(base.focalLength,end.focalLength,t),roll:mix(base.roll,end.roll,t)};
  if(options.cameraPath!=='linear'){
   const a=base.position.map((v,i)=>v-base.target[i]),b=end.position.map((v,i)=>v-end.target[i]),ra=Math.hypot(...a),rb=Math.hypot(...b),x=a.map(v=>v/ra),y=b.map(v=>v/rb),dot=Math.max(-1,Math.min(1,x.reduce((v,n,i)=>v+n*y[i],0)));
   let direction;
   if(dot<-.9995){const perpendicular=Math.abs(x[1])<.9?[x[2],0,-x[0]]:[0,-x[2],x[1]],norm=Math.hypot(...perpendicular);direction=x.map((v,i)=>v*Math.cos(Math.PI*t)+perpendicular[i]/norm*Math.sin(Math.PI*t));}
   else if(dot>.9995){direction=x.map((v,i)=>mix(v,y[i],t));const n=Math.hypot(...direction);direction=direction.map(v=>v/n);}
   else{const angle=Math.acos(dot),sin=Math.sin(angle);direction=x.map((v,i)=>(v*Math.sin((1-t)*angle)+y[i]*Math.sin(t*angle))/sin);}
   c.position=c.target.map((v,i)=>v+direction[i]*mix(ra,rb,t));
  }
  const d=c.target.map((v,i)=>v-c.position[i]),yaw=Math.atan2(-d[0],-d[2]),pitch=Math.atan2(d[1],Math.hypot(d[0],d[2]));
  const q=inverseQuaternion(quatMultiply(spatialQuaternion(0,yaw,pitch),spatialQuaternion(c.roll,0,0))),rotation=quaternionPose(q,{bend:0,turn:-yaw,pitch:-pitch});
  const pose=snapshotPoseObject(object);pose.angles=figure.segments.map(s=>s.angle_rad);pose.len_flag=1;pose.lengths=figure.segments.map(s=>s.length);pose.bend_flag=0;pose.bends=[];delete pose._stykIK;
  const slide=(ids,values)=>ids.forEach((id,i)=>{if(Math.abs(values[i])>TRACK)throw new RangeError('Scene travel exceeds the native translation range.');pose.lengths[index.get(id)]=TRACK+values[i];});
  slide(scene.camera.lens,[0,0,c.focalLength]);slide(scene.camera.position,c.position.map(n=>-n));
  const cameraBone=figure.segments[index.get(scene.camera.camera)];
  for(const [i,s]of figure.segments.entries())if(s._stykRig?.spatial?.origin&&!scene.camera.lens.includes(s.segment_id))pose.angles[i]+=rotation.bend;
  pose.angles[index.get(cameraBone._stykRig.spatial.turn)]=rotation.turn;pose.angles[index.get(cameraBone._stykRig.spatial.pitch)]=rotation.pitch;
  const samples=[];
  for(const [i,actor]of scene.actors.entries()){
   const sample=motions[i].sample(tick);samples.push(sample);const at=[sample.pose.root_x,sample.pose.root_y,sample.worldRoot[2]];
   const origin=actor.position.map((v,k)=>k===1||!object.len_flag?v:currentTravel(actor.translation[k]));
   slide(actor.translation,origin.map((v,k)=>v+at[k]));
   for(const [source,target]of actor.ids){const si=actor.figure.segments.findIndex(s=>s.segment_id===source),ti=index.get(target),s=figure.segments[ti];pose.angles[ti]=sample.pose.angles[si]+(s._stykRig?.spatial?.origin?rotation.bend:0);}
   const p=quatRotate(q,origin.map((v,k)=>v+at[k]-c.position[k]));if(p[2]>-100)throw new RangeError('An actor approaches or passes the scene camera; move the camera back.');
  }
  pose._stykSpatial={camera:{strength:1,distance:c.focalLength,centerX:pose.root_x,centerY:pose.root_y}};
  return {pose,camera:c,actors:samples};
 }};
}
