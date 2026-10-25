import {defaultFigure} from './demo.mjs';
import {buildSpatialCartoon} from './spatial-character.mjs';

const color=value=>{if(typeof value==='string'&&/^#[a-f\d]{6}$/i.test(value))value=[1,3,5].map(i=>parseInt(value.slice(i,i+2),16));if(!Array.isArray(value)||value.length!==3||value.some(v=>!Number.isInteger(v)||v<0||v>255))throw new Error('Choose a six-digit hex or RGB fill color.');return [...value];};
const finite=(n,key,min,max)=>{if(!Number.isFinite(n)||n<min||n>max)throw new RangeError(`${key} must be between ${min} and ${max}.`);return n;};
const keys=(o,allowed)=>{if(!o||typeof o!=='object'||Array.isArray(o))throw new TypeError('Filled artwork options must be an object.');for(const k of Object.keys(o))if(!allowed.includes(k))throw new Error(`Unknown filled artwork option: ${k}`);};
const name=(value,fallback)=>{value??=fallback;if(typeof value!=='string'||!value.trim()||value.length>120)throw new Error('Choose a name of 1–120 characters.');return value;};

/** Native filled contours over hidden controls, with no raster or special painter. */
function artist(figure) {
  let next=figure.segments.length+1,polygon=1;
  const vertex=(parent,x,y)=>{
    const id=next++;
    figure.segments.push({segment_id:id,parent_id:parent,length:Math.hypot(x,y),angle_rad:Math.atan2(y,x),thickness:0,bend_rad:0,primitive_code:0,aux_code:0,flags:0,segment_type:'line',segment_kind:'line',visible:false,color_rgb:[0,0,0],transparency:0,z_order:0,name:'Artwork control'});
    return id;
  };
  const fill=(points,tint,z,parent=0,opacity=1)=>{
    const ids=points.map(p=>vertex(p.parent??parent,p.x??p[0],p.y??p[1]));
    figure.polyfills.push({polyfill_id:polygon++,segment_ids:ids,segment_ids_raw:[...ids],vertex_id_space:'joint_tip_ids',color_rgb:color(tint),alpha_raw:Math.round((1-opacity)*255),z_order:z});
  };
  const ellipse=(parent,x,y,rx,ry,tint,z,steps=24)=>fill(Array.from({length:steps},(_,i)=>[x+Math.cos(i*Math.PI*2/steps)*rx,y+Math.sin(i*Math.PI*2/steps)*ry]),tint,z,parent);
  const finish=()=>{figure.segment_count=figure.segments.length;figure._styk={...figure._styk,nextPolygonId:polygon};return figure;};
  return {vertex,fill,ellipse,finish};
}

function roundedBox(width,height,radius,steps=6) {
  const points=[];
  for(const [x,y,start]of [[width/2-radius,-height/2+radius,-Math.PI/2],[width/2-radius,height/2-radius,0],[-width/2+radius,height/2-radius,Math.PI/2],[-width/2+radius,-height/2+radius,Math.PI]])
    for(let i=0;i<=steps;i++){const a=start+i*Math.PI/2/steps;points.push([x+Math.cos(a)*radius,y+Math.sin(a)*radius]);}
  return points;
}

export function createFilledShape(options={}) {
  keys(options,['shape','width','height','radius','color','opacity','name','tail']);
  const shape=options.shape??'roundedRect';if(!['roundedRect','pill','ellipse','star','speechBubble'].includes(shape))throw new Error('Choose roundedRect, pill, ellipse, star or speechBubble.');
  const width=finite(options.width??180,'width',2,10000),height=finite(options.height??64,'height',2,10000);
  const radius=finite(options.radius??Math.min(18,width/2,height/2),'radius',0,Math.min(width,height)/2),opacity=finite(options.opacity??1,'opacity',0,1),tint=color(options.color??'#658fce');
  if(options.tail!==undefined&&!['left','right'].includes(options.tail))throw new Error('Speech bubble tail must be left or right.');
  const figure={figure_type_id:1,name:name(options.name,`Filled ${shape}`),segments:[],polyfills:[],image_assets:[],text_assets:[]},draw=artist(figure);let points;
  if(shape==='ellipse')points=Array.from({length:64},(_,i)=>[Math.cos(i*Math.PI/32)*width/2,Math.sin(i*Math.PI/32)*height/2]);
  else if(shape==='star')points=Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,r=i%2?.44:1;return[Math.cos(a)*width/2*r,Math.sin(a)*height/2*r];});
  else if(shape==='speechBubble'){
    const body=height*.78,r=Math.min(radius,width*.18,body*.18),shift=-(height-body)/2;
    points=roundedBox(width,body,r).map(([x,y])=>[x,y+shift]);
    const index=14,center=(options.tail==='right'?.18:-.18)*width;
    points.splice(index,0,[center+width*.08,body/2+shift],[center-width*.025,height/2],[center-width*.08,body/2+shift]);
  }else points=roundedBox(width,height,shape==='pill'?Math.min(width,height)/2:radius);
  draw.fill(points,tint,0,0,opacity);return draw.finish();
}

/** A complete two-spine planar humanoid. All visible artwork is native fill. */
export function createCartoonCharacter(options={}) {
  keys(options,['name','palette','expression','dimension']);
  const palette=options.palette??{};keys(palette,['skin','shirt','pants','shoes','hair','iris']);
  const colors={skin:color(palette.skin??'#efc49c'),shirt:color(palette.shirt??'#68a6a0'),pants:color(palette.pants??'#405d81'),shoes:color(palette.shoes??'#26384e'),hair:color(palette.hair??'#554035'),iris:color(palette.iris??'#34505d')};
  const expression=options.expression??'happy';if(!['happy','neutral','sad'].includes(expression))throw new Error('Choose happy, neutral or sad.');
  const dimension=options.dimension??'2d';if(!['2d','3d'].includes(dimension))throw new Error('Choose 2d or 3d character artwork.');
  if(dimension==='3d')return buildSpatialCartoon({name:name(options.name,'Spatial cartoon character'),colors,expression});
  const figure=defaultFigure(1);figure.name=name(options.name,'Cartoon character');figure.polyfills=[];
  const specs=[
    [0,27,-Math.PI/2,'Lower spine'],[1,42,-Math.PI/2,'Chest'],[2,50,-Math.PI/2,'Head'],
    [2,38,1.12,'Left upper arm'],[4,35,1.30,'Left forearm'],[2,38,2.02,'Right upper arm'],[6,35,1.84,'Right forearm'],
    [0,53,1.30,'Left thigh'],[8,50,1.52,'Left shin'],[0,53,1.84,'Right thigh'],[10,50,1.62,'Right shin'],
    [9,18,0,'Left foot'],[11,18,0,'Right foot'],
  ];
  const template=figure.segments[0];figure.segments=specs.map(([parent,length,angle,label],i)=>({...template,segment_id:i+1,parent_id:parent,length,angle_rad:angle,thickness:0,visible:false,name:label,
    ...(i===2?{primitive_code:3,flags:3,segment_type:'circle',segment_kind:'circleFill',transparency:255}:{})}));
  const draw=artist(figure),rig={spine:[1,2],head:3,leftArm:[4,5],rightArm:[6,7],leftLeg:[8,9],rightLeg:[10,11],leftFoot:12,rightFoot:13};
  const limb=(handle,width,tint,z)=>{
    const s=figure.segments[handle-1],a=s.angle_rad,r=width/2,points=[];
    for(const [cx,start]of [[0,-Math.PI/2],[-s.length,Math.PI/2]])for(let i=0;i<=10;i++){
      const t=start+i*Math.PI/10,x=cx+Math.cos(t)*r,y=Math.sin(t)*r;
      points.push([Math.cos(a)*x-Math.sin(a)*y,Math.sin(a)*x+Math.cos(a)*y]);
    }
    draw.fill(points,tint,z,handle);
  };
  // Far limbs precede the torso; same-color rounded ends cover the elbow/knee seams.
  limb(10,27,colors.pants,1);limb(11,24,colors.pants,2);draw.ellipse(13,-8,3,23,12,colors.shoes,3);
  limb(6,23,colors.shirt,4);limb(7,19,colors.skin,5);draw.ellipse(7,0,0,11,12,colors.skin,6);
  limb(8,29,colors.pants,7);limb(9,25,colors.pants,8);draw.ellipse(12,-8,3,23,12,colors.shoes,9);
  draw.fill(roundedBox(54,27,10).map(([x,y])=>[x,y+2]),colors.pants,10);
  // Upper vertices follow the chest; lower vertices follow the pelvis.
  draw.fill([
    {parent:2,x:-18,y:-3},{parent:2,x:-29,y:4},{parent:2,x:-32,y:17},
    {parent:0,x:-27,y:-7},{parent:0,x:-27,y:10},{parent:0,x:-18,y:14},
    {parent:0,x:18,y:14},{parent:0,x:27,y:10},{parent:0,x:27,y:-7},
    {parent:2,x:32,y:17},{parent:2,x:29,y:4},{parent:2,x:18,y:-3},
  ],colors.shirt,11);
  draw.ellipse(2,0,1,11,10,colors.skin,12);
  limb(4,25,colors.shirt,13);limb(5,20,colors.skin,14);draw.ellipse(5,0,0,12,12,colors.skin,15);draw.ellipse(5,8,-4,5,7,colors.skin,16);
  draw.ellipse(3,-28,27,7,9,colors.skin,20);draw.ellipse(3,28,27,7,9,colors.skin,20);
  draw.ellipse(3,0,25,29,29,colors.skin,21,40);
  draw.fill([[-28,24],[-30,13],[-24,-1],[-13,-8],[5,-9],[21,-4],[29,7],[25,17],[17,12],[11,7],[3,13],[-10,17],[-19,14],[-22,28]],colors.hair,22,3);
  for(const x of [-9,10]){
    draw.ellipse(3,x,26,5.5,7,'#fff9ed',23,18);draw.ellipse(3,x+1.4,27,2.7,4.1,colors.iris,24,16);draw.ellipse(3,x+2,25.7,.9,1.3,'#ffffff',25,12);
    const brow=roundedBox(12,2.6,1.3).map(([xx,y])=>[xx+x,y+15+(expression==='sad'?(xx/12)*(x<0?-3:3):0)]);draw.fill(brow,colors.hair,26,3);
  }
  draw.ellipse(3,2,33,3.8,2.6,'#dcaa83',27,16);
  if(expression==='happy'){draw.ellipse(3,1,41,9,4.8,'#874c44',28,24);draw.fill(roundedBox(12,2.2,1).map(([x,y])=>[x+1,y+38.2]),'#fff7e7',29,3);}
  else if(expression==='neutral')draw.fill(roundedBox(11,2.2,1).map(([x,y])=>[x+1,y+41]),'#874c44',28,3);
  else draw.fill([[-8,42],[-3,38],[4,38],[10,42],[8,43],[3,41],[-2,41],[-6,43]],'#874c44',28,3);
  draw.finish();figure._styk.footSole=15;
  return {figure,rig};
}
