import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AgentEngine} from '../src/agent-engine.mjs';
import {createImageFigure} from '../src/media-authoring.mjs';
import {compileTextFigure,parseTextFont,MAX_FONT_BYTES} from '../src/text-authoring.mjs';
import {inspectWave,wavePeaks} from '../src/audio-pcm.mjs';
import {freshAudioId,AUDIO_CHUNK_BYTES,MAX_AUDIO_FILE_BYTES} from '../src/audio-model.mjs';
import {readBounded,readProject,writeProjectOutput} from './agent-files.mjs';

const MAX_MESSAGE=16*1024*1024;
const schema=properties=>({type:'object',additionalProperties:false,properties});
const str={type:'string'},integer={type:'integer',minimum:0};
const required={project_open:['path'],project_save:['path'],project_export:['path'],project_preview:['path'],
  asset_image:['path'],asset_figure:['path'],asset_audio:['path'],asset_text:['options']};
const extras=[
  ['tools_list','engine','Discover tools; filter by category or native method.',{category:str,method:str}],
  ['engine_inspect','engine','Current document summary, selection, native IDs and revision.',{}],
  ['engine_query','engine','Paginated objects, figure definitions, world-space joints, layers, keys, scene or audio.',
    {view:{enum:['summary','capabilities','objects','figures','figure','geometry','layers','timeline','animation','keys','audio','scene','effects','cameraMotions','document']},uid:integer,figureId:integer,channelId:str,offset:integer,limit:{type:'integer',minimum:1,maximum:1000}}],
  ['engine_snapshot','engine','Read a detached, validated editable document.',{}],
  ['engine_validate','engine','Validate the current document without publishing a file.',{}],
  ['project_new','project','Replace the session with an empty scene or supplied native document.',{name:str,document:{type:'object'}}],
  ['project_open','project','Open an editable .styk project into this session.',{path:str}],
  ['project_save','project','Atomically save an editable .styk project.',{path:str}],
  ['project_export','project','Export .mp4/.webm with project audio, or .png/.svg frames.',{path:str,options:{type:'object'}}],
  ['project_preview','project','Export a PNG/SVG at a chosen tick for visual feedback.',{path:str,tick:integer,width:integer,height:integer}],
  ['asset_image','media','Import a local PNG as a figure, or attach it to a selected figure joint.',
    {path:str,name:str,position:{type:'object'},uid:integer,parentId:integer}],
  ['asset_figure','media','Insert an editable native STYK/STKZ/STYKMOV figure or movieclip.',{path:str,position:{type:'object'}}],
  ['asset_text','media','Create editable outlined text using bundled Noto Sans or a local TTF/OTF font.',
    {options:{type:'object'},fontPath:str,position:{type:'object'}}],
  ['asset_audio','media','Import a local PCM WAV, preserving the recording in the editable project.',
    {path:str,trackId:str,start:{type:'number',minimum:0}}],
].map(([name,category,description,properties])=>({name,category,description,inputSchema:{...schema(properties),...(required[name]?{required:required[name]}:{})}}));

function checked(value,keys) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Expected an object.');
  for(const key of Object.keys(value))if(!keys.includes(key))throw new Error(`Unknown field: ${key}`);
}
function filename(directory,value) {
  if(typeof value!=='string'||!value.trim())throw new TypeError('path must be a nonempty string.');
  return path.resolve(directory,value);
}

/** One local project, one command at a time; no UI or shell command evaluation. */
export class AgentSession {
  constructor({directory=process.cwd(),engine=new AgentEngine()}={}) {this.directory=directory;this.engine=engine;}
  tools({category,method}={}) {
    checked({category,method},['category','method']);
    if(method)return this.engine.tools({method,...(category?{category}:{})});
    const io=extras.filter(t=>!category||t.category===category);
    const native=category&&['project','media','engine'].includes(category)?[]:this.engine.tools(category?{category}:{});
    return structuredClone([...io,...native]);
  }
  async invoke(tool,args={},signal) {
    if(this._running)throw new Error('Another session operation is running.');this._running=true;
    try{return await this._invoke(tool,args,signal);}finally{this._running=false;}
  }
  async _invoke(tool,args,signal) {
    signal?.throwIfAborted();
    if(typeof tool!=='string')throw new TypeError('tool must be a string.');
    if(tool.startsWith('editor_')){checked(args,['args','selection','at']);return this.engine.callAsync({method:tool.slice(7),...args},{signal});}
    const descriptor=extras.find(t=>t.name===tool);if(!descriptor)throw new Error(`Unknown tool: ${tool}`);
    checked(args,Object.keys(descriptor.inputSchema.properties));
    const engine=this.engine;
    switch(tool) {
      case 'tools_list':return this.tools(args);
      case 'engine_inspect':return engine.inspect();
      case 'engine_query':return engine.query(args);
      case 'engine_snapshot':return engine.snapshot();
      case 'engine_validate':return engine.execute({op:'validate'});
      case 'project_new': {
        const replacement=new AgentEngine(args);this.engine=replacement;return replacement.inspect();
      }
      case 'project_open': {
        const document=await readProject(filename(this.directory,args.path));signal?.throwIfAborted();
        const replacement=new AgentEngine({document});this.engine=replacement;return replacement.inspect();
      }
      case 'project_save':case 'project_export':case 'project_preview': {
        const destination=filename(this.directory,args.path),extension=path.extname(destination).toLowerCase();
        if(tool==='project_save'&&extension!=='.styk')throw new Error('project_save requires a .styk path.');
        if(tool==='project_preview'&&!['.png','.svg'].includes(extension))throw new Error('Preview output must be .png or .svg.');
        const {path:ignored,...previewOptions}=args;
        return writeProjectOutput(engine,destination,tool==='project_preview'?previewOptions:args.options??{},signal);
      }
      case 'asset_image': {
        if(args.uid!==undefined&&args.position!==undefined)throw new Error('Sprite attachment uses parentId; omit position.');
        if(args.parentId!==undefined&&args.uid===undefined)throw new Error('Sprite attachment needs a uid.');
        const file=filename(this.directory,args.path),bytes=await readBounded(file,64*1024*1024);
        if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw new Error('Image import requires a PNG file.');
        const figure=createImageFigure({dataUrl:`data:image/png;base64,${bytes.toString('base64')}`,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),name:args.name??path.basename(file)});
        signal?.throwIfAborted();
        return engine.callAsync(args.uid===undefined?{method:'importFigure',args:[figure,{position:args.position}]}:
          {method:'addSpriteSegment',args:[figure,{parentId:args.parentId}],selection:{uid:args.uid}});
      }
      case 'asset_figure': {
        const document=await readProject(filename(this.directory,args.path));signal?.throwIfAborted();
        return engine.callAsync({method:'importFigure',args:[document,{position:args.position}]});
      }
      case 'asset_text': {
        if(!args.options||typeof args.options!=='object'||Array.isArray(args.options))throw new TypeError('Text needs an options object containing text.');
        const style=args.options.bold?(args.options.italic?'BoldItalic':'Bold'):(args.options.italic?'Italic':'Regular');
        const fontFile=args.fontPath?filename(this.directory,args.fontPath):fileURLToPath(new URL(`../vendor/text/NotoSans-${style}.ttf`,import.meta.url));
        const parsed=parseTextFont(await readBounded(fontFile,MAX_FONT_BYTES),{name:path.basename(fontFile)});
        const figure=compileTextFigure(args.options,parsed.font);signal?.throwIfAborted();
        return engine.callAsync({method:'importFigure',args:[figure,{position:args.position}]});
      }
      case 'asset_audio': {
        const file=filename(this.directory,args.path),bytes=await readBounded(file,MAX_AUDIO_FILE_BYTES);
        const wave=await inspectWave(new Blob([bytes])),peaks=await wavePeaks(wave,()=>Boolean(signal?.aborted));
        const asset={id:freshAudioId('sound'),name:path.basename(file).slice(0,240),size:bytes.length,duration:wave.duration,peaks,chunks:[]};
        for(let offset=0;offset<bytes.length;offset+=AUDIO_CHUNK_BYTES)asset.chunks.push({data_base64:bytes.subarray(offset,offset+AUDIO_CHUNK_BYTES).toString('base64')});
        signal?.throwIfAborted();return engine.callAsync({method:'importAudio',args:[asset,{trackId:args.trackId,start:args.start}]});
      }
    }
  }
}

// Bounded framing with stream backpressure; a client cannot queue parsed commands ahead of a slow export.
export async function* agentLines(source,maxBytes=MAX_MESSAGE) {
  let pieces=[],size=0;
  for await(const chunk of source) {
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);let start=0;
    for(;;){
      const newline=bytes.indexOf(10,start),end=newline<0?bytes.length:newline,part=bytes.subarray(start,end);
      size+=part.length;if(size>maxBytes)throw new RangeError('Agent request exceeds the message size limit.');
      pieces.push(part);
      if(newline<0)break;
      yield Buffer.concat(pieces,size).toString('utf8');pieces=[];size=0;start=newline+1;
    }
  }
  if(size)yield Buffer.concat(pieces,size).toString('utf8');
}

export function agentJSON(value) {
  const result=JSON.stringify(value,(_key,v)=>v instanceof Map?[...v]:v instanceof Set?[...v]:ArrayBuffer.isView(v)?Array.from(v):v);
  if(Buffer.byteLength(result)>MAX_MESSAGE)throw new RangeError('Agent response exceeds 16 MiB; use paginated queries or save a project.');
  return result;
}

export async function serveAgent({input=process.stdin,output=process.stdout,session=new AgentSession(),signal}={}) {
  const send=async response=>{
    let text;try{text=agentJSON(response);}catch(error){text=JSON.stringify({id:response.id??null,ok:false,error:error.message});}
    await new Promise((resolve,reject)=>output.write(text+'\n',error=>error?reject(error):resolve()));
  };
  try {
    for await(const line of agentLines(input)) {
      if(!line.trim())continue;let id=null;
      try {
        const request=JSON.parse(line);
        if(!request||typeof request!=='object'||Array.isArray(request))throw new TypeError('Expected a request object.');
        if(request.id!==undefined&&request.id!==null&&typeof request.id!=='string'&&!Number.isSafeInteger(request.id))throw new TypeError('id must be a string or integer.');
        id=request.id??null;let result;
        if(request.tool!==undefined){checked(request,['id','tool','arguments']);result=await session.invoke(request.tool,request.arguments??{},signal);}
        else{const {id:ignored,...command}=request;signal?.throwIfAborted();result=await session.engine.executeAsync(command,{signal});}
        await send({id,ok:true,result});
      }catch(error){await send({id,ok:false,error:error.message,revision:session.engine.editor.revision});if(signal?.aborted)break;}
    }
  }catch(error){await send({id:null,ok:false,error:error.message});}
}
