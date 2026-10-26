import {spatialLight,interpolateLight,litColor} from './spatial-light.mjs';
import {sweepBox} from './spatial-contacts.mjs';
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
const lightFields=({direction,ambient,intensity,color})=>({direction,ambient,intensity,color});
function sceneLighting(input,base){
 record(input,['direction','ambient','intensity','color','shadows','groundY','shadowStrength'],'scene lighting');
 const {shadows=base?.shadows??false,groundY=base?.groundY??121,shadowStrength=base?.shadowStrength??.32,...fields}=input;
 if(typeof shadows!=='boolean')throw new TypeError('shadows must be a boolean.');finite(groundY,'light.groundY');finite(shadowStrength,'shadowStrength',0,.8);
 return {...spatialLight(fields,base?lightFields(base):undefined),shadows,groundY,shadowStrength};
}

/** Compile actors and solid scenery into one native articulated mesh. A single
 * depth pass gives crossing actors and props real mutual occlusion. */
export function createSpatialScene(options={}){
 record(options,['name','actors','boxes','lighting'],'spatial scene');
 const {actors=[],boxes=[]}=options;
 const lighting=options.lighting?sceneLighting(options.lighting):null;
 if(!Array.isArray(actors)||!actors.length||actors.length>8||!Array.isArray(boxes)||boxes.length>128)throw new RangeError('A scene needs 1–8 actors and at most 128 boxes.');
 const figure={figure_type_id:1,name:String(options.name??'3D scene').slice(0,255),segments:[],polyfills:[],image_assets:[],text_assets:[],_styk:{spatialScene:{version:1,actors:[],boxes:[],props:[],...(lighting?{lighting}:{})},colorMode:'segments'}};
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
  record(box,['name','position','size','color','heldBy','weight','collider'],'scene box');const p=vector(box.position??[0,121,0],'box.position'),size=vector(box.size??[100,20,100],'box.size');if(size.some(n=>n<=0))throw new RangeError('Box dimensions must be positive.');
  const rgb=box.color??[80,100,120];if(!Array.isArray(rgb)||rgb.length!==3||rgb.some(n=>!Number.isInteger(n)||n<0||n>255))throw new TypeError('Box color needs RGB bytes.');
  let boxBone=scenery,center=p;
  if(box.collider!==undefined&&typeof box.collider!=='boolean')throw new TypeError('Box collider must be a boolean.');
  if(box.heldBy){
   record(box.heldBy,['actor','hand'],'heldBy');const actor=box.heldBy.actor,hand=box.heldBy.hand??'both';
   if(!Number.isInteger(actor)||actor<0||actor>=actors.length||!['left','right','both'].includes(hand))throw new Error('heldBy needs an existing actor index and left/right/both hand.');
   finite(box.weight??.5,'box.weight',0,1);
   const held=figure._styk.spatialScene.props;
   if(held.some(p=>p.heldBy.actor===actor&&(p.heldBy.hand==='both'||hand==='both'||p.heldBy.hand===hand)))throw new Error('A hand can support only one scene prop.');
   const translation=slides(`Prop ${i+1}`,cameraPosition[2]);boxBone=bone(`Prop ${i+1} orientation`,translation[2]);const release=add(`Prop ${i+1} released`,0,1);
   held.push({name:box.name??`Box ${i+1}`,size,heldBy:{actor,hand},weight:box.weight??.5,translation,bone:boxBone,release});center=[0,0,0];
  }else figure._styk.spatialScene.boxes.push({name:box.name??`Box ${i+1}`,position:p,size,collider:box.collider!==false,color:rgb});
  const start=mesh.indices.length/3,at=mesh.positions.length/3;
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){mesh.positions.push(center[0]+x*size[0]/2,center[1]+y*size[1]/2,center[2]+z*size[2]/2);mesh.bones.push(boxBone,0,0,0);mesh.weights.push(1,0,0,0);}
  const faces=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
  for(const [j,[a,b,c,d]]of faces.entries()){const mat=color(rgb.map(n=>Math.round(n*(.72+j*.045))));mesh.indices.push(at+a,at+b,at+c,at+a,at+c,at+d);mesh.materials.push(mat,mat);}
  mesh.groups.push({name:String(box.name??`Box ${i+1}`),start,count:12});
 }
 if(lighting?.shadows){
  const scene=figure._styk.spatialScene,floor=scene.boxes.find(b=>Math.abs(b.position[1]-b.size[1]/2-lighting.groundY)<.5);
  if(!floor)throw new Error('Ground shadows need a box floor whose top matches lighting.groundY.');
  scene.shadows=[];scene.shadowControls={enabled:add('Ground shadows enabled',0,1),strength:add('Ground shadow strength',0,1)};mesh.unlit=[];
  const shades=Array.from({length:8},(_,i)=>{const id=mesh.colors.length;if(id>=1024)throw new RangeError('Shadow colors exceed the scene palette limit.');mesh.colors.push(floor.color.map(n=>Math.round(n*(1-lighting.shadowStrength*i/7))));mesh.unlit.push(id);return id;});
  scene.shadowMaterials={shades,floor};
  for(const [actor]of scene.actors.entries())for(const part of ['body','left','right']){
   const translation=slides(`Shadow ${actor} ${part}`,cameraPosition[2]),shape=bone(`Shadow ${actor} ${part} shape`,translation[2],[0,0,0],[1,0,0]);scene.shadows.push({actor,part,translation,bone:shape});
   const start=mesh.indices.length/3;
   for(let ring=0;ring<8;ring++){
    const radius=1-ring*.095,at=mesh.positions.length/3,rx=part==='body'?46:18,rz=part==='body'?24:12;
    mesh.positions.push(0,0,0);mesh.bones.push(shape,0,0,0);mesh.weights.push(1,0,0,0);
    for(let j=0;j<=24;j++){const a=j*Math.PI/12;mesh.positions.push(Math.cos(a)*rx*radius,0,Math.sin(a)*rz*radius);mesh.bones.push(shape,0,0,0);mesh.weights.push(1,0,0,0);}
    for(let j=0;j<24;j++){mesh.indices.push(at,at+j+1,at+j+2);mesh.materials.push(shades[ring]);}
   }
   mesh.groups.push({name:`${part} ground shadow`,start,count:mesh.indices.length/3-start});
  }
 }
 figure._styk.spatialMesh=mesh;figure.segment_count=figure.segments.length;
 return figure;
}

export function createSpatialSceneMotion(figure,object,options={},fps=24){
 const scene=figure._styk?.spatialScene;if(scene?.version!==1)throw new Error('Select a native spatial scene.');
 record(options,['start','duration','after','actors','camera','cameraTo','cameraPath','collisions','lighting','lightingTo'],'spatial scene motion');
 const collisionMode=options.collisions??'stop';if(!['stop','error','off'].includes(collisionMode))throw new Error('collisions must be stop, error or off.');
 const duration=options.duration??Math.round(fps*2);
 if(!Number.isInteger(duration)||duration<2||duration>HUMAN_MOTION_LIMITS.frames||duration*figure.segments.length>HUMAN_MOTION_LIMITS.boneSamples||JSON.stringify(object).length*2*duration>HUMAN_MOTION_LIMITS.poseBytes)throw new RangeError('Spatial scene motion exceeds the pose preparation limit.');
 if(object.join||object.scale!==1||object.image_text_flags||Math.abs(object.angles[0]-figure.segments[0].angle_rad)>1e-7)throw new Error('Generate scene motion on an independent scene at its original scale and rotation.');
 if(Object.values(object._stykIK??{}).some(c=>c.enabled&&c.pinned)||Object.values(object._stykSpatial?.shape??{}).some(s=>(s.width??1)!==1||(s.taper??0)!==0)||object.len_flag&&figure.segments.some((s,i)=>!s._stykRig?.spatial?.motion&&!scene.props?.some(p=>p.release===s.segment_id)&&!Object.values(scene.shadowControls??{}).includes(s.segment_id)&&!scene.shadows?.some(p=>p.bone===s.segment_id)&&Math.abs(object.lengths[i]-s.length)>1e-6))throw new Error('Release scene IK pins and restore original proportions before generating scene motion.');
 if(options.after!==undefined&&!['hold','restore'].includes(options.after))throw new Error('after must be hold or restore.');
 if(options.cameraPath!==undefined&&!['orbit','linear'].includes(options.cameraPath))throw new Error('cameraPath must be orbit or linear.');
 const actorOptions=options.actors??[];if(!Array.isArray(actorOptions)||actorOptions.length>scene.actors.length)throw new RangeError('actors must match the scene actor order.');
 const index=new Map(figure.segments.map((s,i)=>[s.segment_id,i]));
 let sourceLighting=scene.lighting;
 const actorOrigins=scene.actors.map(actor=>actor.position.map((v,k)=>k===1||!object.len_flag?v:object.lengths[index.get(actor.translation[k])]-TRACK));
 const activeProps=(scene.props??[]).filter(p=>!object.len_flag||object.lengths[index.get(p.release)]<1.5);
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
 if(object._stykSpatial?.light){const native=spatialLight(object._stykSpatial.light),q=spatialQuaternion(cameraBend,object.angles[index.get(cameraBone._stykRig.spatial.turn)],object.angles[index.get(cameraBone._stykRig.spatial.pitch)]);sourceLighting={...sceneLighting({}),...scene.lighting,...native,direction:quatRotate(inverseQuaternion(q),native.direction)};}
 if(sourceLighting&&scene.shadowControls&&object.len_flag)sourceLighting={...sourceLighting,shadows:object.lengths[index.get(scene.shadowControls.enabled)]>=1.5,shadowStrength:object.lengths[index.get(scene.shadowControls.strength)]-1};
 const lightBase=options.lighting?sceneLighting(options.lighting,sourceLighting):sourceLighting??(options.lightingTo?sceneLighting({}):null),lightEnd=options.lightingTo?sceneLighting(options.lightingTo,lightBase):lightBase;
 if(lightBase?.shadows&&!scene.shadows?.length)throw new Error('Create the scene with lighting.shadows before animating ground shadows.');
 if(scene.shadows?.length&&lightBase&&(lightBase.groundY!==scene.lighting.groundY||lightEnd.groundY!==scene.lighting.groundY))throw new Error('Ground shadow height must match the scene receiver floor.');
 const base=cameraSettings(options.camera??{},sourceCamera),end=cameraSettings(options.cameraTo??{},base);
 const adjusted=actorOptions.map(o=>({...o})),blocked=[];
 const makeMotion=(a,i,factor=1)=>{
  const original=adjusted[i]??{action:'idle'},opt={...original};
  const props=activeProps.filter(p=>p.heldBy.actor===i);
  if(props.length){const hand=props.length>1?'both':props[0].heldBy.hand,forward=Math.max(.45,...props.map(p=>(p.size[2]/2+25)/73));if(forward>.7)throw new Error('The carried box is too deep for this character’s reach.');
   opt.carry={hand,forward,weight:Math.min(1,props.reduce((n,p)=>n+p.weight,0)),loadHeight:props[0].size[1],...original.carry};
   if(opt.action==='idle')opt.action='carry';
  }
  if(factor!==1){opt.distance=(opt.distance??(opt.action==='run'?515:opt.action==='walk'?206:0))*factor;if(factor===0&&['walk','run'].includes(opt.action)){if(opt.action==='run'){delete opt.armBend;delete opt.stepLength;}opt.action='idle';}}
  if(opt.view?.orbitYaw||opt.view?.orbitPitch||opt.viewTo?.orbitYaw||opt.viewTo?.orbitPitch||opt.view?.perspective||opt.viewTo?.perspective)throw new Error('Use the shared scene camera instead of per-actor orbit or perspective.');
  const source=createObject(a.figure,i+1,0,0);
  for(const [sourceId,targetId]of a.ids){const si=a.figure.segments.findIndex(s=>s.segment_id===sourceId),ti=index.get(targetId);source.angles[si]=object.angles[ti]-(a.figure.segments[si]._stykRig?.spatial?.origin?cameraBend:0);}
  return createHumanMotion(a.figure,source,{...opt,duration,groundY:opt.groundY??121,view:{headPitch:0,...opt.view,perspective:0},viewTo:{...opt.viewTo,perspective:0}},fps);
 };
 const motions=scene.actors.map((a,i)=>makeMotion(a,i));
 const obstacles=[...(scene.boxes??[]).filter(b=>b.collider),...(scene.props??[]).filter(p=>!activeProps.includes(p)).map(p=>({name:p.name,position:p.translation.map(currentTravel),size:p.size,releasedBy:p.heldBy.actor}))];
 const collision=(m,i)=>{const origin=actorOrigins[i],radius=Math.max(48,...activeProps.filter(p=>p.heldBy.actor===i).map(p=>Math.hypot(p.size[0],p.size[2])/2+48));let previous=origin;
  for(let j=0;j<=128;j++){const path=m.pathAt((duration-1)*j/128),next=path.map((v,k)=>v+origin[k]);for(const box of obstacles){const hit=sweepBox(previous,next,box,radius);if(hit){const escape=box.releasedBy===i&&sweepBox(origin,origin,box,radius)&&Math.hypot(next[0]-box.position[0],next[2]-box.position[2])>=Math.hypot(previous[0]-box.position[0],previous[2]-box.position[2])-1e-6;if(!escape)return hit;}}previous=next;}return null;};
 if(collisionMode!=='off')for(let i=0;i<motions.length;i++){const hit=collision(motions[i],i);if(!hit)continue;
  if(collisionMode==='error'||collision(makeMotion(scene.actors[i],i,0),i))throw new Error(`Actor ${i+1} intersects ${hit.box}; move the actor or obstacle.`);
  let lo=0,hi=1;for(let j=0;j<14;j++){const mid=(lo+hi)/2;if(collision(makeMotion(scene.actors[i],i,mid),i))hi=mid;else lo=mid;}motions[i]=makeMotion(scene.actors[i],i,Math.max(0,lo-.001));blocked.push({actor:i,box:hit.box,distance:motions[i].settings.distance});
 }
 const pairCollision=list=>{for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
   if(Math.abs(actorOrigins[i][1]-actorOrigins[j][1])>246)continue;let previous;
   for(let k=0;k<=128;k++){const tick=(duration-1)*k/128,a=list[i].pathAt(tick),b=list[j].pathAt(tick),p=[0,2].map(n=>actorOrigins[i][n]+a[n]-actorOrigins[j][n]-b[n]);
    if(previous){const d=p.map((v,n)=>v-previous[n]),den=d[0]*d[0]+d[1]*d[1],t=den?Math.max(0,Math.min(1,-(previous[0]*d[0]+previous[1]*d[1])/den)):0;if(Math.hypot(previous[0]+d[0]*t,previous[1]+d[1]*t)<96)return {actor:i,otherActor:j};}previous=p;
   }
  }return null;};
 if(collisionMode!=='off'){
  const pair=pairCollision(motions);if(pair){
   motions.forEach((m,i)=>{adjusted[i]={...(actorOptions[i]??{action:'idle'}),distance:m.settings.distance};});
   const at=factor=>scene.actors.map((a,i)=>makeMotion(a,i,factor));
   if(collisionMode==='error'||pairCollision(at(0)))throw new Error(`Actors ${pair.actor+1} and ${pair.otherActor+1} intersect; separate their paths.`);
   let lo=0,hi=1;for(let k=0;k<14;k++){const mid=(lo+hi)/2;if(pairCollision(at(mid)))hi=mid;else lo=mid;}at(Math.max(0,lo-.001)).forEach((m,i)=>{motions[i]=m;});blocked.push({...pair,reason:'actor'});
  }
 }
 if(collisionMode!=='off'){for(let i=0;i<motions.length;i++)if(collision(motions[i],i))throw new Error('The shortened path still intersects an obstacle; adjust the path.');if(pairCollision(motions))throw new Error('The shortened actor paths still intersect; adjust their headings.');}
 const releases=motions.map(m=>m.settings.action==='putDown'?m.sample((duration-1)*.65):null);
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
   const origin=actorOrigins[i];
   slide(actor.translation,origin.map((v,k)=>v+at[k]));
   for(const [source,target]of actor.ids){const si=actor.figure.segments.findIndex(s=>s.segment_id===source),ti=index.get(target),s=figure.segments[ti];pose.angles[ti]=sample.pose.angles[si]+(s._stykRig?.spatial?.origin?rotation.bend:0);}
   const p=quatRotate(q,origin.map((v,k)=>v+at[k]-c.position[k]));if(p[2]>-100)throw new RangeError('An actor approaches or passes the scene camera; move the camera back.');
  }
  for(const prop of scene.props??[]){
   const source=activeProps.includes(prop),sample=samples[prop.heldBy.actor],origin=actorOrigins[prop.heldBy.actor];let center;
   if(source){const hands=prop.heldBy.hand==='both'?['left','right']:[prop.heldBy.hand],grips=hands.map(h=>(sample.load?.released?releases[prop.heldBy.actor]??sample:sample).worldGrips[h]);if(grips.some(p=>!p))throw new Error('A held prop needs a carrying motion.');
    center=[0,1,2].map(k=>origin[k]+grips.reduce((n,p)=>n+p[k],0)/grips.length+(k===1?prop.size[1]/2:0));
    if(sample.load?.released){const floor=origin[1]+(actorOptions[prop.heldBy.actor]?.groundY??121);if(Math.abs(center[1]+prop.size[1]/2-floor)>1)throw new Error('The load cannot reach the floor without stretching; increase its height or adjust the pose.');center[1]=floor-prop.size[1]/2;}
   }else center=prop.translation.map(currentTravel);
   slide(prop.translation,center);pose.lengths[index.get(prop.release)]=source&&!sample.load?.released?1:2;
   const b=figure.segments[index.get(prop.bone)];pose.angles[index.get(b._stykRig.spatial.turn)]=source?sample.view.yaw:object.angles[index.get(b._stykRig.spatial.turn)];
  }
  const light=lightBase?{...lightBase,...interpolateLight(lightFields(lightBase),lightFields(lightEnd),t),shadowStrength:mix(lightBase.shadowStrength,lightEnd.shadowStrength,t),shadows:t<.5?lightBase.shadows:lightEnd.shadows}:null;
  if(scene.shadowControls&&light){pose.lengths[index.get(scene.shadowControls.enabled)]=light.shadows?2:1;pose.lengths[index.get(scene.shadowControls.strength)]=1+light.shadowStrength;}
  if(scene.shadows?.length&&light){
   if(light.direction[1]>=-.1)throw new Error('Ground shadows need a light above the floor.');
   const {shades,floor}=scene.shadowMaterials,ground=litColor(floor.color.map(n=>Math.round(n*.81)),light,-light.direction[1]);
   const colors={...pose._stykStyle?.meshColors};shades.forEach((id,i)=>{const rgb=ground.map(n=>Math.round(n*(1-light.shadowStrength*i/7)));colors[id]=(rgb[0]<<16)|(rgb[1]<<8)|rgb[2];});pose._stykStyle={...pose._stykStyle,meshColors:colors};
   for(const shadow of scene.shadows){const sample=samples[shadow.actor],origin=actorOrigins[shadow.actor],base=shadow.part==='body'?[...sample.worldRoot]:sample.worldFeet?.[shadow.part]??sample.worldRoot;
    const p=base.map((v,k)=>v+origin[k]);if(shadow.part==='body')p[1]-=35;
    const height=Math.max(0,light.groundY-p[1]),center=[p[0]+light.direction[0]/light.direction[1]*height,light.groundY-.15,p[2]+light.direction[2]/light.direction[1]*height];
    slide(shadow.translation,center);const b=figure.segments[index.get(shadow.bone)],yaw=Math.atan2(-light.direction[2],light.direction[0]);pose.angles[index.get(b._stykRig.spatial.turn)]=yaw;
    const inside=Math.abs(center[0]-floor.position[0])+60<floor.size[0]/2&&Math.abs(center[2]-floor.position[2])+60<floor.size[2]/2;pose.lengths[index.get(shadow.bone)]=inside&&light.shadows?1:0;
   }
  }
  pose._stykSpatial={...(light?{light:{...spatialLight(lightFields(light)),direction:quatRotate(q,light.direction)}}:{}),camera:{strength:1,distance:c.focalLength,centerX:pose.root_x,centerY:pose.root_y}};
  return {pose,camera:c,actors:samples,blocked,lighting:light};
 }};
}
