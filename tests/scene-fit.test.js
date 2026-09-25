import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneFitPrompt,drawSceneFitPrior,validateSceneFit,replaceSceneFit} from '../scripts/scene-fit.js';
import {analysisFrame,wallSignature} from '../scripts/image-geometry.js';
import {managedLightSignature,protectedLightSignature} from '../scripts/image-lighting.js';

const plan={scene:{name:'School',description:'Old school'},spaces:[],openings:[],features:[],lights:[]};
const geometryRequest={
  mode:'fitted',imageId:'geometry-image',frame:'frame',width:100,height:100,sceneWidth:100,sceneHeight:100,
  registration:{version:1,coordinateSpace:'normalized-image',segments:[{id:'wall-old',label:'W1',a:[.1,.1],b:[.9,.1],kind:'wall'}],openings:[],rooms:[],features:[]}
};
const lightingRequest={
  mode:'fitted',requestId:'lighting-request',imageId:'lighting-image',frame:'frame',width:100,height:100,sceneWidth:100,sceneHeight:100,
  registration:{version:1,coordinateSpace:'normalized-image',managedLights:[{id:'managed-old',label:'M1',ownership:'managed',name:'Lamp',center:[.5,.5],brightSquares:1,dimSquares:3,color:'#ffffff',preset:'steady-lamp'}],protectedLights:[]}
};
const rawBundle={
  kind:'scene-fit',version:1,
  geometry:{version:1,coordinateSpace:'normalized-image',boundaryConvention:'wall-centre',source:{imageId:'geometry-image',width:100,height:100},walls:[{id:'wall-new',a:[.1,.2],b:[.9,.2],kind:'wall',evidence:'visible',reviewRequired:false,note:'',sourceIds:['wall-old'],change:'moved'}],openings:[],removedSourceIds:[],reviewNotes:[]},
  lighting:{version:1,coordinateSpace:'normalized-image',requestId:'lighting-request',source:{imageId:'lighting-image',width:100,height:100},lights:[{id:'light-new',name:'Lamp',center:[.5,.5],preset:'steady-lamp',spread:'medium',color:'#ffffff',evidence:'visible',reviewRequired:false,note:'',sourceIds:['managed-old'],change:'moved'}],removedSourceIds:[],reviewNotes:[]}
};

test('combined scene-fit prompt has one wrapper output contract and both registered tasks',()=>{
  const prompt=buildSceneFitPrompt(plan,{geometryRequest,lightingRequest,availablePresets:['steady-lamp']});
  assert.equal((prompt.match(/Return ONLY/g)??[]).length,1);
  assert.match(prompt,/"kind":"scene-fit"/);
  assert.match(prompt,/GEOMETRY TASK/);
  assert.match(prompt,/LIGHTING TASK/);
  assert.match(prompt,/wall-old/);
  assert.match(prompt,/managed-old/);
});

test('scene-fit validation returns both canonical proposals only when both are valid',()=>{
  const result=validateSceneFit(rawBundle,{geometryRequest,lightingRequest,catalog:{}});
  assert.equal(result.geometry.walls[0].id,'wall-new');
  assert.equal(result.lighting.lights[0].id,'light-new');
  const invalid=structuredClone(rawBundle);invalid.lighting.lights[0].preset='invalid';
  assert.throws(()=>validateSceneFit(invalid,{geometryRequest,lightingRequest,catalog:{}}),/^Error: Lighting: light-new: preset is invalid/);
});

test('combined prior draws geometry and lighting annotations on one canvas',()=>{
  const calls=[];
  const context=new Proxy({measureText:text=>({width:text.length*6})},{get(target,key){return key in target?target[key]:(...args)=>calls.push([key,...args]);},set(target,key,value){target[key]=value;return true;}});
  const canvas={width:100,height:100,getContext:()=>context};
  drawSceneFitPrior(canvas,{geometryRequest,lightingRequest},{grid:{size:10,distance:5}});
  assert(calls.some(call=>call[0]==='lineTo'));
  assert(calls.some(call=>call[0]==='arc'));
});

function mockScene({failLighting=false,onLightingFailure,failWallRestore=false}={}) {
  let id=0,wallCreates=0;
  const flags={'scene-architect':{geometryBackup:{old:true},lightingBackup:{old:true}}};
  const scene={
    id:'scene',width:100,height:100,padding:0,shiftX:0,shiftY:0,grid:{size:10,distance:5},
    firstLevel:{background:{src:'map.png'}},
    walls:[{_id:'wall-1',id:'wall-1',c:[0,0,100,0],door:0,flags:{}}],
    lights:[
      {_id:'light-1',id:'light-1',name:'Managed',x:20,y:20,config:{bright:5,dim:10},flags:{'scene-architect':{generated:true}}},
      {_id:'protected-1',id:'protected-1',name:'Protected',x:80,y:80,config:{bright:2,dim:4},flags:{custom:{owner:true}}}
    ],
    getFlag(scope,key){return flags[scope]?.[key];},
    async setFlag(scope,key,value){flags[scope]??={};flags[scope][key]=structuredClone(value);},
    async createEmbeddedDocuments(type,items,options={}) {
      if(type==='AmbientLight'&&failLighting) {
        onLightingFailure?.(this);
        throw new Error('simulated lighting failure');
      }
      if(type==='Wall'&&++wallCreates>1&&failWallRestore)throw new Error('simulated wall recovery failure');
      const target=type==='Wall'?this.walls:this.lights;
      const created=items.map(item=>{
        const document=structuredClone(item),documentId=options.keepId?document._id:`new-${++id}`;
        document._id=documentId;document.id=documentId;target.push(document);return document;
      });
      return created;
    },
    async deleteEmbeddedDocuments(type,ids) {
      const key=type==='Wall'?'walls':'lights';
      this[key]=this[key].filter(document=>!ids.includes(document.id??document._id));
    }
  };
  return scene;
}

test('scene-fit apply updates both document domains and preserves protected lights',async()=>{
  const scene=mockScene(),frame=analysisFrame(scene),wallBefore=wallSignature(scene),managedBefore=managedLightSignature(scene),protectedBefore=protectedLightSignature(scene);
  await replaceSceneFit(scene,{frame,wallBefore,managedBefore,protectedBefore,walls:[{c:[0,10,100,10],door:0,flags:{}}],lights:[{name:'New managed',x:50,y:50,config:{bright:5,dim:10},flags:{'scene-architect':{generated:true}}}]});
  assert.equal(scene.walls.length,1);
  assert.equal(scene.walls[0].c[1],10);
  assert.equal(scene.lights.filter(light=>light.flags?.['scene-architect']?.generated).length,1);
  assert(scene.lights.some(light=>light.id==='protected-1'));
});

test('scene-fit apply compensates geometry when lighting fails',async()=>{
  const scene=mockScene({failLighting:true}),frame=analysisFrame(scene),wallBefore=wallSignature(scene),managedBefore=managedLightSignature(scene),protectedBefore=protectedLightSignature(scene);
  await assert.rejects(replaceSceneFit(scene,{frame,wallBefore,managedBefore,protectedBefore,walls:[{c:[0,10,100,10],door:0,flags:{}}],lights:[{name:'New managed',x:50,y:50,config:{bright:5,dim:10},flags:{'scene-architect':{generated:true}}}]}),/restored the pre-operation/);
  assert.deepEqual(scene.walls.map(wall=>({c:wall.c,door:wall.door})),[{c:[0,0,100,0],door:0}]);
  assert.equal(managedLightSignature(scene),managedBefore);
  assert.deepEqual(scene.getFlag('scene-architect','geometryBackup'),{old:true});
  assert.deepEqual(scene.getFlag('scene-architect','lightingBackup'),{old:true});
});

test('scene-fit recovery refuses to overwrite concurrent changes and retains backup evidence',async()=>{
  const scene=mockScene({failLighting:true,onLightingFailure:current=>{current.lights.find(light=>light.id==='protected-1').x++;}}),frame=analysisFrame(scene),wallBefore=wallSignature(scene),managedBefore=managedLightSignature(scene),protectedBefore=protectedLightSignature(scene);
  await assert.rejects(replaceSceneFit(scene,{frame,wallBefore,managedBefore,protectedBefore,walls:[{c:[0,10,100,10],door:0,flags:{}}],lights:[{name:'New managed',x:50,y:50,config:{bright:5,dim:10},flags:{'scene-architect':{generated:true}}}]}),/recovery is blocked: Native lights or the background changed during recovery/);
  assert.notDeepEqual(scene.getFlag('scene-architect','geometryBackup'),{old:true});
  assert.equal(scene.walls[0].c[1],10);
});

test('scene-fit recovery reports failed compensation and retains durable backups',async()=>{
  const scene=mockScene({failLighting:true,failWallRestore:true}),frame=analysisFrame(scene),wallBefore=wallSignature(scene),managedBefore=managedLightSignature(scene),protectedBefore=protectedLightSignature(scene);
  await assert.rejects(replaceSceneFit(scene,{frame,wallBefore,managedBefore,protectedBefore,walls:[{c:[0,10,100,10],door:0,flags:{}}],lights:[{name:'New managed',x:50,y:50,config:{bright:5,dim:10},flags:{'scene-architect':{generated:true}}}]}),/recovery is blocked: simulated wall recovery failure/);
  assert.notDeepEqual(scene.getFlag('scene-architect','geometryBackup'),{old:true});
  assert.notDeepEqual(scene.getFlag('scene-architect','lightingBackup'),{old:true});
  assert.equal(scene.getFlag('scene-architect','lightingBackup').lights.length,1);
});
