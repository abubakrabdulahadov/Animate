import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {AgentSession} from './agent-session.mjs';
import {AgentEngine} from '../src/agent-engine.mjs';
import {createObject,createFrame,emptyDocument} from '../src/demo.mjs';
import {compileTextFigure,parseTextFont} from '../src/text-authoring.mjs';

const directory=fileURLToPath(new URL('../artifacts/human-motion/',import.meta.url));
await mkdir(directory,{recursive:true});
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const segments=[];
function bone(parent,length,angle,color='#e8e5d8',thickness=9,extra={}){
  const id=segments.length+1;segments.push({segment_id:id,parent_id:parent,length,angle_rad:angle,thickness,
    bend_rad:0,primitive_code:0,aux_code:0,flags:0,segment_type:'line',segment_kind:'line',color_rgb:rgb(color),transparency:0,visible:thickness>0,z_order:id,...extra});return id;
}
bone(0,30,-Math.PI/2,'#6fb8b2',16,{name:'Lower spine'});
bone(1,45,-Math.PI/2,'#6fb8b2',16,{name:'Chest'});
bone(2,38,-Math.PI/2,'#fff0cf',0,{name:'Head',primitive_code:3,flags:3,segment_type:'circle',segment_kind:'circleFill',visible:true});
bone(2,52,1.05,'#efede0',9,{name:'Left upper arm'});bone(4,46,1.32,'#efede0',8,{name:'Left forearm'});
bone(2,52,2.09,'#9dbdb9',9,{name:'Right upper arm'});bone(6,46,1.82,'#9dbdb9',8,{name:'Right forearm'});
bone(0,65,1.18,'#efede0',10,{name:'Left thigh'});bone(8,62,1.5,'#efede0',9,{name:'Left shin'});
bone(0,65,1.96,'#9dbdb9',10,{name:'Right thigh'});bone(10,62,1.64,'#9dbdb9',9,{name:'Right shin'});
bone(9,18,0,'#efede0',9,{name:'Left foot'});bone(11,18,0,'#9dbdb9',9,{name:'Right foot'});
bone(2,32,2.95,'#e58a77',11,{name:'Scarf'});bone(14,20,3.3,'#e58a77',8,{name:'Scarf tail'});
bone(3,Math.hypot(9,20),Math.atan2(20,9),'#fff0cf',0,{name:'Face anchor'});
bone(16,3.2,-Math.PI/2,'#172c3a',0,{name:'Eye',primitive_code:3,flags:3,segment_type:'circle',segment_kind:'circleFill',visible:true});
const figure={figure_type_id:1,name:'Nur / humanoid',segments,segment_count:segments.length,polyfills:[],image_assets:[],text_assets:[]};
const rig={spine:[1,2],head:3,leftArm:[4,5],rightArm:[6,7],leftLeg:[8,9],rightLeg:[10,11],leftFoot:12,rightFoot:13};
const font=parseTextFont(await readFile(new URL('../vendor/text/NotoSans-Regular.ttf',import.meta.url))).font;
const figures=[figure];
function text(text,size,color,x,y,uid){const f=compileTextFigure({text,fontSize:size,color:rgb(color),figureTypeId:figures.length+1},font);figures.push(f);return ()=>createObject(f,uid,x,y);}
const title=text('INSONGA YAQIN HARAKAT',32,'#f3d7a3',65,65,100);
const oldLabel=text('Oddiy tebranish',24,'#98a8b6',70,155,101);
const newLabel=text('Tayanchli, tabiiy qadam',24,'#7bd0c2',710,155,102);
const idleLabel=text('NAFAS VA MUVOZANAT',24,'#7bd0c2',460,155,103);
const waveLabel=text('YUMSHOQ QO\'L HARAKATI',24,'#7bd0c2',440,155,104);
const reachLabel=text('TABIYIY UZATISH',24,'#7bd0c2',490,155,105);
const footer=text('Tayanch oyoq joyida. Bel, qo\'l va bosh birga ishlaydi.',20,'#a4bcc5',65,650,106);
const floorSegments=[];
const addLine=(x,y,x2,y2,color,width)=>{
  const id=floorSegments.length+1;floorSegments.push({segment_id:id,parent_id:0,length:Math.hypot(x,y),angle_rad:Math.atan2(y,x),thickness:0,bend_rad:0,primitive_code:0,aux_code:1,flags:256,segment_type:'line',segment_kind:'line',color_rgb:rgb(color),transparency:0,visible:false,z_order:id});
  floorSegments.push({...floorSegments[0],segment_id:id+1,parent_id:id,length:Math.hypot(x2-x,y2-y),angle_rad:Math.atan2(y2-y,x2-x),thickness:width,visible:true,color_rgb:rgb(color),z_order:id+1});
};
addLine(45,554,1235,554,'#55717e',2);for(let x=50;x<1240;x+=40)addLine(x,559,x,565,'#2f4b5a',1);
const floor={figure_type_id:figures.length+1,name:'Ground contact reference',segments:floorSegments,segment_count:floorSegments.length,polyfills:[],image_assets:[],text_assets:[]};figures.push(floor);
const report=emptyDocument();report.canvas_width=1280;report.canvas_height=720;report.fps=24;report.figure_types=figures;
report.backgrounds=[{background_id:1,kind:3,x1:0,y1:0,x2:0,y2:1,color_a:0xff101b2b,color_b:0xff203f4c}];
report.keyframes=Array.from({length:432},(_,tick)=>{
  const seconds=tick/24,walking=tick<144,objects=[createObject(floor,3,0,0),title(),footer()];
  if(walking){
    const old=createObject(figure,1,160+300*tick/143,426),phase=seconds*7,swing=Math.sin(phase)*.55;
    old.angles[7]=Math.PI/2+swing;old.angles[8]=Math.PI/2+swing*.6;
    old.angles[9]=Math.PI/2-swing;old.angles[10]=Math.PI/2-swing*.6;
    old.angles[3]=Math.PI/2-swing;old.angles[4]=Math.PI/2-swing;
    old.angles[5]=Math.PI/2+swing;old.angles[6]=Math.PI/2+swing;
    objects.push(old,oldLabel(),newLabel());
  }else objects.push(tick<240?idleLabel():tick<336?waveLabel():reachLabel());
  objects.push(createObject(figure,2,walking?800:640,426));
  const frame=createFrame(objects,1);frame.background_id=1;frame._styk={easing:{interpolation:'constant'}};return frame;
});
const session=new AgentSession({directory,engine:new AgentEngine({document:report,name:'Natural human motion'})});
const metrics=[];
for(const options of [
  {action:'walk',start:0,duration:144,distance:300,groundY:550,rig},
  {action:'idle',start:144,duration:96,rig},
  {action:'wave',start:240,duration:96,hand:'left',rig},
  {action:'reach',start:336,duration:96,hand:'left',target:{x:715,y:370},rig},
]){
  const start=performance.now();
  const value=await session.invoke('editor_applyHumanMotion',{args:[options],selection:{uid:2},at:{tick:options.start}});
  metrics.push({action:options.action,frames:value.value.frames,totalMs:performance.now()-start});
}
await session.invoke('project_save',{path:'natural-human-motion.styk'});
await session.invoke('project_export',{path:'natural-human-motion.mp4'});
execFileSync('ffmpeg',['-v','error','-y','-i',path.join(directory,'natural-human-motion.mp4'),'-vf','fps=1/1.5,scale=426:240,tile=3x4','-frames:v','1',path.join(directory,'contact-sheet.jpg')]);
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-of','json',path.join(directory,'natural-human-motion.mp4')],{encoding:'utf8'}));
assert.equal(Number(probe.streams[0].nb_read_frames),432);assert.equal(probe.streams[0].width,1280);assert.equal(probe.streams[0].r_frame_rate,'24/1');
await writeFile(path.join(directory,'report.json'),JSON.stringify({metrics,video:probe.streams[0]},null,2));
console.log(JSON.stringify(metrics,null,2));
