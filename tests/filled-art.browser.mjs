import {chromium} from './support/playwright.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import backend from '../desktop/backend.cjs';

const output=path.resolve('artifacts/filled-art');await mkdir(output,{recursive:true});
const service=await backend.startBackend({appRoot:process.cwd()});let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const page=await browser.newPage();await page.goto(`${service.origin}/api/health`);
  const result=await page.evaluate(async()=>{
    const {Editor}=await import('/src/editor.mjs'),{buildGeometry}=await import('/src/pivot/geometry.mjs'),{ExportFrameRenderer}=await import('/src/export-frame-renderer.mjs');
    const e=new Editor({demo:false});e.setCanvasSize(1280,720);e.setBackgroundColor(0xfff3ece0);
    e.addFigure();const old=e.selectedUid;e.moveSelection(-330,10);e.updateFigureStyle({name:'Original stick figure'});
    const cartoon=e.addCartoonCharacter({position:{x:900,y:375},palette:{shirt:'#73a8a0',pants:'#425e86'}});
    e.select(old);await e.applyHumanMotion({action:'carry',hand:'left',duration:72});
    e.select(cartoon.uid);await e.applyHumanMotion({action:'carry',hand:'left',duration:72});
    const art=[
      {shape:'roundedRect',width:440,height:420,radius:30,color:'#e4dfd6',position:{x:310,y:370}},
      {shape:'roundedRect',width:440,height:420,radius:30,color:'#fffaf1',position:{x:900,y:370}},
      {shape:'pill',width:250,height:42,color:'#385b71',position:{x:900,y:595}},
      {shape:'speechBubble',width:155,height:75,radius:18,color:'#ecc87f',position:{x:1065,y:225}},
      {shape:'star',width:33,height:33,color:'#bd815d',position:{x:1065,y:220}},
      {shape:'ellipse',width:45,height:45,color:'#d68c70',position:{x:1060,y:595}},
    ];
    for(const spec of art){e.addFilledShape(spec);if(spec.shape==='roundedRect')e.sendToBack();}
    e.seek(48);const g=buildGeometry(e.report,e.evaluatedFrame),body=[...g.objects.values()].find(o=>o.obj.unique_id===cartoon.uid);
    const strokes=body.drawables.filter(s=>s.alpha>0&&s.type!=='poly');if(strokes.length)throw new Error('The cartoon exposes skeleton strokes.');
    const renderer=new ExportFrameRenderer({width:1280,height:720});let png;
    try{await renderer.load(e.report);const canvas=await renderer.renderTick(48),ctx=canvas.getContext('2d');
      ctx.fillStyle='#294755';ctx.textAlign='center';ctx.font='600 31px sans-serif';ctx.fillText('YAXLIT, TO‘LDIRILGAN PERSONAJ',640,75);
      ctx.font='21px sans-serif';ctx.fillStyle='#6c797b';ctx.fillText('Avvalgi ko‘rinish',310,140);ctx.fillText('Multfilm ko‘rinishi',900,140);
      ctx.fillStyle='#fffaf1';ctx.font='18px sans-serif';ctx.fillText('Filled UI shakllari',900,602);
      ctx.fillStyle='#7f8987';ctx.font='17px sans-serif';ctx.fillText('Boshqaruv tugunlari ichkarida; tashqarida faqat rangli shakllar.',640,670);
      png=canvas.toDataURL('image/png');
    }finally{renderer.dispose();}
    return {png,visibleSkeletonStrokes:strokes.length,filledContours:body.polys.length,controls:body.fig.segments.length};
  });
  assert.equal(result.visibleSkeletonStrokes,0);assert.ok(result.filledContours>25);
  await writeFile(path.join(output,'cartoon-preview.png'),Buffer.from(result.png.split(',')[1],'base64'));delete result.png;
  await writeFile(path.join(output,'browser-report.json'),JSON.stringify({...result,gpuDisabled:true},null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();service.stop();}
