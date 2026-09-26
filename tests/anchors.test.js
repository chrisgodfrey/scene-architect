import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileSceneIntent, normalizeSceneIntent } from '../scripts/plan-generator.js';
import { featureCorners, normalizePlan, openingRect, planWarnings, polygonsOverlap, validatePlan } from '../scripts/plan.js';
import { validateArt } from '../scripts/art-manifest.js';
import { lightDataFromPlan } from '../scripts/foundry-data.js';

const canvas={columns:40,rows:32,gridSize:70};
const fixture=name=>JSON.parse(readFileSync(new URL(`../fixtures/intents/${name}.json`,import.meta.url),'utf8'));
const anchor=(id,overrides={})=>({id,role:'major-anchor',type:'machine',description:id,size:'small',count:1,...overrides});
const dressing=(id,overrides={})=>({id,role:'soft-dressing',type:'furniture',description:id,count:30,...overrides});
const intent=(features,otherRooms=[])=>({
  kind:'scene-intent',version:2,scene:{name:'Anchor test',circulation:'linear'},
  rooms:[{id:'lab',name:'Lab',size:'large',features},...otherRooms]
});
const experiment=()=>intent([
  anchor('instantiator',{size:'large',placement:'centered',lightPreset:'magic-portal'}),
  anchor('restraint-bed',{type:'bed',size:'medium',count:3,facing:'instantiator'}),
  dressing('stools')
]);
const centre=f=>[f.x+f.width/2,f.y+f.height/2];
const deepFreeze=value=>{
  if(value&&typeof value==='object') {Object.values(value).forEach(deepFreeze);Object.freeze(value);}
  return value;
};
function assertFacing(feature,target) {
  const [x,y]=centre(feature),[tx,ty]=centre(target),distance=Math.hypot(tx-x,ty-y),angle=feature.rotation*Math.PI/180;
  assert(distance>0);
  assert(Math.abs(Math.sin(angle)-(tx-x)/distance)<1e-8,`${feature.id}: front x component`);
  assert(Math.abs(-Math.cos(angle)-(ty-y)/distance)<1e-8,`${feature.id}: front y component`);
}
function assertGeometry(plan) {
  for(const [index,f] of plan.features.entries()) {
    const corners=featureCorners(f),room=plan.spaces.find(r=>r.id===f.roomId);
    assert(corners.every(([x,y])=>x>=room.x+.75-1e-8&&x<=room.x+room.width-.75+1e-8&&y>=room.y+.75-1e-8&&y<=room.y+room.height-.75+1e-8));
    for(const other of plan.features.slice(index+1))assert(!polygonsOverlap(corners,featureCorners(other)));
    for(const opening of plan.openings)assert(!polygonsOverlap(corners,featureCorners(openingRect(opening))));
    if(f.facing)assertFacing(f,plan.features.find(target=>target.id===f.facing));
  }
}

test('semantic fixtures compile deterministically at 40x32 grid70 without mutating inputs',()=>{
  for(const name of ['laboratory','civic','bathhouse']) {
    const raw=fixture(name),original=structuredClone(raw);
    deepFreeze(raw);
    const first=compileSceneIntent(raw,deepFreeze({...canvas}));
    assert.deepEqual(raw,original);
    assert.deepEqual(compileSceneIntent(raw,canvas),first);
    assert.deepEqual(compileSceneIntent(normalizeSceneIntent(raw),canvas),first);
    assert.deepEqual(planWarnings(first),[]);
    validatePlan(first);validateArt(first);assertGeometry(first);
    assert(first.features.every(f=>f.role==='major-anchor'));
    assert(first.spaces.some(r=>r.dressing?.length));
    assert.equal(first.features.length,raw.rooms.reduce((n,r)=>n+r.features.filter(f=>f.role==='major-anchor').reduce((sum,f)=>sum+(f.count??1),0),0));
  }
});

test('laboratory has six requested rooms and exactly three beds actually facing a centred Instantiator',()=>{
  const plan=compileSceneIntent(fixture('laboratory'),canvas);
  assert.equal(plan.spaces.filter(r=>r.id!=='circulation').length,6);
  const source=plan.features.find(f=>f.id==='central-laboratory--instantiator'),room=plan.spaces.find(r=>r.id===source.roomId);
  assert.deepEqual(centre(source),centre(room));
  const beds=plan.features.filter(f=>f.id.startsWith('central-laboratory--restraint-bed--'));
  assert.equal(beds.length,3);
  assert.equal(new Set(beds.map(f=>centre(f).join(','))).size,3);
  assert.equal(new Set(beds.map(f=>f.rotation)).size,3);
  assert.deepEqual(beds.map(f=>f.rotation),[180,270,0]);
  beds.forEach(f=>{assert.equal(f.facing,source.id);assertFacing(f,source);});
  assertGeometry(plan);
});

test('facing dependencies are resolved before use regardless of declaration order',()=>{
  const raw=experiment();
  raw.rooms[0].features.reverse();
  const plan=compileSceneIntent(raw,canvas),target=plan.features.find(f=>f.id==='lab--instantiator');
  plan.features.filter(f=>f.facing).forEach(f=>assertFacing(f,target));
  assert.equal(plan.features.filter(f=>f.facing).length,3);
});

test('oblique facing uses clockwise centre rotation, including a centred follower',()=>{
  const raw=intent([
    anchor('observer',{type:'bed',placement:'centered',facing:'target',lightPreset:'steady-lamp'}),
    anchor('target')
  ]);
  const plan=compileSceneIntent(raw,canvas),observer=plan.features.find(f=>f.id==='lab--observer'),target=plan.features.find(f=>f.id==='lab--target');
  assert(observer.rotation>270&&observer.rotation<360);
  assertFacing(observer,target);assertGeometry(plan);
  assert.deepEqual(centre(observer),centre(plan.spaces[0]));
  const corners=featureCorners(observer);
  for(let axis=0;axis<2;axis++)assert(Math.abs(corners.reduce((sum,p)=>sum+p[axis],0)/4-centre(observer)[axis])<1e-8);
  assert.deepEqual([plan.lights[0].x,plan.lights[0].y],centre(observer));
});

test('bounded maximum canvas does not overflow candidate expansion or change source counts',()=>{
  const plan=compileSceneIntent(intent([anchor('target',{placement:'centered'}),anchor('bed',{type:'bed',count:15,facing:'target'})]),{columns:200,rows:200,gridSize:70});
  assert.equal(plan.features.length,16);
  assertGeometry(plan);
});

test('normalization keeps target identity stable across names, rooms, repeated compiles and instances',()=>{
  const raw=intent([
    anchor('The Instantiator',{placement:'centered'}),
    anchor('Restraint Bed',{type:'bed',count:3,facing:'THE INSTANTIATOR'})
  ],[{id:'Other Room',features:[anchor('The Instantiator')]}]);
  raw.rooms[0].id='Central Lab';
  const normalized=normalizeSceneIntent(raw);
  assert.equal(normalized.rooms[0].features[1].facing,'the-instantiator');
  assert.deepEqual(normalizeSceneIntent(normalized),normalized);
  const first=compileSceneIntent(raw,canvas);
  assert.deepEqual(first,compileSceneIntent(normalized,canvas));
  assert(first.features.some(f=>f.id==='other-room--the-instantiator'));
  for(const f of first.features.filter(f=>f.facing))assert.equal(f.facing,'central-lab--the-instantiator');
  assert.equal(new Set(first.features.map(f=>f.id)).size,first.features.length);
});

test('long stable semantic IDs keep target identity without exceeding art-manifest ID limits',()=>{
  const roomId='r'.repeat(64),targetId='t'.repeat(64);
  const raw=intent([anchor(targetId,{placement:'centered'}),anchor('b'.repeat(64),{type:'bed',count:3,facing:targetId})]);
  raw.rooms[0].id=roomId;
  const plan=compileSceneIntent(raw,canvas);
  validateArt(plan);
  assert(plan.art.assets.every(a=>a.id.length<=80));
  for(const f of plan.features.filter(f=>f.facing))assert.equal(f.facing,`${roomId}--${targetId}`);
  assert.deepEqual(plan,compileSceneIntent(normalizeSceneIntent(raw),canvas));
});

test('dressing retains descriptions and counts but never consumes footprint capacity or art slots',()=>{
  const raw=intent([dressing('chairs',{count:200}),dressing('papers',{count:200})]);
  const plan=compileSceneIntent(raw,{columns:6,rows:6,gridSize:70});
  assert.deepEqual(plan.features,[]);assert.deepEqual(plan.lights,[]);
  assert(!plan.art.assets.some(a=>a.kind==='prop'));
  assert.deepEqual(plan.spaces[0].dressing,raw.rooms[0].features);
  for(const d of plan.spaces[0].dressing)assert.deepEqual(Object.keys(d).sort(),['count','description','id','role','type']);
  const withDressing=compileSceneIntent(experiment(),canvas),withoutDressing=experiment();
  withoutDressing.rooms[0].features.pop();
  assert.deepEqual(withDressing.features,compileSceneIntent(withoutDressing,canvas).features);
});

test('semantic source lights remain linked at exact anchor centres and native positions',()=>{
  for(const name of ['laboratory','civic','bathhouse']) {
    const raw=fixture(name),plan=compileSceneIntent(raw,canvas);
    const sources=raw.rooms.flatMap(r=>r.features.filter(f=>f.lightPreset));
    assert.equal(plan.lights.filter(l=>l.sourceFeatureId).length,sources.reduce((sum,f)=>sum+(f.count??1),0));
    for(const light of plan.lights) {
      const source=light.sourceFeatureId?plan.features.find(f=>f.id===light.sourceFeatureId):plan.spaces.find(r=>r.id===light.roomId);
      assert(source);
      assert.deepEqual([light.x,light.y],centre(source));
      const native=lightDataFromPlan(light,plan,{torch:{},rainbowswirl:{},pulse:{}});
      assert.deepEqual([native.x,native.y],centre(source).map(n=>n*70));
      assert.equal(native.flags['scene-architect'].sourceFeatureId,light.sourceFeatureId??null);
      assert.equal(native.flags['scene-architect'].preset,light.preset);
    }
    assert(plan.lights.every(l=>l.preset==='ambient-fill'||plan.features.find(f=>f.id===l.sourceFeatureId)?.role==='major-anchor'));
  }
});

test('strict v2 rejects missing, ambiguous and cross-room targets, dressing targets and cycles',()=>{
  const cases=[
    [intent([anchor('bed',{facing:'absent'})]),/missing.*same room/],
    [intent([anchor('bed',{facing:'target'}),anchor('target',{count:2})]),/ambiguous/],
    [intent([anchor('bed',{facing:'chairs'}),dressing('chairs')]),/major-anchor/],
    [intent([anchor('bed',{facing:'target'})],[{id:'other',features:[anchor('target')]}]),/same room/],
    [intent([anchor('self',{facing:'self'})]),/cycle/],
    [intent([anchor('a',{facing:'b'}),anchor('b',{facing:'c'}),anchor('c',{facing:'a'})]),/cycle/],
    [intent([anchor('The Machine'),anchor('the-machine')]),/ambiguous duplicate feature ID/],
    [intent([anchor('a')],[{id:'LAB',features:[]}]),/duplicate.*room ID/]
  ];
  for(const [raw,error] of cases)assert.throws(()=>compileSceneIntent(raw,canvas),error);
});

test('strict v2 rejects unsupported relations, positions, roles and dressing lights rather than dropping them',()=>{
  const cases=[
    [anchor('bad',{relations:[{type:'near',target:'x'}]}),/unsupported/],
    [anchor('bad',{placement:'against-wall'}),/unsupported/],
    [anchor('bad',{facing:{target:'x'}}),/semantic ID/],
    [anchor('bad',{rotation:90}),/unsupported/],
    [anchor('bad',{x:2}),/unsupported/],
    [anchor('bad',{role:'obstacle'}),/role/],
    [anchor('bad',{placement:'centered',count:2}),/centered.*count 1/],
    [anchor('bad',{lightPreset:'ambient-fill'}),/room ambientLight/],
    [anchor('bad',{lightPreset:'unsupported'}),/lightPreset/],
    [dressing('bad',{facing:'target'}),/unsupported/],
    [dressing('bad',{size:'small'}),/unsupported/],
    [dressing('bad',{lightPreset:'flame'}),/promote.*major-anchor/],
    [dressing('bad',{lightPreset:'ambient-fill'}),/promote.*major-anchor/],
    [dressing('bad',{count:201}),/count/],
    [dressing('bad',{count:1.5}),/count/]
  ];
  for(const [feature,error] of cases)assert.throws(()=>compileSceneIntent(intent([feature]),canvas),error);
  const raw=experiment();raw.rooms[0].x=0;
  assert.throws(()=>compileSceneIntent(raw,canvas),/unsupported/);
  delete raw.rooms[0].x;raw.scene.coordinates=[];
  assert.throws(()=>compileSceneIntent(raw,canvas),/unsupported/);
});

test('anchor count limits fail before layout and impossible footprints/centres fail explicitly',()=>{
  assert.throws(()=>compileSceneIntent(intent([anchor('a',{count:9}),anchor('b',{count:8})]),{columns:4,rows:4}),/at most 16 major-anchor/);
  assert.throws(()=>compileSceneIntent(intent([anchor('a',{count:17})]),canvas),/count/);
  assert.throws(()=>compileSceneIntent(intent([anchor('a',{type:'bed',size:'large',count:16})]),{columns:8,rows:8}),/cannot fit.*major-anchor footprints/);
  assert.throws(()=>compileSceneIntent(intent([anchor('a',{type:'bed',size:'large'})]),{columns:6,rows:6}),/cannot fit.*major-anchor footprints/);
  assert.throws(()=>compileSceneIntent(intent([anchor('a',{placement:'centered'}),anchor('b',{placement:'centered'})]),canvas),/cannot fit.*relations/);
  assert.throws(()=>compileSceneIntent(intent(Array.from({length:65},(_,i)=>dressing(`item-${i}`))),canvas),/at most 64 feature groups/);
});

test('saved plans revalidate semantic targets, real facing, centred placement and cycles',()=>{
  const base=compileSceneIntent(experiment(),canvas);
  for(const [change,error] of [
    [p=>{p.features.find(f=>f.facing).facing='missing';},/existing major-anchor/],
    [p=>{p.features.find(f=>f.facing).rotation+=10;},/actually face/],
    [p=>{p.features.find(f=>f.placement).x+=.1;},/room centre/],
    [p=>{p.features.find(f=>f.placement).placement='against-wall';},/unsupported/],
    [p=>{p.features.find(f=>f.placement).facing=p.features.find(f=>f.facing).id;},/cycle/],
    [p=>{p.features[0].relations=[];},/unsupported/],
    [p=>{p.features.find(f=>f.facing).role='soft-dressing';},/put soft-dressing/],
    [p=>{delete p.features.find(f=>f.facing).role;},/require role/],
    [p=>{p.features.find(f=>f.facing).facing=null;},/nonempty text/]
  ]) {
    const p=structuredClone(base);change(p);
    assert.throws(()=>validatePlan(normalizePlan(p)),error);
  }
  const raw=experiment();raw.rooms.push({id:'other',size:'large',features:[anchor('target')]});
  const cross=compileSceneIntent(raw,canvas);
  cross.features.find(f=>f.facing).facing='other--target';
  assert.throws(()=>validatePlan(cross),/same room/);
});

test('saved dressing fields and source lighting cannot be promoted silently to geometry',()=>{
  const base=compileSceneIntent(intent([dressing('stools')]),canvas);
  for(const [change,error] of [
    [p=>{p.spaces[0].dressing={};},/must be an array/],
    [p=>{p.spaces[0].dressing[0].x=3;},/no coordinates/],
    [p=>{p.spaces[0].dressing[0].width=2;},/no coordinates/],
    [p=>{p.spaces[0].dressing[0].lightPreset='flame';},/native lights/],
    [p=>{p.spaces[0].dressing[0].count=0;},/count/],
    [p=>{p.spaces[0].dressing[0].description='';},/description/],
    [p=>{p.spaces[0].dressing.push({...p.spaces[0].dressing[0]});},/duplicate ID/],
    [p=>{p.lights.push({preset:'flame',sourceFeatureId:'stools'});},/existing feature/]
  ]) {
    const p=structuredClone(base);change(p);
    assert.throws(()=>validatePlan(normalizePlan(p)),error);
  }
});

test('legacy saved low-level plans still validate without anchor roles or dressing',()=>{
  const old=JSON.parse(readFileSync(new URL('../fixtures/laboratory.json',import.meta.url),'utf8'));
  const original=structuredClone(old),checked=validatePlan(normalizePlan(old));
  assert.deepEqual(old,original);
  assert(checked.features.every(f=>f.role===undefined));
  assert(checked.spaces.every(r=>r.dressing===undefined));
  old.version=1;
  assert.equal(validatePlan(normalizePlan(old)).version,1);
});
