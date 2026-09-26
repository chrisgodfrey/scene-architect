import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { architecturalRegions, architectureSettings, artworkMapping, assertArchitectureScene, applyCompositedMap } from '../scripts/architecture.js';
import { applyDocumentUpdate } from './mock-update.js';
import { normalizePlan, validatePlan } from '../scripts/plan.js';
import { compileGeometry } from '../scripts/geometry.js';
import { lightDataFromPlan, wallDataFromSegment } from '../scripts/foundry-data.js';

const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/laboratory.json',import.meta.url)));

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
  assert.throws(()=>artworkMapping({width:1402,height:1200},regions),/aspect ratio/);
  assert.throws(()=>artworkMapping({width:1024,height:1024},regions),/aspect ratio/);
  assert.throws(()=>artworkMapping({width:1,height:1},regions),/aspect ratio/);
  for(const image of [{width:0,height}, {width:NaN,height}, {width:1.5,height}, {width:10000,height:10000}])
    assert.throws(()=>artworkMapping(image,regions),/dimensions/);
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
