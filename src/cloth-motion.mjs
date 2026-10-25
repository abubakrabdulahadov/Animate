import {buildGeometry} from './pivot/geometry.mjs';
import {createFrame} from './demo.mjs';
import {snapshotPoseObject} from './pose-snapshot.mjs';

export const CLOTH_LIMITS=Object.freeze({vertices:2048,triangles:4096,meshes:16});
const finite=(n,name,min,max)=>{if(!Number.isFinite(n)||n<min||n>max)throw new RangeError(`${name} must be between ${min} and ${max}.`);return n;};
const whole=(n,name,min,max)=>{finite(n,name,min,max);if(!Number.isInteger(n))throw new RangeError(`${name} must be an integer.`);return n;};
const keys=(o,allowed)=>{if(!o||typeof o!=='object'||Array.isArray(o))throw new TypeError('Cloth options must be an object.');for(const k of Object.keys(o))if(!allowed.includes(k))throw new Error(`Unknown cloth option: ${k}`);};
const color=value=>{if(typeof value==='string'&&/^#[a-f\d]{6}$/i.test(value))value=[1,3,5].map(i=>parseInt(value.slice(i,i+2),16));if(!Array.isArray(value)||value.length!==3||value.some(n=>!Number.isInteger(n)||n<0||n>255))throw new Error('Choose an RGB or hex cloth color.');return value;};

/** Compile editable native handles and triangle fills; no new rendering format. */
export function appendCloth(figure,options={}) {
  keys(options,['preset','anchorId','length','width','endWidth','angle','offset','rows','columns','spacing','color','opacity','zOrder']);
  const preset=options.preset??'scarf';if(!['scarf','cape','skirt'].includes(preset))throw new Error('Choose scarf, cape or skirt.');
  const defaults=preset==='scarf'?[120,18,14,Math.PI,3]:preset==='cape'?[150,65,120,Math.PI/2,6]:[100,65,120,Math.PI/2,6];
  const length=finite(options.length??defaults[0],'length',1,10000),width=finite(options.width??defaults[1],'width',1,10000),endWidth=finite(options.endWidth??defaults[2],'endWidth',1,10000);
  const angle=finite(options.angle??defaults[3],'angle',-Math.PI*20,Math.PI*20),spacing=finite(options.spacing??6,'spacing',1,500);
  const rows=whole(options.rows??Math.max(8,Math.min(128,Math.ceil(length/spacing))),'rows',2,128),columns=whole(options.columns??defaults[4],'columns',2,12);
  if((rows+1)*(columns+1)>CLOTH_LIMITS.vertices||rows*columns*2>CLOTH_LIMITS.triangles)throw new RangeError('Reduce cloth rows or columns.');
  const meshes=clothMeshes(figure);if(meshes.length>=CLOTH_LIMITS.meshes)throw new RangeError('A figure supports at most sixteen cloth meshes.');
  const anchorId=options.anchorId??0;if(!Number.isInteger(anchorId)||anchorId!==0&&!figure.segments.some(s=>s.segment_id===anchorId))throw new Error('Choose an existing cloth anchor handle.');
  if(figure.segments.find(s=>s.segment_id===anchorId)?._stykCloth)throw new Error('Attach cloth to an ordinary figure handle.');
  if(figure.segments.some(s=>s._stykRig)||figure._styk?.animationOrigin)throw new Error('Cloth currently needs an ordinary planar figure.');
  const offset=options.offset??{x:0,y:0};keys(offset,['x','y']);finite(offset.x,'offset.x',-10000,10000);finite(offset.y,'offset.y',-10000,10000);
  const tint=color(options.color??'#bf6b60'),opacity=finite(options.opacity??1,'opacity',0,1);
  const orders=[0,...figure.segments.map(s=>s.z_order??0),...(figure.polyfills??[]).map(p=>p.z_order??0)];
  const z=finite(options.zOrder??(preset==='skirt'?Math.max(...orders)+1:Math.min(...orders)-1),'zOrder',-1e6,1e6);
  if(figure.segments.length+(rows+1)*(columns+1)>30000||(figure.polyfills?.length??0)+rows*columns*2>20000)throw new RangeError('The cloth would exceed the figure size limit.');
  const next=structuredClone(figure),id=Math.max(0,...meshes.map(m=>m.id))+1;
  let handle=Math.max(0,...next.segments.map(s=>s.segment_id))+1,polygon=Math.max(0,...(next.polyfills??[]).map((p,i)=>p.polyfill_id??i+1), (next._styk?.nextPolygonId??1)-1)+1;
  if(handle+(rows+1)*(columns+1)-1>65535)throw new RangeError('The cloth would exceed the native handle ID limit.');
  const ids=[];
  for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++){
    const v=row/rows,u=column/columns-.5,span=width+(endWidth-width)*v;
    const x=offset.x+Math.cos(angle)*length*v-Math.sin(angle)*span*u,y=offset.y+Math.sin(angle)*length*v+Math.cos(angle)*span*u;
    ids.push(handle);next.segments.push({segment_id:handle++,parent_id:anchorId,length:Math.hypot(x,y),angle_rad:Math.atan2(y,x),thickness:0,bend_rad:0,primitive_code:0,aux_code:0,flags:0,segment_type:'line',segment_kind:'line',visible:false,color_rgb:[...tint],transparency:0,z_order:z,
      name:`${preset} ${row}:${column}`,_stykCloth:{id,row,column,rows,columns}});
  }
  next.polyfills??=[];
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const a=ids[row*(columns+1)+column],b=a+1,c=ids[(row+1)*(columns+1)+column],d=c+1;
    for(const vertices of [[a,c,d],[a,d,b]])next.polyfills.push({polyfill_id:polygon++,segment_ids:vertices,segment_ids_raw:[...vertices],vertex_id_space:'joint_tip_ids',color_rgb:[...tint],alpha_raw:Math.round((1-opacity)*255),z_order:z,_stykCloth:{id}});
  }
  next.segment_count=next.segments.length;next._styk={...next._styk,nextPolygonId:polygon};
  return {figure:next,mesh:{id,anchorId,rows,columns,vertices:ids.length,triangles:rows*columns*2,handleIds:ids}};
}

/** Markers contain only grid coordinates; native parents and polygon handles own all references. */
export function clothMeshes(figure) {
  const groups=new Map();
  for(const [index,s]of figure.segments.entries())if(s._stykCloth){
    const m=s._stykCloth;whole(m.id,'cloth id',1,1e9);whole(m.rows,'cloth rows',2,128);whole(m.columns,'cloth columns',2,12);whole(m.row,'cloth row',0,m.rows);whole(m.column,'cloth column',0,m.columns);
    const group=groups.get(m.id)??{id:m.id,anchorId:s.parent_id,rows:m.rows,columns:m.columns,nodes:[]};
    if(group.rows!==m.rows||group.columns!==m.columns||group.anchorId!==s.parent_id||s._stykRig||s.is_static||s.aux_code&1||s.flags&256||s.segment_type!=='line'||Math.abs(s.bend_rad??0)>1e-7)throw new Error('Cloth topology changed; recreate the cloth mesh before baking.');
    group.nodes.push({index,id:s.segment_id,row:m.row,column:m.column});groups.set(m.id,group);
  }
  if(groups.size>CLOTH_LIMITS.meshes)throw new RangeError('Too many cloth meshes.');
  for(const g of groups.values()){
    if(g.nodes.length!== (g.rows+1)*(g.columns+1)||g.nodes.length>CLOTH_LIMITS.vertices||new Set(g.nodes.map(n=>`${n.row}:${n.column}`)).size!==g.nodes.length||figure.segments.some(s=>s.segment_id===g.anchorId&&s._stykCloth))throw new Error('Cloth topology changed; recreate the cloth mesh before baking.');
  }
  return [...groups.values()];
}

/** Deterministic stylized drape/flutter, rather than stateful collision physics. */
export function createClothDeformer(figure,options={}) {
  keys(options,['wind','flutter','sag','lag','frequency']);
  const wind=options.wind??{x:12,y:0};keys(wind,['x','y']);finite(wind.x,'wind.x',-200,200);finite(wind.y,'wind.y',-200,200);
  const flutter=finite(options.flutter??4,'flutter',0,50),sag=finite(options.sag??8,'sag',0,100),lag=finite(options.lag??.035,'lag',0,.2),frequency=finite(options.frequency??1.6,'frequency',0,8);
  const meshes=clothMeshes(figure);
  if(meshes.length&& (figure.segments.some(s=>s._stykRig)||figure._styk?.animationOrigin))throw new Error('Cloth currently needs an ordinary planar figure.');
  const apply=(input,time,{velocity={x:0,y:0},joints}={})=>{
    finite(time,'cloth time',0,1e8);finite(velocity.x,'velocity.x',-1e5,1e5);finite(velocity.y,'velocity.y',-1e5,1e5);
    const pose=snapshotPoseObject(input);if(!meshes.length)return pose;
    if(input.join||!Number.isFinite(input.scale)||input.scale<=0)throw new Error('Cloth baking needs an independent, positively scaled figure.');
    if(meshes.some(m=>m.nodes.some(n=>input._stykIK?.[n.id]?.enabled)))throw new Error('Disable IK on cloth control handles before baking.');
    if(time===0)return pose;
    const points=joints??buildGeometry({version:5,figure_types:[figure]},createFrame([{...input,object_slot:0}])).objects.get(0).joints;
    const scale=input.scale,entry=1-Math.exp(-time*5);
    pose.len_flag=1;pose.lengths=figure.segments.map((s,i)=>input.len_flag?input.lengths[i]:input.runtime_segments?.[i]?.length??s.length);
    for(const mesh of meshes){
      const anchor=mesh.anchorId===0?{x:input.root_x,y:input.root_y}:points.get(mesh.anchorId);
      const corner=(row,column)=>points.get(mesh.nodes.find(n=>n.row===row&&n.column===column).id);
      const a=corner(0,0),b=corner(0,mesh.columns),c=corner(mesh.rows,0),d=corner(mesh.rows,mesh.columns);
      const tx=(c.x+d.x-a.x-b.x)/2,ty=(c.y+d.y-a.y-b.y)/2,span=Math.hypot(tx,ty)||1,nx=-ty/span,ny=tx/span;
      for(const node of mesh.nodes){
        if(input.bend_flag&&Math.abs(input.bends[node.index]??0)>1e-7)throw new Error('Cloth control handles must stay straight.');
        if(node.row===0)continue;
        const v=node.row/mesh.rows,u=node.column/mesh.columns,free=v*v;
        const phase=v*Math.PI*3.5+u*.8,oscillation=Math.sin(time*frequency*Math.PI*2-phase)-Math.sin(-phase);
        const wave=flutter*oscillation*Math.sin(v*Math.PI/2)*(.6+.4*Math.sin(u*Math.PI));
        const tip=points.get(node.id),dx=(wind.x*free-Math.max(-200,Math.min(200,velocity.x))*lag*free)*entry*scale;
        const dy=(wind.y+sag-Math.max(-200,Math.min(200,velocity.y))*lag)*free*entry*scale;
        const x=tip.x+dx+nx*wave*scale,y=tip.y+dy+ny*wave*scale;
        pose.angles[node.index]=Math.atan2(y-anchor.y,x-anchor.x);pose.lengths[node.index]=Math.hypot(x-anchor.x,y-anchor.y)/scale;
      }
    }
    return pose;
  };
  return {meshes,apply};
}
