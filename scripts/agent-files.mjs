import {open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {decodeDocument,normalizeDecodedDocument,buildContainerV2} from '../src/native-container.mjs';

export async function readBounded(filename,maxBytes) {
  const file=await open(filename,'r');
  try {
    if((await file.stat()).size>maxBytes)throw new RangeError(`Input exceeds ${maxBytes} bytes.`);
    const chunks=[];let size=0;
    for await(const chunk of file.createReadStream({autoClose:false,end:maxBytes})) {
      size+=chunk.length;if(size>maxBytes)throw new RangeError(`Input exceeds ${maxBytes} bytes.`);chunks.push(chunk);
    }
    return Buffer.concat(chunks,size);
  }finally{await file.close();}
}

export async function readProject(filename) {
  const extension=path.extname(filename).slice(1).toLowerCase(),kind=['stkz','stykmov'].includes(extension)?extension:'styk';
  const decoded=await decodeDocument(await readBounded(filename,256*1024*1024),kind);
  return normalizeDecodedDocument(decoded.document,kind);
}

// Stream to a sibling file; publication happens only after a complete, flushed result.
export async function atomicOutput(destination,produce,signal) {
  const temporary=path.join(path.dirname(destination),`.${path.basename(destination)}.${randomUUID()}.tmp`);
  const file=await open(temporary,'wx');
  try {
    let position=0;
    const writeAt=async(bytes,offset)=>{
      let written=0;
      while(written<bytes.byteLength){signal?.throwIfAborted();const result=await file.write(bytes,written,bytes.byteLength-written,offset+written);
        if(!result.bytesWritten)throw new Error('Output write made no progress.');written+=result.bytesWritten;}
    };
    await produce({write:async bytes=>{await writeAt(bytes,position);position+=bytes.byteLength;},patch:writeAt});
    signal?.throwIfAborted();await file.sync();await file.close();await rename(temporary,destination);
  }finally{await file.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

export async function writeProjectOutput(engine,destination,options={},signal) {
  signal?.throwIfAborted();
  const format=path.extname(destination).slice(1).toLowerCase();
  if(!['styk','mp4','webm','png','svg'].includes(format))throw new Error('Output must be .styk, .mp4, .webm, .png or .svg.');
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Export options must be an object.');
  for(const key of Object.keys(options))if(!['start','end','tick','width','height','smoothing','audio'].includes(key))throw new Error(`Unknown export field: ${key}`);
  const report=format==='styk'?engine.projectSnapshot():engine.snapshot(),total=engine.editor.totalTicks;
  const image=['png','svg'].includes(format),start=image?(options.tick??engine.editor.tick):(options.start??0),end=image?start+1:(options.end??total);
  if(format!=='styk'&&(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>total))throw new RangeError('Export range must be [start, end) within the animation.');
  const width=options.width??report.canvas_width,height=options.height??report.canvas_height;
  if(format!=='styk'&&![width,height].every(n=>Number.isInteger(n)&&n>=1&&n<=16384))throw new RangeError('Export dimensions must be 1–16384 pixels.');
  if(options.audio!==undefined&&typeof options.audio!=='boolean')throw new TypeError('audio must be a boolean.');
  await atomicOutput(destination,async sink=>{
    if(format==='styk')await sink.write(await buildContainerV2(report,'styk'));
    else {
      const {renderAgentVideo}=await import('./agent-video.mjs');
      await renderAgentVideo(report,{format,start,end,width,height,smoothing:options.smoothing,audio:options.audio??true,
        browserPath:process.env.STYK_BROWSER_PATH,signal,write:sink.write,patch:(offset,bytes)=>sink.patch(bytes,offset)});
    }
  },signal);
  return {output:destination,format,...(format==='styk'?{}:{width,height,start,end})};
}
