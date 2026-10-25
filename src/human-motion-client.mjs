import {createHumanMotion} from './human-motion.mjs';

/** One bounded preparation, terminated on cancellation; no persistent pose cache. */
export async function prepareHumanMotion(input,{signal}={}) {
  signal?.throwIfAborted();
  if(typeof Worker==='undefined'){
    const motion=createHumanMotion(input.figure,input.object,input.options,input.fps),poses=[];
    let yielded=performance.now();
    for(let tick=0;tick<motion.settings.duration;tick++){
      signal?.throwIfAborted();poses.push(motion.sample(tick).pose);
      if(performance.now()-yielded>6){await new Promise(resolve=>setTimeout(resolve,0));yielded=performance.now();}
    }
    signal?.throwIfAborted();return {poses,rig:motion.rig};
  }
  const worker=new Worker(new URL('./human-motion-worker.mjs',import.meta.url),{type:'module',name:'StykAnimate human motion'});
  let abort,timer;
  try{return await new Promise((resolve,reject)=>{
    abort=()=>reject(signal.reason??new DOMException('Human motion cancelled.','AbortError'));
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>reject(new Error('Human motion preparation timed out.')),120000);
    worker.onmessage=({data})=>data.ok?resolve(data):reject(new Error(data.error));
    worker.onerror=event=>{event.preventDefault();reject(new Error(event.message||'Human motion worker stopped.'));};
    worker.onmessageerror=()=>reject(new Error('Human motion result could not be transferred.'));
    worker.postMessage(input);if(signal?.aborted)abort();
  });}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();}
}
