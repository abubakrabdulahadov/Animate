import {chromium} from './support/playwright.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import backend from '../desktop/backend.cjs';

const output=path.resolve('artifacts/cloth-motion');await mkdir(output,{recursive:true});
const service=await backend.startBackend({appRoot:process.cwd()});let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
  const page=await browser.newPage();await page.goto(`${service.origin}/api/health`);
  const result=await page.evaluate(async()=>{
    const {Editor}=await import('/src/editor.mjs'),{createStartupDocument}=await import('/src/startup-document.mjs');
    const e=new Editor({demo:false}).load(createStartupDocument());e.select(1);e.moveSelection(-140,45);e.setBackgroundColor(0xff152c3b);
    const scarf=e.addCloth({preset:'scarf',anchorId:1,rows:30,columns:5,color:'#e28b72'});
    const cape=e.addCloth({preset:'cape',anchorId:1,rows:24,columns:6,color:'#597d91',offset:{x:-8,y:10}});
    let created=0,terminated=0,heartbeats=0,abortOnStart;
    const NativeWorker=globalThis.Worker;
    globalThis.Worker=class extends NativeWorker{
      constructor(url,options){super(url,options);this.motion=String(url).includes('human-motion-worker');if(this.motion){created++;if(abortOnStart)queueMicrotask(()=>abortOnStart.abort());}}
      terminate(){if(this.motion)terminated++;return super.terminate();}
    };
    const timer=setInterval(()=>heartbeats++,1),start=performance.now();
    try{
      await e.applyHumanMotion({action:'carry',hand:'left',duration:120,distance:160,cloth:false});
      const baselineRoots=[];for(const tick of [20,60,100]){e.seek(tick);baselineRoots.push(e.evaluatedFrame.objects[0].root_x);}
      await e.applyClothMotion({start:0,duration:120,cloth:{wind:{x:-16,y:0},flutter:8}});
      for(const [i,tick]of [20,60,100].entries()){e.seek(tick);if(Math.abs(e.evaluatedFrame.objects[0].root_x-baselineRoots[i])>.001)throw new Error('Cloth replaced the base walking animation.');}
      const totalMs=performance.now()-start,baseline=JSON.stringify(e.serialize()),controller=new AbortController();abortOnStart=controller;
      let cancelled=false;try{await e.applyClothMotion({start:0,duration:24},{signal:controller.signal});}catch(error){cancelled=error.name==='AbortError';}
      if(!cancelled||JSON.stringify(e.serialize())!==baseline)throw new Error('Cancellation published a partial cloth pose.');
      if(created!==3||terminated!==3)throw new Error('A cloth preparation worker was retained.');
      if(!heartbeats)throw new Error('Cloth preparation did not yield.');
      const {ExportFrameRenderer}=await import('/src/export-frame-renderer.mjs');
      const renderer=new ExportFrameRenderer({width:960,height:540}),pngs=[];
      try{await renderer.load(e.report);for(const tick of [35,75])pngs.push((await renderer.renderTick(tick)).toDataURL('image/png'));}finally{renderer.dispose();}
      const {appendCloth}=await import('/src/cloth-motion.mjs'),{defaultFigure,emptyDocument,createObject,createFrame}=await import('/src/demo.mjs');
      const base=defaultFigure();base.segments.forEach(s=>s.visible=false);
      const flat=appendCloth(base,{length:160,width:80,endWidth:80,angle:0,rows:32,columns:8,color:'#e28b72'}).figure,report=emptyDocument();
      report.figure_types=[flat];report.keyframes=[createFrame([createObject(flat,1,300,200)])];
      const check=new ExportFrameRenderer({width:960,height:540});let seamSamples=0;
      try{await check.load(report);const canvas=await check.renderTick(0),ctx=canvas.getContext('2d'),pixels=ctx.getImageData(305,165,150,70).data;
        for(let i=0;i<pixels.length;i+=4){if(Math.abs(pixels[i]-226)>1||Math.abs(pixels[i+1]-139)>1||Math.abs(pixels[i+2]-114)>1)throw new Error('Opaque cloth contains an internal triangle seam.');seamSamples++;}
      }finally{check.dispose();}
      return {created,terminated,cancelled,heartbeats,totalMs,vertices:scarf.vertices+cape.vertices,triangles:scarf.triangles+cape.triangles,seamSamples,pngs};
    }finally{clearInterval(timer);globalThis.Worker=NativeWorker;}
  });
  assert.ok(result.vertices>300);assert.ok(result.triangles>500);
  for(const [i,png]of result.pngs.entries())await writeFile(path.join(output,`cloth-carry-${i}.png`),Buffer.from(png.split(',')[1],'base64'));
  delete result.pngs;await writeFile(path.join(output,'browser-report.json'),JSON.stringify({...result,gpuDisabled:true},null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();service.stop();}
