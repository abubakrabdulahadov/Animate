import {createHumanMotion,humanRig,HUMAN_MOTION_LIMITS} from './human-motion.mjs';
import {prepareHumanMotion} from './human-motion-client.mjs';
import {snapshotPoseObject} from './pose-snapshot.mjs';
import {createFrame} from './demo.mjs';
import {evaluatedFrame,timeline} from './pivot/geometry.mjs';
import {validateObjectChanges} from './pivot/model.mjs';
import {layerLocked} from './layers.mjs';
import {draftAnimation,recordAnimation} from './editor-animation.mjs';
import {animationChannelId,validateAnimationDocument} from './animation-channels.mjs';
import {planLayerSheetEdit,publishLayerSheetEdit} from './editor-layer-sheet.mjs';

export function motionFrameAt(report,tick){
  const rows=timeline(report);let low=0,high=rows.length-1;
  while(low<high){const mid=Math.ceil((low+high)/2);if(rows[mid].start<=tick)low=mid;else high=mid-1;}
  const row=rows[low];return evaluatedFrame(report,low,row.count>1?(tick-row.start)/row.count:0,tick,{skipMovieclips:true});
}
export function poseMotionContext(editor,options={},editing=false,humanoid=true){
  if(editor._drag||editor._animationEdit||editor._authoredPoseEdit)throw new Error('Finish the current pose edit before generating motion.');
  if(editing&&(editor.frameDraft?.dirty||editor.frameDraft?.empty||editor.report._styk?.simpleFrameDraft?.baseline))throw new Error('Update or discard the working frame before generating motion.');
  const start=options.start??Math.round(editor.tick);
  if(!Number.isInteger(start)||start<0||start>10000000)throw new RangeError('Motion start must be a nonnegative whole tick.');
  if(editor.selectedUids.size!==1)throw new Error('Select one figure.');
  const uid=editor.selectedUid,frame=motionFrameAt(editor.report,Math.min(start,editor.totalTicks-1)),object=frame.objects.find(o=>o.unique_id===uid);
  if(!object)throw new Error('The humanoid is absent at the motion start.');
  if(editing&&layerLocked(editor.report,uid))throw new Error('Unlock the figure layer before generating motion.');
  if(object.join||frame.objects.some(o=>o.join&&frame.objects[o.join.target_object_slot]?.unique_id===uid))throw new Error('Generate motion on an independent humanoid; detach joined figures first.');
  const figure=editor.report.figure_types.find(f=>f.figure_type_id===object.figure_type_id);
  // The worker needs bone geometry, not embedded artwork or an unrelated scene.
  const numericFigure={figure_type_id:figure.figure_type_id,name:figure.name,
    segments:figure.segments.map(({segment_id,parent_id,length,angle_rad,bend_rad,primitive_code,aux_code,flags,segment_type,segment_kind,is_static,name,_stykRig,_stykCloth,_stykCharacterRole})=>
      ({segment_id,parent_id,length,angle_rad,bend_rad,primitive_code,aux_code,flags,segment_type,segment_kind,is_static,name,_stykRig,_stykCloth,_stykCharacterRole,thickness:0,color_rgb:[0,0,0]})),
    polyfills:[],image_assets:[],text_assets:[],_styk:{...(figure._styk?.animationOrigin?{animationOrigin:figure._styk.animationOrigin}:{}),...(figure._styk?.footSole!==undefined?{footSole:figure._styk.footSole}:{}),...(figure._styk?.spatialCartoon?{spatialCartoon:figure._styk.spatialCartoon}:{})}};
  const pose=snapshotPoseObject(object);pose.object_slot=0;
  for(const [flag,vector,field]of [['len_flag','lengths','length'],['bend_flag','bends','bend_rad']])if(!pose[flag]&&object.runtime_segments?.some((s,i)=>s[field]!==undefined&&s[field]!==figure.segments[i][field])){
    pose[flag]=1;pose[vector]=figure.segments.map((s,i)=>object.runtime_segments[i]?.[field]??s[field]??0);
  }
  const fps=editor.report.frame_delay_ms?1000/editor.report.frame_delay_ms:editor.report.fps;
  if(humanoid)humanRig(numericFigure,options.rig);
  return {uid,start,object,figure,input:{figure:numericFigure,object:pose,options,fps},layerId:editor.layerForUid(uid)};
}

export const editorHumanMotionMethods={
  getHumanRig(mapping){const c=poseMotionContext(this,{rig:mapping});return humanRig(c.input.figure,mapping);},
  previewHumanMotion(options={},tick=0){const c=poseMotionContext(this,options),motion=createHumanMotion(c.input.figure,c.input.object,options,c.input.fps);return {rig:motion.rig,...motion.sample(tick)};},
  async applyHumanMotion(options={}, {signal}={}){return applyPoseMotion(this,options,{signal});},
};

/** Shared bounded publication for generated native pose sequences. */
export async function applyPoseMotion(editor,options={}, {signal,prepare=prepareHumanMotion,label='Generate human motion',humanoid=true}={}){
  const c=poseMotionContext(editor,options,true,humanoid),report=editor.report,revision=editor.revision,selection=editor._selectionState(),identity=editor._nextFrameIdentity;
  if(editor.animationChannels.some(channel=>channel.target.kind==='figure'&&channel.target.uid===c.uid&&['x','y','rotation'].includes(channel.property)))throw new Error('Bake or remove explicit figure transform channels before generating motion.');
  const controller=new AbortController(),cancel=event=>{if(['edit','history','document','preview','selection','seek'].includes(event.detail?.kind))controller.abort();};
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  editor.addEventListener('change',cancel);
  let prepared;
  try{
    prepared=await prepare(c.input,{signal:combined});
    const check=()=>{combined.throwIfAborted();if(editor.report!==report||editor.revision!==revision||editor._nextFrameIdentity!==identity||editor.selectedUid!==c.uid||editor._drag||editor._animationEdit)throw new DOMException('The scene changed while human motion was prepared.','AbortError');};
    let yielded=performance.now();
    const checkpoint=async()=>{check();if(performance.now()-yielded>6){await new Promise(resolve=>setTimeout(resolve,0));check();yielded=performance.now();}};
    check();
    const end=c.start+prepared.poses.length;if(end>10000001)throw new RangeError('Motion exceeds the timeline limit.');
    const oldEnd=editor.totalTicks,restore=(options.after??'hold')==='restore'&&end<oldEnd;
    const samples=prepared.poses.map((pose,i)=>({tick:c.start+i,pose}));
    if(c.start>0){const previous=motionFrameAt(report,c.start-1).objects.find(o=>o.unique_id===c.uid);if(previous)samples.unshift({tick:c.start-1,pose:previous});}
    if(restore){const original=motionFrameAt(report,end).objects.find(o=>o.unique_id===c.uid);if(original)samples.push({tick:end,pose:original});}
    const sheet=report._styk?.layerSheet;
    if(sheet){
      const types=new Map(report.figure_types.map(f=>[f.figure_type_id,f.segments.length]));
      const members=motionFrameAt(report,Math.min(c.start,oldEnd-1)).objects.filter(o=>editor.layerForUid(o.unique_id)===c.layerId),counts=members.length;
      if(samples.length*counts>HUMAN_MOTION_LIMITS.layerObjects)throw new RangeError('Generate a shorter motion or put the humanoid on its own layer.');
      if(samples.length*members.reduce((n,o)=>n+types.get(o.figure_type_id),0)>HUMAN_MOTION_LIMITS.layerBoneSamples)throw new RangeError('Put the humanoid on its own layer before generating motion in this dense scene.');
      const plan=planLayerSheetEdit(editor,[c.layerId]);
      let captures=0,bones=0;
      for(const {tick,pose}of samples){
        const source=motionFrameAt(report,Math.min(tick,oldEnd-1)),objects=source.objects.map(o=>o.unique_id===c.uid?{...pose,object_slot:o.object_slot}:o);
        const owned=objects.filter(o=>editor.layerForUid(o.unique_id)===c.layerId);captures+=owned.length;bones+=owned.reduce((n,o)=>n+types.get(o.figure_type_id),0);
        if(captures>HUMAN_MOTION_LIMITS.layerObjects)throw new RangeError('Generate a shorter motion or put the humanoid on its own layer.');
        if(bones>HUMAN_MOTION_LIMITS.layerBoneSamples)throw new RangeError('Put the humanoid on its own layer before generating motion in this dense scene.');
        if(!objects.some(o=>o.unique_id===c.uid))throw new Error('The humanoid must remain present throughout the generated range.');
        const frame={...source,objects};validateObjectChanges(report,frame,new Set([c.uid]));
        plan.write(c.layerId,tick,frame,{easing:{interpolation:'constant'},extend:true});
        await checkpoint();
      }
      if(end>oldEnd)for(const [id,track]of Object.entries(sheet.tracks))if(track.end===oldEnd&&!editor.getLayer(id)?.locked)plan.get(id).end=end;
      check();editor.removeEventListener('change',cancel);
      publishLayerSheetEdit(editor,plan,label);
    }else{
      const target={kind:'figure',uid:c.uid},id=animationChannelId(target,'pose'),draft=draftAnimation(editor),native=editor.nativePoseChannel(target);
      const before=editor.animationChannel(target,'pose')??native,channel={...before,id,target,source:'authored',keys:before.keys.filter(k=>k.tick<c.start||k.tick>=end).map(k=>({...k}))};
      delete channel.useBasePose;
      let next=identity;
      for(const {tick,pose}of samples){
        const frame=createFrame([snapshotPoseObject(pose)]),frameId=`frame-${next++}`;frame._styk={frameId};
        validateObjectChanges(report,frame,new Set([c.uid]));draft.sources[frameId]=frame;
        const existing=channel.keys.findIndex(k=>k.tick===tick&&!k.hidden),key={id:`human-${draft.after.nextKeyId++}`,tick,value:{frameId},interpolation:'constant'};
        if(existing>=0)channel.keys[existing]=key;else channel.keys.push(key);
        await checkpoint();
      }
      channel.keys.sort((a,b)=>a.tick-b.tick);draft.shareChannel(channel,target,id);
      const proposed={...report,_styk:{...report._styk,animation:draft.after,frameSources:{...report._styk.frameSources,...draft.sources}}};
      validateAnimationDocument(proposed);
      const frameSourceChanges=Object.entries(draft.sources).map(([id,value])=>({id,before:{exists:false},after:{exists:true,value}}));
      check();editor.removeEventListener('change',cancel);
      editor._nextFrameIdentity=next;
      recordAnimation(editor,label,draft,selection,{frameSourceChanges,hadFrameSourceTable:Object.hasOwn(report._styk,'frameSources')});
    }
    editor.seek(c.start);editor.select(c.uid);
    return {uid:c.uid,start:c.start,end,frames:prepared.poses.length,rig:prepared.rig};
  }finally{editor.removeEventListener('change',cancel);}
}
