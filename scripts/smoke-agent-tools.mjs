import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {AgentSession} from './agent-session.mjs';
import {pcmWave} from '../src/audio-pcm.mjs';

const directory=fileURLToPath(new URL('../artifacts/agent-tools-smoke/',import.meta.url));
await mkdir(directory,{recursive:true});
const session=new AgentSession({directory});
await session.invoke('editor_updateProject',{args:[{canvas_width:320,canvas_height:240,fps:12}]});
await session.invoke('editor_addSegment',{args:[{length:80,angle:0,thickness:3,start:{x:65,y:175}}],selection:{uid:null}});
await session.invoke('editor_addSegments',{args:[[{parentId:1,length:60,angle:-2.2,thickness:3},{parentId:0,length:45,angle:-1.2,thickness:3}]]});
await session.invoke('editor_addPolygon',{args:[[0,1,2],{color:'#ffbb55'}]});
await session.invoke('asset_text',{options:{text:'ENGINE TOOLS',fontSize:23,bold:true,color:[50,70,90]},position:{x:65,y:58}});
execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=0x67BBBB:s=16x16','-frames:v','1',path.join(directory,'sprite.png')]);
await session.invoke('asset_image',{path:'sprite.png',position:{x:265,y:165}});
for(let i=1;i<12;i++){
  await session.invoke('editor_duplicateFrame');
  await session.invoke('editor_moveSelection',{args:[7,0],selection:{uid:1}});
  await session.invoke('editor_rotateFigure',{args:[-.035]});
}
const samples=Float32Array.from({length:48000},(_,i)=>Math.sin(i/48000*2*Math.PI*440)*.2);
await writeFile(path.join(directory,'tone.wav'),new Uint8Array(await pcmWave([samples]).arrayBuffer()));
await session.invoke('asset_audio',{path:'tone.wav',start:0});
await session.invoke('project_save',{path:'shapes.styk'});
await session.invoke('project_open',{path:'shapes.styk'});
await session.invoke('project_preview',{path:'preview.png',tick:6});
await session.invoke('project_preview',{path:'preview.svg',tick:6});
assert.ok((await readFile(path.join(directory,'preview.svg'),'utf8')).includes('<svg'));
const results=[];
for(const format of ['mp4','webm']){
  const filename=path.join(directory,`shapes.${format}`);
  await session.invoke('project_export',{path:filename});
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-of','json',filename],{encoding:'utf8'}));
  const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
  assert.equal(Number(video.nb_read_frames),12);assert.equal(video.width,320);assert.equal(video.height,240);
  assert.ok(audio,'Export must contain the native project soundtrack.');assert.equal(audio.channels,2);
  const pcm=execFileSync('ffmpeg',['-v','error','-i',filename,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);
  let energy=0;for(let i=0;i<pcm.length;i+=4)energy+=pcm.readFloatLE(i)**2;
  const rms=Math.sqrt(energy/(pcm.length/4));assert.ok(rms>.05,'Decoded soundtrack must be audible.');
  results.push({format,video:video.codec_name,audio:audio.codec_name,frames:Number(video.nb_read_frames),rms});
}
await session.invoke('project_export',{path:'range.mp4',options:{start:3,end:9,audio:false,width:160,height:120}});
const range=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-of','json',path.join(directory,'range.mp4')],{encoding:'utf8'}));
assert.equal(Number(range.streams[0].nb_read_frames),6);assert.equal(range.streams[0].width,160);assert.equal(range.streams.length,1);
await writeFile(path.join(directory,'report.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
