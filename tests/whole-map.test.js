import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {wholeMapPrompt, mapAlignment, mapSize, assertMapFrame, applyWholeMap} from '../scripts/whole-map.js';
import {projectFromScene,saveProject} from '../scripts/project.js';
import {applyDocumentUpdate} from './mock-update.js';
const plan=JSON.parse(fs.readFileSync(new URL('../fixtures/laboratory.json',import.meta.url)));
const scene=()=>({id:'map-test',width:1960,height:1680,walls:[{c:[17,31,256,358],door:2}],lights:[{x:400}],tiles:[{id:'keep'}],grid:{size:70},firstLevel:{background:{src:'old.png'}},flags:{'scene-architect':{plan:structuredClone(plan)}},getFlag(scope,key){return this.flags[scope]?.[key];},async update(data){applyDocumentUpdate(this,data);}});

test('map request describes one complete image, features, light intent and generation identity',()=>{
  const prompt=wholeMapPrompt(plan,scene(),{generationId:'request-123'});
  assert.match(prompt,/ONE complete/);assert.match(prompt,/1960 × 1680/);
  for(const [i,f] of plan.features.entries())assert(prompt.includes(`${i+1}. ${f.description}`));
  for(const light of plan.lights)assert(prompt.includes(light.name));
  assert.match(prompt,/GENERATION REQUEST ID: request-123/);
  assert.match(prompt,/extend naturally across grid boundaries/);
  assert.match(prompt,/PAINTING OVER.*reference in place/);
  assert.match(prompt,/camera exactly 90 degrees above/);
  assert.match(prompt,/one flat Cartesian coordinate plane/);
  assert.match(prompt,/parallel in the reference must remain parallel/);
  for(const forbidden of ['isometric','oblique','three-quarter','perspective','foreshortening','horizon','vanishing point','vertical wall faces'])assert(prompt.includes(forbidden));
  assert.match(prompt,/Before returning the image, verify/);
  assert.match(prompt,/Draw each ordinary door closed, straight and centred/);
  assert.doesNotMatch(prompt,/open leaf/);
  assert.match(prompt,/never shift architecture by even part of a grid cell/);
  assert(!prompt.includes('IMPORT SLOT:'));
});
test('map request carries semantic preset effects without explicit overrides',()=>{
  const semantic=structuredClone(plan);semantic.lights=[
    {name:'Portal',preset:'magic-portal',sourceFeatureId:'instantiator'},
    {name:'Unreliable engine',preset:'flickering-lamp',sourceFeatureId:'engine'}
  ];
  const prompt=wholeMapPrompt(semantic,scene());
  assert.match(prompt,/Portal: magic-portal linked to feature 4; use rainbowswirl/);
  assert.match(prompt,/Unreliable engine: flickering-lamp linked to feature 5; use torch/);
});
test('whole-map application accepts arbitrary native edits and preserves documents',async()=>{
  const s=scene(),before=JSON.stringify([s.walls,s.lights,s.tiles]);
  await applyWholeMap(s,'new.png',async(s,path)=>{s.firstLevel.background.src=path;});
  assert.equal(s.firstLevel.background.src,'new.png');assert.equal(JSON.stringify([s.walls,s.lights,s.tiles]),before);
});
test('failed map application restores background without touching native edits',async()=>{
  const s=scene();let first=true;
  await assert.rejects(applyWholeMap(s,'new.png',async(s,path)=>{s.firstLevel.background.src=path;if(first){first=false;throw new Error('failed');}}),/failed/);
  assert.equal(s.firstLevel.background.src,'old.png');assert.equal(s.walls[0].c[0],17);
});
test('map source and alignment persist on reopen with stale-write protection',async()=>{
  const s=scene(),w=projectFromScene(s),stale=projectFromScene(s);
  w.generation={imageId:'generation-1',createdAt:123,width:1960,height:1680};
  w.map={src:'worlds/map.png',scale:1.1,x:12,y:-8,width:1024,height:1024,generationId:'generation-1'};await saveProject(s,w);
  const reopened=projectFromScene(s);assert.deepEqual(reopened.map,w.map);assert.deepEqual(reopened.generation,w.generation);
  reopened.map.x=100;assert.equal(w.map.x,12);
  reopened.generation.imageId='changed';assert.equal(w.generation.imageId,'generation-1');
  await assert.rejects(saveProject(s,stale),/another window/);
});
test('alignment and frame reject invalid sizes and unsupported transforms, not wall drift',()=>{
  assert.deepEqual(mapAlignment(),{scale:1,x:0,y:0});assertMapFrame(scene());
  for(const scale of [NaN,Infinity,0,5])assert.throws(()=>mapAlignment({scale}),/scale/);
  assert.throws(()=>mapAlignment({x:Infinity}),/offsets/);
  assert.throws(()=>mapSize({...scene(),width:9000}),/limit/);
  assert.throws(()=>assertMapFrame({...scene(),padding:.1}),/padding/);
  const s=scene();s.firstLevel.textures={rotation:10};assert.throws(()=>assertMapFrame(s),/background offset/);
});
