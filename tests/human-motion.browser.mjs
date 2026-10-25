import {chromium} from './support/playwright.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import backend from '../desktop/backend.cjs';

const output=path.resolve('artifacts/human-motion');await mkdir(output,{recursive:true});
const service=await backend.startBackend({appRoot:process.cwd()});let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
  const page=await browser.newPage();await page.goto(`${service.origin}/api/health`);
  const result=await page.evaluate(async()=>{
    const {Editor}=await import('/src/editor.mjs'),{createStartupDocument}=await import('/src/startup-document.mjs');
    const e=new Editor({demo:false}).load(createStartupDocument());e.select(1);
    let created=0,terminated=0,heartbeats=0;
    const NativeWorker=globalThis.Worker;
    globalThis.Worker=class extends NativeWorker{
      constructor(url,options){super(url,options);this.human=String(url).includes('human-motion-worker');if(this.human)created++;}
      terminate(){if(this.human)terminated++;return super.terminate();}
    };
    const timer=setInterval(()=>heartbeats++,1),start=performance.now();
    await e.applyHumanMotion({duration:240,distance:400});clearInterval(timer);
    const totalMs=performance.now()-start,baseline=e.serialize();
    const controller=new AbortController(),pending=e.applyHumanMotion({action:'wave',duration:600},{signal:controller.signal});controller.abort();
    let cancelled=false;try{await pending;}catch(error){cancelled=error.name==='AbortError';}
    if(!cancelled||JSON.stringify(e.serialize())!==JSON.stringify(baseline))throw new Error('Browser cancellation published a partial motion.');
    if(created!==2||terminated!==2)throw new Error('Human-motion workers were not disposed.');
    if(!heartbeats)throw new Error('Preparation did not yield to the browser.');
    e.seek(100);
    const {ExportFrameRenderer}=await import('/src/export-frame-renderer.mjs');
    const renderer=new ExportFrameRenderer({width:640,height:360});let png;
    try{await renderer.load(e.report);const canvas=await renderer.renderTick(100);png=canvas.toDataURL('image/png');}
    finally{renderer.dispose();globalThis.Worker=NativeWorker;}
    return {created,terminated,cancelled,heartbeats,totalMs,frames:e.totalTicks,png};
  });
  assert.equal(result.frames,240);
  await writeFile(path.join(output,'browser-preview.png'),Buffer.from(result.png.split(',')[1],'base64'));delete result.png;
  await writeFile(path.join(output,'browser-report.json'),JSON.stringify({...result,gpuDisabled:true},null,2));
  console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();service.stop();}
