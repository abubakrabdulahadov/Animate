import {chromium} from './support/playwright.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import backend from '../desktop/backend.cjs';
const output=path.resolve('artifacts/weighted-scene');await mkdir(output,{recursive:true});const service=await backend.startBackend({appRoot:process.cwd()});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const page=await browser.newPage();await page.goto(service.origin+'/api/health');
 const result=await page.evaluate(async()=>{
  const {Editor}=await import('/src/editor.mjs'),{ExportFrameRenderer}=await import('/src/export-frame-renderer.mjs');
  const e=new Editor({demo:false});e.setCanvasSize(960,540);e.setBackgroundColor(0xffe7dfce);
  e.addSpatialScene({name:'A careful delivery',position:{x:480,y:285},actors:[{name:'Aziz',position:[-150,0,0],palette:{shirt:'#508c8a',pants:'#435e7b'}}],boxes:[{name:'Stone floor',position:[0,131,0],size:[1100,20,1000],color:[151,160,147]},{name:'Crate',size:[60,50,35],color:[171,117,69],heldBy:{actor:0,hand:'both'},weight:.9},{name:'Bench',position:[215,83,-130],size:[170,20,60],color:[139,104,72]},{name:'Bench left leg',position:[150,107,-130],size:[20,28,45],color:[108,87,66]},{name:'Bench right leg',position:[280,107,-130],size:[20,28,45],color:[108,87,66]},{name:'Wall',position:[310,-5,-180],size:[24,250,90],color:[117,133,141]}],lighting:{direction:[-.7,-1,.4],ambient:.52,intensity:.72,color:[255,239,215],shadows:true,shadowStrength:.38}});
  const camera={position:[230,-130,660],target:[0,-5,0],focalLength:700};
  await e.applySpatialSceneMotion({duration:72,actors:[{action:'carry',distance:150,view:{yaw:Math.PI/2}}],camera});
  await e.applySpatialSceneMotion({start:72,duration:72,actors:[{action:'putDown'}],cameraTo:{position:[180,-145,620],target:[20,0,0]}});
  await e.applySpatialSceneMotion({start:144,duration:72,actors:[{action:'walk',distance:-110}],cameraTo:{position:[180,-145,650],target:[-30,0,0]}});
  const renderer=new ExportFrameRenderer({width:960,height:540});await renderer.load(e.report);const images=[];
  for(const tick of[0,36,71,100,125,143,180,215]){const canvas=await renderer.renderTick(tick);images.push({name:`film-${tick}`,url:canvas.toDataURL('image/png')});}renderer.dispose();
  const project=e.serialize(),before=JSON.stringify(project),controller=new AbortController(),pending=e.applySpatialSceneMotion({start:216,duration:1000,actors:[{action:'idle'}]},{signal:controller.signal});controller.abort();let cancelled=false;try{await pending;}catch(error){cancelled=error.name==='AbortError';}if(!cancelled||JSON.stringify(e.serialize())!==before)throw new Error('Cancellation changed the scene.');
  const p=new Editor({demo:false});p.setCanvasSize(480,480);p.setBackgroundColor(0xffe7dfce);p.addSpatialScene({position:{x:240,y:245},actors:[{}],boxes:[{position:[0,131,0],size:[1000,20,1000],color:[151,160,147]}],lighting:{direction:[-.7,-1,.4],ambient:.5,intensity:.7,color:[255,255,255],shadows:true}});
  const r=new ExportFrameRenderer({width:480,height:480}),captures=[];
  for(const [name,lighting]of[['lit',{direction:[-.7,-1,.4],shadows:true}],['no-shadow',{direction:[-.7,-1,.4],shadows:false}],['other-light',{direction:[.7,-1,-.4],shadows:true}]]){
   await p.applySpatialSceneMotion({duration:2,lighting,camera:{position:[220,-160,650],target:[0,0,0]}});await r.load(p.report);const canvas=await r.renderTick(0),data=canvas.getContext('2d').getImageData(0,0,480,480).data;captures.push(Array.from(data));images.push({name,url:canvas.toDataURL('image/png')});
  }r.dispose();
  const difference=(a,b)=>{let pixels=0,total=0;for(let i=0;i<a.length;i+=4){const d=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);if(d>10)pixels++;total+=d;}return {pixels,total};};
  const cloth=new Editor({demo:false});cloth.setCanvasSize(400,460);cloth.setBackgroundColor(0xffeee7d8);cloth.addCartoonCharacter({position:{x:200,y:275}});const spine=cloth.getHumanRig().spine.at(-1);cloth.addCloth({anchorId:spine,angle:Math.PI/2,offset:{x:-40,y:15},width:10,endWidth:10,length:50,rows:16,columns:3,zOrder:1000,color:'#b66a56'});const source=cloth.serialize();
  for(const [name,collisions]of[['cloth-free',false],['cloth-contact',{handles:[spine],radius:29}]]){const editor=new Editor({demo:false}).load(structuredClone(source));editor.select(cloth.selectedUid);await editor.applyClothMotion({duration:48,cloth:{wind:{x:100,y:0},flutter:0,sag:0,collisions}});const painter=new ExportFrameRenderer({width:400,height:460});await painter.load(editor.report);images.push({name,url:(await painter.renderTick(47)).toDataURL('image/png')});painter.dispose();}
  return {images,project,shadow:difference(captures[0],captures[1]),lighting:difference(captures[0],captures[2]),cancelled,frames:e.totalTicks};
 });
 assert.equal(result.frames,216);assert.ok(result.cancelled);assert.ok(result.shadow.pixels>100,'Ground shadows must visibly change the floor');assert.ok(result.lighting.pixels>1000,'Moving the light must visibly change surface tones and shadow direction');
 for(const {name,url}of result.images)await writeFile(path.join(output,`${name}.png`),Buffer.from(url.split(',')[1],'base64'));
 await writeFile(path.join(output,'demo-project.json'),JSON.stringify(result.project));delete result.project;delete result.images;await writeFile(path.join(output,'browser-report.json'),JSON.stringify({...result,gpuDisabled:true},null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();service.stop();}
