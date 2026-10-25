import {createHumanMotion,HUMAN_MOTION_LIMITS} from './human-motion.mjs';
import {createClothDeformer} from './cloth-motion.mjs';

/** Shared preparation in the browser worker and cooperative Node runtime. */
export function createPoseMotionSampler(input) {
  if(input.kind!=='cloth')return createHumanMotion(input.figure,input.object,input.options,input.fps);
  const {figure,poses,options,fps}=input;
  if(!Array.isArray(poses)||poses.length<2||poses.length>HUMAN_MOTION_LIMITS.frames||poses.length*figure.segments.length>HUMAN_MOTION_LIMITS.boneSamples)throw new RangeError('Cloth motion exceeds the pose preparation limit.');
  const cloth=createClothDeformer(figure,options.cloth??{});
  if(!cloth.meshes.length)throw new Error('Add a cloth mesh before baking cloth motion.');
  return {settings:{duration:poses.length},rig:null,sample(tick){
    const current=poses[tick],previous=poses[Math.max(0,tick-1)];
    return {pose:cloth.apply(current,tick/fps,{velocity:{x:(current.root_x-previous.root_x)*fps,y:(current.root_y-previous.root_y)*fps}})};
  }};
}
