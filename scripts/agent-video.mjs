import {createServer} from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** A blank headless runtime, without loading the application or automating UI. */
export async function renderAgentVideo(report, {format, start = 0, end, width=report.canvas_width,
  height=report.canvas_height, smoothing='edges', audio=true, browserPath, signal, write, patch}) {
  if(!['mp4','webm','png','svg'].includes(format))throw new Error('Unsupported agent render format.');
  const {chromium} = await import('playwright');
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>StykAnimate agent runtime</title>'); return;
      }
      if (!/^\/(src|vendor|assets)\//.test(pathname)) throw new Error('Not found');
      const filename = await realpath(path.join(root, decodeURIComponent(pathname)));
      if (!['src', 'vendor', 'assets'].some(dir => filename.startsWith(path.join(root, dir) + path.sep))) throw new Error('Not found');
      const mime = {'.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'};
      response.setHeader('Content-Type', mime[path.extname(filename)] ?? 'application/octet-stream');
      response.end(await readFile(filename));
    } catch { response.writeHead(404); response.end(); }
  });
  let browser;
  const abort = () => { void browser?.close().catch(() => {}); };
  try {
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({headless: true, ...(browserPath ? {executablePath: browserPath} : {})});
    signal?.addEventListener('abort', abort, {once: true});
    signal?.throwIfAborted();
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({serviceWorkers: 'block'});
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.exposeFunction('agentWrite', bytes => write(Uint8Array.from(bytes)));
    await page.exposeFunction('agentPatch', (offset, bytes) => patch(offset, Uint8Array.from(bytes)));
    await page.goto(origin);
    return await page.evaluate(async ({report, format, start, end, width, height, smoothing, audio}) => {
      const {ExportFrameRenderer} = await import('/src/export-frame-renderer.mjs');
      const {encodeMP4, encodeWebM} = await import('/src/video-export.mjs');
      const renderer = new ExportFrameRenderer({width, height, smoothing});
      let audioEngine;
      try {
        await renderer.load(report);
        const sink = {streamed: true,
          async write(part) {
            const blob = new Blob([part]);
            for (let offset = 0; offset < blob.size; offset += 65536)
              await globalThis.agentWrite(Array.from(new Uint8Array(await blob.slice(offset, offset + 65536).arrayBuffer())));
          },
          patch: (offset, bytes) => globalThis.agentPatch(offset, Array.from(bytes)),
          finish: async () => ({frames: end - start, fps: report.fps}),
          abort: async () => {}};
        if(format==='svg'){
          await sink.write(await renderer.renderSVGTick(start));
          return {frames:1,format};
        }
        if(format==='png'){
          const canvas=await renderer.renderTick(start);
          await sink.write(await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG encoding failed.')),'image/png')));
          return {frames:1,format};
        }
        let audioChunks;
        if(audio){
          const {audibleClips,audioState}=await import('/src/audio-model.mjs');
          if(audibleClips(audioState(report)).length){
            const {AudioEngine}=await import('/src/audio-engine.mjs');audioEngine=new AudioEngine();
            audioChunks=audioEngine.exportChunks(report,{start:start/report.fps,duration:(end-start)/report.fps});
          }
        }
        return await (format === 'mp4' ? encodeMP4 : encodeWebM)({width,height, fps: report.fps, totalFrames: end - start,
          renderFrame: index => renderer.renderTick(start + index), sink,audioChunks});
      } finally { audioEngine?.dispose();renderer.dispose(); }
    }, {report, format, start, end, width, height, smoothing, audio});
  } finally {
    signal?.removeEventListener('abort', abort);
    try { await browser?.close(); }
    finally { await new Promise(resolve => server.close(resolve)); }
  }
}
