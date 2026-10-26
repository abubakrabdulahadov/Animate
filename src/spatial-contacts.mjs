import {quatRotate,spatialPoint} from './rig-spatial.mjs';
import {inverseQuaternion} from './ik-spatial.mjs';
/** Conservative torso core in the shirt's own articulated frame. Hidden control
 * bones do not supply collision geometry; authored mesh density stays irrelevant. */
export function torsoContact(elbow,wrist,frame){
 const local=p=>quatRotate(inverseQuaternion(frame.q),p.map((v,i)=>v-frame.t[i]));
 const a=local(elbow),b=local(wrist),center=[0,-30,0],radius=[30,43,22];
 let minimum=Infinity;
 for(let i=0;i<=8;i++){const t=i/8,p=a.map((v,k)=>(v+(b[k]-v)*t-center[k])/radius[k]);minimum=Math.min(minimum,p.reduce((n,v)=>n+v*v,0));}
 return {penetrating:minimum<.96,local:b,world:p=>spatialPoint(frame,p),clearance:minimum};
}

/** Exact slab sweep for a point against an expanded axis-aligned box. */
export function sweepBox(a,b,box,radius=0,vertical=[-125,121]){
 const lo=box.position.map((v,i)=>v-box.size[i]/2-(i===1?0:radius)),hi=box.position.map((v,i)=>v+box.size[i]/2+(i===1?0:radius));
 // Broad body capsule: a floor below the soles is a receiver, not a wall.
 if(lo[1]>=Math.max(a[1],b[1])+vertical[1]-.25||hi[1]<=Math.min(a[1],b[1])+vertical[0])return null;
 let enter=0,leave=1;
 for(const k of [0,2]){const d=b[k]-a[k];if(Math.abs(d)<1e-9){if(a[k]<lo[k]||a[k]>hi[k])return null;}else{let x=(lo[k]-a[k])/d,y=(hi[k]-a[k])/d;if(x>y)[x,y]=[y,x];enter=Math.max(enter,x);leave=Math.min(leave,y);if(enter>leave)return null;}}
 return {time:enter,box:box.name??'Box'};
}
