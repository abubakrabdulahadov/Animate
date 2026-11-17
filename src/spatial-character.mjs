import {ACTION_MOTIONS} from './human-action-motion.mjs';
import {createObject,createFrame} from './demo.mjs';
import {buildGeometry} from './pivot/geometry.mjs';
import {snapshotPoseObject} from './pose-snapshot.mjs';
import {spatialCamera,projection,projectSpatial,unprojectSpatial} from './spatial-projection.mjs';
import {spatialPoint,spatialQuaternion,quatMultiply,quatRotate,quaternionPose} from './rig-spatial.mjs';
import {animationRotation} from './animation-origin.mjs';
import {ikLayout,ikChain,solveObjectIK} from './ik.mjs';
import {torsoContact} from './spatial-contacts.mjs';
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
// Stickmen keep every joint except the shoulders: their arms leave the neck and hang slightly outward.
const stickSpecs=specs.map(([role,parent,origin,tip])=>{
  const arm={leftUpperArm:[[6,-64,0],[19,-28,0]],leftForearm:[[19,-28,0],[25,8,0]],rightUpperArm:[[-6,-64,0],[-19,-28,0]],rightForearm:[[-19,-28,0],[-25,8,0]]}[role];
  return arm?[role,parent,...arm]:[role,parent,origin,tip];
});
export function characterBones(figure){
  if(!isSpatialCharacter(figure))throw new Error('Select a spatial cartoon character.');
  const roles=new Map();for(const [index,s]of figure.segments.entries())if(s._stykCharacterRole){if(roles.has(s._stykCharacterRole))throw new Error('Ambiguous character anatomy.');roles.set(s._stykCharacterRole,{segment:s,index});}
  for(const role of ['model',...anatomy])if(!roles.get(role)?.segment._stykRig?.spatial?.origin)throw new Error('The character anatomy has changed.');
  return roles;
}
export function characterRig(figure){const r=characterBones(figure),id=role=>r.get(role).segment.segment_id;return {spine:[id('spine0'),id('spine1')],head:id('head'),leftArm:[id('leftUpperArm'),id('leftForearm')],rightArm:[id('rightUpperArm'),id('rightForearm')],leftLeg:[id('leftThigh'),id('leftShin')],rightLeg:[id('rightThigh'),id('rightShin')],leftFoot:id('leftFoot'),rightFoot:id('rightFoot')};}

/** Immutable mesh and ordinary spatial bones, using the existing depth renderer. */
/** A 3D stickman: one solid color, a ball head and round sticks on the same native bones. */
function buildStickMesh({surface,ellipsoid,colors}){
  const ink=colors.stick,stick=5.6;
  // A straight round stick between two points on one bone, capped by balls at the ends.
  const bar=(role,a,b,r,label)=>{const d=b.map((n,i)=>n-a[i]),len=Math.hypot(...d),axis=d.map(n=>n/len),helper=Math.abs(axis[1])<.9?[0,1,0]:[1,0,0];
    const cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],n1=cross(axis,helper),k=Math.hypot(...n1),e1=n1.map(n=>n/k),e2=cross(axis,e1),center=a.map((n,i)=>(n+b[i])/2);
    surface(role,center,ink,(u,v)=>{const phi=u*Math.PI,theta=v*Math.PI*2,end=u<.5?a:b,along=-Math.cos(phi)*r,ring=Math.sin(phi)*r;return end.map((n,i)=>n+axis[i]*along+(e1[i]*Math.cos(theta)+e2[i]*Math.sin(theta))*ring);},10,14,label);
  };
  ellipsoid('head',[0,-102,0],[29,29,29],ink,'Head',18,28);
  bar('spine0',[0,0,0],[0,-27,0],stick,'Body');bar('spine1',[0,-27,0],[0,-72,0],stick,'Body');
  // Every limb is a straight rigid stick on its own bone; a small pelvis "V" joins the legs.
  ellipsoid('spine1',[0,-66,0],[6.4,6.4,6.4],ink,'Neck',8,12);
  for(const side of ['left','right']){const sx=side==='left'?1:-1;
    bar('model',[0,-3,0],[sx*15,0,0],stick,'Hips');
    bar(`${side}UpperArm`,[sx*6,-64,0],[sx*19,-28,0],stick,`${side} arm`);bar(`${side}Forearm`,[sx*19,-28,0],[sx*25,8,0],stick,`${side} arm`);
    bar(`${side}Thigh`,[sx*15,0,0],[sx*15,53,0],stick*1.08,`${side} leg`);bar(`${side}Shin`,[sx*15,53,0],[sx*15,103,0],stick*1.08,`${side} leg`);
    ellipsoid(`${side}Forearm`,[sx*25.8,13,0],[7.5,7.5,7.5],ink,`${side} hand`,10,14);
    ellipsoid(`${side}Foot`,[sx*15,113.5,10],[7.5,7.5,16],ink,`${side} foot`,10,16);
  }
}

/** `shading:false` keeps flat base colors for scenes whose own light shades the mesh. */
export function buildSpatialCartoon({name,colors,expression,shading=true,style='cartoon'}) {
  const figure={figure_type_id:1,name,segments:[],polyfills:[],image_assets:[],text_assets:[],_styk:{spatialCartoon:1,footSole:18,colorMode:'segments'}},roles=new Map();
  const add=(parent,length,angle,name,extra={})=>{const id=figure.segments.length+1;figure.segments.push({segment_id:id,parent_id:parent,length,angle_rad:angle,thickness:0,bend_rad:0,primitive_code:0,aux_code:0,flags:0,segment_type:'line',segment_kind:'line',visible:false,color_rgb:[0,0,0],transparency:0,z_order:0,name,...extra});return id;};
  add(0,0,0,'Figure rotation');
  const rigSpecs=style==='stick'?stickSpecs:specs;
  for(const [role,parent,origin,tip]of [['model',null,[0,0,0],[0,-1,0]],...rigSpecs]){
    const turn=add(0,0,0,`${role} turn`),pitch=add(0,0,0,`${role} tilt`),v=tip.map((n,i)=>n-origin[i]);
    const id=add(roles.get(parent)??0,Math.hypot(...v),Math.atan2(v[1],v[0]),role,{_stykCharacterRole:role,_stykRig:{spatial:{parent:roles.get(parent)??0,origin:[...origin],tip:[...tip],turn,pitch}}});roles.set(role,id);
  }
  const x=add(0,30,0,'Surface X'),y=add(0,30,Math.PI/2,'Surface Y');
  const mesh={positions:[],bones:[],weights:[],indices:[],colors:[],materials:[],basis:[1,x,y],groups:[]},palette=new Map();
  const tint=(rgb,level)=>{const f=.6+.42*level,cool=(1-level)*.14,c=rgb.map((n,i)=>Math.round(Math.max(0,Math.min(255,n*f*(1-cool)+[52,62,96][i]*cool)))),key=c.join();if(!palette.has(key)){palette.set(key,mesh.colors.length);mesh.colors.push(c);}return palette.get(key);};
  const vertex=(p,role)=>{const index=mesh.positions.length/3;mesh.positions.push(...p);mesh.bones.push(roles.get(role),0,0,0);mesh.weights.push(1,0,0,0);return index;};
  const p=i=>mesh.positions.slice(i*3,i*3+3),cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  // `shared` is the whole quad's normal, so both of its triangles get one shading level (no checkerboard).
  const triangle=(a,b,c,center,color,shared)=>{
    const A=p(a),B=p(b),C=p(c),own=cross(B.map((n,i)=>n-A[i]),C.map((n,i)=>n-A[i]));if(Math.hypot(...own)<1e-8)return;
    const outward=own.reduce((sum,n,i)=>sum+n*((A[i]+B[i]+C[i])/3-center[i]),0)>=0;if(!outward)[b,c]=[c,b];
    let normal=shared&&Math.hypot(...shared)>1e-8?shared:own;if(normal.reduce((sum,n,i)=>sum+n*((A[i]+B[i]+C[i])/3-center[i]),0)<0)normal=normal.map(n=>-n);const norm=Math.hypot(...normal);
    // Bounded baked palette shading: a soft wrapped key light with cooler, richer shadows.
    // Few, shared levels keep eight-actor scenes inside the native palette limit.
    const light=(normal[0]*-.35+normal[1]*-.55+normal[2]*.76)/norm,wrap=Math.max(0,(light+.45)/1.45),steps=color.levels??12,level=shading?Math.round(wrap**1.15*steps)/steps:.86;
    mesh.indices.push(a,b,c);mesh.materials.push(tint(color,level));
  };
  const surface=(role,center,color,point,rows=12,columns=20,label=role)=>{
    const start=mesh.indices.length/3,base=mesh.positions.length/3;
    for(let i=0;i<=rows;i++)for(let j=0;j<=columns;j++)vertex(point(i/rows,j/columns),role);
    for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){const a=base+i*(columns+1)+j,b=a+1,c=a+columns+1,d=c+1,A=p(a),B=p(b),C=p(c),D=p(d),quad=cross(D.map((n,k)=>n-A[k]),C.map((n,k)=>n-B[k]));triangle(a,c,b,center,color,quad);triangle(b,c,d,center,color,quad);}
    mesh.groups.push({name:label,start,count:mesh.indices.length/3-start});
  };
  const ellipsoid=(role,center,radius,color,label=role,rows=12,columns=20)=>surface(role,center,color,(u,v)=>{const a=u*Math.PI,b=v*Math.PI*2;return[center[0]+radius[0]*Math.sin(a)*Math.cos(b),center[1]-radius[1]*Math.cos(a),center[2]+radius[2]*Math.sin(a)*Math.sin(b)];},rows,columns,label);
  // A tapered capsule along a vertical bone: round ends, smooth narrowing toward the tip.
  const limb=(role,top,bottom,color,label=role)=>{const spec=specs.find(s=>s[0]===role),a=spec[2],b=spec[3],center=a.map((n,i)=>(n+b[i])/2);
    surface(role,center,color,(u,v)=>{const phi=u*Math.PI,theta=v*Math.PI*2,upper=u<.5,r=upper?top:bottom,cy=upper?a[1]:b[1];return[center[0]+Math.sin(phi)*Math.cos(theta)*r,cy-Math.cos(phi)*r,center[2]+Math.sin(phi)*Math.sin(theta)*r];},12,16,label);
  };
  // A surface of revolution with a rounded-square section, closed at both ends.
  const lathe=(role,ys,profile,color,label,rows=26,columns=28,power=2.6)=>{const center=[0,(ys[0]+ys[1])/2,0];
    surface(role,center,color,(u,v)=>{const [rx,rz,dz=0]=profile(u),theta=v*Math.PI*2,c=Math.cos(theta),s=Math.sin(theta),e=2/power;return[rx*Math.sign(c)*Math.abs(c)**e,ys[0]+(ys[1]-ys[0])*u,dz+rz*Math.sign(s)*Math.abs(s)**e];},rows,columns,label);
  };
  if(style==='stick'){buildStickMesh({surface,ellipsoid,colors});figure._styk.spatialMesh=mesh;figure._styk.stickStyle=1;figure.segment_count=figure.segments.length;return {figure,rig:characterRig(figure)};}
  const smooth=(keys,u)=>{let i=0;while(i<keys.length-2&&u>keys[i+1][0])i++;const [u0,...a]=keys[i],[u1,...b]=keys[i+1],t=Math.max(0,Math.min(1,(u-u0)/(u1-u0))),k=t*t*(3-2*t);return a.map((n,j)=>n+(b[j]-n)*k);};
  // Small details use fewer shading levels; they are too small to show more.
  const detail=rgb=>Object.assign([...rgb],{levels:2});
  const shade=(rgb,f)=>rgb.map(n=>Math.round(Math.max(0,Math.min(255,n*f))));
  const blend=(a,b,t)=>a.map((n,i)=>Math.round(n+(b[i]-n)*t));
  // Torso: broad rounded shoulders, a slightly narrower waist, closed at the neck and hips.
  const torso=[[0,0,0,0],[.05,15,11,0],[.14,26,16,0],[.3,27,17.5,.5],[.55,24.5,17,.5],[.82,21.5,15,0],[1,13,9,0]];
  lathe('spine0',[-80,-4],u=>smooth(torso,u),colors.shirt,'Shirt',22,28,2.25);
  ellipsoid('spine0',[0,-78,0],[13,4.5,10],detail(shade(colors.shirt,.82)),'Collar',6,20);
  ellipsoid('spine0',[-12,-47,16.6],[6,5.2,1.2],detail(shade(colors.shirt,.86)),'Front pocket',6,12);
  ellipsoid('spine0',[0,-44,-16.6],[15,1.1,1.3],detail(shade(colors.shirt,.8)),'Back seam',4,14);
  ellipsoid('model',[0,0,0],[22.5,15.5,14.6],colors.pants,'Hips');
  ellipsoid('model',[0,-9,0],[22.6,3.4,15.6],detail(shade(colors.pants,.55)),'Belt',6,24);
  ellipsoid('model',[0,-9,15.2],[4.2,3.2,1.4],detail([216,184,112]),'Buckle',6,10);
  const sole=detail(blend(colors.shoes,[236,230,220],.4));
  for(const side of ['left','right']){const sx=side==='left'?1:-1;
    limb(`${side}Thigh`,12,10.5,colors.pants);limb(`${side}Shin`,10.2,8.8,colors.pants);
    ellipsoid(`${side}Shin`,[sx*15,98,0],[9.6,3,9.6],detail(shade(colors.pants,.82)),`${side} cuff`,5,16);
    ellipsoid(`${side}Foot`,[sx*15,109,10],[11.5,9,19],colors.shoes,`${side} shoe`,12,20);
    ellipsoid(`${side}Foot`,[sx*15,107,25],[9,6.5,6],detail(blend(colors.shoes,[255,255,255],.14)),`${side} toe`,8,14);
    ellipsoid(`${side}Foot`,[sx*15,118.5,10.5],[9.6,2.5,16.6],sole,`${side} sole`,8,22);
    ellipsoid(`${side}UpperArm`,[sx*28.5,-62,0],[10.5,10,10.5],colors.shirt,`${side} shoulder`,10,16);
    limb(`${side}UpperArm`,9.2,8.6,colors.shirt,`${side} sleeve`);
    limb(`${side}Forearm`,6.8,6,colors.skin,`${side} forearm`);
    ellipsoid(`${side}Forearm`,[sx*30,17,1],[7.2,9.5,6.4],colors.skin,`${side} hand`,10,16);
    ellipsoid(`${side}Forearm`,[sx*25.6,12,5],[3,5,3],colors.skin,`${side} thumb`,6,10);
  }
  ellipsoid('head',[0,-76,0],[8,9,8],colors.skin,'Neck',8,14);
  const head=[0,-108,1],hr=[35,34,32];
  // Points on the face follow the head's ellipsoid so features sit on its surface.
  const onFace=(x,y,lift=0)=>[x,y,head[2]+hr[2]*Math.sqrt(Math.max(0,1-((x-head[0])/hr[0])**2-((y-head[1])/hr[1])**2))+lift];
  ellipsoid('head',head,hr,colors.skin,'Head',16,28);
  for(const sx of [-1,1]){ellipsoid('head',[sx*34,-104,0],[4.5,8,6],colors.skin,'Ear',8,12);ellipsoid('head',[sx*35.5,-104,0],[2,5,3.5],detail(shade(colors.skin,.82)),'Ear',6,10);}
  // Hair cap: a forehead hairline in front, above the ears at the sides, down to the nape behind.
  surface('head',head,colors.hair,(u,v)=>{const theta=v*Math.PI*2,front=Math.sin(theta),side=Math.cos(theta)**2,max=front>0?1.5-.48*front+.06*Math.sin(theta*7)*front:1.5-.62*front,phi=u*(max-.12*side*Math.max(0,front)),grow=1.05+.06*Math.cos(phi*.9)**2;
    return[head[0]+hr[0]*grow*Math.sin(phi)*Math.cos(theta),head[1]-hr[1]*1.07*Math.cos(phi)-2,head[2]+hr[2]*grow*Math.sin(phi)*Math.sin(theta)];},16,32,'Hair');
  ellipsoid('head',[-8,-136,16],[19,8,13],colors.hair,'Fringe',8,16);
  const lift=(x,y,n)=>onFace(x,y,n);
  for(const sx of [-1,1]){
    const eye=lift(sx*12.5,-106,-2.4);
    ellipsoid('head',eye,[7.4,9.6,3.6],detail([255,252,246]),'Eye white',10,16);
    ellipsoid('head',[eye[0]+sx*.4,eye[1]+.6,eye[2]+2.3],[5.2,6.6,1.6],detail(colors.iris),'Iris',8,14);
    ellipsoid('head',[eye[0]+sx*.4,eye[1]+.8,eye[2]+3.4],[2.9,3.8,1.1],detail([28,30,36]),'Pupil',8,12);
    ellipsoid('head',[eye[0]+sx*.4+1.8,eye[1]-2.6,eye[2]+4.3],[1.5,1.8,.7],detail([255,255,255]),'Eye glint',6,10);
    ellipsoid('head',lift(sx*13,-119.5,.6),[7.2,1.8,1.6],detail(shade(colors.hair,.9)),'Brow',6,12);
    ellipsoid('head',lift(sx*21,-95,-.9),[6,3.4,1.2],detail(blend(colors.skin,[240,120,120],.32)),'Cheek',6,12);
  }
  ellipsoid('head',lift(0,-98,.4),[3.4,3,3.2],shade(colors.skin,.94),'Nose',8,12);
  // The mouth is a short tube on the face: a curve up for happy, flat for neutral, down for sad.
  const curve=expression==='happy'?-3.4:expression==='sad'?2.6:0,half=expression==='neutral'?5:7.5;
  surface('head',onFace(0,-88),detail([150,72,66]),(u,v)=>{const x=(v*2-1)*half,y=-88+curve*(x/half)**2,c=onFace(x,y),a=u*Math.PI*2;return[c[0],y+1.4*Math.cos(a),c[2]-.6+1.4*Math.sin(a)];},6,14,'Mouth');
  if(expression==='happy')ellipsoid('head',lift(0,-86.4,-.8),[4.2,1.8,1],detail([255,248,236]),'Smile',6,12);
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
  const acting=ACTION_MOTIONS.includes(options.action);
  if(acting&&options.target!==undefined)throw new Error('3D strikes aim along the character’s heading; target is available for 2D characters.');
  if(acting&&options.facing!==undefined&&![1,-1].includes(options.facing))throw new Error('facing is 1 or -1 for jump, punch, kick or hit motion.');
  const validateView=view=>{if(!view||typeof view!=='object'||Array.isArray(view))throw new Error('view must be an object.');for(const key of Object.keys(view))if(!['yaw','pitch','roll','headYaw','headPitch','orbitYaw','orbitPitch','perspective','distance'].includes(key))throw new Error(`Unknown orbit view: ${key}`);const {orbitYaw,orbitPitch,...native}=view;characterViewPose(figure,object,native);if(orbitYaw!==undefined)finite(orbitYaw,'orbitYaw',-Math.PI*4,Math.PI*4);if(orbitPitch!==undefined)finite(orbitPitch,'orbitPitch',-Math.PI/2+.05,Math.PI/2-.05);};
  if(options.view)validateView(options.view);if(options.viewTo)validateView(options.viewTo);
  const sourceView=characterView(figure,object),direction=acting?1:Math.sign(options.distance??0)||1;
  const turning=options.action==='turn';
  const moving=['walk','run'].includes(options.action??'walk')||options.action==='carry'&&Math.abs(options.distance??0)>1e-6;
  const standing=!moving&&!turning&&!acting&&options.action!=='putDown'&&!(options.carry?.weight>0);
  // Actions are planned in the body's own sagittal plane: forward is the heading, `facing` picks a profile.
  const base={...sourceView,yaw:moving?direction*Math.PI/2:acting&&options.facing!==undefined?options.facing*Math.PI/2:sourceView.yaw,orbitYaw:0,orbitPitch:0,...options.view},end={...base,...options.viewTo};
  const ids=role=>roles.get(role).segment.segment_id,restAngles=[-Math.PI/2,-Math.PI/2,-Math.PI/2,1.12,1.3,2.02,1.84,1.3,1.52,1.84,1.62,0,0];
  const proxy={figure_type_id:figure.figure_type_id,name:figure.name,segments:[{...figure.segments[0],_stykRig:undefined},...anatomy.map((role,i)=>{
    const s=roles.get(role).segment,parent=[0,ids('spine0'),ids('spine1'),ids('spine1'),ids('leftUpperArm'),ids('spine1'),ids('rightUpperArm'),0,ids('leftThigh'),0,ids('rightThigh'),ids('leftShin'),ids('rightShin')][i];
    return {...s,parent_id:parent,angle_rad:restAngles[i],length:Math.hypot(...s._stykRig.spatial.tip.map((n,i)=>n-s._stykRig.spatial.origin[i])),_stykRig:undefined,...(role==='head'?{segment_type:'circle',segment_kind:'circleFill',primitive_code:3,flags:3}:{})};
  })],polyfills:[],image_assets:[],text_assets:[],_styk:{footSole:18}};
  const proxyObject=createObject(proxy,object.unique_id,object.root_x,object.root_y,{scale:object.scale}),{view,viewTo,cloth,collisions=options.action!=='reach'&&!figure._styk?.stickStyle,...motionOptions}=options;
  if(typeof collisions!=='boolean')throw new TypeError('Character collisions must be true or false.');
  const planar=planarFactory(proxy,proxyObject,{...motionOptions,...(turning?{action:'idle'}:{}),...(acting?{facing:1}:{}),rig,cloth:false},fps);
  // Action travel follows the body heading at that moment; walking uses its integrated arc-length path.
  const actionPath=(tick,yaw)=>{const s=planar.sample(tick).pose.root_x-planar.root.x;return [Math.sin(yaw)*s,0,Math.cos(yaw)*s];};
  const reachSource=options.action==='reach'?planarFactory(proxy,proxyObject,{...motionOptions,action:'idle',rig,cloth:false},fps):null;
  const meshless={...figure,_styk:{...figure._styk,spatialMesh:undefined}};
  const ik=ikLayout(figure),locomotion=createSpatialLocomotion(planar,base,end,{moving,turning,scale:object.scale,rootY:object.root_y});
  return {rig,events:planar.events,pathAt:tick=>acting?actionPath(tick,locomotion.views(tick/(planar.settings.duration-1)).yaw):locomotion.path(tick/(planar.settings.duration-1)),settings:{...planar.settings,action:turning?'turn':planar.settings.action},sample(tick){
    const sampled=planar.sample(tick),idleArms=reachSource?.sample(tick),u=tick/(planar.settings.duration-1),smooth=u*u*(3-2*u),v={};for(const key of Object.keys(base))v[key]=base[key]+(end[key]-base[key])*smooth;
    Object.assign(v,locomotion.views(u));v.torsoYaw+=sampled.twist??0;
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
    const footStates={},travel=acting?actionPath(tick,v.yaw):locomotion.path(u),sway=(moving?sampled.support:0)*2*object.scale;
    const world=[travel[0]+Math.cos(v.yaw)*sway,sampled.pose.root_y-object.root_y,travel[2]-Math.sin(v.yaw)*sway];
    if(standing){const upright=planar.ground-object.root_y-(18+103*.9995)*object.scale;world[1]+=(upright-world[1])*sampled.entry;}
    if(moving||turning||standing)for(const side of ['left','right']){
      const state=locomotion.foot(side,u);footStates[side]=state;
      const hip=quatRotate(spatialQuaternion(v.roll,v.yaw,v.pitch),[(side==='left'?15:-15)*object.scale,0,0]);
      const horizontal=Math.hypot(state.point[0]-world[0]-hip[0],state.point[2]-world[2]-hip[2]),reach=103*object.scale*(standing?.9995:moving&&options.action!=='run'&&!(options.carry?.weight>0)?.995:.985);
      if(horizontal>=reach)throw new RangeError('Turning stride exceeds leg reach; reduce step length or turn angle.');
      world[1]=Math.max(world[1],state.point[1]-hip[1]-Math.sqrt(reach*reach-horizontal*horizontal));
    }
    const path=quatRotate(cameraQ,world),depth=path[2];
    const distance=Math.max(100,v.distance),denominator=1-v.perspective*depth/(distance*object.scale);if(denominator<.1)throw new RangeError('The orbit path approaches the camera; increase distance.');
    const scale=1/denominator;pose.scale=object.scale*scale;pose.root_x=object.root_x+path[0]*scale;pose.root_y=object.root_y+path[1]*scale;
    pose._stykSpatial={...pose._stykSpatial,camera:{strength:v.perspective,distance:Math.max(100,distance-depth/object.scale),centerX:object.root_x,centerY:object.root_y}};
    const geometry=()=>buildGeometry({version:5,figure_types:[meshless]},createFrame([{...pose,object_slot:0}])).objects.get(0);
    let g=geometry(),requestedReach;
    if(moving||turning||standing){
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
    if(options.action==='putDown'&&sampled.load.lowering>0)for(const side of Object.keys(sampled.grips)){
      const id=rig[`${side}Arm`][1],chain=ikChain(figure,id,2,ik),bone=roles.get(`${side}Forearm`),p=spatialPoint(g.segments[bone.index].spatialFrame,bone.segment._stykRig.spatial.tip);
      const current=quatRotate(inverseQuaternion(cameraQ),p.map(n=>n*object.scale)).map((n,i)=>n+world[i]);
      current[1]+=(planar.ground-object.root_y-(options.carry?.loadHeight??planar.legLength*.4)-current[1])*sampled.load.lowering;
      const desired=quatRotate(cameraQ,current),raw=desired.map((n,i)=>(n-path[i])*scale),target={x:pose.root_x+raw[0],y:pose.root_y+raw[1],rotation:0},capture=captureSpatialIK(figure,pose,g,chain,[]);
      const solved=solveObjectIK(figure,pose,g.root,ik,{[id]:{enabled:true,pinned:true,allowStretch:false,bendDirection:0,chainLength:2,followers:{},target,...capture,spatialTarget:{...capture.spatialTarget,depth:raw[2]}}},{includePoints:false});
      if(solved){pose.angles=solved.angles;g=geometry();}
    }
    const corrections=[];
    if(collisions&&(options.action==='reach'||sampled.load?.weight>0||options.action==='putDown'))for(const side of ['left','right']){
      const role=`${side}Arm`,id=rig[role][1],chain=ikChain(figure,id,2,ik),torso=g.segments[roles.get('spine0').index].spatialFrame;
      const points=()=>chain.map(i=>spatialPoint(g.segments[i].spatialFrame,figure.segments[i]._stykRig.spatial.tip));
      let [elbow,wrist]=points(),contact=torsoContact(elbow,wrist,torso);
      if(!contact.penetrating)continue;
      const requested=wrist.slice(),sign=side==='left'?1:-1;
      for(let attempt=0;attempt<4&&contact.penetrating;attempt++){
        const local=contact.local.slice();local[2]=Math.max(local[2],28+attempt*5);if(attempt>1)local[0]=sign*Math.max(Math.abs(local[0]),32);
        const p=contact.world(local),target={x:pose.root_x+p[0]*pose.scale,y:pose.root_y+p[1]*pose.scale,rotation:0},capture=captureSpatialIK(figure,pose,g,chain,[]),pole=quatRotate(torso.q,[sign,1,.5]),norm=Math.hypot(...pole);
        const solved=solveObjectIK(figure,pose,g.root,ik,{[id]:{enabled:true,pinned:true,allowStretch:false,bendDirection:0,chainLength:2,followers:{},target,...capture,spatialTarget:{...capture.spatialTarget,depth:p[2]*pose.scale,pole:pole.map(v=>v/norm)}}},{includePoints:false});
        if(solved){pose.angles=solved.angles;g=geometry();}[elbow,wrist]=points();contact=torsoContact(elbow,wrist,torso);
      }
      if(contact.penetrating)throw new Error('The arm cannot clear the torso without stretching; move the target forward.');
      corrections.push({kind:'torso',hand:side,requested,actual:wrist.slice()});
    }
    const grips={},targets={};for(const [role,chain]of Object.entries({leftArm:rig.leftArm,rightArm:rig.rightArm,leftLeg:rig.leftLeg,rightLeg:rig.rightLeg})){
      const p=g.joints.get(chain[1]),actual={x:p.x,y:p.y},requested=requestedReach&&role===`${options.hand??'right'}Arm`?requestedReach:actual;
      targets[role]={actual,requested:{...requested},error:Math.hypot(actual.x-requested.x,actual.y-requested.y)};
    }
    for(const side of Object.keys(sampled.grips??{})){const p=g.joints.get(rig[`${side}Arm`][1]);grips[side]={x:p.x,y:p.y};}
    const worldGrips={};for(const side of Object.keys(grips)){const bone=roles.get(`${side}Forearm`),p=spatialPoint(g.segments[bone.index].spatialFrame,bone.segment._stykRig.spatial.tip),local=quatRotate(inverseQuaternion(cameraQ),p.map(n=>n*object.scale));worldGrips[side]=local.map((n,i)=>n+world[i]);}
    const worldFeet={},contacts={};for(const side of ['left','right']){const role=`${side}Foot`,bone=roles.get(role),frame=g.segments[bone.index].spatialFrame,p=spatialPoint(frame,[side==='left'?15:-15,121,13]);
      const point=projectSpatial([pose.root_x+p[0]*pose.scale,pose.root_y+p[1]*pose.scale,p[2]*pose.scale],projection(pose,g.root));
      const local=quatRotate(inverseQuaternion(cameraQ),p.map(n=>n*object.scale));worldFeet[side]=local.map((n,i)=>n+world[i]);
      const ankle=g.joints.get(rig[`${side}Leg`][1]);contacts[side]={...sampled.contacts[side],...(footStates[side]?{planted:footStates[side].planted}:{}),point:{x:point.x,y:point.y},ankle:{x:ankle.x,y:ankle.y}};
    }
    return {...sampled,pose,grips,contacts,targets,view:v,worldRoot:world,worldGrips,worldFeet,collisions:corrections};
  }};
}
