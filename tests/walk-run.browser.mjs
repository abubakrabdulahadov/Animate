import {chromium} from './support/playwright.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import backend from '../desktop/backend.cjs';
import {decodeDocument} from '../src/native-container.mjs';
import {createCartoonCharacter} from '../src/filled-art.mjs';
const output=path.resolve('artifacts/walk-run');await mkdir(output,{recursive:true});
let source=createCartoonCharacter().figure;
if(process.env.STYK_WALK_FIGURE){const film=await decodeDocument(await readFile(process.env.STYK_WALK_FIGURE),'styk');source=film.document.figure_types.find(f=>f.name.startsWith('Samar'))??film.document.figure_types[0];}
const service=await backend.startBackend({appRoot:process.cwd()});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const page=await browser.newPage();await page.goto(service.origin+'/api/health');
 const result=await page.evaluate(async figure=>{
  const {Editor}=await import('/src/editor.mjs'),{ExportFrameRenderer}=await import('/src/export-frame-renderer.mjs'),{createHumanMotion}=await import('/src/human-motion.mjs'),{createObject,createFrame,emptyDocument}=await import('/src/demo.mjs');
  figure.figure_type_id=1;
  const ground={figure_type_id:2,name:'Ground',segments:[{segment_id:1,parent_id:0,length:960,angle_rad:0,bend_rad:0,thickness:1.3,primitive_code:0,aux_code:0,flags:0,segment_type:'line',segment_kind:'line',visible:true,color_rgb:[168,178,178]}],polyfills:[],image_assets:[],text_assets:[]};
  const r=emptyDocument();r.canvas_width=960;r.canvas_height=540;r.fps=24;r.figure_types=[figure,ground];r.backgrounds=[{background_id:1,kind:2,color:0xffe9e9e3}];r.keyframes=[];r._styk.name='Turish, yurish va yugurish';
  for(const [action,x,distance]of[['idle',460,0],['walk',240,350],['run',120,680]]){
   const m=createHumanMotion(figure,createObject(figure,1,x,350,{scale:1.4}),{action,duration:72,distance,groundY:480});
   for(let tick=0;tick<72;tick++){const f=createFrame([createObject(ground,2,0,480),m.sample(tick).pose]);f.background_id=1;r.keyframes.push(f);}
  }
  const renderer=new ExportFrameRenderer({width:960,height:540});await renderer.load(r);const images=[];
  for(const [name,tick]of[['standing',24],['walking',108],['running',173]]){const canvas=await renderer.renderTick(tick);images.push({name,url:canvas.toDataURL('image/png')});}renderer.dispose();
  const e=new Editor({demo:false});e.importFigure(figure);const before=e.serialize();await e.applyHumanMotion({action:'run',duration:72,distance:260});const baked=e.serialize(),controller=new AbortController(),pending=e.applyHumanMotion({action:'run',duration:400,distance:500},{signal:controller.signal});controller.abort();let cancelled=false;try{await pending;}catch(error){cancelled=error.name==='AbortError';}if(!cancelled||JSON.stringify(e.serialize())!==JSON.stringify(baked))throw new Error('Run cancellation published partial work.');e.undo();if(JSON.stringify(e.serialize())!==JSON.stringify(before))throw new Error('Running did not undo completely.');
  const spatial=new Editor({demo:false});spatial.setCanvasSize(960,540);spatial.setBackgroundColor(0xffe9e9e3);spatial.addCartoonCharacter({dimension:'3d',position:{x:400,y:350}});const painter=new ExportFrameRenderer({width:960,height:540});
  for(const action of['idle','walk','run']){await spatial.applyHumanMotion({action,duration:72,...(action==='idle'?{}:{distance:240}),groundY:480,view:{yaw:.9}});await painter.load(spatial.report);images.push({name:`spatial-${action}`,url:(await painter.renderTick(35)).toDataURL('image/png')});}painter.dispose();
  return {images,project:r,cancelled,frames:r.keyframes.length};
 },source);
 assert.ok(result.cancelled);assert.equal(result.frames,216);for(const{name,url}of result.images)await writeFile(path.join(output,`${name}.png`),Buffer.from(url.split(',')[1],'base64'));await writeFile(path.join(output,'demo-project.json'),JSON.stringify(result.project));delete result.images;delete result.project;await writeFile(path.join(output,'browser-report.json'),JSON.stringify({...result,gpuDisabled:true},null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();service.stop();}
