import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHumanMotion} from '../src/human-motion.mjs';
import {createCartoonCharacter} from '../src/filled-art.mjs';
import {defaultFigure,createObject,createFrame} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {Editor} from '../src/editor.mjs';
import {createStartupDocument} from '../src/startup-document.mjs';
import {AgentSession} from '../scripts/agent-session.mjs';
import {AgentEngine} from '../src/agent-engine.mjs';
import {characterBones} from '../src/spatial-character.mjs';
import {spatialPoint} from '../src/rig-spatial.mjs';

const close=(a,b,t=1e-3)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const figures=()=>[defaultFigure(),createCartoonCharacter().figure];
const joints=(f,pose)=>buildGeometry({version:5,figure_types:[f]},createFrame([{...pose,object_slot:0}])).objects.get(0).joints;
const settled=(m,from=8)=>Array.from({length:m.settings.duration-from},(_,i)=>m.sample(from+i));

function assertGroundedRig(f,m,samples){
  for(const s of samples){
    const g=joints(f,s.pose);
    for(const role of ['leftArm','rightArm','leftLeg','rightLeg'])for(const id of m.rig[role]){
      const segment=f.segments.find(b=>b.segment_id===id),start=g.get(segment.parent_id),end=g.get(id);
      close(Math.hypot(end.x-start.x,end.y-start.y),segment.length,1e-4);
    }
    for(const side of ['left','right'])if(s.contacts[side].planted)close(s.contacts[side].point.y,m.ground,.01);
    for(const role of ['leftLeg','rightLeg'])if(s.contacts[role==='leftLeg'?'left':'right'].planted)assert.ok(s.targets[role].error<.01);
  }
}

test('jumps crouch, leave the floor with both feet, travel exactly and land planted',()=>{
 for(const f of figures())for(const distance of [0,140,-140]){
  const m=createHumanMotion(f,createObject(f,1,300,300),{action:'jump',duration:40,distance,height:70,groundY:550});
  const samples=settled(m),start=m.sample(0).pose.root_y;let flights=0,highest=Infinity,lowest=-Infinity;
  for(const s of samples){if(s.airborne){flights++;for(const side of ['left','right']){assert.ok(!s.contacts[side].planted);assert.ok(s.contacts[side].point.y<m.ground-.01);}}highest=Math.min(highest,s.pose.root_y);lowest=Math.max(lowest,s.pose.root_y);}
  assertGroundedRig(f,m,samples);
  assert.ok(flights>=8,'Jump should spend several ticks airborne');
  assert.ok(start-highest>60,'Pelvis should rise close to the requested height');
  assert.ok(lowest-start>m.legLength*.1,'Jump should crouch before take-off or after landing');
  const end=m.sample(39);close(end.pose.root_x-300,distance,1e-6);for(const side of ['left','right'])assert.ok(end.contacts[side].planted);
  const [takeoff,land]=m.events;assert.deepEqual(m.events.map(e=>e.kind),['takeoff','land']);
  assert.ok(m.sample(takeoff.tick+1).airborne&&m.sample(land.tick-1).airborne&&!m.sample(land.tick+1).airborne);
  assert.deepEqual(m.sample(20),m.sample(20));
 }
});

test('punches strike a reachable target at the impact tick and return to guard',()=>{
 for(const f of figures())for(const facing of [1,-1])for(const hand of ['left','right']){
  const object=createObject(f,1,300,300),probe=createHumanMotion(f,object,{action:'punch',duration:24,hand,facing,groundY:550});
  const impact=probe.events[0].tick,shoulder=joints(f,probe.sample(impact).pose).get(probe.rig.spine.at(-1));
  const target={x:shoulder.x+facing*probe.legLength*.55,y:shoulder.y+4};
  const m=createHumanMotion(f,object,{action:'punch',duration:24,hand,target,groundY:550}),samples=settled(m);
  assertGroundedRig(f,m,samples);
  const hit=m.sample(impact);assert.ok(hit.targets[`${hand}Arm`].error<.5,`hand should land on the target, error ${hit.targets[`${hand}Arm`].error}`);
  for(const s of samples)for(const side of ['left','right'])assert.ok(s.contacts[side].planted);
  const guard=m.sample(23),g=joints(f,guard.pose),wrist=g.get(m.rig[`${hand}Arm`][1]),neck=g.get(m.rig.spine.at(-1));
  assert.ok(Math.hypot(wrist.x-neck.x,wrist.y-neck.y)<probe.legLength*.45,'Punching hand should come back to guard');
  const unaimed=createHumanMotion(f,object,{action:'punch',duration:24,hand,facing,groundY:550}).sample(impact),reach=joints(f,unaimed.pose);
  assert.ok(facing*(reach.get(m.rig[`${hand}Arm`][1]).x-reach.get(m.rig.spine.at(-1)).x)>probe.legLength*.4,'Default punch extends in the facing direction');
 }
});

test('kicks raise one foot to hip height while the support foot stays planted',()=>{
 for(const f of figures())for(const foot of ['left','right'])for(const facing of [1,-1]){
  const m=createHumanMotion(f,createObject(f,1,300,300),{action:'kick',duration:30,foot,facing,groundY:550}),samples=settled(m);
  const support=foot==='left'?'right':'left';assertGroundedRig(f,m,samples);
  const planted=samples.map(s=>s.contacts[support]);for(const c of planted){assert.ok(c.planted);close(c.point.x,planted[0].point.x,1e-6);}
  const hit=m.sample(m.events[0].tick),ankle=hit.contacts[foot].ankle;
  assert.ok(!hit.contacts[foot].planted);assert.ok(ankle.y<hit.pose.root_y+m.legLength*.15,'Kick should reach about hip height');assert.ok(facing*(ankle.x-hit.pose.root_x)>m.legLength*.6);
  assert.ok(m.sample(29).contacts[foot].planted);
 }
 const f=defaultFigure(),m=createHumanMotion(f,createObject(f,1,300,300),{action:'kick',duration:30,target:{x:5000,y:300},groundY:550});
 for(const s of settled(m))for(const role of ['leftLeg','rightLeg'])assert.ok(Number.isFinite(s.targets[role].error));
});

test('hit reactions recoil away from the attacker and step back onto the floor',()=>{
 for(const f of figures())for(const facing of [1,-1]){
  const m=createHumanMotion(f,createObject(f,1,300,300),{action:'hit',duration:24,facing,groundY:550});
  assert.equal(m.settings.blend,.05);close(m.settings.distance,-facing*m.legLength*.35,1e-9);
  const samples=settled(m,2);assertGroundedRig(f,m,samples);
  const recoil=m.sample(m.events[0].tick),spine=f.segments.findIndex(s=>s.segment_id===m.rig.spine[0]);
  assert.ok(-facing*Math.cos(recoil.pose.angles[spine])>.15,'Torso should lean away from the hit');
  close(m.sample(23).pose.root_x-300,m.settings.distance,1e-6);for(const side of ['left','right'])assert.ok(m.sample(23).contacts[side].planted);
  assert.ok(samples.some(s=>!s.contacts.left.planted)&&samples.some(s=>!s.contacts.right.planted),'Both feet should step');
 }
});

test('action options are validated, including the 3D heading-only strikes',()=>{
 const f=defaultFigure(),o=createObject(f,1,0,0);
 for(const options of [{action:'punch',height:40},{action:'jump',foot:'left'},{action:'kick',foot:'middle'},{action:'jump',facing:2},{action:'walk',facing:1},
   {action:'jump',duration:10},{action:'punch',distance:30},{action:'jump',distance:10000},{action:'punch',carry:{hand:'left'}},{action:'kick',target:{x:NaN,y:0}},{action:'jump',height:1}])
  assert.throws(()=>createHumanMotion(f,o,options),undefined,JSON.stringify(options));
 const spatial=createCartoonCharacter({dimension:'3d'}).figure;
 assert.throws(()=>createHumanMotion(spatial,createObject(spatial,1,0,0),{action:'punch',duration:24,target:{x:0,y:0}}),/2D characters/);
 assert.throws(()=>createHumanMotion(spatial,createObject(spatial,1,0,0),{action:'kick',duration:30,facing:0}));
});

test('3D characters jump, punch, kick and recoil along their heading with planted, unstretched legs',()=>{
 const f=createCartoonCharacter({dimension:'3d'}).figure,bones=characterBones(f),geometry=p=>buildGeometry({version:5,figure_types:[{...f,_styk:{...f._styk,spatialMesh:undefined}}]},createFrame([{...p,object_slot:0}])).objects.get(0);
 const length=(g,role)=>{const b=bones.get(role),frame=g.segments[b.index].spatialFrame,a=spatialPoint(frame,b.segment._stykRig.spatial.origin),c=spatialPoint(frame,b.segment._stykRig.spatial.tip);return Math.hypot(...c.map((v,i)=>v-a[i]));};
 const rest=geometry(createObject(f,1,300,300)),legs=['leftThigh','leftShin','rightThigh','rightShin','leftUpperArm','rightForearm'],expected=legs.map(r=>length(rest,r));
 for(const [options,yaw]of [[{action:'jump',duration:36,distance:90,view:{yaw:.9}},.9],[{action:'punch',duration:24,facing:1},Math.PI/2],[{action:'kick',duration:30,facing:-1},-Math.PI/2],[{action:'hit',duration:24,facing:-1},-Math.PI/2]]){
  const m=createHumanMotion(f,createObject(f,1,300,300),{groundY:550,...options});let flights=0,twist=0;
  assert.deepEqual(m.events,createHumanMotion(defaultFigure(),createObject(defaultFigure(),1,300,300),{action:options.action,duration:options.duration}).events);
  for(let tick=8;tick<m.settings.duration;tick++){const s=m.sample(tick),g=geometry(s.pose);if(s.airborne)flights++;twist=Math.max(twist,Math.abs(s.view.torsoYaw));close(s.view.yaw,yaw,1e-9);
   legs.forEach((role,i)=>close(length(g,role),expected[i],1e-3));for(const side of ['left','right'])if(s.contacts[side].planted)close(s.contacts[side].point.y,550,.05);}
  const travel=m.pathAt(m.settings.duration-1),end=m.sample(m.settings.duration-1).worldRoot,start=m.sample(0).worldRoot;
  for(const k of [0,2])close(end[k]-start[k],travel[k],1e-6);
  const forward=[Math.sin(yaw),0,Math.cos(yaw)],along=travel[0]*forward[0]+travel[2]*forward[2];close(Math.hypot(travel[0],travel[2]),Math.abs(along),1e-6);
  if(options.action==='jump'){assert.ok(flights>=8);close(along,90,1e-6);}
  if(options.action==='hit')assert.ok(along<-30,'Hits push the character backwards along its heading');
  if(options.action==='punch')assert.ok(twist>.3,'Punches turn the shoulders into the strike');
 }
});

test('actions bake as one undoable command and report absolute timing events',async()=>{
 for(const sheet of [false,true]){
  const e=sheet?new Editor({demo:false}).load(createStartupDocument()):new Editor({demo:false});e.addFigure();const uid=e.selectedUid,before=e.serialize(),undos=e._undo.length;
  const result=await e.applyHumanMotion({action:'kick',start:12,duration:30});
  assert.equal(e._undo.length,undos+1);assert.deepEqual(result.events,[{kind:'impact',tick:12+14}]);
  const after=e.serialize();e.undo();assert.deepEqual(e.serialize(),before);e.redo();assert.deepEqual(e.serialize(),after);
  e.select(uid);assert.deepEqual(e.previewHumanMotion({action:'jump',duration:36},0).events.map(x=>x.kind),['takeoff','land']);
 }
 const session=new AgentSession({directory:process.cwd(),engine:new AgentEngine()});session.engine.execute({op:'addFigure'});
 const reply=await session.invoke('editor_applyHumanMotion',{args:[{action:'punch',duration:24}]});
 assert.deepEqual(reply.value.events,[{kind:'impact',tick:10}]);
});

test('scene actors can delay an action so a hit lands on another actor\'s impact',async()=>{
 const e=new Editor({demo:false});e.addSpatialScene({actors:[{name:'A',position:[-60,0,0]},{name:'B',position:[62,0,0]}],boxes:[{name:'Floor',position:[0,131,0],size:[900,20,600],color:[110,140,140]}]});
 const options={duration:30,actors:[{action:'punch',facing:1},{action:'hit',facing:-1,delay:12}]};
 const first=e.previewSpatialSceneMotion(options,0),held=e.previewSpatialSceneMotion(options,12);
 assert.deepEqual(held.actors[1].pose,first.actors[1].pose,'The delayed actor holds its starting pose');
 assert.notDeepEqual(e.previewSpatialSceneMotion(options,15).actors[1].pose,held.actors[1].pose);
 const before=e.serialize(),result=await e.applySpatialSceneMotion({start:6,...options});
 assert.deepEqual(result.events,[{kind:'impact',tick:6+13,actor:0},{kind:'recoil',tick:6+12+2,actor:1}]);
 e.undo();assert.deepEqual(e.serialize(),before);
 for(const delay of [-1,29,1.5])await assert.rejects(e.applySpatialSceneMotion({duration:30,actors:[{action:'idle'},{action:'hit',delay}]}),/delay/);
});
