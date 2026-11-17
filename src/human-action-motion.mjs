/**
 * Stylized action choreography for the planar human motion sampler: jumps,
 * punches, kicks and hit reactions. Each function is pure and deterministic;
 * it returns pelvis, torso, foot and hand targets that `human-motion.mjs`
 * resolves through the shared IK solver. Nothing here touches documents.
 */
export const ACTION_MOTIONS=Object.freeze(['jump','punch','kick','hit']);
/** Shortest useful duration in ticks; shorter actions skip their key poses. */
export const ACTION_MIN_TICKS=Object.freeze({jump:16,punch:12,kick:14,hit:8});
// Normalized key times shared by sampling and the reported timing events.
const JUMP={crouch:.3,takeoff:.4,land:.74,squash:.84};
const PUNCH={guard:.2,windup:.34,impact:.44,hold:.52,recover:.72};
const KICK={guard:.22,chamber:.38,impact:.48,hold:.55,rechamber:.66,down:.8};
const HIT={peak:.1};

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=t=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10);};
const outCubic=t=>1-(1-clamp(t))**3;
const mix=(a,b,t)=>a+(b-a)*t;

/**
 * Cubic Hermite interpolation through timed keys with neighbour-averaged
 * tangents, so poses flow through intermediate keys instead of stopping at
 * each one. Values are numbers or {f,d} hand offsets.
 */
function track(keys,u){
  const value=(i,k)=>typeof keys[i][1]==='number'?keys[i][1]:keys[i][1][k];
  const tangent=(i,k)=>i===0||i===keys.length-1?0:(value(i+1,k)-value(i-1,k))/(keys[i+1][0]-keys[i-1][0]);
  if(u<=keys[0][0])return keys[0][1];
  if(u>=keys.at(-1)[0])return keys.at(-1)[1];
  let i=0;while(u>keys[i+1][0])i++;
  const h=keys[i+1][0]-keys[i][0],s=(u-keys[i][0])/h,s2=s*s,s3=s2*s;
  const at=k=>(2*s3-3*s2+1)*value(i,k)+(s3-2*s2+s)*h*tangent(i,k)+(-2*s3+3*s2)*value(i+1,k)+(s3-s2)*h*tangent(i+1,k);
  return typeof keys[0][1]==='number'?at():{f:at('f'),d:at('d')};
}

/** Whole-tick timing marks for syncing camera hits, flashes and sound. */
export function actionEvents(action,duration){
  const at=(kind,u)=>({kind,tick:Math.round(u*(duration-1))});
  if(action==='jump')return [at('takeoff',JUMP.takeoff),at('land',JUMP.land)];
  if(action==='punch')return [at('impact',PUNCH.impact)];
  if(action==='kick')return [at('impact',KICK.impact)];
  if(action==='hit')return [at('recoil',HIT.peak)];
  return [];
}

/** The leading foot for a fighting stance; punches and kicks lead with the other side. */
export function actionFront(action,settings,restFront){
  if(action==='punch')return settings.hand==='left'?'right':'left';
  if(action==='kick')return settings.foot==='left'?'right':'left';
  return restFront;
}

const HANG={f:.04,d:.98},GUARD={f:.26,d:-.06},GUARD_REAR={f:.3,d:.02};

/**
 * Sample one action at normalized time `u`.
 * Context: root, ground (ankle height), legLength, restFeet, direction (facing),
 * front, intensity, height, distance, hand, foot, target and the entry weight.
 * Returned hands are {f,d} fractions of arm reach from the shoulder, f along the
 * facing direction and d downward; `to`/`toWeight` pull a hand toward a world target.
 * `twist` is a torso turn in radians for 3D characters (positive brings the right
 * shoulder forward); planar figures have no depth to show it.
 */
export function sampleAction(action,u,c){
  const L=c.legLength,dir=c.direction,I=Math.min(c.intensity,1.5);
  const back=c.front==='left'?'right':'left';
  const stanceX={[c.front]:c.root.x+dir*.28*L,[back]:c.root.x-dir*.24*L};
  const restBlend=(side,x,y)=>({x:mix(c.restFeet[side].x,x,c.entry),y:mix(c.restFeet[side].y,y,c.entry)});
  const planted=c.entry>=.999999;
  if(action==='jump'){
    const spread=.14*L,stand=c.ground-Math.sqrt((.975*L)**2-spread**2),depth=L*(.16+.08*I),take=stand,h=c.height,D=c.distance;
    const {crouch:A,takeoff:T,land:Ld,squash:S}=JUMP;
    const travel=u<T?.04*(u/T)**2:u<Ld?mix(.04,.96,(u-T)/(Ld-T)):mix(.96,1,outCubic((u-Ld)/(1-Ld)));
    let y,crouch=0;const s=clamp((u-T)/(Ld-T)),flying=u>T&&u<Ld,tuck=flying?Math.sin(Math.PI*s):0;
    if(u<A){y=stand+depth*ease(u/A);crouch=ease(u/A);}
    else if(u<T){const p=(u-A)/(T-A);y=stand+depth+(take-stand-depth)*p*p;crouch=1-p*p;}
    else if(u<Ld)y=take-h*4*s*(1-s);
    else if(u<S){const q=(u-Ld)/(S-Ld),drop=Math.sin(q*Math.PI/2);y=take+depth*1.15*drop;crouch=1.15*drop;}
    else{const r=ease((u-S)/(1-S));y=mix(take+depth*1.15,stand,r);crouch=1.15*(1-r);}
    const x=c.root.x+D*travel;y+=(c.root.y-stand)*(1-c.entry);
    const feet={};
    for(const side of ['left','right']){
      const out=Math.sign(c.restFeet[side].x-c.root.x)||(side==='left'?1:-1),base=c.root.x+out*spread;
      if(u<=T)feet[side]={...restBlend(side,base,c.ground),planted};
      else if(u<Ld)feet[side]={x:base+D*travel+dir*.12*L*tuck,y:y+(c.ground-take)*(1-.5*tuck*Math.min(1,I+.3)),planted:false,free:true};
      else feet[side]={x:base+D,y:c.ground,planted:true};
    }
    const lean=dir*(.32*crouch+.06*tuck)*Math.max(.4,I);
    const arm=v=>track([[0,HANG],[A,{f:-.45,d:.8}],[T,{f:.25,d:-.9}],[(T+Ld)/2,{f:.45,d:-.75}],[Ld,{f:.7,d:.05}],[S,{f:.6,d:.35}],[1,HANG]],v);
    return {x,y,lean,head:-lean*.5,feet,hands:{[c.front]:{...arm(u),bend:dir},[back]:{...arm(u-.025),bend:dir}},airborne:flying&&planted,legBend:-dir};
  }
  if(action==='punch'){
    const {guard:G,windup:W,impact:S,hold:H,recover:R}=PUNCH;
    const shift=track([[0,0],[G,0],[W,-.04],[S,.1*I],[H,.1*I],[R,0],[1,0]],u);
    const x=c.root.x+dir*L*shift,y=mix(c.root.y,c.ground-.93*L,c.entry)+.02*L*clamp(shift/.1);
    const lean=dir*track([[0,0],[G,.06],[W,-.02],[S,.24*I],[H,.22*I],[R,.06],[1,.06]],u);
    const strike=u<W?0:u<S?outCubic((u-W)/(S-W)):u<H?1:1-ease((u-H)/(R-H));
    const feet={};for(const side of ['left','right'])feet[side]={...restBlend(side,stanceX[side],c.ground),planted};
    const lead=track([[0,HANG],[G,GUARD],[W,{f:.1,d:0}],[R,GUARD],[1,GUARD]],u);
    const rear=track([[0,HANG],[G,GUARD_REAR],[S,{f:.18,d:.06}],[R,GUARD_REAR],[1,GUARD_REAR]],u);
    const other=c.hand==='left'?'right':'left',twist=(c.hand==='left'?-1:1)*track([[0,0],[G,.1],[W,-.25],[S,.5*I],[H,.45*I],[R,.1],[1,.1]],u);
    return {x,y,lean,twist,head:-lean*.5,feet,hands:{[c.hand]:{...lead,to:c.target,reach:c.target?null:{f:.97,d:-.02},toWeight:strike,lower:true},[other]:{...rear,lower:true}},airborne:false,legBend:-dir};
  }
  if(action==='kick'){
    const {guard:G,chamber:C,impact:X,hold:H,rechamber:Rc,down:D}=KICK,kicker=c.foot,support=kicker==='left'?'right':'left';
    const shift=track([[0,0],[G,.1],[C,.14],[X,.1],[H,.1],[Rc,.13],[D,.04],[1,0]],u);
    const x=c.root.x+dir*L*shift,y=mix(c.root.y,c.ground-.94*L,c.entry);
    const lean=dir*track([[0,0],[G,.04],[C,-.05],[X,-.32*I],[H,-.3*I],[Rc,-.06],[D,.04],[1,.04]],u);
    const home={x:stanceX[kicker],y:c.ground},chamber={x:x+dir*.28*L,y:y+.42*L};
    const target=c.target??{x:x+dir*.92*L,y:y-.05*L};
    let foot,free=true;
    if(u<=G){foot=restBlend(kicker,home.x,home.y);free=false;}
    else if(u<C){const p=ease((u-G)/(C-G));foot={x:mix(home.x,chamber.x,p),y:mix(home.y,chamber.y,p)-.08*L*Math.sin(Math.PI*p)};}
    else if(u<X){const p=outCubic((u-C)/(X-C));foot={x:mix(chamber.x,target.x,p),y:mix(chamber.y,target.y,p)};}
    else if(u<H)foot={...target};
    else if(u<Rc){const p=ease((u-H)/(Rc-H));foot={x:mix(target.x,chamber.x,p),y:mix(target.y,chamber.y,p)};}
    else if(u<D){const p=ease((u-Rc)/(D-Rc));foot={x:mix(chamber.x,home.x,p),y:mix(chamber.y,home.y,p)-.06*L*Math.sin(Math.PI*p)};}
    else{foot={...home};free=false;}
    // Keep the kicking foot inside the leg's reach so the support leg never stretches.
    const dx=foot.x-x,dy=foot.y-y,limit=.97*L,length=Math.hypot(dx,dy);
    if(free&&length>limit)foot={x:x+dx*limit/length,y:y+dy*limit/length};
    const feet={[support]:{...restBlend(support,stanceX[support],c.ground),planted},[kicker]:{...foot,planted:!free&&planted,free}};
    const balance=track([[0,HANG],[G,GUARD],[X,{f:-.3,d:.6}],[Rc,GUARD],[1,GUARD]],u),guard=track([[0,HANG],[G,GUARD_REAR],[X,{f:.32,d:-.1}],[1,GUARD_REAR]],u);
    const twist=(kicker==='left'?-1:1)*track([[0,0],[G,0],[X,-.3*I],[H,-.28*I],[D,0],[1,0]],u);
    return {x,y,lean,twist,head:-lean*.4,feet,hands:{[kicker]:{...balance,lower:true},[support]:{...guard,lower:true}},airborne:false,legBend:-dir};
  }
  if(action==='hit'){
    const P=HIT.peak,D=c.distance;
    const slide=track([[0,0],[P,.45],[.4,.95],[.55,1],[1,1]],u);
    const x=c.root.x+D*slide,y=mix(c.root.y,c.ground-.93*L,c.entry)+L*track([[0,0],[P,.03],[.3,.06],[.6,.02],[1,0]],u);
    const lean=dir*track([[0,0],[P,-.5*I],[.3,-.3*I],[.55,-.05],[.75,.08],[1,.06]],u);
    const snap=-dir*track([[0,0],[P*.7,.55*I],[.3,.1],[.6,0],[1,0]],u);
    const step=(side,a,b)=>{const p=ease((u-a)/(b-a)),start=restBlend(side,stanceX[side],c.ground);return {x:start.x+D*p,y:start.y-.12*L*Math.sin(Math.PI*p),planted:planted&&(u<=a||u>=b),free:u>a&&u<b};};
    const feet={[c.front]:step(c.front,.12,.38),[back]:step(back,.3,.52)};
    const flail=v=>track([[0,GUARD],[P,{f:.55,d:-.35}],[.45,{f:.35,d:.3}],[.8,GUARD],[1,GUARD]],v);
    const twist=track([[0,0],[P,.35*I],[.45,-.1],[.8,0],[1,0]],u);
    return {x,y,lean,twist,head:-lean*.3+snap,feet,hands:{[c.front]:{...flail(u),lower:true},[back]:{...flail(u-.03),lower:true}},airborne:false,legBend:-dir};
  }
  throw new Error(`Unknown action motion: ${action}`);
}
