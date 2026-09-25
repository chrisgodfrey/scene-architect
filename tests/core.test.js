import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizePlan, validatePlan, planWarnings } from '../scripts/plan.js';
import { compileGeometry } from '../scripts/geometry.js';
import { migrateArt, validateArt, usedAssets, artworkRequests } from '../scripts/art-manifest.js';
import { availableLightPresetKeys, lightDataFromPlan, resolvedLightConfig, wallDataFromSegment } from '../scripts/foundry-data.js';
import { geometryConflict, projectFromScene, saveProject, propTileData, applyRenderedArt } from '../scripts/project.js';
import { fitRect, renderSceneArt } from '../scripts/renderer.js';
import { applyDocumentUpdate } from './mock-update.js';

const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/laboratory.json',import.meta.url)));
const plan=()=>structuredClone(fixture);
const check=p=>validateArt(validatePlan(p));
function sceneFor(p) {
  const flags={'scene-architect':{plan:structuredClone(p)}};
  return {id:'scene1',width:p.scene.columns*p.scene.gridSize,height:p.scene.rows*p.scene.gridSize,grid:{size:p.scene.gridSize,type:1},walls:compileGeometry(p).map(s=>wallDataFromSegment(s,p.scene.gridSize)),tiles:[],flags,
    firstLevel:{background:{src:'original.png'}},getFlag:(scope,key)=>flags[scope][key],
    async update(data) {applyDocumentUpdate(this,data);},
    async createEmbeddedDocuments(type,items) {assert.equal(type,'Tile');const docs=items.map((x,i)=>({...structuredClone(x),id:`new-${i}`}));this.tiles.push(...docs);return docs;},
    async deleteEmbeddedDocuments(type,ids) {assert.equal(type,'Tile');this.tiles=this.tiles.filter(t=>!ids.includes(t.id));}
  };
}

test('laboratory validates, connected rooms and exactly three shared restraint beds',()=>{
  const p=check(plan());assert.deepEqual(planWarnings(p),[]);
  assert.equal(p.features.filter(f=>f.assetId==='restraint-bed').length,3);
  assert.equal(usedAssets(p).length,11);
  const prompt=artworkRequests(p);assert.equal(prompt.match(/IMPORT SLOT: restraint-bed\n/g).length,1);assert.match(prompt,/Instances using this image: 3/);assert.match(prompt,/several generations and downloads/);
});
test('semantic lights link to visible sources and preserve bounded animation overrides',()=>{
  const p=plan();p.lights=[{
    name:'Instantiator portal',preset:'magic-portal',sourceFeatureId:'instantiator',
    dim:10,alpha:.7,animation:{type:'rainbowswirl',speed:6,intensity:8,reverse:true}
  }];
  const checked=validatePlan(normalizePlan(p)),source=checked.features.find(f=>f.id==='instantiator'),light=checked.lights[0];
  assert.equal(light.x,source.x+source.width/2);assert.equal(light.y,source.y+source.height/2);
  const data=lightDataFromPlan(light,checked,{rainbowswirl:{}},{sourceId:'plan-light-1-portal'});
  assert.equal(data.x,light.x*checked.scene.gridSize);assert.equal(data.config.dim,10);assert.equal(data.config.color,'#954aff');
  assert.deepEqual(data.config.animation,{type:'rainbowswirl',speed:6,intensity:8,reverse:true});
  assert.equal(data.flags['scene-architect'].sourceFeatureId,'instantiator');
  assert.equal(data.flags['scene-architect'].sourceId,'plan-light-1-portal');
  const small=resolvedLightConfig({name:'Suggested portal',preset:'magic-portal'},{rainbowswirl:{}},'small');
  assert.equal(small.dim,6);assert.equal(small.bright,2.25);
  assert.equal(resolvedLightConfig({name:'Suggested lamp',preset:'flickering-lamp'},{}).animation.type,'');
  assert(!availableLightPresetKeys({torch:{}}).includes('magic-portal'));
  assert(availableLightPresetKeys({torch:{}}).includes('flickering-lamp'));
});
test('legacy animations retain their meaning and unavailable effects fail explicitly',()=>{
  const p=plan();p.lights=[{name:'Old lamp',x:4,y:5,animation:'flicker'}];
  const checked=validatePlan(normalizePlan(p)),light=checked.lights[0];
  assert.deepEqual(light.animation,{type:'flicker',speed:2,intensity:2,reverse:false});
  assert.equal(lightDataFromPlan(light,checked,{flicker:{}}).config.animation.type,'flicker');
  assert.throws(()=>lightDataFromPlan(light,checked,{}),/not available/);
});
test('semantic lights reject missing sources, invalid ambient placement and unsafe overrides',()=>{
  const missing=plan();missing.lights=[{preset:'flame',sourceFeatureId:'missing'}];
  assert.throws(()=>validatePlan(normalizePlan(missing)),/existing feature/);
  const ambient=plan();ambient.lights=[{preset:'ambient-fill',roomId:'medical',x:20,y:20}];
  assert.throws(()=>validatePlan(normalizePlan(ambient)),/between/);
  const override=plan();override.lights=[{preset:'steady-lamp',sourceFeatureId:'instantiator',alpha:2}];
  assert.throws(()=>validatePlan(normalizePlan(override)),/alpha/);
});
test('version 1 migration is deterministic, non-mutating to original and preserves floor semantics',()=>{
  const old=plan();delete old.art;old.version=1;
  for(const f of old.features)delete f.assetId;
  const a=migrateArt(validatePlan(normalizePlan(old))),b=migrateArt(validatePlan(normalizePlan(old)));
  assert.deepEqual(a,b);assert.equal(old.art,undefined);assert.equal(a.version,2);validateArt(a);
});
test('explicit manifests and future versions are not silently migrated',()=>{
  const p=plan();p.art.version=88;assert.equal(migrateArt(p).art.version,88);assert.throws(()=>validateArt(p),/Unsupported/);
  const q=plan();q.version=99;assert.throws(()=>validatePlan(q),/Unsupported/);
});
test('openings require existing wall units and cannot overlap',()=>{
  const p=plan();p.openings[0].x=9;assert.throws(()=>validatePlan(p),/does not belong/);
  const q=plan();q.openings.push({...q.openings[0]});assert.throws(()=>validatePlan(q),/overlaps another/);
});
test('room overlap and outside boundaries fail',()=>{
  const p=plan();p.spaces[1].x=3;assert.throws(()=>validatePlan(p),/overlap/);
  const q=plan();q.spaces[0].width=100;assert.throws(()=>validatePlan(q),/outside/);
});
test('rotated props are checked against walls, other props and door clearance',()=>{
  const p=plan();p.features[0].x=8;p.features[0].rotation=90;assert.throws(()=>validatePlan(p),/rotated footprint/);
  const q=plan();q.features[0].x=8;q.features[0].y=10;assert.throws(()=>validatePlan(q),/blocks an opening/);
  const r=plan();r.features[1].x=r.features[0].x;assert.throws(()=>validatePlan(r),/Props .* overlap/);
  const t=plan();t.barriers.push({a:[10,10],b:[12,10],kind:'wall'});assert.throws(()=>validatePlan(t),/crosses a barrier/);
});
test('decals may overlap props; malformed numeric placement and duplicate IDs fail',()=>{
  check(plan());
  for(const value of [NaN,Infinity,'10',-1]) {const p=plan();p.features[0].x=value;assert.throws(()=>validatePlan(p),/must be a number/);}
  const p=plan();p.features[1].id=p.features[0].id;assert.throws(()=>validatePlan(p),/duplicate feature/);
});
test('disconnected rooms are surfaced as actionable warnings',()=>{
  const p=plan();p.openings=[];assert.match(planWarnings(validatePlan(p))[0],/not connected.*machinery/);
});
test('one multi-cell opening creates one aligned native door',()=>{
  const p=plan(),edges=compileGeometry(p),doors=edges.filter(e=>e.kind==='door');assert.equal(doors.length,2);
  assert.deepEqual(doors[0],{a:[8,10],b:[8,12],kind:'door'});
  assert.deepEqual(wallDataFromSegment(doors[0],70).c,[560,700,560,840]);
  assert(!edges.some(e=>e.a[0]===8&&e.b[0]===8&&e.a[1]===16&&e.b[1]===18));
});
test('materials/props references and crop ranges are validated',()=>{
  const reserved=plan();reserved.art.assets[0].id='toString';assert.throws(()=>validateArt(reserved),/Invalid or duplicate art ID/);
  const p=plan();p.features[0].assetId='missing';assert.throws(()=>validateArt(p),/reference a prop/);
  const q=plan();q.spaces[0].floorAsset='restraint-bed';assert.throws(()=>validateArt(q),/reference a material/);
  const r=plan();r.art.assignments['restraint-bed']={src:'worlds/art.png',fit:'stretch',crop:{x:0,y:0,width:1,height:1}};assert.throws(()=>validateArt(r),/contain or cover/);
  r.art.assignments['restraint-bed'].fit='contain';r.art.assignments['restraint-bed'].crop.x=.2;assert.throws(()=>validateArt(r),/crop/);
});
test('unused assets are excluded from artwork requests',()=>{
  const p=plan();p.art.assets.push({id:'unused',kind:'prop',description:'Never placed',ratio:1,requirements:'transparent'});
  assert(!usedAssets(p).some(a=>a.id==='unused'));assert(!artworkRequests(p).includes('IMPORT SLOT: unused'));
});
test('fit preserves aspect ratio; cover deliberately clips',()=>{
  assert.deepEqual(fitRect(200,100,100,100),{x:0,y:25,width:100,height:50});
  assert.deepEqual(fitRect(200,100,100,100,'cover'),{x:-50,y:0,width:200,height:100});
});
test('missing images and oversized output fail before canvas allocation',async()=>{
  await assert.rejects(renderSceneArt(plan()),/Import these assets/);
  const p=plan();p.scene.gridSize=400;await assert.rejects(renderSceneArt(p),/Render limit/);
});
test('geometry conflict detects manual edits, additions and grid changes but permits door state',()=>{
  const p=plan(),s=sceneFor(p);assert.equal(geometryConflict(s,p),null);
  s.walls.find(w=>w.door).ds=1;assert.equal(geometryConflict(s,p),null);
  s.walls[0].c[0]++;assert.match(geometryConflict(s,p),/Native walls differ/);
  const t=sceneFor(p);t.walls.push({...t.walls[0]});assert.match(geometryConflict(t,p),/Native walls differ/);
  const u=sceneFor(p);u.grid.size=100;assert.match(geometryConflict(u,p),/grid differ/);
});
test('legacy per-cell doors match the same saved opening without rewriting native walls',()=>{
  const p=plan(),s=sceneFor(p),i=s.walls.findIndex(w=>w.door===1),w=s.walls.splice(i,1)[0],c=w.c;
  s.walls.push({...w,c:[c[0],c[1],c[0],c[1]+70]},{...w,c:[c[0],c[1]+70,c[2],c[3]]});
  assert.equal(geometryConflict(s,p),null);
});
test('save/reopen round trip retains shared assignments, crops and render settings without aliasing',async()=>{
  const p=plan(),s=sceneFor(p),w=projectFromScene(s);
  s.flags.otherModule={keep:true};s.flags['scene-architect'].guidePath='guide.svg';
  w.plan.art.assignments['restraint-bed']={src:'worlds/bed.png',fit:'contain',crop:{x:.1,y:.1,width:.8,height:.8},hasAlpha:true};w.plan.art.settings.materialScale=3;
  await saveProject(s,w);const loaded=projectFromScene(s);assert.deepEqual(loaded.plan,w.plan);
  delete w.plan.art.assignments['restraint-bed'];await saveProject(s,w);assert.equal(projectFromScene(s).plan.art.assignments['restraint-bed'],undefined);
  assert.equal(loaded.plan.art.assignments['restraint-bed'].src,'worlds/bed.png');
  assert.equal(s.flags.otherModule.keep,true);assert.equal(s.flags['scene-architect'].guidePath,'guide.svg');
  await assert.rejects(saveProject(s,loaded),/another window/);
});
test('padding, grid shifts and background transforms are geometry conflicts',()=>{
  const p=plan();
  for(const [key,value] of [['padding',.25],['shiftX',10],['shiftY',10]]) {
    const s=sceneFor(p);s[key]=value;assert.match(geometryConflict(s,p),/grid differ/);
  }
  const s=sceneFor(p);s.firstLevel.textures={scaleX:1.2};assert.match(geometryConflict(s,p),/background transform/);
});
test('tile assembly preserves counts, exact footprints, rotation and shared texture paths',()=>{
  const p=plan(),beds=p.features.filter(f=>f.assetId==='restraint-bed').map(f=>propTileData(f,'bed.png',70));
  assert.equal(beds.length,3);assert.equal(beds[0].width,105);assert.equal(beds[0].height,210);
  const t=propTileData(p.features.find(f=>f.id==='construct-2'),'construct.png',70);assert.equal(t.rotation,90);
});
test('render commit changes only managed Tiles/background, preserves native walls and unmanaged Tiles',async()=>{
  const p=plan(),s=sceneFor(p),walls=JSON.stringify(s.walls);
  s.tiles=[{id:'custom',flags:{}},{id:'old',flags:{'scene-architect':{generated:true}}}];
  await applyRenderedArt(s,p,{background:'new.png',tiles:[propTileData(p.features[0],'prop.png',70)]},async(scene,path)=>{scene.firstLevel.background.src=path;});
  assert.equal(JSON.stringify(s.walls),walls);assert.deepEqual(s.tiles.map(t=>t.id),['custom','new-0']);assert.equal(s.firstLevel.background.src,'new.png');
});
test('render failure rolls back newly created Tiles and background',async()=>{
  const p=plan(),s=sceneFor(p);let first=true;
  s.tiles=[{id:'old',flags:{'scene-architect':{generated:true}}}];
  await assert.rejects(applyRenderedArt(s,p,{background:'new.png',tiles:[{}]},async(scene,path)=>{if(first){first=false;throw new Error('write failed');}scene.firstLevel.background.src=path;}),/write failed/);
  assert.deepEqual(s.tiles.map(t=>t.id),['old']);assert.equal(s.firstLevel.background.src,'original.png');
});
test('render commit refuses drift before any document writes',async()=>{
  const p=plan(),s=sceneFor(p);s.walls.pop();s.createEmbeddedDocuments=()=>{throw new Error('must not write');};
  await assert.rejects(applyRenderedArt(s,p,{background:'x',tiles:[{}]},()=>{}),/Native walls differ/);
});
