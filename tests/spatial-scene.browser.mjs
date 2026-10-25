import {chromium} from './support/playwright.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import backend from '../desktop/backend.cjs';
const output=path.resolve('artifacts/grounded-turns');await mkdir(output,{recursive:true});
const service=await backend.startBackend({appRoot:process.cwd()});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const page=await browser.newPage();await page.goto(service.origin+'/api/health');
 const result=await page.evaluate(async()=>{
  const {Editor}=await import('/src/editor.mjs'),{ExportFrameRenderer}=await import('/src/export-frame-renderer.mjs');
  const e=new Editor({demo:false});e.setCanvasSize(960,540);e.setBackgroundColor(0xffe3e9e7);
  const {uid}=e.addSpatialScene({position:{x:480,y:280},actors:[{name:'Aziz',position:[-105,0,25],palette:{shirt:'#4f9590'}},{name:'Nila',position:[105,0,-100],palette:{shirt:'#c1846b'}}],boxes:[{name:'Floor',position:[0,132,0],size:[1000,20,1000],color:[116,143,144]},{name:'Bench',position:[0,81,-150],size:[210,20,65],color:[152,118,86]},{name:'Pillar',position:[180,-10,-190],size:[28,260,28],color:[83,105,122]}]});
  e.select(uid);const options={duration:144,actors:[{action:'walk',distance:185,view:{yaw:.7},viewTo:{yaw:2.2}},{action:'turn',view:{yaw:-.6},viewTo:{yaw:1.8}}],camera:{position:[60,-100,700],target:[0,-15,0]},cameraTo:{position:[390,-170,500],target:[40,-15,0],focalLength:700}};
  await e.applySpatialSceneMotion(options);const renderer=new ExportFrameRenderer({width:960,height:540}),images=[];
  await renderer.load(e.report);for(const tick of [0,36,72,108,143]){const canvas=await renderer.renderTick(tick);images.push({name:`scene-${tick}`,url:canvas.toDataURL('image/png')});}renderer.dispose();
  const project=e.serialize(),before=JSON.stringify(project),controller=new AbortController(),pending=e.applySpatialSceneMotion({...options,duration:1000},{signal:controller.signal});controller.abort();let cancelled=false;try{await pending;}catch(error){cancelled=error.name==='AbortError';}if(!cancelled||JSON.stringify(e.serialize())!==before)throw new Error('Cancelled scene motion published partial work.');
  const occlusion=new Editor({demo:false});occlusion.setCanvasSize(320,320);occlusion.setBackgroundColor(0xffffffff);occlusion.addSpatialScene({position:{x:160,y:160},actors:[{position:[-1000,0,0]}],boxes:[{name:'Near red',position:[0,0,80],size:[100,100,30],color:[240,40,30]},{name:'Far blue',position:[0,0,-80],size:[100,100,30],color:[30,60,240]}]});
  await occlusion.applySpatialSceneMotion({duration:24,camera:{position:[0,0,700],target:[0,0,0]},cameraTo:{position:[0,0,-700],target:[0,0,0]}});
  const r=new ExportFrameRenderer({width:320,height:320});await r.load(occlusion.report);const pixels=[];
  for(const tick of [0,23]){const canvas=await r.renderTick(tick);pixels.push([...canvas.getContext('2d').getImageData(160,160,1,1).data]);images.push({name:`occlusion-${tick}`,url:canvas.toDataURL('image/png')});}r.dispose();
  return {images,project,pixels,cancelled,frames:e.totalTicks,controls:e.figure.segments.length};
 });
 assert.ok(result.pixels[0][0]>result.pixels[0][2]*3,'Near red box must occlude the later blue box');assert.ok(result.pixels[1][2]>result.pixels[1][0]*3,'Orbit behind the scene must expose the blue box');assert.equal(result.frames,144);assert.ok(result.cancelled);
 for(const item of result.images)await writeFile(path.join(output,`${item.name}.png`),Buffer.from(item.url.split(',')[1],'base64'));
 await writeFile(path.join(output,'demo-project.json'),JSON.stringify(result.project));delete result.project;delete result.images;
 await writeFile(path.join(output,'browser-report.json'),JSON.stringify({...result,gpuDisabled:true},null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();service.stop();}
