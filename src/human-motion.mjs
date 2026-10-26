import {createClothDeformer} from './cloth-motion.mjs';
import {isSpatialCharacter,characterRig,spatialHumanMotion} from './spatial-character.mjs';
import {buildGeometry} from './pivot/geometry.mjs';
import {createFrame} from './demo.mjs';
import {ikLayout,ikChain,ikBendReference,solveIKPoints} from './ik.mjs';
import {snapshotPoseObject} from './pose-snapshot.mjs';
import {synchronizeAnimationOrigin} from './animation-origin.mjs';

export const HUMAN_MOTION_LIMITS=Object.freeze({frames:2400,boneSamples:500000,layerObjects:100000,layerBoneSamples:1000000,poseBytes:64*1024*1024});
export const HUMAN_ACTIONS=Object.freeze(['walk','run','idle','wave','reach','carry','putDown']);
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=t=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10);};
const mix=(a,b,t)=>a+(b-a)*t;
const angleMix=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
const finite=(value,label,min=-Infinity,max=Infinity)=>{
  if(!Number.isFinite(value)||value<min||value>max)throw new RangeError(`${label} must be finite, between ${min} and ${max}.`);return value;
};

/** Optional anatomy over ordinary native IDs; never inferred from record indexes. */
export function humanRig(figure,mapping) {
  if(isSpatialCharacter(figure)){
    const rig=characterRig(figure);if(mapping&&(Object.keys(mapping).some(k=>!Object.hasOwn(rig,k))||Object.keys(rig).some(k=>JSON.stringify(mapping[k])!==JSON.stringify(rig[k]))))throw new Error('Use the spatial character’s own anatomy mapping.');return rig;
  }
  const segments=figure.segments,ids=new Map(segments.map((s,i)=>[s.segment_id,i]));
  const children=id=>segments.filter(s=>s.parent_id===id);
  const line=s=>s&&s.segment_type==='line'&&![1,2,3,4,5].includes(s.primitive_code);
  if(!mapping){
    const candidates=children(0).filter(line);
    const spines=candidates.map(root=>{const chain=[root];while(chain.length<8){const tip=chain.at(-1),next=children(tip.segment_id);
      if(next.some(c=>c.segment_type==='circle'))return chain;const lines=next.filter(line);if(lines.length!==1)return null;chain.push(lines[0]);}return null;});
    const spine=spines.find(Boolean),body=spine?.at(-1);
    if(!body)throw new Error('Cannot identify this humanoid. Supply a rig mapping with spine, head, arm and leg IDs.');
    const head=children(body.segment_id).find(s=>s.segment_type==='circle');
    let arms=children(body.segment_id).filter(s=>line(s)&&children(s.segment_id).some(line));
    let legs=candidates.filter(s=>s!==spine[0]&&children(s.segment_id).some(line));
    const namedArms=arms.filter(s=>/upper arm/i.test(s.name??'')),namedLegs=legs.filter(s=>/thigh|upper leg/i.test(s.name??''));
    if(namedArms.length===2)arms=namedArms;if(namedLegs.length===2)legs=namedLegs;
    if(arms.length!==2||legs.length!==2)throw new Error('Humanoid detection is ambiguous; supply an explicit rig mapping.');
    const paired=list=>{
      const named=list.find(s=>/\bleft\b/i.test(s.name??''));if(named)list=[named,...list.filter(s=>s!==named)];
      else list=[...list].sort((a,b)=>a.segment_id-b.segment_id);
      return list.map(s=>[s.segment_id,children(s.segment_id).find(line).segment_id]);
    };
    const [leftArm,rightArm]=paired(arms),[leftLeg,rightLeg]=paired(legs);
    mapping={spine:spine.map(s=>s.segment_id),head:head.segment_id,leftArm,rightArm,leftLeg,rightLeg};
    for(const side of ['left','right']){const feet=children(mapping[`${side}Leg`][1]).filter(s=>line(s)&&/foot|toe/i.test(s.name??''));if(feet.length===1)mapping[`${side}Foot`]=feet[0].segment_id;}
  }
  for(const key of Object.keys(mapping))if(!['spine','head','leftArm','rightArm','leftLeg','rightLeg','leftFoot','rightFoot'].includes(key))throw new Error(`Unknown rig role: ${key}`);
  const rig=structuredClone(mapping),all=[];
  for(const role of ['spine','leftArm','rightArm','leftLeg','rightLeg']){
    const chain=rig[role];if(!Array.isArray(chain)||chain.length<(role==='spine'?1:2)||chain.length>(role==='spine'?8:2))throw new Error(`${role} needs ${role==='spine'?'1–8':'two'} connected bone IDs.`);
    for(let i=0;i<chain.length;i++){
      const segment=segments[ids.get(chain[i])];if(!segment||!line(segment)||segment.length<=0||segment.is_static||segment.aux_code&1||segment.flags&256)throw new Error(`Invalid or static ${role} bone ${chain[i]}.`);
      if(i&&segment.parent_id!==chain[i-1])throw new Error(`${role} bones must form a connected chain.`);all.push(chain[i]);
    }
  }
  const shoulder=rig.spine.at(-1);
  if(segments[ids.get(rig.spine[0])].parent_id!==0||['leftLeg','rightLeg'].some(r=>segments[ids.get(rig[r][0])].parent_id!==0)||
    ['leftArm','rightArm'].some(r=>segments[ids.get(rig[r][0])].parent_id!==shoulder)||segments[ids.get(rig.head)]?.parent_id!==shoulder)
    throw new Error('Use a pelvis-rooted planar rig, with arms and head attached to the spine tip.');
  all.push(rig.head);
  for(const side of ['left','right'])if(rig[`${side}Foot`]!==undefined){
    const foot=segments[ids.get(rig[`${side}Foot`])];if(!line(foot)||foot.parent_id!==rig[`${side}Leg`][1])throw new Error('Foot artwork must attach to its ankle.');all.push(foot.segment_id);
  }
  if(new Set(all).size!==all.length||all.some(id=>!ids.has(id)))throw new Error('Human rig roles must use distinct existing native IDs.');
  if(segments.some(s=>s._stykRig)||figure._styk?.animationOrigin)throw new Error('Human motion currently supports ordinary planar rigs without spatial/connector or re-rooted origin constraints.');
  return rig;
}

export function motionOptions(options,legLength,fps) {
  for(const key of Object.keys(options))if(!['action','rig','start','duration','distance','stepLength','groundY','intensity','hand','target','blend','after','cloth','carry','armBend'].includes(key))throw new Error(`Unknown human motion option: ${key}`);
  const action=options.action??'walk',duration=options.duration??Math.round(fps*2),blend=options.blend??.25;
  if(!HUMAN_ACTIONS.includes(action))throw new Error('Choose walk, run, idle, wave, reach, carry or putDown.');
  if(!Number.isInteger(duration)||duration<2||duration>HUMAN_MOTION_LIMITS.frames)throw new RangeError(`duration must be 2–${HUMAN_MOTION_LIMITS.frames} ticks.`);
  const distance=finite(options.distance??(action==='run'?legLength*5:action==='walk'?legLength*2:0),'distance',-legLength*100,legLength*100);
  if(['walk','run'].includes(action)&&Math.abs(distance)<1e-6)throw new Error('Walking or running needs a nonzero distance; use idle to stand.');
  if(!['walk','run','carry'].includes(action)&&distance!==0)throw new Error('distance belongs to walk, run or carry motion.');
  const stepLength=finite(options.stepLength??legLength*(action==='run'?.65:.48),'stepLength',legLength*.12,legLength*(action==='run'?.85:.55));
  const intensity=finite(options.intensity??1,'intensity',0,1.5);finite(blend,'blend',0,2);
  const armBend=finite(options.armBend??(action==='run'?1.35:.1),'armBend',0,action==='run'?1.8:.35);
  if(!(['carry','putDown'].includes(action)?['left','right','both']:['left','right']).includes(options.hand??'right'))throw new Error('Choose left/right, or both for carrying.');
  const carry=options.carry??(['carry','putDown'].includes(action)?{hand:options.hand??'right'}:null);
  if(carry){if(typeof carry!=='object'||Array.isArray(carry)||Object.keys(carry).some(k=>!['hand','forward','height','weight','loadHeight'].includes(k)))throw new Error('carry needs hand and optional forward, height, weight and loadHeight.');
    if(!['left','right','both'].includes(carry.hand))throw new Error('Choose a left, right or both carry grip.');
    finite(carry.weight??0,'carry.weight',0,1);finite(carry.loadHeight??legLength*.4,'carry.loadHeight',0,legLength*1.5);
    finite(carry.forward??.45,'carry.forward',.1,.7);finite(carry.height??.32,'carry.height',.05,.7);
    if(['wave','reach'].includes(action))throw new Error('Use carry with walk, idle or carry motion.');}
  else if(options.carry!==undefined&&options.carry!==null)throw new Error('carry needs an object.');
  if(options.after!==undefined&&!['hold','restore'].includes(options.after))throw new Error('after must be hold or restore.');
  if(options.groundY!==undefined)finite(options.groundY,'groundY');
  if(action==='reach'&&(!options.target||!Number.isFinite(options.target.x)||!Number.isFinite(options.target.y)))throw new Error('Reach needs a finite world-space target {x,y}.');
  return {...options,carry,armBend,action,duration,distance,stepLength,intensity,blend,hand:options.hand??'right',after:options.after??'hold'};
}

/** Build one small, immutable sampling context; no document or renderer caches. */
export function createHumanMotion(figure,object,options={},fps=24) {
  if(isSpatialCharacter(figure)){
    humanRig(figure,options.rig);
    const duration=options.duration??Math.round(fps*2);
    if(duration*figure.segments.length>HUMAN_MOTION_LIMITS.boneSamples||JSON.stringify(object).length*2*duration>HUMAN_MOTION_LIMITS.poseBytes)throw new RangeError('Generate a shorter spatial motion for this character.');
    return spatialHumanMotion(figure,object,options,fps,createHumanMotion);
  }
  if(object.join||!Number.isFinite(object.scale)||object.scale<=0)throw new Error('Select an independent, positively scaled humanoid.');
  const rig=humanRig(figure,options.rig),layout=ikLayout(figure),scale=object.scale;
  const frame=createFrame([{...object,object_slot:0}]);
  const geometry=buildGeometry({figure_types:[figure],keyframes:[frame],version:5},frame).objects.get(0);
  let verticalOffset=0;
  const index=id=>layout.ids.get(id),point=id=>{const p=geometry.joints.get(id);return {x:p.x,y:p.y+verticalOffset};};
  const angles=figure.segments.map((s,i)=>geometry.segments[i].angle),lengths=figure.segments.map((s,i)=>geometry.segments[i].length);
  for(const role of ['spine','leftArm','rightArm','leftLeg','rightLeg'])for(const id of rig[role])if(Math.abs(object.bend_flag?object.bends[index(id)]??0:figure.segments[index(id)].bend_rad??0)>1e-7)throw new Error('Human motion needs straight articulated bones.');
  const legLength=Math.min(...['leftLeg','rightLeg'].map(role=>rig[role].reduce((n,id)=>n+Math.abs(lengths[index(id)]),0)));
  const settings=motionOptions(options,legLength,fps);
  const running=settings.action==='run',walking=running||settings.action==='walk'||settings.action==='carry'&&Math.abs(settings.distance)>1e-6;
  const unloaded=!(settings.carry?.weight>0),standing=!walking&&unloaded&&settings.action!=='putDown';
  if(standing&&['idle','carry'].includes(settings.action)&&options.blend===undefined)settings.blend=0;
  const cloth=options.cloth===false?null:createClothDeformer(figure,options.cloth??{});
  if(walking&&Math.ceil(Math.abs(settings.distance)/(settings.stepLength*(1-.25*(settings.carry?.weight??0))*2))>settings.duration/(running?8:12))throw new RangeError(`Locomotion needs at least ${running?8:12} frames per stride; increase duration or reduce distance.`);
  if(settings.duration*figure.segments.length>HUMAN_MOTION_LIMITS.boneSamples)throw new RangeError('Generate a shorter motion for this dense figure.');
  if(JSON.stringify(object).length*2*settings.duration>HUMAN_MOTION_LIMITS.poseBytes)throw new RangeError('Generate a shorter motion for this pose’s metadata size.');
  const managed=new Set(['leftArm','rightArm','leftLeg','rightLeg'].map(role=>rig[role][1]));
  if(Object.entries(object._stykIK??{}).some(([id,c])=>c.enabled&&c.pinned&&!managed.has(Number(id))))throw new Error('Unpin additional IK controllers before generating human motion.');
  const sole=finite(figure._styk?.footSole??0,'foot sole offset',0,100)*scale;
  const baseGround=Math.max(point(rig.leftLeg[1]).y,point(rig.rightLeg[1]).y)+sole;
  verticalOffset=(settings.groundY??baseGround)-baseGround;
  const root={...geometry.root,y:geometry.root.y+verticalOffset},restFeet={left:{...point(rig.leftLeg[1])},right:{...point(rig.rightLeg[1])}};
  const ground=(settings.groundY??baseGround)-sole,direction=Math.sign(settings.distance)||1;
  const durationSeconds=(settings.duration-1)/fps,front=direction*(restFeet.left.x-restFeet.right.x)>=0?'left':'right';
  const rest=snapshotPoseObject(object);rest.angles=angles.slice();
  // Solver lengths are world-space; native pose lengths remain unscaled.
  const nativeLengths=lengths.map(length=>length/scale);
  const sample=tick=>{
    finite(tick,'sample tick',0,settings.duration-1);
    const seconds=tick/fps,u=tick/(settings.duration-1),entry=settings.blend===0?1:ease(seconds/settings.blend),weight=settings.blend===0?1:Math.min(entry,ease((durationSeconds-seconds)/settings.blend));
    // Finish complete strides so deceleration never leaves a foot suspended.
    const lowering=settings.action==='putDown'?ease((u-.08)/.5)*(1-ease((u-.65)/.35)):0,release=settings.action==='putDown'?ease((u-.6)/.05):0;
    const load=(settings.carry?.weight??0)*(1-release),spacing=settings.stepLength*(1-.25*(settings.carry?.weight??0));
    const strides=Math.ceil(Math.abs(settings.distance)/(spacing*2)),step=walking?Math.abs(settings.distance)/(2*strides):spacing;
    const d=settings.distance*ease(u),cycle=walking?strides*ease(u):0,phase=cycle*Math.PI*2;
    const speedWeight=Math.sin(Math.PI*u)**2,breath=Math.sin(seconds*2*Math.PI*.32),motion=settings.intensity;
    const body=(walking?motion*speedWeight:motion*weight)*(1-.45*load);
    const reachWeight=settings.action==='reach'?ease(seconds/Math.max(.2,durationSeconds*.55))*weight:0,reachDirection=Math.sign((settings.target?.x??root.x)-root.x)||1;
    const x=root.x+d-direction*legLength*.025*load*weight+(walking?legLength*(unloaded&&!running?.004:.012)*Math.sin(phase*2)*speedWeight*motion:0)+(walking?0:legLength*(standing?.0008:.008)*Math.sin(seconds*1.7)*weight*motion)-reachDirection*legLength*.012*reachWeight;
    const stanceDuration=running?.62-.24*speedWeight:.62;
    const phases=[cycle%1,(cycle+.5)%1],airborne=running&&phases.every(f=>f>stanceDuration);
    const flight=airborne?legLength*.035*Math.sin(Math.PI*(phases[0]%.5-stanceDuration)/Math.max(.001,.5-stanceDuration))**2*speedWeight:0;
    let y=walking?mix(root.y,ground-legLength*(running?.94:unloaded?.985:.91),weight)+legLength*(unloaded&&!running?.0025:.012)*Math.cos(phase*2+.35)*body-flight:standing?mix(root.y,ground-legLength*.9995,entry)+legLength*.0015*breath*body:root.y+legLength*.004*breath*body;
    const squat=clamp(.62+(.5*legLength-(settings.carry?.loadHeight??legLength*.4))/legLength,.5,.85);
    y+=legLength*(.05*load+squat*lowering);
    const owned=new Map(),contacts={},targets={},grips={};
    const lean=direction*(.18*load+.65*lowering)+(walking?direction*((running?.16:unloaded?.012:.055)+(unloaded&&!running?.006:.025)*Math.sin(phase-.35))*body:(standing?.004:.012)*breath*body)+reachDirection*.07*reachWeight;
    for(let i=0;i<rig.spine.length;i++){
      const id=rig.spine[i],base=angles[index(id)],twist=(standing?.002:unloaded&&!running?.004:.018)*Math.sin(phase+.5+i*.4)*body;
      owned.set(id,walking||standing?angleMix(base,-Math.PI/2+lean+(i%2?-twist:twist),standing?entry:weight):base+lean+(i%2?-.01:.01)*breath*body);
    }
    owned.set(rig.head,angles[index(rig.head)]+lean*.25+.009*Math.sin(seconds*2*Math.PI*.32-.5)*body);
    const currentPoints=()=>{
      const points=new Map([[0,{x,y}]]),deltas=new Map([[0,0]]),poseAngles=[];
      for(const i of layout.order){const s=figure.segments[i],a=owned.get(s.segment_id)??angles[i]+(deltas.get(s.parent_id)??0),p=points.get(s.parent_id)??{x,y};
        poseAngles[i]=a;deltas.set(s.segment_id,a-angles[i]);points.set(s.segment_id,{x:p.x+Math.cos(a)*lengths[i],y:p.y+Math.sin(a)*lengths[i]});}
      return {points,poseAngles};
    };
    const feet={};
    for(const side of ['left','right']){
      const offset=side===front?0:.5;
      const q=cycle+offset,k=Math.floor(q),f=q-k,stance=f<=stanceDuration,swing=clamp((f-stanceDuration)/(1-stanceDuration));
      const neutral=root.x+direction*2*step*((running?.38:.62)/2-offset);
      let fx=(unloaded&&walking?mix(restFeet[side].x,neutral,entry):restFeet[side].x)+direction*2*step*k,fy=restFeet[side].y;
      if(standing){const out=Math.sign(restFeet[side].x-root.x)||(side==='left'?1:-1);fx=mix(restFeet[side].x,root.x+out*legLength*.14,entry);fy=mix(restFeet[side].y,ground,entry);}
      if(walking){
        if(!stance)fx+=direction*2*step*ease(swing);
        fy=ground-legLength*(running?.22:unloaded?.045:.16)*Math.sin(Math.PI*swing)**2*speedWeight*(running?Math.max(.25,motion):motion);
      }
      feet[side]={x:fx,y:fy};contacts[side]={phase:f,stanceDuration,planted:walking?stance&&entry>=.999999:standing?entry>=.999999:true,point:{x:fx,y:fy+sole},ankle:{x:fx,y:fy}};
    }
    // Lower the pelvis only when needed for a reachable, slightly flexed knee.
    for(const side of ['left','right']){
      const reach=rig[`${side}Leg`].reduce((n,id)=>n+lengths[index(id)],0)*(walking?(unloaded&&!running?.995:.985):standing?.9995:1),dx=feet[side].x-x;
      if(Math.abs(dx)>=reach)throw new Error('Stride exceeds this rig’s leg reach; reduce stepLength or use a standing source pose.');
      y=Math.max(y,feet[side].y-Math.sqrt(reach*reach-dx*dx));
    }
    if(walking)y=mix(root.y,y,entry);
    const solve=(role,target,bend,lowerElbow=false)=>{
      const before=currentPoints(),chain=rig[role],parent=figure.segments[index(chain[0])].parent_id;
      const points=[{...before.points.get(parent)},...chain.map(id=>({...before.points.get(id)}))],sizes=chain.map(id=>lengths[index(id)]);
      solveIKPoints(points,sizes,target,bend);
      if(lowerElbow){const alternate=[{...before.points.get(parent)},...chain.map(id=>({...before.points.get(id)}))];solveIKPoints(alternate,sizes,target,-bend);
        if(alternate[1].y>points[1].y)points.splice(0,points.length,...alternate);}
      chain.forEach((id,i)=>owned.set(id,Math.atan2(points[i+1].y-points[i].y,points[i+1].x-points[i].x)));
      targets[role]={requested:{...target},actual:{...points.at(-1)},error:Math.hypot(points.at(-1).x-target.x,points.at(-1).y-target.y)};
    };
    for(const side of ['left','right']){
      const chain=rig[`${side}Leg`],a=point(chain[0]),b=point(chain[1]),cross=(b.x-root.x)*(a.y-root.y)-(b.y-root.y)*(a.x-root.x);
      solve(`${side}Leg`,feet[side],walking||standing||settings.action==='putDown'||load>0?-direction:Math.sign(cross)||-1);
      if(rig[`${side}Foot`]!==undefined){const id=rig[`${side}Foot`];owned.set(id,walking||standing?angleMix(angles[index(id)],sole?0:direction>0?0:Math.PI,entry):angles[index(id)]);}
    }
    for(const side of ['left','right']){
      const role=`${side}Arm`,upper=rig[role][0],lower=rig[role][1],shoulder=currentPoints().points.get(figure.segments[index(upper)].parent_id);
      const a=lengths[index(upper)],b=lengths[index(lower)],out=side==='left'?1:-1;
      const relaxed=walking||['carry','putDown'].includes(settings.action);
      const opposing=side===front?-1:1,armPhase=phase-.22,armSwing=walking?(running?.62:.22)*Math.cos(armPhase)*opposing*direction*Math.min(body,1.2):0;
      const flex=settings.armBend*(.85+.15*Math.abs(Math.sin(armPhase))),reach=Math.sqrt(a*a+b*b+2*a*b*Math.cos(flex));
      let hand={x:shoulder.x+Math.sin(armSwing)*reach,y:shoulder.y+Math.cos(armSwing)*reach};
      if(!relaxed)hand={x:point(lower).x+(x-root.x)+out*.012*(a+b)*breath*body,y:point(lower).y+(y-root.y)+.004*breath*(a+b)*body};
      if(settings.action==='wave'&&side===settings.hand){
        const raise=ease(seconds/Math.max(.2,durationSeconds*.22))*(1-ease((seconds-durationSeconds*.78)/Math.max(.2,durationSeconds*.22)));
        hand={x:mix(hand.x,shoulder.x+out*(.43+.12*Math.sin(seconds*8))*(a+b),raise),y:mix(hand.y,shoulder.y-(a+b)*(.39+.04*Math.cos(seconds*8)),raise)};
      }
      if(settings.action==='reach'&&side===settings.hand){
        const reach=reachWeight;
        hand={x:mix(hand.x,settings.target.x,reach),y:mix(hand.y,settings.target.y,reach)-Math.sin(Math.PI*reach)*(a+b)*.09};
      }
      const restStart=point(figure.segments[index(upper)].parent_id),restElbow=point(upper),restHand=point(lower);
      const restBend=Math.sign((restHand.x-restStart.x)*(restElbow.y-restStart.y)-(restHand.y-restStart.y)*(restElbow.x-restStart.x))||out;
      const relaxedHand={...hand};
      const carrying=settings.carry&&(settings.carry.hand===side||settings.carry.hand==='both');
      if(carrying)hand={x:shoulder.x+direction*(settings.carry.forward??.45)*(a+b)+(settings.carry.hand==='both'?out*.025*(a+b):0),y:shoulder.y+(settings.carry.height??.32)*(a+b)};
      if(carrying&&lowering)hand={x:mix(hand.x,x+direction*legLength*.73,lowering),y:mix(hand.y,ground+sole-(settings.carry.loadHeight??legLength*.4),lowering)};
      if(carrying&&release>0)hand={x:mix(hand.x,relaxedHand.x,release*(1-lowering)),y:mix(hand.y,relaxedHand.y,release*(1-lowering))};
      solve(role,hand,relaxed?direction:settings.action!=='idle'&&side===settings.hand?out:restBend,carrying);
    }
    const final=currentPoints(),pose=snapshotPoseObject(rest);pose.root_x=x;pose.root_y=y;pose.angles=final.poseAngles;
    if(walking&&entry<1)pose.angles=pose.angles.map((a,i)=>angleMix(angles[i],a,entry));
    if(['wave','reach'].includes(settings.action)&&weight<1)for(const id of rig[`${settings.hand}Arm`])pose.angles[index(id)]=angleMix(angles[index(id)],pose.angles[index(id)],weight);
    if(settings.carry&&!walking&&entry<1)for(const side of ['left','right'])if(settings.carry.hand===side||settings.carry.hand==='both')for(const id of rig[`${side}Arm`])pose.angles[index(id)]=angleMix(angles[index(id)],pose.angles[index(id)],entry);
    if(object.len_flag||nativeLengths.some((n,i)=>Math.abs(n-figure.segments[i].length)>1e-6)){pose.len_flag=1;pose.lengths=nativeLengths.slice();}
    const baked=new Map([[0,{x:pose.root_x,y:pose.root_y}]]);
    for(const i of layout.order){const s=figure.segments[i],p=baked.get(s.parent_id),a=pose.angles[i];baked.set(s.segment_id,{x:p.x+Math.cos(a)*lengths[i],y:p.y+Math.sin(a)*lengths[i]});}
    for(const role of ['leftArm','rightArm','leftLeg','rightLeg']){const actual=baked.get(rig[role][1]);targets[role].actual={...actual};targets[role].error=Math.hypot(actual.x-targets[role].requested.x,actual.y-targets[role].requested.y);}
    if(settings.carry)for(const side of ['left','right'])if(settings.carry.hand===side||settings.carry.hand==='both')grips[side]={...baked.get(rig[`${side}Arm`][1])};
    if(pose._stykIK)for(const [id,controller]of Object.entries(pose._stykIK))if(managed.has(Number(id))){
      controller.pinned=false;controller.target={...controller.target,...baked.get(Number(id))};
      const chain=ikChain(figure,Number(id),controller.chainLength,layout),points=[baked.get(figure.segments[chain[0]].parent_id),...chain.map(i=>baked.get(figure.segments[i].segment_id))];
      controller.bendReference=ikBendReference(points,chain.map(i=>lengths[i]),controller.bendReference);
    }
    const velocity=settings.distance*30*u*u*(u-1)*(u-1)/durationSeconds;
    const draped=cloth?.meshes.length?cloth.apply(pose,seconds,{joints:baked,velocity:{x:velocity,y:0}}):pose;
    synchronizeAnimationOrigin(figure,draped);
    const support=walking?Math.cos(phase)*(front==='left'?1:-1)*body:0;
    return {pose:draped,contacts,targets,grips,phase:cycle,weight,entry,support,airborne:running&&feet.left.y<ground-legLength*.0001&&feet.right.y<ground-legLength*.0001&&Object.values(contacts).every(c=>!c.planted)&&entry>=.999999,load:{weight:load,lowering,released:release>=.999999}};
  };
  return {rig,settings,legLength,root,ground:ground+sole,sample};
}
