import {chromium} from './support/playwright.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import backend from '../desktop/backend.cjs';
const output=path.resolve('artifacts/spatial-character');await mkdir(output,{recursive:true});
const service=await backend.startBackend({appRoot:process.cwd()});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const page=await browser.newPage();await page.goto(service.origin+'/api/health');
 const result=await page.evaluate(async()=>{
  const {Editor}=await import('/src/editor.mjs'),{ExportFrameRenderer}=await import('/src/export-frame-renderer.mjs');
  const e=new Editor({demo:false});e.setCanvasSize(480,560);e.setBackgroundColor(0xfff1ebe0);e.addCartoonCharacter({dimension:'3d',position:{x:240,y:330}});
  const renderer=new ExportFrameRenderer({width:480,height:560}),images=[],featureCounts=[];
  const mesh=e.figure._styk.spatialMesh,featureGroups=mesh.groups.filter(g=>['Eye white','Iris','Eye glint','Mouth','Smile'].includes(g.name));
  const materialSet=groups=>new Set(groups.flatMap(g=>mesh.materials.slice(g.start,g.start+g.count))),used=materialSet(featureGroups),others=materialSet(mesh.groups.filter(g=>!featureGroups.includes(g)));
  const palette=[...used].filter(i=>!others.has(i)).map(i=>mesh.colors[i]);
  for(const [label,view]of [['Old',{}],['Front',{yaw:0}],['Right',{yaw:Math.PI/2}],['Back',{yaw:Math.PI}],['Left',{yaw:-Math.PI/2}],['Head back',{yaw:0,headYaw:Math.PI}],['Head forward',{yaw:Math.PI,headYaw:Math.PI}],['Body tilt',{yaw:.75,pitch:-.25,perspective:.6,distance:600}]]){
   if(label==='Old')continue;e.setCharacterView({yaw:0,pitch:0,headYaw:0,headPitch:0,perspective:0,...view});
   await renderer.load(e.report);const canvas=await renderer.renderTick(0),ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,480,560).data;let count=0;
   for(let i=0;i<pixels.length;i+=4)if(palette.some(c=>Math.abs(pixels[i]-c[0])<=1&&Math.abs(pixels[i+1]-c[1])<=1&&Math.abs(pixels[i+2]-c[2])<=1))count++;
   ctx.fillStyle='#294755';ctx.font='22px sans-serif';ctx.textAlign='center';ctx.fillText(label,240,45);images.push(canvas.toDataURL('image/png'));featureCounts.push({label,count});
  }
  renderer.dispose();
  await e.applyHumanMotion({action:'carry',hand:'both',duration:72,distance:120,view:{yaw:Math.PI/2,orbitYaw:0,orbitPitch:.05,perspective:.5},viewTo:{orbitYaw:Math.PI*.85,orbitPitch:.2,headYaw:.3}});
  if(e.totalTicks!==72)throw new Error('Spatial motion did not publish.');
  const before=JSON.stringify(e.serialize()),controller=new AbortController(),pending=e.applyHumanMotion({duration:1200,distance:500},{signal:controller.signal});controller.abort();let cancelled=false;try{await pending;}catch(error){cancelled=error.name==='AbortError';}
  if(!cancelled||JSON.stringify(e.serialize())!==before)throw new Error('Spatial worker cancellation published partial motion.');
  const frames=e.totalTicks;return {images,featureCounts,frames,cancelled,controls:e.figure.segments.length,vertices:mesh.positions.length/3,triangles:mesh.indices.length/3};
 });
 const counts=Object.fromEntries(result.featureCounts.map(v=>[v.label,v.count]));assert.ok(counts.Front>40);assert.ok(counts.Back<counts.Front*.02+3);assert.ok(counts['Head back']<counts.Front*.02+3);assert.ok(counts['Head forward']>40);
 for(const [i,png]of result.images.entries())await writeFile(path.join(output,`view-${i}.png`),Buffer.from(png.split(',')[1],'base64'));
 delete result.images;await writeFile(path.join(output,'browser-report.json'),JSON.stringify({...result,gpuDisabled:true},null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();service.stop();}
