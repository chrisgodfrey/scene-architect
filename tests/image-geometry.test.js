import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisPrompt,analysisFrame,buildRegistrationPrior,validateImageGeometry,proposedWallData,replaceSceneWalls,wallSignature} from '../scripts/image-geometry.js';
const request={imageId:'test-image',width:1000,height:800};
const sourceRequest={mode:'source',imageId:'generation-1',width:1200,height:900,sceneWidth:1000,sceneHeight:800,alignment:{scale:.8,offsetX:100,offsetY:-40}};
const segment=(id,a,b,kind='wall')=>({id,a,b,kind,evidence:'visible',reviewRequired:false,note:''});
const proposal=()=>({version:1,coordinateSpace:'normalized-image',boundaryConvention:'wall-centre',source:request,walls:[segment('a',[.1,.2],[.4,.2]),segment('door',[.4,.2],[.5,.2],'door'),segment('b',[.5,.2],[.9,.2])],openings:[segment('gap',[.1,.5],[.2,.5],'open')],reviewNotes:[]});
const registration={version:1,coordinateSpace:'normalized-image',segments:[{id:'wall-a',label:'W1',a:[.1,.2],b:[.4,.2],kind:'wall'},{id:'wall-b',label:'W2',a:[.5,.2],b:[.9,.2],kind:'wall'}],openings:[{id:'opening-1',label:'O1',a:[.1,.5],b:[.2,.5],kind:'open'}],rooms:[],features:[]};
function mockScene() {
  let count=0;
  return {id:'s',width:1000,height:800,firstLevel:{background:{src:'map.png'}},walls:[{_id:'old1',c:[11,12,130,141],door:2,ds:2,flags:{custom:{keep:true}}},{_id:'old2',c:[130,141,222,333],door:0}],lights:[{keep:true}],tiles:[{keep:true}],flags:{},
    async setFlag(m,k,v){this.flags[k]=structuredClone(v);},
    async createEmbeddedDocuments(type,data,options={}) {assert.equal(type,'Wall');const result=data.map(d=>({...structuredClone(d),_id:options.keepId?d._id:`new${++count}`}));this.walls.push(...result);return result;},
    async deleteEmbeddedDocuments(type,ids){assert.equal(type,'Wall');this.walls=this.walls.filter(w=>!ids.includes(w._id));}
  };
}
test('analysis prompt specifies the fitted image, complete network, uncertainty and source identity',()=>{
  const text=analysisPrompt({scene:{name:'Test',description:'Map'},spaces:[],openings:[{kind:'secret'}]},{...request,registration});
  assert.match(text,/test-image/);assert.match(text,/Do not snap to grid/);assert.match(text,/complete scene wall network/);assert.match(text,/Set reviewRequired true/);assert.match(text,/wall-a/);
});
test('same-chat prompt requests source coordinates without another attachment',()=>{
  const text=analysisPrompt({scene:{name:'Test',description:'Map'},spaces:[],openings:[]},{...sourceRequest,registration:{...registration,coordinateSpace:'normalized-source-image'}});
  assert.match(text,/generated earlier in this conversation/);assert.match(text,/Do not ask me to attach/);
  assert.match(text,/"version":2/);assert.match(text,/normalized-source-image/);assert.match(text,/generation-1/);assert.match(text,/Compare every source ID/);
});
test('registration prior deterministically carries live walls and plan semantic anchors',()=>{
  const scene=mockScene(),plan={scene:{gridSize:100},spaces:[{id:'room',name:'Room',x:1,y:1,width:3,height:2}],openings:[{x:1,y:2,orientation:'h',length:1,kind:'open'}],features:[{id:'altar',x:2,y:1,width:1,height:1}]};
  const prior=buildRegistrationPrior(plan,scene,{mode:'fitted'});
  assert.deepEqual(prior.segments.map(s=>[s.id,s.label,s.kind]),[['wall-old1','W1','secret'],['wall-old2','W2','wall']]);
  assert.deepEqual(prior.openings[0],{id:'opening-1',label:'O1',a:[.1,.25],b:[.2,.25],kind:'open'});
  assert.deepEqual(prior.rooms[0],{id:'room-room',name:'Room',a:[.1,.125],b:[.4,.375]});
  assert.deepEqual(prior.features[0],{id:'feature-altar',center:[.25,.1875]});
});
test('source registration applies the inverse alignment and clips to the source frame',()=>{
  const scene={width:1000,height:800,walls:[{_id:'edge',c:[0,400,1000,400],door:0}]};
  const plan={scene:{gridSize:100},spaces:[],openings:[],features:[]};
  const prior=buildRegistrationPrior(plan,scene,sourceRequest);
  assert.equal(prior.coordinateSpace,'normalized-source-image');
  assert.deepEqual(prior.segments[0].a,[0,.5625]);assert.deepEqual(prior.segments[0].b,[1,.5625]);
});
test('registered geometry preserves complete split, merge and removal correspondence',()=>{
  const registeredRequest={...request,registration};
  const p={...proposal(),walls:[
    {...segment('merged',[.1,.2],[.4,.2]),sourceIds:['wall-a','wall-b'],change:'merged'},
    {...segment('new',[.5,.2],[.9,.2]),sourceIds:[],change:'added'}
  ],openings:[],removedSourceIds:['opening-1']};
  const result=validateImageGeometry(p,registeredRequest);
  assert.deepEqual(result.walls[0].sourceIds,['wall-a','wall-b']);assert.equal(result.walls[0].change,'merged');
  assert.deepEqual(result.removedSourceIds,['opening-1']);
  assert.deepEqual(validateImageGeometry(result,registeredRequest),result);
});
test('missing registered IDs import with a mandatory source-accounting review warning',()=>{
  const registeredRequest={...request,registration};
  const p={...proposal(),walls:[{...segment('only',[.1,.2],[.4,.2]),sourceIds:['wall-a'],change:'moved'}],openings:[],removedSourceIds:['wall-b']};
  const result=validateImageGeometry(p,registeredRequest);
  assert(result.registrationReviewRequired);assert.match(result.registrationReviewNote,/opening-1/);
  assert.deepEqual(result.removedSourceIds,['wall-b','opening-1']);
  assert.deepEqual(validateImageGeometry(result,registeredRequest),result);
});
test('registered geometry rejects unknown, duplicated and reused removals',()=>{
  const registeredRequest={...request,registration};
  const valid={...proposal(),walls:[{...segment('only',[.1,.2],[.4,.2]),sourceIds:['wall-a'],change:'moved'}],openings:[],removedSourceIds:['wall-b','opening-1']};
  for(const modify of [
    p=>p.walls[0].sourceIds=['unknown'],
    p=>p.removedSourceIds=['wall-b','wall-b','opening-1'],
    p=>p.removedSourceIds=['wall-a','wall-b','opening-1'],
    p=>{p.walls[0].change='added';}
  ]) {
    const p=structuredClone(valid);modify(p);assert.throws(()=>validateImageGeometry(p,registeredRequest));
  }
});
test('normalized geometry accepts fenced JSON, pixel precision and diagonal segments',()=>{
  const p=proposal();p.walls.push(segment('diagonal',[.111,.333],[.777,.889]));
  const parsed=validateImageGeometry('```json\n'+JSON.stringify(p)+'\n```',request);
  const walls=proposedWallData(parsed,mockScene());assert.deepEqual(walls[3].c,[111,266,777,711]);
  assert.equal(walls.length,4);assert.equal(walls[1].door,1);assert.equal(walls[1].ds,0);
  assert(!walls.some(w=>w.flags['scene-architect'].analysisSegment==='gap'));
});
test('source mismatch, malformed fields, oversized, duplicate and zero-length geometry fail',()=>{
  for(const modify of [p=>p.source={...request,imageId:'other'},p=>p.source={...request,width:900},p=>p.version=2,p=>p.walls[0].a=[2,0],p=>p.walls[0].a=['0.1',.2],p=>p.walls[0].a=[NaN,.2],p=>p.walls[0].b=p.walls[0].a,p=>p.walls[0].kind='open',p=>p.walls[0].reviewRequired='false',p=>p.walls[1].id='a',p=>p.walls=[]]) {
    const p=proposal();modify(p);assert.throws(()=>validateImageGeometry(p,request));
  }
  assert.throws(()=>validateImageGeometry(' '.repeat(1_000_001),request),/1 MB/);
});
test('overlapping walls, reversed duplicates and blocked passage spans are rejected',()=>{
  for(const s of [segment('duplicate',[.4,.2],[.1,.2]),segment('covered-door',[.1,.2],[.9,.2]),segment('covered-gap',[.05,.5],[.3,.5])]) {
    const p=proposal();p.walls.push(s);assert.throws(()=>validateImageGeometry(p,request),/overlaps/);
  }
});
test('untrusted fields are stripped and secret/plan-informed segments require review',()=>{
  const p=proposal();p.walls[0].flags={malicious:true};p.walls[0].kind='secret';p.walls[1].evidence='plan-informed';
  const result=validateImageGeometry(p,request);
  assert.equal(result.walls[0].flags,undefined);assert(result.walls[0].reviewRequired&&result.walls[1].reviewRequired);
});
test('source geometry transforms into fitted scene coordinates and round-trips canonically',()=>{
  const raw={version:2,coordinateSpace:'normalized-source-image',boundaryConvention:'wall-centre',source:{imageId:'generation-1',width:1200,height:900},
    walls:[segment('wall',[.1,.2],[.4,.2])],openings:[],reviewNotes:[]};
  const result=validateImageGeometry(raw,sourceRequest);
  assert.deepEqual(result.walls[0].a,[.28,.21000000000000002]);assert.deepEqual(result.walls[0].b,[.52,.21000000000000002]);
  assert.equal(result.version,1);assert.equal(result.coordinateSpace,'normalized-image');
  assert.deepEqual(result.source,{imageId:'generation-1',width:1000,height:800});
  assert.deepEqual(validateImageGeometry(result,sourceRequest),result);
});
test('source geometry clips visible spans, omits cropped spans and records review notes',()=>{
  const clippedRequest={...sourceRequest,alignment:{scale:1.5,offsetX:0,offsetY:0}};
  const raw={version:2,coordinateSpace:'normalized-source-image',boundaryConvention:'wall-centre',source:{imageId:'generation-1',width:1200,height:900},
    walls:[segment('partial',[0,.5],[.3,.5]),segment('outside',[.9,.7],[1,.7])],openings:[],reviewNotes:[]};
  const result=validateImageGeometry(raw,clippedRequest);
  assert.equal(result.walls.length,1);assert.deepEqual(result.walls[0].a,[0,.5]);assert.equal(result.walls[0].reviewRequired,true);
  assert.match(result.walls[0].note,/Clipped/);assert(result.reviewNotes.some(n=>/outside.*omitted/.test(n)));
});
test('source geometry rejects the wrong generation and fitted-pixel zero length',()=>{
  const raw={version:2,coordinateSpace:'normalized-source-image',boundaryConvention:'wall-centre',source:{imageId:'other',width:1200,height:900},
    walls:[segment('wall',[.1,.2],[.4,.2])],openings:[],reviewNotes:[]};
  assert.throws(()=>validateImageGeometry(raw,sourceRequest),/different analysis image or generation/);
  raw.source.imageId='generation-1';raw.walls[0]=segment('wall',[.1,.2],[.10001,.2]);
  assert.throws(()=>validateImageGeometry(raw,sourceRequest),/zero pixel length/);
});
test('apply replaces walls only, saves durable backup, and restore keeps door states and custom data',async()=>{
  const scene=mockScene(),original=structuredClone(scene.walls),other=JSON.stringify([scene.lights,scene.tiles,scene.firstLevel]);
  await replaceSceneWalls(scene,proposedWallData(proposal(),scene),wallSignature(scene),analysisFrame(scene));
  assert.deepEqual(scene.flags.geometryBackup.walls,original);assert.equal(scene.walls.length,3);
  const backup=scene.flags.geometryBackup;
  await replaceSceneWalls(scene,backup.walls,wallSignature(scene),analysisFrame(scene),{restoring:true});
  assert.equal(scene.walls.length,2);assert.equal(scene.walls[0].ds,2);assert(scene.walls[0].flags.custom.keep);
  assert.equal(JSON.stringify([scene.lights,scene.tiles,scene.firstLevel]),other);
  assert.equal(scene.flags.geometryBackup.walls.length,3);
});
test('stale preview or failed backup prevents all wall writes',async()=>{
  const scene=mockScene(),sig=wallSignature(scene),frame=analysisFrame(scene);
  scene.walls[0].c[0]++;
  await assert.rejects(replaceSceneWalls(scene,[],sig,frame),/changed/);assert.equal(scene.flags.geometryBackup,undefined);
  scene.setFlag=async()=>{throw new Error('backup failed');};
  await assert.rejects(replaceSceneWalls(scene,[],wallSignature(scene),frame),/backup failed/);assert.equal(scene.walls.length,2);
});
test('partial creation failure removes staged walls while keeping originals',async()=>{
  const scene=mockScene(),old=structuredClone(scene.walls),create=scene.createEmbeddedDocuments;
  scene.createEmbeddedDocuments=async function(type,data,options){await create.call(this,type,data.slice(0,1),options);throw new Error('create failed');};
  await assert.rejects(replaceSceneWalls(scene,proposedWallData(proposal(),scene),wallSignature(scene),analysisFrame(scene)),/create failed/);
  assert.deepEqual(scene.walls,old);
});
test('partial deletion failure restores missing walls with original IDs',async()=>{
  const scene=mockScene(),old=structuredClone(scene.walls),remove=scene.deleteEmbeddedDocuments;let first=true;
  scene.deleteEmbeddedDocuments=async function(type,ids){if(first){first=false;await remove.call(this,type,ids.slice(0,1));throw new Error('delete failed');}return remove.call(this,type,ids);};
  await assert.rejects(replaceSceneWalls(scene,proposedWallData(proposal(),scene),wallSignature(scene),analysisFrame(scene)),/delete failed/);
  assert.deepEqual(scene.walls.sort((a,b)=>a._id.localeCompare(b._id)),old);
});
test('concurrent edits during staging abort without resurrecting a user-deleted wall',async()=>{
  const scene=mockScene(),create=scene.createEmbeddedDocuments;
  scene.createEmbeddedDocuments=async function(...args){const docs=await create.apply(this,args);this.walls=this.walls.filter(w=>w._id!=='old2');return docs;};
  await assert.rejects(replaceSceneWalls(scene,proposedWallData(proposal(),scene),wallSignature(scene),analysisFrame(scene)),/changed during/);
  assert.equal(scene.walls.length,1);assert.equal(scene.walls[0]._id,'old1');
});
test('failed restore keeps the original backup available for another attempt',async()=>{
  const scene=mockScene();
  await replaceSceneWalls(scene,proposedWallData(proposal(),scene),wallSignature(scene),analysisFrame(scene));
  const backup=structuredClone(scene.flags.geometryBackup),current=structuredClone(scene.walls);
  scene.createEmbeddedDocuments=async()=>{throw new Error('restore failed');};
  await assert.rejects(replaceSceneWalls(scene,backup.walls,wallSignature(scene),analysisFrame(scene),{restoring:true}),/restore failed/);
  assert.deepEqual(scene.flags.geometryBackup,backup);assert.deepEqual(scene.walls,current);
});
