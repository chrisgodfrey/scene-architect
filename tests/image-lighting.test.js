import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLightRegistrationPrior,
  lightAnalysisPrompt,
  managedLightSignature,
  protectedLightSignature,
  proposedLightData,
  replaceSceneLights,
  snapshotManagedLights,
  validateImageLighting
} from '../scripts/image-lighting.js';
import {analysisFrame} from '../scripts/image-geometry.js';

const catalog={flicker:{},torch:{},rainbowswirl:{},pulse:{}};
const plan={scene:{name:'Laboratory',description:'Arcane laboratory'},lights:[{name:'Portal',preset:'magic-portal'}]};
const fittedRequest={
  mode:'fitted',
  requestId:'request-1',
  imageId:'image-1',
  width:1000,
  height:800,
  sceneWidth:1000,
  sceneHeight:800
};
const sourceRequest={
  mode:'source',
  requestId:'request-2',
  imageId:'generation-1',
  width:1200,
  height:900,
  sceneWidth:1000,
  sceneHeight:800,
  alignment:{scale:.8,offsetX:100,offsetY:-40}
};
const managed=(id,x,y,sourceId=`source-${id}`)=>({
  _id:id,id,name:`Managed ${id}`,x,y,config:{dim:10,bright:5,color:'#ffb45b'},
  flags:{'scene-architect':{generated:true,preset:'flickering-lamp',sourceId}}
});
const protectedLight=(id,x,y)=>({_id:id,id,name:`Protected ${id}`,x,y,config:{dim:5,bright:1,color:'#ffffff'},flags:{custom:{owner:true}}});
function mockScene() {
  let count=0;
  return {
    id:'scene',width:1000,height:800,grid:{size:100,distance:5},firstLevel:{background:{src:'map.png'}},
    walls:[{id:'wall',c:[0,0,1,1]}],tiles:[{id:'tile'}],tokens:[{id:'token'}],flags:{},
    lights:[managed('m1',200,240),managed('m2',700,500),protectedLight('p1',500,400)],
    async setFlag(_module,key,value){this.flags[key]=structuredClone(value);},
    async createEmbeddedDocuments(type,data,options={}) {
      assert.equal(type,'AmbientLight');
      const docs=data.map(item=>{
        const id=options.keepId?item._id:`new-${++count}`;
        return {...structuredClone(item),_id:id,id};
      });
      this.lights.push(...docs);
      return docs;
    },
    async deleteEmbeddedDocuments(type,ids) {
      assert.equal(type,'AmbientLight');
      this.lights=this.lights.filter(light=>!ids.includes(light.id??light._id));
    }
  };
}
const proposed=(request,registration)=>({
  version:request.mode==='source'?2:1,
  coordinateSpace:request.mode==='source'?'normalized-source-image':'normalized-image',
  requestId:request.requestId,
  source:{imageId:request.imageId,width:request.width,height:request.height},
  lights:[
    {id:'portal',name:'Portal glow',center:[.25,.3],preset:'magic-portal',spread:'large',color:'#954AFF',evidence:'visible',reviewRequired:false,note:'Visible aperture',sourceIds:[registration.managedLights[0].id],change:'moved'},
    {id:'lamp',name:'New wall lamp',center:[.75,.6],preset:'flickering-lamp',spread:'medium',evidence:'visible',reviewRequired:false,note:'Visible wall fixture',sourceIds:[],change:'added'}
  ],
  removedSourceIds:[registration.managedLights[1].id],
  reviewNotes:[]
});

test('registration separates managed and protected light context with deterministic signatures',()=>{
  const scene=mockScene(),registration=buildLightRegistrationPrior(scene,fittedRequest);
  assert.deepEqual(registration.managedLights.map(light=>light.id),['source-m1','source-m2']);
  assert.deepEqual(registration.protectedLights.map(light=>light.id),['protected-p1']);
  assert.deepEqual(registration.managedLights[0].center,[.2,.3]);
  assert.equal(registration.managedLights[0].dimSquares,2);
  const managedSignature=managedLightSignature(scene),protectedSignature=protectedLightSignature(scene);
  scene.lights.push(protectedLight('p2',100,100));
  assert.notEqual(protectedLightSignature(scene),protectedSignature);
  scene.lights.pop();
  scene.lights[2].config.color='#abcdef';
  assert.notEqual(protectedLightSignature(scene),protectedSignature);
  scene.lights[2].config.color='#ffffff';
  scene.lights[0].x++;
  assert.notEqual(managedLightSignature(scene),managedSignature);
  assert.equal(protectedLightSignature(scene),protectedSignature);
  scene.lights[2].config.dim++;
  assert.notEqual(protectedLightSignature(scene),protectedSignature);
  scene.lights.splice(2,1);
  assert.notEqual(protectedLightSignature(scene),protectedSignature);

  const duplicateScene=mockScene();
  duplicateScene.lights[0].flags['scene-architect'].sourceId='shared';
  duplicateScene.lights[1].flags['scene-architect'].sourceId='shared';
  duplicateScene.lights[2].flags['scene-architect']={sourceId:'shared'};
  const duplicateRegistration=buildLightRegistrationPrior(duplicateScene,fittedRequest);
  assert.deepEqual(duplicateRegistration.managedLights.map(light=>light.id),['managed-m1','managed-m2']);
  assert.deepEqual(duplicateRegistration.protectedLights.map(light=>light.id),['protected-p1']);
  assert.equal(new Set([...duplicateRegistration.managedLights,...duplicateRegistration.protectedLights].map(light=>light.id)).size,3);
  const duplicateRequest={...fittedRequest,registration:duplicateRegistration};
  const result=validateImageLighting(proposed(duplicateRequest,duplicateRegistration),duplicateRequest,catalog);
  assert.deepEqual(validateImageLighting(result,duplicateRequest,catalog),result);

  const fallbackScene=mockScene();
  fallbackScene.lights[0].flags['scene-architect'].sourceId='invalid source';
  fallbackScene.lights[1].flags['scene-architect'].sourceId='managed-m1';
  const fallback=buildLightRegistrationPrior(fallbackScene,fittedRequest);
  assert.deepEqual(fallback.managedLights.map(light=>light.id),['managed-m1-2','managed-m1']);
  fallbackScene.lights[0].id=fallbackScene.lights[0]._id='invalid document id';
  assert.throws(()=>buildLightRegistrationPrior(fallbackScene,fittedRequest),/document ID/);
});

test('source registration applies inverse map alignment and prompt needs no repeated attachment',()=>{
  const scene=mockScene(),registration=buildLightRegistrationPrior(scene,sourceRequest);
  assert.equal(registration.coordinateSpace,'normalized-source-image');
  assert.deepEqual(registration.managedLights[0].center,[0,.3125]);
  const prompt=lightAnalysisPrompt(plan,{...sourceRequest,registration});
  assert.match(prompt,/generated earlier in this conversation/);
  assert.match(prompt,/Do not ask me to attach/);
  assert.match(prompt,/tangible visible light emitters/);
  assert.match(prompt,/Protected IDs are context only/);
  assert.match(prompt,/source-m1/);
});

test('validated proposals preserve correspondence and resolve complete Foundry light data',()=>{
  const scene=mockScene(),request={...fittedRequest,registration:buildLightRegistrationPrior(scene,fittedRequest)};
  const result=validateImageLighting(proposed(request,request.registration),request,catalog);
  assert.equal(result.lights[0].color,'#954aff');
  assert.equal(result.registrationReviewRequired,false);
  const data=proposedLightData(result,scene,catalog);
  assert.equal(data[0].x,250);assert.equal(data[0].y,240);
  assert.equal(data[0].config.dim,12);assert.equal(data[0].config.bright,4.5);
  assert.equal(data[0].config.animation.type,'rainbowswirl');
  assert.equal(data[0].flags['scene-architect'].sourceId,'source-m1');
  assert.equal(data[1].flags['scene-architect'].sourceId,'analysis-lamp');
  assert.deepEqual(validateImageLighting(result,request,catalog),result);
});

test('missing managed sources become review-gated removals while protected references fail',()=>{
  const scene=mockScene(),request={...fittedRequest,registration:buildLightRegistrationPrior(scene,fittedRequest)};
  const raw=proposed(request,request.registration);
  raw.removedSourceIds=[];
  const result=validateImageLighting(raw,request,catalog);
  assert(result.registrationReviewRequired);
  assert.deepEqual(result.removedSourceIds,[request.registration.managedLights[1].id]);
  assert.match(result.registrationReviewNote,/treated as proposed removals/);
  for(const edit of [
    value=>value.lights[0].sourceIds=[request.registration.protectedLights[0].id],
    value=>value.removedSourceIds=[request.registration.protectedLights[0].id],
    value=>value.lights[0].sourceIds=['unknown']
  ]) {
    const invalid=proposed(request,request.registration);edit(invalid);
    assert.throws(()=>validateImageLighting(invalid,request,catalog));
  }
});

test('source proposals transform to the fitted scene and omit cropped sources for review',()=>{
  const scene=mockScene(),croppedRequest={...sourceRequest,alignment:{scale:1.5,offsetX:0,offsetY:0}};
  const request={...croppedRequest,registration:buildLightRegistrationPrior(scene,croppedRequest)};
  const raw=proposed(request,request.registration);
  raw.lights[0].center=[.25,.3];
  raw.lights[1].center=[1,.9];
  raw.lights[0].change='split';
  raw.lights[1].sourceIds=[request.registration.managedLights[0].id];
  raw.lights[1].change='split';
  const result=validateImageLighting(raw,request,catalog);
  assert.equal(result.lights[0].center[0],.125);
  assert(Math.abs(result.lights[0].center[1]-.2)<1e-12);
  assert.equal(result.lights.length,1);
  assert(result.reviewNotes.some(note=>/outside the fitted scene/.test(note)));
  assert(!result.removedSourceIds.includes(request.registration.managedLights[0].id));
  assert.equal(result.origin.version,2);
  assert.deepEqual(validateImageLighting(result,request,catalog),result);
});

test('lighting validation rejects stale identity, malformed fields, unsupported effects and limits',()=>{
  const scene=mockScene(),request={...fittedRequest,registration:buildLightRegistrationPrior(scene,fittedRequest)};
  const edits=[
    value=>value.requestId='other',
    value=>value.source.imageId='other',
    value=>value.lights[0].center=[2,0],
    value=>value.lights[0].preset='laser',
    value=>value.lights[0].spread='huge',
    value=>value.lights[0].color='purple',
    value=>value.lights[0].id=value.lights[1].id,
    value=>value.lights[0].reviewRequired='false',
    value=>value.lights[0].change='added',
    value=>value.removedSourceIds=[value.lights[0].sourceIds[0]]
  ];
  for(const edit of edits) {
    const invalid=proposed(request,request.registration);edit(invalid);
    assert.throws(()=>validateImageLighting(invalid,request,catalog));
  }
  assert.throws(()=>validateImageLighting(' '.repeat(1_000_001),request,catalog),/1 MB/);
  const noAnimation={...catalog};delete noAnimation.rainbowswirl;
  assert.throws(()=>validateImageLighting(proposed(request,request.registration),request,noAnimation),/not available/);
  for(const edit of [
    registration=>registration.managedLights[1].id=registration.managedLights[0].id,
    registration=>registration.managedLights[0].id='invalid source',
    registration=>registration.protectedLights[0].id=registration.managedLights[0].id
  ]) {
    const invalidRegistration=structuredClone(request.registration);edit(invalidRegistration);
    const invalidRequest={...fittedRequest,registration:invalidRegistration};
    assert.throws(()=>validateImageLighting(proposed(invalidRequest,invalidRegistration),invalidRequest,catalog),/Copy a fresh lighting request/);
  }
});

test('managed replacement and restore preserve protected lights and all non-light documents',async()=>{
  const scene=mockScene(),registration=buildLightRegistrationPrior(scene,fittedRequest),request={...fittedRequest,registration};
  const proposal=validateImageLighting(proposed(request,registration),request,catalog);
  const beforeManaged=snapshotManagedLights(scene);
  const protectedBefore=JSON.stringify(scene.lights.filter(light=>!light.flags?.['scene-architect']?.generated));
  const otherBefore=JSON.stringify([scene.walls,scene.tiles,scene.tokens,scene.firstLevel]);
  await replaceSceneLights(scene,proposedLightData(proposal,scene,catalog),managedLightSignature(scene),protectedLightSignature(scene),analysisFrame(scene));
  assert.deepEqual(scene.flags.lightingBackup.lights,beforeManaged);
  assert.equal(scene.lights.filter(light=>light.flags?.['scene-architect']?.generated).length,2);
  assert.equal(JSON.stringify(scene.lights.filter(light=>!light.flags?.['scene-architect']?.generated)),protectedBefore);
  assert.equal(JSON.stringify([scene.walls,scene.tiles,scene.tokens,scene.firstLevel]),otherBefore);
  const backup=structuredClone(scene.flags.lightingBackup);
  await replaceSceneLights(scene,backup.lights,managedLightSignature(scene),protectedLightSignature(scene),analysisFrame(scene),{restoring:true});
  assert.equal(scene.lights.filter(light=>light.flags?.['scene-architect']?.generated).length,2);
  assert.equal(scene.flags.lightingBackup.lights.length,2);
});

test('managed or protected edits and failed backup prevent light writes',async()=>{
  const scene=mockScene(),managedSignature=managedLightSignature(scene),protectedSignature=protectedLightSignature(scene),frame=analysisFrame(scene);
  scene.lights[2].x++;
  await assert.rejects(replaceSceneLights(scene,[],managedSignature,protectedSignature,frame),/changed/);
  assert.equal(scene.flags.lightingBackup,undefined);
  scene.lights[2].x--;
  scene.setFlag=async()=>{throw new Error('backup failed');};
  await assert.rejects(replaceSceneLights(scene,[],managedLightSignature(scene),protectedLightSignature(scene),frame),/backup failed/);
  assert.equal(scene.lights.length,3);
});

test('partial creation or deletion failure rolls managed lights back without touching protected lights',async()=>{
  for(const failure of ['create','delete']) {
    const scene=mockScene(),old=structuredClone(scene.lights),create=scene.createEmbeddedDocuments,remove=scene.deleteEmbeddedDocuments;
    if(failure==='create')scene.createEmbeddedDocuments=async function(type,data,options){await create.call(this,type,data.slice(0,1),options);throw new Error('create failed');};
    else {
      let first=true;
      scene.deleteEmbeddedDocuments=async function(type,ids){if(first){first=false;await remove.call(this,type,ids.slice(0,1));throw new Error('delete failed');}return remove.call(this,type,ids);};
    }
    await assert.rejects(replaceSceneLights(scene,[{
      name:'New',x:100,y:100,config:{dim:5,bright:1,animation:{type:'',speed:5,intensity:5,reverse:false}},
      flags:{'scene-architect':{generated:true,sourceId:'new'}}
    }],managedLightSignature(scene),protectedLightSignature(scene),analysisFrame(scene)),new RegExp(`${failure} failed`));
    assert.deepEqual(scene.lights.sort((a,b)=>a._id.localeCompare(b._id)),old);
  }
});
