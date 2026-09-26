import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { architecturalRegions, architectureSettings, artworkMapping, assertArchitectureScene, applyCompositedMap } from '../scripts/architecture.js';
import { applyDocumentUpdate } from './mock-update.js';
import { normalizePlan, validatePlan } from '../scripts/plan.js';
import { compileGeometry } from '../scripts/geometry.js';
import { lightDataFromPlan, wallDataFromSegment } from '../scripts/foundry-data.js';
import { compileSceneIntent } from '../scripts/plan-generator.js';

const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/laboratory.json',import.meta.url)));

function useLightCoordinateSchema(t,clean) {
  const prior=globalThis.CONFIG;
  globalThis.CONFIG={AmbientLight:{documentClass:{schema:{fields:{x:{clean},y:{clean}}}}}};
  t.after(()=>{if(prior===undefined)delete globalThis.CONFIG;else globalThis.CONFIG=prior;});
}

for(const clean of [Math.round,Math.trunc])test(`managed lights use the host coordinate cleaner (${clean.name}), not raw fractional pixels`,t=>{
  useLightCoordinateSchema(t,clean);
  for(const name of ['laboratory','civic','bathhouse'])for(const gridSize of [50,70,71,100,140]) {
    const intent=JSON.parse(fs.readFileSync(new URL(`../fixtures/intents/${name}.json`,import.meta.url)));
    const plan=compileSceneIntent(intent,{columns:40,rows:32,gridSize});
    const raw=plan.lights.map(l=>[l.x*gridSize,l.y*gridSize]),before=structuredClone(plan);
    if(name!=='civic'&&gridSize===70)assert(raw.some(pair=>pair.some(n=>!Number.isInteger(n))));
    const scene={width:40*gridSize,height:32*gridSize,grid:{size:gridSize},
      walls:compileGeometry(plan).map(s=>wallDataFromSegment(s,gridSize)),
      lights:plan.lights.map(l=>{
        const data=lightDataFromPlan(l,plan);
        return {...data,x:clean(data.x),y:clean(data.y)};
      })};
    assert.doesNotThrow(()=>assertArchitectureScene(scene,plan),`${name}, grid ${gridSize}`);
    assert.deepEqual(plan.lights.map(l=>{const {x,y}=lightDataFromPlan(l,plan);return [x,y];}),raw.map(pair=>pair.map(clean)));
    assert.deepEqual(plan,before,'Native coordinate cleaning must not rewrite the authoritative plan');
    scene.lights.reverse();
    scene.lights.push({x:33,y:44,flags:{},config:{dim:17}});
    scene.lights[0].config.alpha=.12;
    assert.doesNotThrow(()=>assertArchitectureScene(scene,plan));
    for(const axis of ['x','y'])for(const delta of [-1,1]) {
      scene.lights[0][axis]+=delta;
      assert.throws(()=>assertArchitectureScene(scene,plan),/Managed light positions/);
      scene.lights[0][axis]-=delta;
    }
    const light=scene.lights.shift();
    assert.throws(()=>assertArchitectureScene(scene,plan),/Managed light positions/);
    scene.lights.unshift(light);
    scene.lights.push(structuredClone(light));
    assert.throws(()=>assertArchitectureScene(scene,plan),/Managed light positions/);
  }
});

test('host coordinate cleaning failures propagate instead of silently accepting raw positions',t=>{
  useLightCoordinateSchema(t,()=>{throw new Error('Coordinate cleaning rejected');});
  const plan=validatePlan(normalizePlan(fixture));
  assert.throws(()=>lightDataFromPlan(plan.lights[0],plan,{torch:{},rainbowswirl:{},flicker:{}}),/Coordinate cleaning rejected/);
  const fields=globalThis.CONFIG.AmbientLight.documentClass.schema.fields;
  for(const invalid of [NaN,Infinity,null]) {
    fields.x.clean=()=>invalid;
    assert.throws(()=>lightDataFromPlan(plan.lights[0],plan),/rejected the planned light x coordinate/);
  }
  fields.x.clean=Math.round;delete fields.y;
  assert.throws(()=>lightDataFromPlan(plan.lights[0],plan),/coordinate field is unavailable/);
});

test('architectural descriptor and Foundry share exact compiled segments without mutating plans',()=>{
  const before=structuredClone(fixture),regions=architecturalRegions(fixture),g=fixture.scene.gridSize;
  assert.deepEqual(fixture,before);
  assert.equal(regions.width,fixture.scene.columns*g);
  assert.equal(regions.height,fixture.scene.rows*g);
  assert.deepEqual(regions.segments.map(s=>[...s.a,...s.b]),compileGeometry(fixture).map(s=>wallDataFromSegment(s,g).c));
  for(const r of regions.protectedRects)assert(Object.values(r).every(Number.isInteger));
  assert.deepEqual(architecturalRegions(fixture),regions);
  for(const o of fixture.openings)assert(regions.openings.some(r=>r.x===o.x&&r.y===o.y&&r.length===o.length&&r.kind===o.kind));
});

test('structural bands derive from cell units and reject invalid configuration',()=>{
  const small=architecturalRegions(fixture);
  const large=architecturalRegions({...fixture,scene:{...fixture.scene,gridSize:140}});
  assert.equal(large.wallWidth,small.wallWidth*2);
  assert.equal(large.bandDepth,small.bandDepth*2);
  assert.equal(architectureSettings({bandPadding:.6}).bandPadding,.6);
  for(const value of [NaN,Infinity,0,'0.2',2])assert.throws(()=>architectureSettings({wallWidth:value}),/wallWidth/);
  for(const value of [.08,.35])assert.equal(architectureSettings({wallWidth:value}).wallWidth,value);
  for(const value of [.079,.351])assert.throws(()=>architectureSettings({wallWidth:value}),/wallWidth/);
  for(const value of [.1,.65])assert.equal(architectureSettings({bandPadding:value}).bandPadding,value);
  for(const value of [.099,.651,NaN,'0.3'])assert.throws(()=>architectureSettings({bandPadding:value}),/bandPadding/);
  assert.throws(()=>architectureSettings({material:'unknown'}),/material/);
  assert.throws(()=>architectureSettings({version:2}),/version/);
  assert.throws(()=>architecturalRegions({...fixture,scene:{...fixture.scene,columns:200,gridSize:400}}),/limit/);
});

test('same-frame artwork scales explicitly while incompatible aspect ratios fail',()=>{
  const regions=architecturalRegions(fixture),{width,height}=regions;
  assert.deepEqual(artworkMapping({width,height},regions),{sourceWidth:width,sourceHeight:height,width,height,scaleX:1,scaleY:1,x:0,y:0});
  assert.equal(artworkMapping({width:width/2,height:height/2},regions).scaleX,2);
  assert.equal(artworkMapping({width:1401,height:1200},regions).sourceWidth,1401);
  assert.equal(artworkMapping({width:1402,height:1200},regions).sourceWidth,1402);
  assert.throws(()=>artworkMapping({width:1403,height:1200},regions),/aspect ratio/);
  assert.throws(()=>artworkMapping({width:1024,height:1024},regions),/aspect ratio/);
  assert.throws(()=>artworkMapping({width:1,height:1},regions),/aspect ratio/);
  for(const image of [{width:0,height}, {width:NaN,height}, {width:1.5,height}, {width:10000,height:10000}])
    assert.throws(()=>artworkMapping(image,regions),/dimensions/);
});

test('reported 1403x1121 artwork fits 2800x2240 without crop or geometry changes',()=>{
  const regions={width:2800,height:2240},before=structuredClone(regions);
  assert.deepEqual(artworkMapping({naturalWidth:1403,naturalHeight:1121,width:700,height:560},regions),{
    sourceWidth:1403,sourceHeight:1121,width:2800,height:2240,
    scaleX:2800/1403,scaleY:2240/1121,x:0,y:0
  });
  assert.deepEqual(regions,before);
  for(const factor of [1,2,3,4]) {
    const mapping=artworkMapping({width:1403*factor,height:1121*factor},regions);
    assert.equal(mapping.sourceWidth*mapping.scaleX,regions.width);
    assert.equal(mapping.sourceHeight*mapping.scaleY,regions.height);
  }
  assert.equal(artworkMapping({width:1400,height:1120},regions).scaleX,2);
});

test('relative aspect allowance includes exactly 0.2 percent and rejects either side beyond it',()=>{
  const regions={width:2800,height:2240};
  for(const width of [2495,2505])for(const factor of [1,2])
    assert.doesNotThrow(()=>artworkMapping({width:width*factor,height:2000*factor},regions));
  for(const width of [2494,2506])for(const factor of [1,2])
    assert.throws(()=>artworkMapping({width:width*factor,height:2000*factor},regions),/aspect ratio/);
  for(const image of [{width:1024,height:1024},{width:1536,height:1024},{width:1,height:1},{width:3,height:2}])
    assert.throws(()=>artworkMapping(image,regions),/aspect ratio/);
});

test('composite updates reject moved managed lights but preserve independent GM lighting',()=>{
  const p=validatePlan(normalizePlan(fixture)),g=p.scene.gridSize;
  const scene={width:p.scene.columns*g,height:p.scene.rows*g,grid:{size:g},
    walls:compileGeometry(p).map(s=>wallDataFromSegment(s,g)),lights:p.lights.map(l=>lightDataFromPlan(l,p,{torch:{},rainbowswirl:{},flicker:{}}))};
  scene.lights.push({x:10,y:20,flags:{}});
  assertArchitectureScene(scene,p);
  scene.lights[0].x++;
  const before=structuredClone(scene);
  assert.throws(()=>assertArchitectureScene(scene,p),/Managed light positions/);
  assert.deepEqual(scene,before);
});

test('applying architecture rejects fitted geometry without changing it; door state remains interactive',()=>{
  const g=fixture.scene.gridSize,scene={
    width:fixture.scene.columns*g,height:fixture.scene.rows*g,grid:{size:g,type:1},tiles:[],
    walls:compileGeometry(fixture).map(s=>wallDataFromSegment(s,g))
  };
  scene.walls.find(w=>w.door===1).ds=1;
  assertArchitectureScene(scene,fixture);
  scene.walls[0].c[0]+=1;
  const before=structuredClone(scene);
  assert.throws(()=>assertArchitectureScene(scene,fixture),/cannot redefine/);
  assert.deepEqual(scene,before);
});

test('composite background and source persist together and failures restore the old background',async()=>{
  const regions=architecturalRegions(fixture),g=fixture.scene.gridSize;
  const scene={width:regions.width,height:regions.height,grid:{size:g},walls:compileGeometry(fixture).map(s=>wallDataFromSegment(s,g)),
    flags:{'scene-architect':{}},firstLevel:{background:{src:'old.png'}},
    getFlag(scope,key){return this.flags[scope][key];},async update(data){applyDocumentUpdate(this,data);}};
  const workflow={plan:structuredClone(fixture),revision:null,map:{src:'old-source.png'}};
  const setBackground=async(s,path)=>{s.firstLevel.background.src=path;};
  const map={src:'source.png',composite:'new.png',architectureVersion:1};
  await applyCompositedMap(scene,workflow,map,'new.png',setBackground);
  assert.deepEqual(scene.flags['scene-architect'].map,map);
  assert.equal(scene.firstLevel.background.src,'new.png');
  const before=JSON.stringify(scene.walls);
  scene.update=async()=>{throw new Error('save failed');};
  await assert.rejects(applyCompositedMap(scene,workflow,{src:'bad.png'},'bad-composite.png',setBackground),/save failed/);
  assert.deepEqual(workflow.map,map);
  assert.equal(scene.firstLevel.background.src,'new.png');
  assert.equal(JSON.stringify(scene.walls),before);
  workflow.revision='stale';
  await assert.rejects(applyCompositedMap(scene,workflow,map,'ignored.png',setBackground),/another window/);
  assert.equal(scene.firstLevel.background.src,'new.png');
});

test('composite failure never overwrites a concurrently changed background or revision',async()=>{
  const regions=architecturalRegions(fixture),g=fixture.scene.gridSize;
  const scene={width:regions.width,height:regions.height,grid:{size:g},walls:compileGeometry(fixture).map(s=>wallDataFromSegment(s,g)),
    flags:{'scene-architect':{}},firstLevel:{background:{src:'old.png'}},
    getFlag(scope,key){return this.flags[scope][key];},async update(){throw new Error('save failed');}};
  const workflow={plan:structuredClone(fixture),revision:null,map:null},writes=[];
  await assert.rejects(applyCompositedMap(scene,workflow,{src:'source.png'},'new.png',async(s,path)=>{
    writes.push(path);s.firstLevel.background.src='concurrent.png';throw new Error('interrupted');
  }),/Another background change/);
  assert.deepEqual(writes,['new.png']);
  assert.equal(scene.firstLevel.background.src,'concurrent.png');
  scene.firstLevel.background.src='old.png';
  await assert.rejects(applyCompositedMap(scene,workflow,{src:'source.png'},'new.png',async(s,path)=>{
    writes.push(path);s.firstLevel.background.src=path;s.flags['scene-architect'].revision='concurrent';
  }),/revision changed/);
  assert.equal(scene.firstLevel.background.src,'new.png');
  assert.equal(workflow.map,null);
});
