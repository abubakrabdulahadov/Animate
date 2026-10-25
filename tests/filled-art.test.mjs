import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCartoonCharacter,createFilledShape} from '../src/filled-art.mjs';
import {createHumanMotion,humanRig} from '../src/human-motion.mjs';
import {createObject,createFrame} from '../src/demo.mjs';
import {buildGeometry} from '../src/pivot/geometry.mjs';
import {Editor} from '../src/editor.mjs';
import {createStartupDocument} from '../src/startup-document.mjs';
import {buildContainerV2,decodeDocument} from '../src/native-container.mjs';
import {AgentSession} from '../scripts/agent-session.mjs';
const geometry=(figure,object)=>buildGeometry({version:5,figure_types:[figure]},createFrame([structuredClone(object)])).objects.get(0);

test('cartoon artwork consists entirely of filled native shapes over hidden humanoid controls',()=>{
  const {figure,rig}=createCartoonCharacter();assert.ok(figure.polyfills.length>25);assert.ok(figure.segments.every(s=>s.visible===false&&s.thickness===0));
  assert.deepEqual(humanRig(figure),rig);const g=geometry(figure,createObject(figure,1,300,300));
  assert.ok(g.drawables.length>25);assert.ok(g.drawables.filter(s=>s.alpha>0).every(s=>s.type==='poly'));
  assert.equal(new Set(figure.segments.map(s=>s.segment_id)).size,figure.segments.length);
  const handles=new Set(figure.segments.map(s=>s.segment_id));assert.ok(figure.polyfills.every(p=>p.segment_ids.every(id=>handles.has(id))));
});

test('cartoon fills follow carrying and walking while core bones retain their lengths',()=>{
  const {figure,rig}=createCartoonCharacter(),source=createObject(figure,1,300,300),m=createHumanMotion(figure,source,{action:'carry',hand:'left',distance:140,duration:90});
  let changed=false;const before=geometry(figure,m.sample(20).pose);
  for(const tick of [20,45,80]){const sample=m.sample(tick),g=geometry(figure,sample.pose);assert.ok(g.drawables.filter(s=>s.alpha>0).every(s=>s.type==='poly'));assert.ok(g.polys.every(p=>p.points.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y))));
    for(let i=0;i<13;i++)assert.ok(Math.abs(g.segments[i].length-figure.segments[i].length)<1e-3);
    const elbow=g.joints.get(rig.leftArm[0]),wrist=g.joints.get(rig.leftArm[1]);assert.ok(elbow.y>wrist.y);
    if(g.polys.at(-1).points[0].x!==before.polys.at(-1).points[0].x)changed=true;
  }assert.ok(changed);
});

test('native figure import is one undoable step on both document timelines and saves fills',async()=>{
  for(const sheet of [false,true]){const e=sheet?new Editor({demo:false}).load(createStartupDocument()):new Editor({demo:false}),before=e.serialize();
    const result=e.addCartoonCharacter({name:'Amina',position:{x:410,y:290},palette:{shirt:'#e18b76',skin:'#bb805c'}});
    assert.equal(e.object.unique_id,result.uid);assert.equal(e.object.root_x,410);assert.equal(e.object.root_y,290);assert.equal(e.figure.name,'Amina');
    const after=e.serialize(),decoded=await decodeDocument(await buildContainerV2(after,'styk'),'styk'),saved=decoded.document.figure_types.find(f=>f.name==='Amina');assert.ok(saved.segments.every(s=>s.visible===false||s.transparency===255));
    assert.ok(geometry(saved,createObject(saved,1,300,300)).drawables.filter(s=>s.alpha>0).every(s=>s.type==='poly'));
    e.undo();assert.deepEqual(e.serialize(),before);e.redo();assert.deepEqual(e.serialize(),after);
  }
});

test('UI artwork has bounded clean contours, round corners and configurable fill opacity',()=>{
  for(const shape of ['roundedRect','pill','ellipse','star','speechBubble']){
    const figure=createFilledShape({shape,width:180,height:80,color:'#f4bb6e',opacity:.7});
    assert.ok(figure.segments.length<=64);assert.equal(figure.polyfills.length,1);assert.equal(figure.polyfills[0].alpha_raw,77);
    const g=geometry(figure,createObject(figure,1,0,0));assert.equal(g.drawables.length,1);assert.equal(g.drawables[0].type,'poly');
    for(const point of g.polys[0].points){assert.ok(Math.abs(point.x)<=90.001);assert.ok(Math.abs(point.y)<=40.001);}
  }
  assert.notDeepEqual(createFilledShape({shape:'speechBubble',tail:'left'}),createFilledShape({shape:'speechBubble',tail:'right'}));
});

test('manual joint rotation carries the filled arm contours and can be undone',()=>{
  const e=new Editor({demo:false}),{uid,rig}=e.addCartoonCharacter();e.select(uid,e.figure.segments.findIndex(s=>s.segment_id===rig.leftArm[0]));
  const before=e.serialize(),a=geometry(e.figure,e.object).polys;
  e.rotateJoint(-.6);const b=geometry(e.figure,e.object).polys;
  assert.ok(b.some((p,i)=>p.points.some((v,j)=>Math.abs(v.x-a[i].points[j].x)>1)));e.undo();assert.deepEqual(e.serialize(),before);
});

test('invalid appearance and shape options leave the live document unchanged',()=>{
  const e=new Editor({demo:false}),before=e.serialize();
  for(const options of [{palette:{shirt:'red'}},{expression:'angry'},{name:''},{extra:true}])assert.throws(()=>e.addCartoonCharacter(options));
  for(const options of [{width:0},{radius:999},{opacity:2},{tail:'up'},{shape:'HTML'},{position:{x:NaN,y:1}}])assert.throws(()=>e.addFilledShape(options));
  assert.deepEqual(e.serialize(),before);
});

test('agent tools create filled characters and UI graphics without changing existing figures',async()=>{
  const session=new AgentSession();await session.invoke('editor_addFigure');const old=structuredClone(session.engine.editor.figure);
  const character=await session.invoke('editor_addCartoonCharacter',{args:[{expression:'neutral'}]});assert.ok(character.value.rig.leftArm.length===2);
  await session.invoke('editor_applyHumanMotion',{args:[{action:'carry',hand:'both',duration:36}],selection:{uid:character.value.uid}});
  await session.invoke('editor_addFilledShape',{args:[{shape:'pill',position:{x:200,y:100}}]});
  assert.deepEqual(session.engine.editor.report.figure_types[0],old);
});
