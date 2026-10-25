import {appendCloth,clothMeshes,createClothDeformer} from './cloth-motion.mjs';
import {applyPoseMotion,poseMotionContext,motionFrameAt} from './editor-human-motion.mjs';
import {prepareHumanMotion} from './human-motion-client.mjs';
import {HUMAN_MOTION_LIMITS} from './human-motion.mjs';
import {snapshotPoseObject} from './pose-snapshot.mjs';

export const editorClothMethods={
  addCloth(options={}){
    const c=poseMotionContext(this,{},true,false),compiled=appendCloth(c.figure,options);
    this.replaceFigureDefinition(c.figure.figure_type_id,compiled.figure,{label:'Add cloth mesh'});
    return compiled.mesh;
  },
  getClothMeshes(){
    const c=poseMotionContext(this,{},false,false);
    return clothMeshes(c.figure).map(({nodes,...mesh})=>({...mesh,vertices:nodes.length,triangles:mesh.rows*mesh.columns*2,handleIds:nodes.map(n=>n.id)}));
  },
  previewClothMotion(options={},seconds=0){
    const c=poseMotionContext(this,{},false,false);
    return createClothDeformer(c.input.figure,options).apply(c.input.object,seconds);
  },
  async applyClothMotion(options={}, {signal}={}){
    for(const key of Object.keys(options))if(!['start','duration','after','cloth'].includes(key))throw new Error(`Unknown cloth bake option: ${key}`);
    if(options.after!==undefined&&!['hold','restore'].includes(options.after))throw new Error('after must be hold or restore.');
    const report=this.report,uid=this.selectedUid;
    return applyPoseMotion(this,options,{signal,humanoid:false,label:'Bake cloth motion',prepare:async(input,{signal})=>{
      const duration=options.duration??Math.round(input.fps*2),start=options.start??Math.round(this.tick);
      if(!Number.isInteger(duration)||duration<2||duration>HUMAN_MOTION_LIMITS.frames||duration*input.figure.segments.length>HUMAN_MOTION_LIMITS.boneSamples)throw new RangeError('Generate a shorter cloth motion for this figure.');
      if(!clothMeshes(input.figure).length)throw new Error('Add a cloth mesh before baking cloth motion.');
      // Capture the existing evaluated animation, not a repeated initial pose.
      const poses=[];let bytes=0,yielded=performance.now();
      for(let tick=0;tick<duration;tick++){
        signal.throwIfAborted();
        const source=motionFrameAt(report,Math.min(start+tick,this.totalTicks-1)).objects.find(o=>o.unique_id===uid);
        if(!source||source.join)throw new Error('The cloth figure must remain present and independent throughout the range.');
        const pose=snapshotPoseObject(source);pose.object_slot=0;
        for(const [flag,vector,field]of [['len_flag','lengths','length'],['bend_flag','bends','bend_rad']])if(!pose[flag]&&source.runtime_segments?.some((s,i)=>s[field]!==undefined&&s[field]!==input.figure.segments[i][field])){
          pose[flag]=1;pose[vector]=input.figure.segments.map((s,i)=>source.runtime_segments[i]?.[field]??s[field]??0);
        }
        bytes+=JSON.stringify(pose).length*2;if(bytes>HUMAN_MOTION_LIMITS.poseBytes)throw new RangeError('Generate a shorter cloth motion for this pose metadata size.');
        poses.push(pose);
        if(performance.now()-yielded>6){await new Promise(resolve=>setTimeout(resolve,0));yielded=performance.now();}
      }
      signal.throwIfAborted();
      return prepareHumanMotion({...input,kind:'cloth',poses},{signal});
    }});
  },
};
