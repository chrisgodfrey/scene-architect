import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {wholeMapPrompt, mapAlignment, mapSize, assertMapFrame, applyWholeMap} from '../scripts/whole-map.js';
import {projectFromScene,saveProject} from '../scripts/project.js';
import {applyDocumentUpdate} from './mock-update.js';
const plan=JSON.parse(fs.readFileSync(new URL('../fixtures/laboratory.json',import.meta.url)));
const scene=()=>({id:'map-test',width:1960,height:1680,walls:[{c:[17,31,256,358],door:2}],lights:[{x:400}],tiles:[{id:'keep'}],grid:{size:70},firstLevel:{background:{src:'old.png'}},flags:{'scene-architect':{plan:structuredClone(plan)}},getFlag(scope,key){return this.flags[scope]?.[key];},async update(data){applyDocumentUpdate(this,data);}});

test('map request describes one complete image and all numbered feature instances',()=>{
  const prompt=wholeMapPrompt(plan,scene());
  assert.match(prompt,/ONE complete/);assert.match(prompt,/1960 × 1680/);
  for(const [i,f] of plan.features.entries())assert(prompt.includes(`${i+1}. ${f.description}`));
  assert.match(prompt,/extend naturally across grid boundaries/);
  assert(!prompt.includes('IMPORT SLOT:'));
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
  w.map={src:'worlds/map.png',scale:1.1,x:12,y:-8,width:1024,height:1024};await saveProject(s,w);
  const reopened=projectFromScene(s);assert.deepEqual(reopened.map,w.map);
  reopened.map.x=100;assert.equal(w.map.x,12);
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
