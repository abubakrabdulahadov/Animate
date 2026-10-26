import {quatRotate,spatialQuaternion} from './rig-spatial.mjs';
const clamp=t=>Math.max(0,Math.min(1,t));
const ease=t=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10);};
const mix=(a,b,t)=>a+(b-a)*t;
const inverseEase=t=>{let a=0,b=1;for(let i=0;i<40;i++){const m=(a+b)/2;if(ease(m)<t)a=m;else b=m;}return(a+b)/2;};
/** A bounded arc-length path, shared by root motion and world-space foot plants.
 * Random access has no dependence on previously requested frames. */
export function createSpatialLocomotion(planar,base,end,{moving=false,turning=false,scale=1,rootY=0}={}){
 const duration=planar.settings.duration,last=duration-1,travel=Math.abs(planar.settings.distance),sign=Math.sign(planar.settings.distance)||1;
 const delta=Math.atan2(Math.sin(end.yaw-base.yaw),Math.cos(end.yaw-base.yaw));
 const views=u=>{
  const body=ease((u-.12)/.88),torso=ease((u-.055)/.86),look=ease(u/.7);
  return {yaw:base.yaw+delta*body,torsoYaw:delta*(torso-body),headYaw:mix(base.headYaw,end.headYaw,ease(u))+delta*(look-torso)};
 };
 const N=512,points=[[0,0,0]];
 for(let i=1;i<=N;i++){const u=(i-.5)/N,yaw=views(u).yaw,d=travel*(ease(i/N)-ease((i-1)/N));points.push([points[i-1][0]+Math.sin(yaw)*d,0,points[i-1][2]+Math.cos(yaw)*d]);}
 const path=u=>{const at=clamp(u)*N,i=Math.min(N-1,Math.floor(at)),f=at-i;return points[i].map((v,k)=>mix(v,points[i+1][k],f));};
 const initial=planar.sample(0),cycles=moving?planar.sample(last).phase:turning?1:0;
 const foot=(side,u)=>{
  const sample=planar.sample(u*last);
  if(turning){
   // A wide turn needs a third step: never put one shoe onto the other shoe's plant.
   const wide=Math.abs(delta)>Math.PI/2,steps=wide?(side==='left'?[[.06,.26,0,.5],[.68,.26,.5,1]]:[[.36,.28,0,1]]):[[side==='left'?.08:.53,.37,0,1]];
   let amount=0,lift=0,planted=true;
   for(const [start,duration,from,to]of steps){if(u<start)break;const t=clamp((u-start)/duration);amount=mix(from,to,ease(t));lift=Math.sin(Math.PI*t)**2*12*scale;planted=t===0||t===1;}
   const yaw=base.yaw+delta*amount,p=quatRotate(spatialQuaternion(0,yaw,0),[(side==='left'?15:-15)*scale,0,0]);
   return {point:[p[0],planar.ground-18*scale-rootY-lift,p[2]],yaw,planted};
  }
  const offset=side==='left'?0:.5;
  // Use the planar sampler's actual leading leg, independent of rig record order.
  const f0=initial.contacts.left.ankle.x-initial.contacts.right.ankle.x;
  const leftFront=sign*f0>=0,phaseOffset=moving?(side===(leftFront?'left':'right')?0:.5):offset;
  const q=(moving?sample.phase:turning?u:0)+phaseOffset,k=Math.floor(q),f=q-k,stanceDuration=sample.contacts[side].stanceDuration??.62,stance=f<=stanceDuration;
  const phaseAt=c=>moving?inverseEase(clamp(c/Math.max(1e-9,cycles))):clamp(c);
  const plant=c=>{
   const at=phaseAt(c),s=planar.sample(at*last),p=path(at),heading=views(at).yaw;
   // Plant locations are fixed in world space for the complete stance interval.
   const longitudinal=moving?(s.contacts[side].ankle.x-s.pose.root_x)*sign:0;
   const relative=quatRotate(spatialQuaternion(0,heading,0),[(side==='left'?15:-15)*scale,0,longitudinal]);
   return {point:[p[0]+relative[0],0, p[2]+relative[2]],yaw:heading};
  };
  const start=plant(k-phaseOffset),finish=plant(k+1-phaseOffset),swing=ease((f-stanceDuration)/(1-stanceDuration)),t=stance?0:swing;
  const point=start.point.map((v,i)=>mix(v,finish.point[i],t));
  // Floor is independent of the pelvis's vertical bounce.
  point[1]=sample.contacts[side].ankle.y-rootY;
  return {point,yaw:mix(start.yaw,finish.yaw,t),planted:stance&&(moving?sample.contacts[side].planted:true)};
 };
 return {views,path,foot,moving,turning};
}
