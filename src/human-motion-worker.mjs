import {createPoseMotionSampler} from './pose-motion-sampler.mjs';
self.onmessage=({data})=>{
  try{
    const motion=createPoseMotionSampler(data),poses=[];
    for(let tick=0;tick<motion.settings.duration;tick++)poses.push(motion.sample(tick).pose);
    self.postMessage({ok:true,poses,rig:motion.rig});
  }catch(error){self.postMessage({ok:false,error:error.message});}
};
