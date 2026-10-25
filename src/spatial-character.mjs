import {createObject,createFrame} from './demo.mjs';
import {buildGeometry} from './pivot/geometry.mjs';
import {snapshotPoseObject} from './pose-snapshot.mjs';
import {spatialCamera,projection,projectSpatial,unprojectSpatial} from './spatial-projection.mjs';
import {spatialPoint,spatialQuaternion,quatMultiply,quatRotate,quaternionPose} from './rig-spatial.mjs';
import {animationRotation} from './animation-origin.mjs';
import {ikLayout,ikChain,solveObjectIK} from './ik.mjs';
import {createSpatialLocomotion} from './spatial-locomotion.mjs';
import {inverseQuaternion,captureSpatialIK} from './ik-spatial.mjs';

const finite=(v,name,min,max)=>{if(!Number.isFinite(v)||v<min||v>max)throw new RangeError(`${name} must be between ${min} and ${max}.`);return v;};
export const isSpatialCharacter=figure=>figure?._styk?.spatialCartoon===1;
const anatomy=['spine0','spine1','head','leftUpperArm','leftForearm','rightUpperArm','rightForearm','leftThigh','leftShin','rightThigh','rightShin','leftFoot','rightFoot'];
const specs=[
  ['spine0','model',[0,0,0],[0,-27,0]],['spine1','spine0',[0,-27,0],[0,-69,0]],['head','spine1',[0,-69,0],[0,-119,0]],
  ['leftUpperArm','spine1',[30,-62,0],[30,-24,0]],['leftForearm','leftUpperArm',[30,-24,0],[30,11,0]],
  ['rightUpperArm','spine1',[-30,-62,0],[-30,-24,0]],['rightForearm','rightUpperArm',[-30,-24,0],[-30,11,0]],
  ['leftThigh','model',[15,0,0],[15,53,0]],['leftShin','leftThigh',[15,53,0],[15,103,0]],
  ['rightThigh','model',[-15,0,0],[-15,53,0]],['rightShin','rightThigh',[-15,53,0],[-15,103,0]],
  ['leftFoot','leftShin',[15,103,0],[15,111,37]],['rightFoot','rightShin',[-15,103,0],[-15,111,37]],
];
export function characterBones(figure){
  if(!isSpatialCharacter(figure))throw new Error('Select a spatial cartoon character.');
  const roles=new Map();for(const [index,s]of figure.segments.entries())if(s._stykCharacterRole){if(roles.has(s._stykCharacterRole))throw new Error('Ambiguous character anatomy.');roles.set(s._stykCharacterRole,{segment:s,index});}
  for(const role of ['model',...anatomy])if(!roles.get(role)?.segment._stykRig?.spatial?.origin)throw new Error('The character anatomy has changed.');
  return roles;
}
export function characterRig(figure){const r=characterBones(figure),id=role=>r.get(role).segment.segment_id;return {spine:[id('spine0'),id('spine1')],head:id('head'),leftArm:[id('leftUpperArm'),id('leftForearm')],rightArm:[id('rightUpperArm'),id('rightForearm')],leftLeg:[id('leftThigh'),id('leftShin')],rightLeg:[id('rightThigh'),id('rightShin')],leftFoot:id('leftFoot'),rightFoot:id('rightFoot')};}

/** Immutable mesh and ordinary spatial bones, using the existing depth renderer. */
export function buildSpatialCartoon({name,colors,expression}) {
  const figure={figure_type_id:1,name,segments:[],polyfills:[],image_assets:[],text_assets:[],_styk:{spatialCartoon:1,footSole:18,colorMode:'segments'}},roles=new Map();
  const add=(parent,length,angle,name,extra={})=>{const id=figure.segments.length+1;figure.segments.push({segment_id:id,parent_id:parent,length,angle_rad:angle,thickness:0,bend_rad:0,primitive_code:0,aux_code:0,flags:0,segment_type:'line',segment_kind:'line',visible:false,color_rgb:[0,0,0],transparency:0,z_order:0,name,...extra});return id;};
  add(0,0,0,'Figure rotation');
  for(const [role,parent,origin,tip]of [['model',null,[0,0,0],[0,-1,0]],...specs]){
    const turn=add(0,0,0,`${role} turn`),pitch=add(0,0,0,`${role} tilt`),v=tip.map((n,i)=>n-origin[i]);
    const id=add(roles.get(parent)??0,Math.hypot(...v),Math.atan2(v[1],v[0]),role,{_stykCharacterRole:role,_stykRig:{spatial:{parent:roles.get(parent)??0,origin:[...origin],tip:[...tip],turn,pitch}}});roles.set(role,id);
  }
  const x=add(0,30,0,'Surface X'),y=add(0,30,Math.PI/2,'Surface Y');
  const mesh={positions:[],bones:[],weights:[],indices:[],colors:[],materials:[],basis:[1,x,y],groups:[]},palette=new Map();
  const tint=(rgb,shade)=>{const c=rgb.map(n=>Math.round(Math.max(0,Math.min(255,n*shade)))),key=c.join();if(!palette.has(key)){palette.set(key,mesh.colors.length);mesh.colors.push(c);}return palette.get(key);};
  const vertex=(p,role)=>{const index=mesh.positions.length/3;mesh.positions.push(...p);mesh.bones.push(roles.get(role),0,0,0);mesh.weights.push(1,0,0,0);return index;};
  const triangle=(a,b,c,center,color)=>{
    const p=i=>mesh.positions.slice(i*3,i*3+3),A=p(a),B=p(b),C=p(c),u=B.map((n,i)=>n-A[i]),v=C.map((n,i)=>n-A[i]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],norm=Math.hypot(...normal);if(norm<1e-8)return;
    const d=normal.reduce((sum,n,i)=>sum+n*((A[i]+B[i]+C[i])/3-center[i]),0);if(d<0){[b,c]=[c,b];for(let i=0;i<3;i++)normal[i]*=-1;}
    // Bounded baked palette shading gives a clear silhouette without a new light pipeline.
    const light=(normal[0]*-.3+normal[1]*-.5+normal[2]*.8)/norm,shade=Math.round((.82+.16*Math.max(-.7,light))*12)/12;
    mesh.indices.push(a,b,c);mesh.materials.push(tint(color,shade));
  };
  const surface=(role,center,color,point,rows=12,columns=20,label=role)=>{
    const start=mesh.indices.length/3,base=mesh.positions.length/3;
    for(let i=0;i<=rows;i++)for(let j=0;j<=columns;j++)vertex(point(i/rows,j/columns),role);
    for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){const a=base+i*(columns+1)+j,b=a+1,c=a+columns+1,d=c+1;triangle(a,c,b,center,color);triangle(b,c,d,center,color);}
    mesh.groups.push({name:label,start,count:mesh.indices.length/3-start});
  };
  const ellipsoid=(role,center,radius,color,label=role,rows=12,columns=20)=>surface(role,center,color,(u,v)=>{const a=u*Math.PI,b=v*Math.PI*2;return[center[0]+radius[0]*Math.sin(a)*Math.cos(b),center[1]-radius[1]*Math.cos(a),center[2]+radius[2]*Math.sin(a)*Math.sin(b)];},rows,columns,label);
  const capsule=(role,radius,color)=>{const spec=specs.find(s=>s[0]===role),a=spec[2],b=spec[3],center=a.map((n,i)=>(n+b[i])/2);
    surface(role,center,color,(u,v)=>{const phi=u*Math.PI,theta=v*Math.PI*2,cy=u<.5?a[1]:b[1];return[center[0]+Math.sin(phi)*Math.cos(theta)*radius,cy-Math.cos(phi)*radius,Math.sin(phi)*Math.sin(theta)*radius];},14,18,role);
  };
  ellipsoid('spine0',[0,-30,0],[29,45,18],colors.shirt,'Shirt');ellipsoid('model',[0,1,0],[27,18,17],colors.pants,'Hips');
  ellipsoid('spine0',[-11,-37,17],[7,8,2],colors.shirt.map(n=>Math.min(255,n+24)),'Front pocket',8,14);
  ellipsoid('spine0',[0,-40,-17],[20,1.5,2],colors.shirt.map(n=>Math.round(n*.78)),'Back seam',6,16);
  for(const side of ['left','right']){const sx=side==='left'?1:-1;capsule(`${side}Thigh`,13,colors.pants);capsule(`${side}Shin`,11.5,colors.pants);
    ellipsoid(`${side}Foot`,[sx*15,111,13],[14,10,24],colors.shoes,`${side} shoe`);
    capsule(`${side}UpperArm`,11.5,colors.shirt);capsule(`${side}Forearm`,9.5,colors.skin);ellipsoid(`${side}Forearm`,[sx*30,14,0],[11,12,10],colors.skin,`${side} hand`);
  }
  ellipsoid('head',[0,-69,0],[10,12,10],colors.skin,'Neck');ellipsoid('head',[0,-97,0],[30,32,26],colors.skin,'Head');
  for(const sx of [-1,1])ellipsoid('head',[sx*29,-96,0],[7,9,7],colors.skin,'Ear',8,14);
  surface('head',[0,-97,0],colors.hair,(u,v)=>{const theta=v*Math.PI*2,max=2.28-1.02*Math.max(0,Math.sin(theta)),phi=u*max;return[31*Math.sin(phi)*Math.cos(theta),-97-34*Math.cos(phi),28*Math.sin(phi)*Math.sin(theta)];},12,24,'Hair');
  for(const sx of [-1,1]){ellipsoid('head',[sx*10,-99,24],[5.7,7.2,3.5],[255,250,238],'Eye white',8,14);ellipsoid('head',[sx*10+1,-99,27.4],[2.8,4.2,1.5],colors.iris,'Iris',8,12);ellipsoid('head',[sx*10+1.6,-100,28.8],[.9,1.2,.7],[255,255,255],'Eye glint',6,10);
    ellipsoid('head',[sx*10,-109,25.5],[6,1.7,2],colors.hair,'Brow',6,12);
  }
  ellipsoid('head',[0,-92,28],[3.6,4,4],colors.skin,'Nose',8,14);
  ellipsoid('head',[0,-84,24],[expression==='neutral'?5:8,expression==='happy'?4:1.4,2],[128,65,60],'Mouth',8,14);
  if(expression==='happy')ellipsoid('head',[0,-85.3,25.5],[5,1.1,.8],[255,248,230],'Smile',6,12);
  figure._styk.spatialMesh=mesh;figure.segment_count=figure.segments.length;return {figure,rig:characterRig(figure)};
}

export function characterView(figure,object){const roles=characterBones(figure),index=new Map(figure.segments.map((s,i)=>[s.segment_id,i])),rotation=animationRotation(figure,object),sign=object.image_text_flags?-1:1,angle=(role,kind)=>{const s=roles.get(role).segment,id=s._stykRig.spatial[kind],i=index.get(id);return (object.angles[i]-rotation)*sign-figure.segments[i].angle_rad;};const model=roles.get('model');return {yaw:angle('model','turn'),pitch:angle('model','pitch'),roll:(object.angles[model.index]-rotation)*sign-model.segment.angle_rad,headYaw:angle('head','turn'),headPitch:angle('head','pitch'),perspective:spatialCamera(object).strength,distance:spatialCamera(object).distance};}
export function characterViewPose(figure,object,patch={}){
  const roles=characterBones(figure),index=new Map(figure.segments.map((s,i)=>[s.segment_id,i]));
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new TypeError('Character view must be an object.');
  for(const [key,value]of Object.entries(patch)){
    if(!['yaw','pitch','roll','headYaw','headPitch','perspective','distance'].includes(key))throw new Error(`Unknown character view: ${key}`);
    finite(value,key,key==='distance'?100:key==='perspective'?0:-Math.PI*4,key==='distance'?100000:key==='perspective'?1:Math.PI*4);
  }
  const pose=snapshotPoseObject(object),rotation=animationRotation(figure,object),sign=object.image_text_flags?-1:1;for(const [key,role,kind]of [['yaw','model','turn'],['pitch','model','pitch'],['headYaw','head','turn'],['headPitch','head','pitch']])if(patch[key]!==undefined){const i=index.get(roles.get(role).segment._stykRig.spatial[kind]);pose.angles[i]=rotation+(figure.segments[i].angle_rad+patch[key])*sign;}
  if(patch.roll!==undefined){const delta=(patch.roll-characterView(figure,object).roll)*sign;for(const [i,s]of figure.segments.entries())if(s._stykRig?.spatial?.origin)pose.angles[i]+=delta;}
  if(patch.perspective!==undefined||patch.distance!==undefined)pose._stykSpatial={...pose._stykSpatial,camera:{...spatialCamera(pose),...(patch.perspective!==undefined?{strength:patch.perspective}:{}),...(patch.distance!==undefined?{distance:patch.distance}:{})}};
  return pose;
}

/** Lift the existing foot-planted planar sampler into native spatial pose channels. */
export function spatialHumanMotion(figure,object,options,fps,planarFactory){
  const roles=characterBones(figure),rig=characterRig(figure),indices=new Map(figure.segments.map((s,i)=>[s.segment_id,i]));
  if(object.join||object.image_text_flags||object.scale<=0)throw new Error('Spatial motion needs an independent, positively scaled, unreflected character.');
  if(Math.abs(animationRotation(figure,object))>1e-7)throw new Error('Reset the planar figure rotation before generating spatial motion; use view.roll instead.');
  if(object.len_flag&&figure.segments.some((s,i)=>Math.abs(object.lengths[i]-s.length)>1e-6)||Object.values(object._stykSpatial?.shape??{}).some(s=>(s.width??1)!==1||(s.taper??0)!==0))throw new Error('Restore the character’s original bone proportions before generating spatial motion.');
  if(Object.values(object._stykIK??{}).some(c=>c.enabled&&c.pinned))throw new Error('Release spatial IK pins before generating character motion.');
  if(options.cloth&&options.cloth!==false)throw new Error('Planar cloth deformation cannot be applied to a spatial character.');
  const validateView=view=>{if(!view||typeof view!=='object'||Array.isArray(view))throw new Error('view must be an object.');for(const key of Object.keys(view))if(!['yaw','pitch','roll','headYaw','headPitch','orbitYaw','orbitPitch','perspective','distance'].includes(key))throw new Error(`Unknown orbit view: ${key}`);const {orbitYaw,orbitPitch,...native}=view;characterViewPose(figure,object,native);if(orbitYaw!==undefined)finite(orbitYaw,'orbitYaw',-Math.PI*4,Math.PI*4);if(orbitPitch!==undefined)finite(orbitPitch,'orbitPitch',-Math.PI/2+.05,Math.PI/2-.05);};
  if(options.view)validateView(options.view);if(options.viewTo)validateView(options.viewTo);
  const sourceView=characterView(figure,object),direction=Math.sign(options.distance??0)||1;
  const turning=options.action==='turn';
  const moving=(options.action??'walk')==='walk'||options.action==='carry'&&Math.abs(options.distance??0)>1e-6;
  const base={...sourceView,yaw:moving?direction*Math.PI/2:sourceView.yaw,orbitYaw:0,orbitPitch:0,...options.view},end={...base,...options.viewTo};
  const ids=role=>roles.get(role).segment.segment_id,restAngles=[-Math.PI/2,-Math.PI/2,-Math.PI/2,1.12,1.3,2.02,1.84,1.3,1.52,1.84,1.62,0,0];
  const proxy={figure_type_id:figure.figure_type_id,name:figure.name,segments:[{...figure.segments[0],_stykRig:undefined},...anatomy.map((role,i)=>{
    const s=roles.get(role).segment,parent=[0,ids('spine0'),ids('spine1'),ids('spine1'),ids('leftUpperArm'),ids('spine1'),ids('rightUpperArm'),0,ids('leftThigh'),0,ids('rightThigh'),ids('leftShin'),ids('rightShin')][i];
    return {...s,parent_id:parent,angle_rad:restAngles[i],length:Math.hypot(...s._stykRig.spatial.tip.map((n,i)=>n-s._stykRig.spatial.origin[i])),_stykRig:undefined,...(role==='head'?{segment_type:'circle',segment_kind:'circleFill',primitive_code:3,flags:3}:{})};
  })],polyfills:[],image_assets:[],text_assets:[],_styk:{footSole:18}};
  const proxyObject=createObject(proxy,object.unique_id,object.root_x,object.root_y,{scale:object.scale}),{view,viewTo,cloth,...motionOptions}=options;
  const planar=planarFactory(proxy,proxyObject,{...motionOptions,...(turning?{action:'idle'}:{}),rig,cloth:false},fps);
  const reachSource=options.action==='reach'?planarFactory(proxy,proxyObject,{...motionOptions,action:'idle',rig,cloth:false},fps):null;
  const meshless={...figure,_styk:{...figure._styk,spatialMesh:undefined}};
  const ik=ikLayout(figure),locomotion=createSpatialLocomotion(planar,base,end,{moving,turning,scale:object.scale,rootY:object.root_y});
  return {rig,settings:{...planar.settings,action:turning?'turn':planar.settings.action},sample(tick){
    const sampled=planar.sample(tick),idleArms=reachSource?.sample(tick),u=tick/(planar.settings.duration-1),smooth=u*u*(3-2*u),v={};for(const key of Object.keys(base))v[key]=base[key]+(end[key]-base[key])*smooth;
    Object.assign(v,locomotion.views(u));
    const pose=snapshotPoseObject(object),absolute=new Map([['model',0]]);pose.angles=object.angles.slice();pose.len_flag=0;pose.lengths=[];pose.bend_flag=0;pose.bends=[];
    for(const {segment,index}of roles.values()){pose.angles[index]=segment.angle_rad;pose.angles[indices.get(segment._stykRig.spatial.turn)]=0;pose.angles[indices.get(segment._stykRig.spatial.pitch)]=0;}
    for(const [i,role]of anatomy.entries()){
      const source=roles.get(role).segment,parent=source._stykRig.spatial.parent,parentRole=[...roles].find(([,s])=>s.segment.segment_id===parent)?.[0]??'model';
      const angle=(idleArms&&i>=3&&i<=6?idleArms:sampled).pose.angles[i+1],up=i<3,pitch=role.endsWith('Foot')?0:up?-(angle+Math.PI/2):Math.atan2(Math.cos(angle)*direction,Math.sin(angle));absolute.set(role,pitch);
      pose.angles[indices.get(source._stykRig.spatial.pitch)]=pitch-(absolute.get(parentRole)??0);
    }
    const model=roles.get('model').segment,head=roles.get('head').segment;
    pose.angles[indices.get(roles.get('spine0').segment._stykRig.spatial.turn)]=v.torsoYaw;
    const cameraQ=quatMultiply(spatialQuaternion(0,0,-v.orbitPitch),spatialQuaternion(0,-v.orbitYaw,0));
    const orientation=quaternionPose(quatMultiply(cameraQ,spatialQuaternion(v.roll,v.yaw,v.pitch)),{bend:0,turn:v.yaw-v.orbitYaw,pitch:v.pitch-v.orbitPitch});
    for(const s of roles.values())pose.angles[s.index]+=orientation.bend;
    pose.angles[indices.get(model._stykRig.spatial.turn)]=orientation.turn;
    pose.angles[indices.get(model._stykRig.spatial.pitch)]=orientation.pitch;
    pose.angles[indices.get(head._stykRig.spatial.turn)]=v.headYaw;
    pose.angles[indices.get(head._stykRig.spatial.pitch)]+=v.headPitch;
    const footStates={},travel=locomotion.path(u),sway=(moving?sampled.support:0)*2*object.scale;
    const world=[travel[0]+Math.cos(v.yaw)*sway,sampled.pose.root_y-object.root_y,travel[2]-Math.sin(v.yaw)*sway];
    if(moving||turning)for(const side of ['left','right']){
      const state=locomotion.foot(side,u);footStates[side]=state;
      const hip=quatRotate(spatialQuaternion(v.roll,v.yaw,v.pitch),[(side==='left'?15:-15)*object.scale,0,0]);
      const horizontal=Math.hypot(state.point[0]-world[0]-hip[0],state.point[2]-world[2]-hip[2]),reach=103*object.scale*.985;
      if(horizontal>=reach)throw new RangeError('Turning stride exceeds leg reach; reduce step length or turn angle.');
      world[1]=Math.max(world[1],state.point[1]-hip[1]-Math.sqrt(reach*reach-horizontal*horizontal));
    }
    const path=quatRotate(cameraQ,world),depth=path[2];
    const distance=Math.max(100,v.distance),denominator=1-v.perspective*depth/(distance*object.scale);if(denominator<.1)throw new RangeError('The orbit path approaches the camera; increase distance.');
    const scale=1/denominator;pose.scale=object.scale*scale;pose.root_x=object.root_x+path[0]*scale;pose.root_y=object.root_y+path[1]*scale;
    pose._stykSpatial={...pose._stykSpatial,camera:{strength:v.perspective,distance:Math.max(100,distance-depth/object.scale),centerX:object.root_x,centerY:object.root_y}};
    const geometry=()=>buildGeometry({version:5,figure_types:[meshless]},createFrame([{...pose,object_slot:0}])).objects.get(0);
    let g=geometry(),requestedReach;
    if(moving||turning){
      for(const side of ['left','right']){
        const state=footStates[side];
        const desired=quatRotate(cameraQ,state.point),raw=desired.map((n,i)=>(n-path[i])*scale);
        const id=rig[`${side}Leg`][1],chain=ikChain(figure,id,2,ik),capture=captureSpatialIK(figure,pose,g,chain,[]);
        const target={x:pose.root_x+raw[0],y:pose.root_y+raw[1],rotation:0};
        const pole=quatRotate(cameraQ,[Math.sin(state.yaw),0,Math.cos(state.yaw)]);
        const solved=solveObjectIK(figure,pose,g.root,ik,{[id]:{enabled:true,pinned:true,allowStretch:false,bendDirection:0,chainLength:2,followers:{},target,...capture,spatialTarget:{...capture.spatialTarget,depth:raw[2],pole}}},{includePoints:false});
        if(solved){pose.angles=solved.angles;g=geometry();}
        // A planted shoe retains its own heading instead of swivelling with the hips.
        const foot=roles.get(`${side}Foot`),parent=g.segments[roles.get(`${side}Shin`).index].spatialFrame;
        const local=quaternionPose(quatMultiply(inverseQuaternion(parent.q),quatMultiply(cameraQ,spatialQuaternion(0,state.yaw,0))),{bend:0,turn:0,pitch:0});
        pose.angles[foot.index]=foot.segment.angle_rad+parent.authoredBend+local.bend;
        pose.angles[indices.get(foot.segment._stykRig.spatial.turn)]=local.turn;
        pose.angles[indices.get(foot.segment._stykRig.spatial.pitch)]=local.pitch;g=geometry();
      }
    }
    if(reachSource){
      const side=options.hand??'right',id=rig[`${side}Arm`][1],chain=ikChain(figure,id,2,ik),start=g.joints.get(id),seconds=tick/fps,duration=(planar.settings.duration-1)/fps;
      const x=Math.min(1,seconds/Math.max(.2,duration*.55)),amount=x*x*x*(x*(x*6-15)+10),weight=amount*sampled.weight;
      requestedReach={x:start.x+(options.target.x-start.x)*weight,y:start.y+(options.target.y-start.y)*weight-Math.sin(weight*Math.PI)*73*object.scale*.09};
      const capture=captureSpatialIK(figure,pose,g,chain,[]),target=unprojectSpatial(requestedReach,capture.spatialTarget.depth,pose,g.root);
      const solved=solveObjectIK(figure,pose,g.root,ik,{[id]:{enabled:true,pinned:true,allowStretch:false,bendDirection:0,chainLength:2,followers:{},target:{...target,rotation:0},...capture}},{includePoints:false});
      if(solved){pose.angles=solved.angles;if(solved.lengths){pose.len_flag=1;pose.lengths=solved.lengths;}g=geometry();}
    }
    const grips={},targets={};for(const [role,chain]of Object.entries({leftArm:rig.leftArm,rightArm:rig.rightArm,leftLeg:rig.leftLeg,rightLeg:rig.rightLeg})){
      const p=g.joints.get(chain[1]),actual={x:p.x,y:p.y},requested=requestedReach&&role===`${options.hand??'right'}Arm`?requestedReach:actual;
      targets[role]={actual,requested:{...requested},error:Math.hypot(actual.x-requested.x,actual.y-requested.y)};
    }
    for(const side of Object.keys(sampled.grips??{})){const p=g.joints.get(rig[`${side}Arm`][1]);grips[side]={x:p.x,y:p.y};}
    const contacts={};for(const side of ['left','right']){const role=`${side}Foot`,bone=roles.get(role),frame=g.segments[bone.index].spatialFrame,p=spatialPoint(frame,[side==='left'?15:-15,121,13]);
      const point=projectSpatial([pose.root_x+p[0]*pose.scale,pose.root_y+p[1]*pose.scale,p[2]*pose.scale],projection(pose,g.root));
      const ankle=g.joints.get(rig[`${side}Leg`][1]);contacts[side]={...sampled.contacts[side],...(footStates[side]?{planted:footStates[side].planted}:{}),point:{x:point.x,y:point.y},ankle:{x:ankle.x,y:ankle.y}};
    }
    return {...sampled,pose,grips,contacts,targets,view:v,worldRoot:world};
  }};
}
