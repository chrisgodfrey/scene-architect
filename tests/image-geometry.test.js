import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisPrompt,analysisFrame,validateImageGeometry,proposedWallData,replaceSceneWalls,wallSignature} from '../scripts/image-geometry.js';
const request={imageId:'test-image',width:1000,height:800};
const segment=(id,a,b,kind='wall')=>({id,a,b,kind,evidence:'visible',reviewRequired:false,note:''});
const proposal=()=>({version:1,coordinateSpace:'normalized-image',boundaryConvention:'wall-centre',source:request,walls:[segment('a',[.1,.2],[.4,.2]),segment('door',[.4,.2],[.5,.2],'door'),segment('b',[.5,.2],[.9,.2])],openings:[segment('gap',[.1,.5],[.2,.5],'open')],reviewNotes:[]});
function mockScene() {
  let count=0;
  return {id:'s',width:1000,height:800,firstLevel:{background:{src:'map.png'}},walls:[{_id:'old1',c:[11,12,130,141],door:2,ds:2,flags:{custom:{keep:true}}},{_id:'old2',c:[130,141,222,333],door:0}],lights:[{keep:true}],tiles:[{keep:true}],flags:{},
    async setFlag(m,k,v){this.flags[k]=structuredClone(v);},
    async createEmbeddedDocuments(type,data,options={}) {assert.equal(type,'Wall');const result=data.map(d=>({...structuredClone(d),_id:options.keepId?d._id:`new${++count}`}));this.walls.push(...result);return result;},
    async deleteEmbeddedDocuments(type,ids){assert.equal(type,'Wall');this.walls=this.walls.filter(w=>!ids.includes(w._id));}
  };
}
test('analysis prompt specifies the fitted image, complete network, uncertainty and source identity',()=>{
  const text=analysisPrompt({scene:{name:'Test',description:'Map'},spaces:[],openings:[{kind:'secret'}]},request);
  assert.match(text,/test-image/);assert.match(text,/Do not snap to grid/);assert.match(text,/complete scene wall network/);assert.match(text,/Set reviewRequired true/);
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
