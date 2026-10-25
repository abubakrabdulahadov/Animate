import {Editor} from './editor.mjs';
import {agentMethod, editorTools, validateAgentArguments} from './agent-tools.mjs';
import {evaluatedFrame} from './pivot/geometry.mjs';
import {AUTHORING_PROPERTIES} from './animation-properties.mjs';
import {VFX_REGISTRY} from './vfx-registry.mjs';
import {CAMERA_MOTION_TYPES,MOTION_PARAMETERS} from './camera-motion.mjs';
import {sessionProject} from './editor-sessions.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed) {
  if (!object(value)) throw new TypeError('Expected an object.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown field: ${key}`);
}
function number(value, label, integer = false) {
  if (!Number.isFinite(value) || integer && !Number.isSafeInteger(value)) throw new TypeError(`${label} must be a finite ${integer ? 'integer' : 'number'}.`);
  return value;
}

/** DOM-free access to the same editable document and commands as the app. */
export class AgentEngine {
  constructor({document, name} = {}) {
    this.editor = new Editor({demo: false});
    const title = name ?? document?._styk?.name ?? 'Agent animation';
    if (document) this.editor.load(document, title);
    else this.editor.name = title;
  }
  inspect() {
    const e = this.editor;
    return {name: e.name, revision: e.revision, frame: e.frameIndex, tick: e.tick,
      frames: e.report.keyframes.length, totalTicks: e.totalTicks, fps: e.report.fps,
      width: e.report.canvas_width, height: e.report.canvas_height,
      canUndo: e.canUndo, canRedo: e.canRedo,
      selectedUid:e.selectedUid, selectedJointId:e.figure?.segments[e.selectedJoint]?.segment_id ?? null,
      activeLayerId:e.activeLayerId,
      documentTimeline:e.report._styk?.layerSheet?'sheet':'native',
      scope:(e._movieclipScopes??[]).map(({typeId,name})=>({figureId:typeId,name})),
      figures: e.report.figure_types.map(f => ({id: f.figure_type_id, name: f.name,
        joints: f.segments.map(s => ({id: s.segment_id, parent: s.parent_id}))})),
      objects: e.selectionFrame.objects.map(o => ({uid: o.unique_id, figureId: o.figure_type_id,
        x: o.root_x, y: o.root_y, scale: o.scale}))};
  }
  snapshot() { return this.editor.serialize(); }
  projectSnapshot() {
    const {report,name}=sessionProject(this.editor);
    if(report===this.editor.report)return this.snapshot();
    // The existing movieclip owner folds pending nested edits into the root.
    return new AgentEngine({document:report,name}).snapshot();
  }
  tools(options = {}) { fields(options, ['category', 'method']); return structuredClone(editorTools(options,Editor.prototype)); }
  query(options = {}) {
    fields(options, ['view','uid','figureId','channelId','offset','limit']);
    const {view='summary', uid, figureId, channelId, offset=0, limit=100} = options, e=this.editor;
    number(offset,'offset',true); number(limit,'limit',true);
    if(offset<0||limit<1||limit>1000)throw new RangeError('Query offset must be nonnegative; limit must be 1–1000.');
    const page=(values,map=value=>value)=>({total:values.length,offset,limit,items:values.slice(offset,offset+limit).map(map)});
    let result;
    switch(view){
      case 'summary': return this.inspect();
      case 'capabilities': return {version:2, categories:[...new Set(this.tools().map(t=>t.category))],
        animationProperties:structuredClone(AUTHORING_PROPERTIES), cameraMotions:structuredClone(CAMERA_MOTION_TYPES),
        units:{coordinates:'scene pixels',angles:'radians',ticks:'zero-based',audio:'seconds'}};
      case 'effects':result=page(Object.entries(VFX_REGISTRY),([type,definition])=>({type,...definition}));break;
      case 'cameraMotions':result={types:CAMERA_MOTION_TYPES,parameters:MOTION_PARAMETERS,clips:e.getCameraMotions()};break;
      case 'objects': result=page(e.evaluatedFrame.objects.filter(o=>uid===undefined||o.unique_id===uid),o=>{
        const {runtime_segments,...pose}=o;return pose;});break;
      case 'figures': result=page(e.report.figure_types,f=>({id:f.figure_type_id,name:f.name,segments:f.segments.length,polygons:f.polyfills?.length??0,images:f.image_assets?.length??0,text:f.text_assets?.length??0}));break;
      case 'figure': {
        const figure=e.report.figure_types.find(f=>f.figure_type_id===(figureId??e.figure?.figure_type_id));
        if(!figure)throw new Error('Unknown figureId.');result=figure;break;
      }
      case 'geometry': {
        const target=uid??e.selectedUid, pose=e.evaluatedFrame.objects.find(o=>o.unique_id===target);
        if(!pose)throw new Error('Geometry query needs a present uid or selected figure.');
        const geometry=e.geometry.objects.get(pose.object_slot);
        if(!geometry)throw new Error('Figure geometry is unavailable.');
        result={uid:target,figureId:pose.figure_type_id,root:geometry.root,
          joints:page([...geometry.joints],([id,point])=>({id,...point})),
          segments:page(geometry.segments,s=>({id:s.seg.segment_id,start:s.start,end:s.end,length:s.length,angle:s.angle,type:s.type})),
          polygons:page(geometry.polys,p=>({id:p.poly.polyfill_id,points:p.points,color:p.rgb,alpha:p.alpha}))};break;
      }
      case 'layers':result=page(e.layers);break;
      case 'timeline':result=page(e.timeline,(row,index)=>({index:offset+index,start:row.start,count:row.count,id:e.getFrameId(offset+index)}));break;
      case 'animation':result=page(e.animationChannels,c=>({id:c.id,target:c.target,property:c.property,keys:c.keys.length}));break;
      case 'keys': {
        const channel=e.animationChannels.find(c=>c.id===channelId);if(!channel)throw new Error('Unknown channelId.');
        result={channelId,...page(channel.keys)};break;
      }
      case 'audio': {
        const audio=e.report._styk?.audio;
        result={tracks:page(audio?.tracks??[]),assets:Object.values(audio?.assets??{}).map(({id,name,duration,size})=>({id,name,duration,size}))};break;
      }
      case 'scene':result={camera:e.evaluatedFrame.camera,backgrounds:page(e.report.backgrounds,b=>({id:b.background_id,name:b.name,kind:b.kind,width:b.width,height:b.height}))};break;
      case 'document':return this.snapshot();
      default:throw new Error(`Unknown query view: ${view}`);
    }
    return structuredClone(result);
  }
  _prepareCall({method,args=[],selection={},at={}}) {
    if(this._busy)throw new Error('Another agent operation is running.');
    const descriptor=agentMethod(method),e=this.editor;
    if(!Array.isArray(args)||args.length>16)throw new TypeError('args must contain at most 16 positional arguments.');
    validateAgentArguments(method,args);
    fields(selection,['uid','uids','jointId','polygonId','layerId']);fields(at,['frame','tick']);
    if(at.frame!==undefined&&at.tick!==undefined)throw new Error('Choose at.frame or at.tick.');
    if(at.frame!==undefined){number(at.frame,'frame',true);if(at.frame<0||at.frame>=e.report.keyframes.length)throw new RangeError('Frame index is out of range.');}
    if(at.tick!==undefined){number(at.tick,'tick',true);if(at.tick<0||at.tick>=e.totalTicks)throw new RangeError('Tick is out of range.');}
    if(selection.uid!==undefined&&selection.uids!==undefined)throw new Error('Choose uid or uids.');
    const tick=at.tick??(at.frame===undefined?e.tick:e.timeline[at.frame].start);
    let index=at.frame??e.frameIndex;
    if(at.tick!==undefined){let low=0,high=e.timeline.length-1;while(low<high){const mid=Math.ceil((low+high)/2);if(e.timeline[mid].start<=tick)low=mid;else high=mid-1;}index=low;}
    const row=e.timeline[index];
    const frame=tick===e.tick?e.selectionFrame:evaluatedFrame(e.report,index,row.count>1?(tick-row.start)/row.count:0,tick);
    if(selection.uids!==undefined&&!Array.isArray(selection.uids))throw new TypeError('uids must be an array.');
    if(selection.uids?.length!==undefined&&selection.uids.length!==1&&(selection.jointId!==undefined||selection.polygonId!==undefined))throw new Error('Joint/polygon selection requires one figure.');
    if(selection.uid===null&&(selection.jointId!==undefined||selection.polygonId!==undefined))throw new Error('Joint/polygon selection requires a figure.');
    const uids=selection.uids??(selection.uid!==undefined?[selection.uid]:[]);
    if(!Array.isArray(uids)||uids.length>10000)throw new TypeError('uids must be an array of at most 10000 IDs.');
    for(const uid of uids)if(uid!==null){number(uid,'uid',true);if(!frame.objects.some(o=>o.unique_id===uid))throw new Error(`Object ${uid} is absent at this frame.`);
      if(e.isFigureFocusLocked(uid))throw new Error(`Figure ${uid} is locked by layer focus.`);}
    const uid=selection.uid??(selection.uids?.length===1?selection.uids[0]:e.selectedUid);
    const pose=frame.objects.find(o=>o.unique_id===uid),figure=e.report.figure_types.find(f=>f.figure_type_id===pose?.figure_type_id);
    const joint=selection.jointId===undefined?-1:figure?.segments.findIndex(s=>s.segment_id===selection.jointId);
    if(selection.jointId!==undefined&&!(joint>=0))throw new Error('Unknown jointId.');
    const polygon=selection.polygonId===undefined?-1:figure?.polyfills?.findIndex(p=>p.polyfill_id===selection.polygonId);
    if(selection.polygonId!==undefined&&!(polygon>=0))throw new Error('Unknown polygonId.');
    if(selection.jointId!==undefined&&selection.polygonId!==undefined)throw new Error('Choose jointId or polygonId.');
    if(selection.layerId!==undefined&&!e.getLayer(selection.layerId))throw new Error('Unknown layerId.');
    if(at.frame!==undefined)e.selectFrame(at.frame);else if(at.tick!==undefined)e.seek(at.tick);
    if(selection.layerId!==undefined)e.setActiveLayer(selection.layerId);
    if(selection.uids!==undefined)e.selectMany(selection.uids);else if(selection.uid!==undefined)e.select(selection.uid);
    if(selection.jointId!==undefined)e.select(uid,joint);
    if(selection.polygonId!==undefined)e.selectPolygon(uid,polygon);
    return {descriptor,args};
  }
  call(options) {
    fields(options,['method','args','selection','at']);
    if(agentMethod(options.method).async)throw new Error('Use callAsync for this asynchronous method.');
    const {args}=this._prepareCall(options);
    const value=this.editor[options.method](...args);
    return {value:structuredClone(value===this.editor?null:value??null),state:this.inspect()};
  }
  async callAsync(options) {
    fields(options,['method','args','selection','at']);
    const {args}=this._prepareCall(options);this._busy=true;
    try{const value=await this.editor[options.method](...args);return {value:structuredClone(value===this.editor?null:value??null),state:this.inspect()};}
    finally{this._busy=false;}
  }
  async executeAsync(command) {
    if(command?.op==='call'){fields(command,['op','method','args','selection','at']);const {op,...options}=command;return this.callAsync(options);}
    return this.execute(command);
  }
  execute(command) {
    if(this._busy)throw new Error('Another agent operation is running.');
    if (!object(command) || typeof command.op !== 'string') throw new TypeError('A command needs an op string.');
    const e = this.editor;
    const check = keys => fields(command, ['op', ...keys]);
    const select = () => {
      number(command.uid, 'uid', true);
      if (!e.selectionFrame.objects.some(o => o.unique_id === command.uid)) throw new Error(`Object ${command.uid} is absent at this frame.`);
      e.select(command.uid);
    };
    switch (command.op) {
      case 'tools':check(['category','method']);return this.tools(Object.fromEntries(Object.entries(command).filter(([key])=>key!=='op')));
      case 'query': {const {op,...options}=command;return this.query(options);}
      case 'snapshot':check([]);return this.snapshot();
      case 'validate':check([]);this.snapshot();return {valid:true,revision:e.revision};
      case 'call': {check(['method','args','selection','at']);const {op,...options}=command;return this.call(options);}
      case 'inspect': check([]); break;
      case 'project':
        check(['width', 'height', 'fps']);
        e.updateProject({...(command.width === undefined ? {} : {canvas_width: command.width}),
          ...(command.height === undefined ? {} : {canvas_height: command.height}),
          ...(command.fps === undefined ? {} : {fps: command.fps})}); break;
      case 'addFigure':
        check(['figureId']);
        if (command.figureId !== undefined && !e.report.figure_types.some(f => f.figure_type_id === command.figureId)) throw new Error('Unknown figureId.');
        e.addFigure(command.figureId); break;
      case 'importFigure':
        check(['document']);
        if (!object(command.document)) throw new TypeError('Expected a native figure document.');
        e.importFigure(command.document); break;
      case 'draw':
        check(['uid', 'segments']);
        if (!Array.isArray(command.segments) || !command.segments.length) throw new TypeError('Expected a nonempty segments array.');
        for (const segment of command.segments) fields(segment, ['parentId', 'type', 'length', 'angle', 'thickness', 'start']);
        if (command.uid === undefined) e.select(null); else select();
        e.addSegments(command.segments); break;
      case 'selectFrame':
        check(['index']); number(command.index, 'index', true);
        if (command.index < 0 || command.index >= e.report.keyframes.length) throw new RangeError('Frame index is out of range.');
        e.selectFrame(command.index); break;
      case 'seek':
        check(['tick']); number(command.tick, 'tick', true);
        if (command.tick < 0 || command.tick >= e.totalTicks) throw new RangeError('Tick is out of range.');
        e.seek(command.tick); break;
      case 'duplicateFrame': check([]); e.duplicateFrame(); break;
      case 'deleteFrame': check([]); e.deleteFrame(); break;
      case 'duration': check(['ticks']); e.setFrameDuration(command.ticks); break;
      case 'move':
        check(['uid', 'dx', 'dy']); number(command.dx, 'dx'); number(command.dy, 'dy');
        select(); e.moveSelection(command.dx, command.dy); break;
      case 'rotate':
        check(['uid', 'radians']); number(command.radians, 'radians');
        select(); e.rotateFigure(command.radians); break;
      case 'scale':
        check(['uid', 'factor']); number(command.factor, 'factor');
        if (command.factor <= 0) throw new RangeError('factor must be positive.');
        select(); e.scaleSelection(command.factor); break;
      case 'style': {
        check(['uid', 'jointId', 'values']);
        fields(command.values, ['color_rgb', 'thickness', 'transparency']);
        if (command.values.thickness !== undefined) {
          number(command.values.thickness, 'thickness');
          if (command.values.thickness < 0) throw new RangeError('thickness must be nonnegative.');
        }
        select();
        const index = e.figure.segments.findIndex(s => s.segment_id === command.jointId);
        if (index < 0) throw new Error('Unknown jointId.');
        e.select(command.uid, index); e.updateSegment(command.values); break;
      }
      case 'pose': {
        check(['uid', 'jointId', 'x', 'y']); number(command.x, 'x'); number(command.y, 'y');
        select();
        const index = e.figure.segments.findIndex(s => s.segment_id === command.jointId);
        if (index < 0) throw new Error('Unknown jointId.');
        e.select(command.uid, index); e.poseJoint(command.x, command.y); break;
      }
      case 'deleteFigure': check(['uid']); select(); e.deleteFigure(); break;
      case 'camera':
        check(['values']); fields(command.values, ['x', 'y', 'scale', 'angle_rad']);
        e.setCameraValues(command.values); break;
      case 'background': check(['argb']); e.setBackgroundColor(command.argb); break;
      case 'undo': check([]); e.undo(); break;
      case 'redo': check([]); e.redo(); break;
      default: throw new Error(`Unknown operation: ${command.op}`);
    }
    return this.inspect();
  }
}
