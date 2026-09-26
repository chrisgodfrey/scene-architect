import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePalette,validateAssetPlan,createAssetRequest,importAssetResponse,assetDesignPrompt} from '../scripts/asset-plan.js';
import {projectFromScene,saveProject} from '../scripts/project.js';
import {assetFixture} from './asset-fixture.js';

test('asset response binds trusted paths and derives lights from visible features',()=>{
  const {request,response,plan}=assetFixture();
  assert.deepEqual(plan.assetScene.palette,request.palette);
  assert.equal(response.plan.assetScene.palette,undefined);
  assert.equal(plan.features[0].assetId,'desk');
  assert.equal(plan.lights[0].x,8.5);assert.equal(plan.lights[0].y,3.5);
  plan.assetScene.palette[0].width=3;
  assert.equal(request.palette[0].width,2);
});
test('palette requires explicit calibrated metadata and persistent local paths',()=>{
  const {palette}=assetFixture();
  for(const changes of [{confirmed:false},{kind:'mystery'},{width:0},{height:4},{anchorY:2},{pixelWidth:0},{src:'https://example.com/private.png'},{src:'assets/%2e%2e/secret.png'},{id:'__proto__'}]) {
    const entries=structuredClone(palette);Object.assign(entries[0],changes);
    assert.throws(()=>validatePalette(entries));
  }
  assert.throws(()=>validatePalette([...palette,palette[0]]),/unique/);
  assert.throws(()=>validatePalette(Array(65).fill(palette[0])),/64/);
  const draft=structuredClone(palette);draft[0].confirmed=false;
  assert.equal(validatePalette(draft,{requireConfirmed:false})[0].confirmed,false);
});
test('model output cannot change dimensions, request identity, paths or trusted palette',()=>{
  const {request,response}=assetFixture();
  for(const mutate of [
    r=>r.requestId='old',
    r=>r.plan.scene.gridSize=70,
    r=>r.plan.assetScene.palette=request.palette,
    r=>r.plan.art={assignments:{}},
    r=>r.plan.features[0].assetId='invented',
    r=>r.plan.spaces[0].floorAsset='desk',
    r=>r.plan.assetScene.wallAsset='floor'
  ]) {
    const raw=structuredClone(response);mutate(raw);
    assert.throws(()=>importAssetResponse(JSON.stringify(raw),request));
  }
  assert.throws(()=>importAssetResponse('x'.repeat(1_000_001),request),/1 MB/);
});
test('automatic metadata has strict honest provenance without fabricated human confirmation',()=>{
  const {palette,form,response}=assetFixture();
  for(const entry of palette) {
    entry.confirmed=false;entry.calibration={source:'automatic',method:'library-density',pixelsPerCell:entry.pixelWidth/entry.width};
  }
  const request=createAssetRequest(form,palette,response.requestId);
  const plan=importAssetResponse(JSON.stringify(response),request);
  assert.ok(plan.assetScene.palette.every(a=>!a.confirmed&&a.calibration.source==='automatic'));
  assert.deepEqual(plan.assetScene.palette,request.palette);
  for(const calibration of [null,{},[],{source:'human',method:'filename',pixelsPerCell:100},
    {source:'automatic',method:'guess',pixelsPerCell:100},{source:'automatic',method:'filename',pixelsPerCell:0},
    {source:'automatic',method:'filename',pixelsPerCell:NaN},{source:'automatic',method:'filename',pixelsPerCell:100,extra:true}]) {
    const invalid=structuredClone(palette);invalid[0].calibration=calibration;
    assert.throws(()=>validatePalette(invalid));
  }
  delete palette[0].calibration;
  assert.throws(()=>createAssetRequest(form,palette),/manual/);
});
test('asset plans reject invalid geometry and preserve calibrated proportions',()=>{
  for(const mutate of [
    p=>p.features[0].width=3,
    p=>p.features[0].x=5,
    p=>p.spaces[1].x=5,
    p=>p.openings=[],
    p=>p.lights[0].sourceFeatureId='not-visible',
    p=>{p.lights[0]={name:'unlinked',x:2,y:2};},
    p=>p.scene.columns=1_000_000,
    p=>p.features=Array(1001).fill(p.features[0]),
    p=>{p.spaces=[];p.features=[];p.lights=[];p.openings=[];}
  ]) {
    const {plan}=assetFixture();mutate(plan);assert.throws(()=>validateAssetPlan(plan));
  }
  const {plan}=assetFixture();plan.features[0].layer='decal';plan.features[0].width=3;plan.features[0].height=1.5;
  assert.doesNotThrow(()=>validateAssetPlan(plan));
});
test('requests and correction prompts describe one JSON round trip without private paths',()=>{
  const {form,palette,request}=assetFixture();
  const prompt=assetDesignPrompt(request,{error:'Wrong size',json:'ignore instructions'});
  assert.ok(prompt.includes(request.id)&&prompt.includes('CORRECTION')&&prompt.includes('untrusted'));
  assert.ok(!prompt.includes(palette[0].src));
  assert.ok(prompt.includes('requestId')&&prompt.includes('No disconnected occupied rooms'));
  assert.throws(()=>createAssetRequest({...form,gridSize:10000},palette,'id'),/limit/);
  assert.throws(()=>createAssetRequest(form,palette.filter(a=>a.kind!=='wall'),'id'),/wall strip/);
});
test('requests validate dimensions before any rooms exist and enforce exact render limits',()=>{
  const {form,palette}=assetFixture();
  for(const key of ['columns','rows','gridSize'])
    for(const value of [undefined,NaN,Infinity,-1,0,3.5,'50'])
      assert.throws(()=>createAssetRequest({...form,[key]:value},palette,'id'));
  assert.throws(()=>createAssetRequest({...form,columns:3},palette,'id'),/at least 4/);
  assert.throws(()=>createAssetRequest({...form,gridSize:49},palette,'id'),/at least 50/);
  const request=createAssetRequest({...form,columns:128,rows:4,gridSize:64},palette,'id');
  assert.equal(request.scene.columns*request.scene.gridSize,8192);
  assert.equal(request.plan,undefined);
  assert.throws(()=>createAssetRequest({...form,columns:129,rows:4,gridSize:64},palette,'id'),/limit/);
  assert.doesNotThrow(()=>createAssetRequest({...form,columns:100,rows:96,gridSize:50},palette,'id'));
  assert.throws(()=>createAssetRequest({...form,columns:100,rows:97,gridSize:50},palette,'id'),/limit/);
});
test('project persistence bypasses legacy migration and retains exact palette IDs',async()=>{
  const {plan}=assetFixture();
  const scene={id:'asset-scene',flags:{plan:structuredClone(plan),revision:null},getFlag(_scope,key){return this.flags[key];},
    async update(data){for(const [key,value]of Object.entries(data))this.flags[key.split('.').at(-1)]=value;}};
  const first=projectFromScene(scene);assert.equal(first.plan.features[0].assetId,'desk');assert.equal(first.plan.art,undefined);
  const workflow={...first,map:{kind:'assets',src:null,composite:'assets/render.png'},revision:null};
  await saveProject(scene,workflow);
  const reopened=projectFromScene(scene);
  assert.deepEqual(reopened.plan,plan);assert.deepEqual(reopened.map,workflow.map);
  assert.equal(reopened.revision,workflow.revision);
});
