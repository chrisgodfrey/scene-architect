import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArt } from '../scripts/art-manifest.js';
import { buildSceneIntentPrompt, compileSceneIntent, normalizeSceneIntent } from '../scripts/plan-generator.js';
import { planWarnings, validatePlan } from '../scripts/plan.js';

const room=(index,overrides={})=>({
  id:`room-${index}`,
  name:`Room ${index}`,
  purpose:`Purpose ${index}`,
  size:index%3===0?'large':index%3===1?'medium':'small',
  floor:index%2?'wood':'stone',
  features:[],
  ambientLight:false,
  ...overrides
});

const intent=(rooms,scene={})=>({
  kind:'scene-intent',
  version:1,
  scene:{
    name:'Generated scene',
    description:'A deterministic generated scene.',
    visualDirection:'Orthographic ink and muted colour.',
    circulation:'linear',
    ...scene
  },
  rooms
});

const checked=plan=>{
  validatePlan(plan);
  validateArt(plan);
  assert.deepEqual(planWarnings(plan),[]);
  return plan;
};

test('scene intent prompt is coordinate-free and preserves the low-level boundary',()=>{
  const prompt=buildSceneIntentPrompt({brief:'An old school',sceneName:'School',columns:34,rows:28,gridSize:70,animations:['flicker']});
  assert.match(prompt,/"kind": "scene-intent"/);
  assert.match(prompt,/"circulation": "linear\|central-corridor"/);
  assert.match(prompt,/Do not include x, y, width, height, rotation, coordinates, openings, barriers/);
  assert.match(prompt,/Scene Architect deterministically constructs and validates the complete plan/);
  assert.match(prompt,/flicker/);
});

test('central corridor gives every requested room direct shared circulation',()=>{
  const rooms=[
    room(1,{name:'Classroom one',features:[{id:'teacher-desk',type:'desk',description:'Teacher desk',size:'small',count:1,lightPreset:'steady-lamp'}]}),
    room(2,{name:'Classroom two',features:[{id:'student-table',type:'table',description:'Student table',size:'medium',count:2}]}),
    room(3,{name:'Classroom three'}),
    room(4,{name:'Classroom four'}),
    room(5,{name:'Library',ambientLight:true}),
    room(6,{name:'Staff room'})
  ];
  const raw=intent(rooms,{name:'Old school',circulation:'central-corridor'});
  const plan=checked(compileSceneIntent(raw,{columns:34,rows:28,gridSize:70}));
  assert.equal(plan.spaces.length,rooms.length+1);
  const corridor=plan.spaces.find(space=>space.id==='circulation');
  assert(corridor);
  assert.equal(plan.openings.length,rooms.length);
  for(const requested of rooms) {
    const space=plan.spaces.find(candidate=>candidate.id===requested.id);
    assert(space);
    assert(plan.openings.some(opening=>
      (opening.orientation==='h'&&opening.y>=corridor.y&&opening.y<=corridor.y+corridor.height&&opening.x>=space.x&&opening.x<space.x+space.width)
      ||(opening.orientation==='v'&&opening.x>=corridor.x&&opening.x<=corridor.x+corridor.width&&opening.y>=space.y&&opening.y<space.y+space.height)));
  }
  assert.equal(plan.features.length,3);
  assert.equal(plan.lights.length,2);
  assert.deepEqual(compileSceneIntent(raw,{columns:34,rows:28,gridSize:70}),plan);
});

test('linear circulation forms a connected room chain without a generated corridor',()=>{
  const raw=intent(Array.from({length:7},(_,index)=>room(index+1)),{name:'Burial complex',circulation:'linear'});
  const plan=checked(compileSceneIntent(raw,{columns:36,rows:24,gridSize:70}));
  assert.equal(plan.spaces.length,7);
  assert(!plan.spaces.some(space=>space.id==='circulation'));
  assert.equal(plan.openings.length,6);
});

test('normalization supplies bounded defaults and compilation makes duplicate ids unique',()=>{
  const raw=intent([
    room(1,{id:'Class Room',features:[
      {id:'Desk',type:'desk',description:'First desk',size:'small',count:2},
      {id:'Desk',type:'desk',description:'Second desk',size:'small',count:1}
    ]}),
    room(2,{id:'Class Room'}),
    room(3,{id:'circulation'})
  ]);
  delete raw.scene.circulation;
  const normalized=normalizeSceneIntent(raw);
  assert.equal(normalized.scene.circulation,'central-corridor');
  assert.equal(new Set(normalized.rooms.map(candidate=>candidate.id)).size,3);
  assert(!normalized.rooms.some(candidate=>candidate.id==='circulation'));
  const plan=checked(compileSceneIntent(raw,{columns:34,rows:28,gridSize:70}));
  assert.equal(new Set(plan.features.map(feature=>feature.id)).size,3);
  assert.equal(plan.features.length,3);
});

test('semantic room size influences bounded partitioning',()=>{
  const raw=intent([
    room(1,{size:'small'}),
    room(2,{size:'small'}),
    room(3,{size:'large'}),
    room(4,{size:'small'})
  ],{circulation:'central-corridor'});
  const plan=checked(compileSceneIntent(raw,{columns:34,rows:28,gridSize:70}));
  assert(plan.spaces.find(space=>space.id==='room-3').width>plan.spaces.find(space=>space.id==='room-1').width);
});

test('bounded room and topology matrix always produces validated deterministic plans',()=>{
  for(const circulation of ['linear','central-corridor']) {
    for(let count=1;count<=20;count++) {
      const rooms=Array.from({length:count},(_,index)=>room(index+1,{
        features:index%4===0?[{id:'fixture',type:index%2?'table':'other',description:`Fixture ${index}`,size:'small',count:1,lightPreset:index%8===0?'flickering-lamp':null}]:[],
        ambientLight:index%7===0
      }));
      const raw=intent(rooms,{circulation});
      const first=checked(compileSceneIntent(raw,{columns:120,rows:80,gridSize:70}));
      const second=compileSceneIntent(raw,{columns:120,rows:80,gridSize:70});
      assert.deepEqual(second,first);
      assert.equal(first.spaces.filter(space=>space.id!=='circulation').length,count);
      assert.equal(first.features.length,rooms.reduce((total,candidate)=>total+candidate.features.reduce((sum,feature)=>sum+feature.count,0),0));
    }
  }
});

test('invalid and over-capacity intent fails before returning a plan',()=>{
  assert.throws(()=>compileSceneIntent(null),/JSON object/);
  assert.throws(()=>compileSceneIntent({kind:'scene-intent',version:2,scene:{},rooms:[room(1)]}),/Unsupported scene design version/);
  assert.throws(()=>compileSceneIntent({kind:'scene-intent',version:1,scene:{},rooms:[]}),/at least one room/);
  assert.throws(()=>compileSceneIntent(intent(Array.from({length:20},(_,index)=>room(index+1)),{circulation:'central-corridor'}),{columns:12,rows:12,gridSize:70}),/too many rooms/);
  assert.throws(()=>compileSceneIntent(intent([room(1,{features:[{id:'bed',type:'bed',description:'Bed',size:'large',count:16}]})]),{columns:8,rows:8,gridSize:70}),/cannot fit all requested features/);
});
