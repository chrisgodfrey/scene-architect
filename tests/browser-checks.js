import {renderSceneArt,renderProp,makeCanvas,compositePreview,canvasBlob,loadImage} from '../scripts/renderer.js';
import {validatePlan} from '../scripts/plan.js';
import {usedAssets} from '../scripts/art-manifest.js';
import {compileGeometry} from '../scripts/geometry.js';
import {wallDataFromSegment} from '../scripts/foundry-data.js';
import {projectFromScene} from '../scripts/project.js';
import {renderGuide,renderWholeMap} from '../scripts/whole-map.js';
import {analysisFrame} from '../scripts/image-geometry.js';
import {applyDocumentUpdate} from './mock-update.js';

const results=[],assert=(truth,message)=>{if(!truth)throw new Error(message);results.push(message);};
const pixel=(canvas,x,y)=>[...canvas.getContext('2d').getImageData(x,y,1,1).data];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fixture=await (await fetch('/fixtures/laboratory.json')).json();
const fullCrop={x:0,y:0,width:1,height:1};
const images=new Map();
const colours={'surround-rock':'#202a34','wall-stone':'#ad8d68','floor-1-stone':'#657780','floor-2-metal':'#496370'};
for(const a of usedAssets(fixture)) {
  const c=makeCanvas(a.kind==='prop'?Math.round(128*a.ratio):128,128),ctx=c.getContext('2d');
  if(a.kind==='material'){ctx.fillStyle=colours[a.id];ctx.fillRect(0,0,c.width,c.height);}
  else {ctx.fillStyle=a.id==='vapour'?'#a56dbb66':'#c4a577';ctx.fillRect(c.width*.08,10,c.width*.84,108);ctx.fillStyle='#2b363e';ctx.fillRect(c.width*.2,26,c.width*.6,70);ctx.fillStyle='white';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.fillText('SYNTHETIC',c.width/2,65,c.width-8);}
  images.set(a.id,c);fixture.art.assignments[a.id]={src:a.id+'.png',fit:'contain',crop:fullCrop};
}

try {
  validatePlan(fixture);
  let loads=0;
  const rendered=await renderSceneArt(fixture,{imageLoader:async src=>{loads++;return images.get(src.replace('.png',''));}});
  assert(loads===11,'Renderer loads exactly the 11 used assets');
  assert(rendered.props.length===11,'Renderer places exactly 11 feature instances');
  const beds=rendered.props.filter(p=>p.feature.assetId==='restraint-bed');
  assert(beds.length===3&&beds[0].canvas===beds[1].canvas&&beds[1].canvas===beds[2].canvas,'Three restraint beds share one fitted texture');
  assert(same(pixel(rendered.background,40,40),[32,42,52,255]),'Surrounding material stays outside rooms');
  assert(same(pixel(rendered.background,9*70,9*70),[101,119,128,255]),'Exact room interior receives stone floor');
  assert(same(pixel(rendered.background,4*70,9*70),[73,99,112,255]),'Adjoining machinery room receives its own floor');
  assert(same(pixel(rendered.background,8*70,13*70),[173,141,104,255]),'Solid wall boundary receives wall texture');
  assert(same(pixel(rendered.background,8*70,11*70),[101,119,128,255]),'Native door span remains clear in static background');
  assert(same(pixel(rendered.background,8*70,17*70),[101,119,128,255]),'Open passage remains clear in static background');
  assert(same(pixel(rendered.background,14*70,8*70),[101,119,128,255]),'Secret doorway has no permanently closed door painting');
  assert(same(pixel(rendered.background,9*70,9*70),pixel(rendered.background,9*70+1,9*70+1)),'Renderer adds no baked grid');
  assert(pixel(beds[0].canvas,0,0)[3]===0,'Transparent source remains transparent at prop corners');
  const source=makeCanvas(200,100),sc=source.getContext('2d');sc.fillStyle='red';sc.fillRect(0,0,100,100);sc.fillStyle='lime';sc.fillRect(100,0,100,100);
  const contained=renderProp(source,{crop:fullCrop,fit:'contain'},100,100,{shadows:false});
  assert(pixel(contained,50,1)[3]===0&&pixel(contained,50,50)[3]===255,'Contain keeps proportions and transparent letterboxing');
  const cropped=renderProp(source,{crop:{x:.5,y:0,width:.5,height:1},fit:'cover'},100,100,{shadows:false});
  assert(same(pixel(cropped,10,10),[0,255,0,255]),'Crop selects the requested source region without background removal');
  const opaque=renderProp(source,{crop:fullCrop,fit:'cover'},100,100,{shadows:false});
  assert(pixel(opaque,0,0)[3]===255,'Opaque image backgrounds are preserved');
  const assembly=compositePreview(rendered,fixture);
  const png=await canvasBlob(assembly);await fetch('/output/laboratory-synthetic.png',{method:'POST',body:png});
  document.querySelector('#assembly').src=URL.createObjectURL(png);
  // Actual image decoding, PNG alpha round-trip and canvas encoding in Chromium.
  const bedBlob=await canvasBlob(images.get('restraint-bed')),bedUrl=URL.createObjectURL(bedBlob),bedImage=await loadImage(bedUrl);
  assert(bedImage.width===64&&bedImage.height===128,'PNG source decodes at original proportions');URL.revokeObjectURL(bedUrl);

  // Mock only Foundry's host APIs; render the production Handlebars template and call real actions.
  const template=Handlebars.compile(await (await fetch('/templates/scene-architect.hbs')).text());
  const notices=[];
  globalThis.ui={notifications:{info:m=>notices.push(m),warn:m=>notices.push(m),error:m=>notices.push(m)}};
  const scenes=new Map();
  globalThis.game={scenes:{get:id=>scenes.get(id),[Symbol.iterator]:()=>scenes.values()},user:{isGM:true},world:{id:'mock-world'}};
  class App {
    async render(){this.element=document.querySelector('#wizard');this.element.innerHTML=template(await this._prepareContext());this.element.onclick=e=>{const button=e.target.closest('[data-action]');if(button)this.constructor.DEFAULT_OPTIONS.actions[button.dataset.action].call(this,e,button);};return this;}
  }
  const uploads=[];
  globalThis.foundry={applications:{api:{ApplicationV2:App,HandlebarsApplicationMixin:x=>x,DialogV2:{confirm:async()=>true,input:async()=>{}}},apps:{FilePicker:{createDirectory:async()=>{},upload:async(_source,_dir,file)=>{uploads.push(file);const path='/output/'+file.name;await fetch(path,{method:'POST',body:file});return {path};}}}},utils:{}};
  let clipboardText='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{clipboardText=text;}}});
  globalThis.Hooks={once:()=>{},on:()=>{}};
  globalThis.CONST={GRID_TYPES:{SQUARE:1},WALL_DOOR_TYPES:{DOOR:1,SECRET:2}};
  globalThis.CONFIG={Canvas:{lightAnimations:{flicker:{},torch:{},rainbowswirl:{},pulse:{}}}};
  const {SceneArchitectApp,buildSceneIntentPrompt,buildLayoutPrompt}=await import('../scripts/scene-architect.js');
  const intentPrompt=buildSceneIntentPrompt({brief:'An old school with four classrooms',sceneName:'School',columns:34,rows:28,gridSize:70,animations:['flicker','rainbowswirl']});
  assert(intentPrompt.includes('"kind": "scene-intent"')&&intentPrompt.includes('"circulation": "linear|central-corridor"')&&intentPrompt.includes('Do not include x, y, width, height')&&intentPrompt.includes('Use flickering-lamp for ordinary lanterns and oil lamps'),'Primary scene design prompt requests coordinate-free semantic intent with bounded circulation and animated practical lights');
  const layoutPrompt=buildLayoutPrompt({brief:'Portal room',sceneName:'Test',columns:20,rows:20,gridSize:70},['flicker','rainbowswirl']);
  assert(layoutPrompt.includes('"spaces"')&&layoutPrompt.includes('"preset":"flickering-lamp"')&&layoutPrompt.includes('sourceFeatureId')&&layoutPrompt.includes('flicker, rainbowswirl'),'Advanced low-level layout prompt retains its coordinate and semantic-light contract');
  const p=structuredClone(fixture);p.art.assignments={};
  const plannedApp=new SceneArchitectApp();plannedApp.usePlan(structuredClone(fixture));await plannedApp.render();
  assert(plannedApp.element.querySelectorAll('.sa-primary').length===1&&plannedApp.element.querySelector('.sa-primary').dataset.action==='buildDraft'&&plannedApp.element.querySelectorAll('[aria-current="step"]').length===1&&plannedApp.element.querySelector('[aria-current="step"]').dataset.step==='1'&&plannedApp.element.querySelector('.sa-step[data-step="1"] details').open,'Planned workflow identifies draft creation as its one primary action and opens only the current planning step');
  const schoolIntent={
    kind:'scene-intent',version:1,
    scene:{name:'Old School',description:'An old school with four classrooms, a library and staff room.',visualDirection:'Top-down old-school fantasy map.',circulation:'central-corridor'},
    rooms:[
      {id:'classroom-1',name:'Classroom one',purpose:'Old desks and a teacher lectern',size:'medium',floor:'wood',features:[{id:'teacher-desk',type:'desk',description:'Teacher desk',size:'small',count:1}],ambientLight:true},
      {id:'classroom-2',name:'Classroom two',purpose:'Rows of student desks',size:'medium',floor:'wood',features:[],ambientLight:true},
      {id:'classroom-3',name:'Classroom three',purpose:'Dusty classroom',size:'medium',floor:'wood',features:[],ambientLight:true},
      {id:'classroom-4',name:'Classroom four',purpose:'Abandoned classroom',size:'medium',floor:'wood',features:[],ambientLight:true},
      {id:'library',name:'Library',purpose:'Book stacks and reading tables',size:'large',floor:'wood',features:[{id:'reading-table',type:'table',description:'Reading table',size:'medium',count:2}],ambientLight:true},
      {id:'staff',name:'Staff room',purpose:'Teachers meeting room',size:'small',floor:'wood',features:[],ambientLight:true}
    ]
  };
  const generatedApp=new SceneArchitectApp();await generatedApp.render();
  assert(generatedApp.element.querySelector('.sa-primary').dataset.action==='copyLayoutPrompt','New workflow makes the scene design request the one primary action');
  await generatedApp.run('copyLayoutPrompt');
  assert(clipboardText.includes('"kind": "scene-intent"')&&generatedApp.element.querySelector('.sa-primary').dataset.action==='pastePlan'&&generatedApp.element.querySelector('[data-next-action-text]').textContent.includes('generated scene design'),'Copying the scene design request advances the primary guidance to one semantic import');
  foundry.applications.api.DialogV2.input=async()=>({json:JSON.stringify(schoolIntent)});
  await generatedApp.run('pastePlan');
  assert(generatedApp.workflow.plan&&!generatedApp.workflow.planRepair&&generatedApp.workflow.plan.spaces.some(space=>space.id==='circulation')&&generatedApp.workflow.plan.openings.length===schoolIntent.rooms.length,'Generated school intent compiles locally into a valid central-corridor plan without repair state');
  assert(generatedApp.element.querySelector('.sa-primary').dataset.action==='buildDraft'&&!generatedApp.element.textContent.includes('Advanced plan not accepted'),'Successful semantic import advances directly to draft creation');
  const validGeneratedPlan=generatedApp.workflow.plan;
  const overCapacity=structuredClone(schoolIntent);overCapacity.rooms=Array.from({length:20},(_,index)=>({...schoolIntent.rooms[0],id:`room-${index}`,name:`Room ${index}`,features:[]}));
  generatedApp.workflow.columns=12;generatedApp.workflow.rows=12;
  foundry.applications.api.DialogV2.input=async()=>({json:JSON.stringify(overCapacity)});
  await generatedApp.run('pastePlan');
  assert(generatedApp.workflow.plan===validGeneratedPlan&&!generatedApp.workflow.planRepair,'Semantic capacity failure preserves the current valid plan and never enters low-level plan repair');
  foundry.applications.api.DialogV2.input=async()=>({json:JSON.stringify(fixture)});
  await generatedApp.run('pastePlan');
  assert(generatedApp.workflow.plan===validGeneratedPlan&&!generatedApp.workflow.planRepair&&notices.at(-1).includes('kind must be "scene-intent"'),'Primary import rejects low-level plan JSON atomically and keeps repair state exclusive to Advanced');
  const invalidPlan=structuredClone(fixture),firstProp=invalidPlan.features[0],overlappingProp=invalidPlan.features[1];
  overlappingProp.x=firstProp.x;overlappingProp.y=firstProp.y;
  const rejectedJson=JSON.stringify(invalidPlan,null,2),dialogResults=[{json:rejectedJson}];
  foundry.applications.api.DialogV2.input=async()=>dialogResults.shift();
  const repairApp=new SceneArchitectApp();await repairApp.render();await repairApp.run('pastePlan',{dataset:{mode:'advanced'}});
  assert(repairApp.workflow.planRepair?.json===rejectedJson&&repairApp.workflow.planRepair.error==='Props restraint-1 and restraint-2 overlap.'&&repairApp.element.textContent.includes('Props restraint-1 and restraint-2 overlap.'),'Rejected plan JSON and the exact validation error remain available in persistent correction guidance');
  assert(repairApp.element.querySelector('.sa-primary').dataset.action==='copyPlanRepairPrompt'&&repairApp.element.querySelector('[data-next-action-text]').textContent.includes('correction request'),'Validation failure makes the correction request the primary guided action');
  await repairApp.run('copyPlanRepairPrompt');
  assert(clipboardText.includes('"validatorError": "Props restraint-1 and restraint-2 overlap."')&&clipboardText.includes('"rejectedPlanText"')&&clipboardText.includes('untrusted data'),'Correction request includes bounded validation evidence and labels model-produced content as untrusted data');
  assert(repairApp.element.querySelector('.sa-primary').dataset.action==='pastePlan'&&repairApp.element.querySelector('[data-next-action-text]').textContent.includes('corrected low-level plan JSON'),'Copied correction request advances the primary guidance to corrected JSON import');
  dialogResults.push({json:JSON.stringify(fixture)});await repairApp.run('pastePlan',{dataset:{mode:'advanced'}});
  assert(repairApp.workflow.plan&&!repairApp.workflow.planRepair&&repairApp.element.querySelector('.sa-primary').dataset.action==='buildDraft','A valid corrected plan clears repair state and resumes the normal draft workflow');
  const scene={id:'browser-scene',name:p.scene.name,width:1960,height:1680,grid:{type:1,size:70,distance:5,units:'ft'},walls:compileGeometry(p).map((e,i)=>({...wallDataFromSegment(e,70),_id:`old-wall-${i}`})),
    lights:[
      {_id:'managed-portal',id:'managed-portal',name:'Managed portal',x:700,y:600,config:{dim:8,bright:3,color:'#954aff',animation:{type:'rainbowswirl',speed:3,intensity:6,reverse:false}},flags:{'scene-architect':{generated:true,preset:'magic-portal',sourceId:'plan-light-1-portal'}}},
      {_id:'managed-lamp',id:'managed-lamp',name:'Managed lamp',x:1200,y:800,config:{dim:6,bright:2,color:'#ffb45b',animation:{type:'flicker',speed:3,intensity:4,reverse:false}},flags:{'scene-architect':{generated:true,preset:'flickering-lamp',sourceId:'plan-light-2-lamp'}}},
      {_id:'protected-light',id:'protected-light',name:'GM light',x:1500,y:1100,config:{dim:5,bright:1,color:'#ffffff',animation:{type:'',speed:5,intensity:5,reverse:false}},flags:{custom:{owner:true}}}
    ],
    tiles:[],flags:{'scene-architect':{plan:p}},firstLevel:{background:{src:''},async update(data){this.background.src=data['background.src'];}},
    getFlag(scope,key){return this.flags[scope]?.[key];},async setFlag(scope,key,value){this.flags[scope][key]=structuredClone(value);},
    async update(data){applyDocumentUpdate(this,data);},
    async createEmbeddedDocuments(type,items,options={}){const key=type==='Wall'?'walls':type==='AmbientLight'?'lights':'tiles';const docs=items.map(x=>{const id=options.keepId?x._id:crypto.randomUUID();return {...structuredClone(x),_id:id,id};});this[key].push(...docs);return docs;},
    async deleteEmbeddedDocuments(type,ids){const key=type==='Wall'?'walls':type==='AmbientLight'?'lights':'tiles';this[key]=this[key].filter(t=>!ids.includes(t.id??t._id));}};
  scenes.set(scene.id,scene);
  const app=new SceneArchitectApp();app.workflow=projectFromScene(scene);await app.render();
  assert(document.querySelectorAll('[name="mapFile"]').length===1&&!document.querySelector('[data-asset-id]'),'Wizard requests one complete map with no asset slots');
  assert(document.querySelectorAll('.sa-primary').length===1&&document.querySelector('.sa-primary').dataset.action==='exportGuide'&&document.querySelectorAll('[aria-current="step"]').length===1&&document.querySelector('.sa-progress-item[data-step="1"]').classList.contains('is-complete')&&document.querySelector('[aria-current="step"]').dataset.step==='2','Wizard exposes exactly one primary next action with planning complete and generation current');
  const reference=await app.markReferenceExported();await app.render();
  assert(reference.referenceExportedAt&&!reference.imageId&&document.querySelector('.sa-primary').dataset.action==='copyMapPrompt','Exporting the reference advances the wizard without creating a same-chat generation identity');
  const guide=renderGuide(p,scene);
  assert(guide.width===1960&&guide.height===1680,'PNG reference uses the exact full-scene dimensions');
  await fetch('/output/map-reference.png',{method:'POST',body:await canvasBlob(guide)});
  const transfer=new DataTransfer();transfer.items.add(new File([await canvasBlob(source)],'whole-map.png',{type:'image/png'}));app.element.querySelector('[name="mapFile"]').files=transfer.files;
  await app.previewMap();
  assert(!!app.element.querySelector('.sa-map-preview canvas')&&!app.element.querySelector('[name="showWalls"]')&&same(pixel(app.element.querySelector('.sa-map-preview canvas'),100,35),[255,0,0,255]),'Stage 3 shows the complete artwork without a stale wall-overlay control');
  assert(app.element.textContent.includes('pure 90° top-down orthographic 2D map')&&app.element.textContent.includes('Reject and regenerate artwork')&&app.element.textContent.includes('visible vertical wall faces'),'Map generation and artwork acceptance require a non-perspective orthographic image');
  assert(app.element.querySelector('.sa-map-warning').textContent.includes('aspect ratio'),'Different aspect ratio produces a visible stretching warning');
  assert(app.element.querySelector('.sa-primary').dataset.action==='applyMap'&&app.element.querySelector('[data-next-action-text]').textContent.includes('continue to scene fitting'),'Artwork preview keeps the primary button and required scene-fit handoff in agreement');
  scene.walls[0].c=[15,35,200,35];scene.walls[0].door=1;
  const withWalls=renderWholeMap(source,scene,{},true),withoutWalls=renderWholeMap(source,scene,{},false);
  assert(same(pixel(withWalls,100,35),[56,189,248,255]),'Preview uses edited native door coordinates and type');
  assert(same(pixel(withoutWalls,100,35),[255,0,0,255]),'Applied image contains no wall overlay');
  const shifted=renderWholeMap(source,scene,{scale:1,x:100,y:50});
  assert(same(pixel(shifted,10,10),[24,26,31,255])&&same(pixel(shifted,200,200),[255,0,0,255]),'Global offsets reposition image and fill exposed canvas');
  scene.tiles=[{id:'legacy',flags:{'scene-architect':{generated:true}}},{id:'custom',flags:{}}];
  const documents=JSON.stringify([scene.walls,scene.lights,scene.tiles]);
  let confirmText='';foundry.applications.api.DialogV2.confirm=async options=>{confirmText=options.content;return true;};
  await app.applyMap();
  assert(uploads.length===2&&scene.firstLevel.background.src.endsWith('-map.png'),'Apply uploads the original source and fitted full-map background');
  assert(scene.getFlag('scene-architect','map').generationId===null&&app.element.querySelector('.sa-primary').dataset.action==='exportSceneFitImage'&&app.element.querySelectorAll('[aria-current="step"]').length===1&&app.element.querySelectorAll('.sa-progress-item').length===5&&app.element.querySelector('[aria-current="step"]').dataset.step==='4'&&app.element.querySelector('.sa-step[data-step="4"] details').open&&!app.element.textContent.includes('optional'),'A map applied without a generation identity opens one required fitted-image scene-fit stage in the five-stage journey');
  const createURL=URL.createObjectURL,anchorClick=HTMLAnchorElement.prototype.click;let exportedBlob;
  HTMLAnchorElement.prototype.click=function(){};
  URL.createObjectURL=blob=>{exportedBlob=blob;return createURL.call(URL,blob);};
  await app.exportSceneFitImage();URL.createObjectURL=createURL;HTMLAnchorElement.prototype.click=anchorClick;
  const combinedExportUrl=URL.createObjectURL(exportedBlob),combinedExport=await loadImage(combinedExportUrl);
  assert(combinedExport.width===scene.width&&clipboardText.includes('"kind":"scene-fit"')&&(clipboardText.match(/Return ONLY/g)??[]).length===1&&clipboardText.includes('REGISTERED PRIOR')&&clipboardText.includes('REGISTERED LIGHT PRIOR'),'Combined fitted fallback downloads one registered comparison and copies one wrapper prompt');
  URL.revokeObjectURL(combinedExportUrl);
  await scene.setFlag('scene-architect','geometryRequest',null);await scene.setFlag('scene-architect','lightingRequest',null);
  assert(JSON.stringify([scene.walls,scene.lights,scene.tiles])===documents,'Applying preserves manually edited walls, lights and all existing Tiles');
  assert(confirmText.includes('older Scene Architect prop Tiles')&&confirmText.includes('aspect ratio'),'Confirmation explains legacy Tiles and aspect-ratio stretch');
  await app.markReferenceExported();await app.copyMapPrompt();
  const generation=app.workflow.generation,reused=await app.generationRequest();
  assert(generation.imageId===reused.imageId&&scene.getFlag('scene-architect','generation').imageId===generation.imageId&&clipboardText.includes(generation.imageId),'Copying and recopying the map prompt reuses one persisted generation identity');
  app.element.querySelector('[name="mapFile"]').files=transfer.files;
  await app.previewMap();await app.applyMap();
  assert(uploads.length===4&&scene.getFlag('scene-architect','map').generationId===generation.imageId,'A selected map associates with same-chat geometry only after its generation prompt was copied');
  const uploadedMap=await loadImage(scene.firstLevel.background.src);
  assert(same(pixel(renderWholeMap(uploadedMap,scene),100,35),[255,0,0,255]),'Encoded uploaded PNG has no preview overlay');
  const reopened=new SceneArchitectApp();reopened.workflow={...projectFromScene(scene),legacySeparateFit:true};await reopened.render();
  assert(reopened.workflow.map.src.includes('-source.png'),'Reopen restores original full-map source');
  assert(reopened.workflow.map.generationId===generation.imageId&&reopened.element.textContent.includes('registered vectors')&&reopened.element.textContent.includes('do not attach the image again'),'Applied map retains generation identity and offers registered same-chat geometry guidance');
  assert(reopened.element.querySelectorAll('.sa-primary').length===1&&reopened.element.querySelector('.sa-primary').dataset.action==='copySourceAnalysisPrompt'&&reopened.element.querySelector('[data-action="exportAnalysisImage"]'),'Map-applied workflow recommends same-chat analysis while keeping the fitted-image fallback reachable');
  assert(reopened.element.textContent.includes('Manual wall and door edits are supported'),'Native edits show an advisory without blocking the workflow');
  const uploadCount=uploads.length;
  await reopened.previewMap();await reopened.applyMap();
  const reappliedMap=scene.getFlag('scene-architect','map');
  assert(!reopened.element.querySelector('[name="mapScale"], [name="mapX"], [name="mapY"]')&&uploads.length===uploadCount+1&&reappliedMap.scale===1&&reappliedMap.x===0&&reappliedMap.y===0,'Reapply reuses the original source with an automatic full-scene fit and no manual alignment controls');
  const background=scene.firstLevel.background.src;
  foundry.applications.api.DialogV2.confirm=async()=>false;await reopened.applyMap();
  assert(scene.firstLevel.background.src===background&&uploads.length===uploadCount+1,'Cancelling application preserves the background and performs no upload');
  foundry.applications.api.DialogV2.confirm=async()=>true;
  const originalUpload=foundry.applications.apps.FilePicker.upload;
  foundry.applications.apps.FilePicker.upload=async()=>({error:'simulated upload failure'});
  let failed=false;try{await reopened.applyMap();}catch(e){failed=e.message.includes('simulated upload failure');}
  assert(failed&&scene.firstLevel.background.src===background,'Upload failure leaves the existing background intact');
  foundry.applications.apps.FilePicker.upload=originalUpload;
  const sourceRequest=await reopened.analysisRequest('source');
  assert(sourceRequest.imageId===generation.imageId&&sourceRequest.width===200&&sourceRequest.height===100&&sourceRequest.sceneWidth===1960&&sourceRequest.registration.segments.length===scene.walls.length&&sourceRequest.wallSignature,'Same-chat analysis persists source dimensions, live vector registration and a freshness signature');
  const sourceIds=[...sourceRequest.registration.segments,...sourceRequest.registration.openings].map(s=>s.id);
  const sourceSeg=(id,a,b,kind='wall',sourceIds=[],change='added')=>({id,a,b,kind,evidence:'visible',reviewRequired:false,note:'',sourceIds,change});
  const sourceProposal={version:2,coordinateSpace:'normalized-source-image',boundaryConvention:'wall-centre',source:{imageId:generation.imageId,width:200,height:100},walls:[sourceSeg('source-wall',[.1,.2],[.4,.2],'wall',[sourceIds[0]],'moved')],openings:[],removedSourceIds:sourceIds.slice(1),reviewNotes:[]};
  reopened.element.querySelector('[name="geometryJson"]').value=JSON.stringify(sourceProposal);await reopened.importGeometry();
  const transformed=scene.getFlag('scene-architect','geometryProposal');
  assert(transformed.origin.version===2&&transformed.walls[0].sourceIds[0]===sourceIds[0]&&transformed.walls[0].a[0]===.1&&!!reopened.element.querySelector('.sa-geometry-preview canvas'),'Same-chat source geometry preserves vector correspondence through the automatic full-scene fit');
  assert(reopened.element.querySelector('.sa-primary').dataset.action==='applyGeometry','Previewed geometry advances the primary action to apply');
  await scene.setFlag('scene-architect','geometryProposal',null);await reopened.render();
  const request=await reopened.analysisRequest();
  assert(request.width===1960&&request.height===1680&&request.imageId,'Analysis request is tied to the currently fitted background and scene dimensions');
  // Inspect the actual export blob without starting an OS download in headless Edge.
  HTMLAnchorElement.prototype.click=function(){};
  URL.createObjectURL=blob=>{exportedBlob=blob;return createURL.call(URL,blob);};
  await reopened.exportAnalysisImage();URL.createObjectURL=createURL;HTMLAnchorElement.prototype.click=anchorClick;
  const exportUrl=URL.createObjectURL(exportedBlob),exportedImage=await loadImage(exportUrl);
  const prior=request.registration.segments[0],priorX=Math.round((prior.a[0]+prior.b[0])*exportedImage.width/2),priorY=Math.round((prior.a[1]+prior.b[1])*exportedImage.height/2);
  const exportedCanvas=renderWholeMap(exportedImage,scene,{},false),cleanAnalysis=renderWholeMap(await loadImage(scene.firstLevel.background.src),scene,{},false);
  assert(exportedImage.width===1960&&!same(pixel(exportedCanvas,priorX,priorY),pixel(cleanAnalysis,priorX,priorY)),'Fitted analysis export overlays labelled registered vectors on otherwise unchanged artwork');URL.revokeObjectURL(exportUrl);
  const seg=(id,a,b,kind='wall',reviewRequired=false,sourceIds=[],change='added')=>({id,a,b,kind,evidence:'visible',reviewRequired,note:reviewRequired?'Check this opening':'',sourceIds,change});
  const fittedIds=[...request.registration.segments,...request.registration.openings].map(s=>s.id);
  const proposal={version:1,coordinateSpace:'normalized-image',boundaryConvention:'wall-centre',source:{imageId:request.imageId,width:1960,height:1680},walls:[seg('wall1',[.1,.2],[.4,.2],'wall',false,[fittedIds[0]],'moved'),seg('door1',[.4,.2],[.5,.2],'door'),seg('wall2',[.5,.2],[.9,.2])],openings:[seg('gap',[.1,.5],[.2,.5],'open',true)],removedSourceIds:fittedIds.slice(2),reviewNotes:['Confirm the passage.']};
  const invalidGeometry=structuredClone(proposal);invalidGeometry.openings[0].id='opening-corridor-salon';invalidGeometry.openings[0].kind='door';
  const rejectedGeometryJson=JSON.stringify(invalidGeometry,null,2);
  reopened.element.querySelector('[name="geometryJson"]').value=rejectedGeometryJson;await reopened.run('importGeometry');
  assert(reopened.geometryRepair?.json===rejectedGeometryJson&&reopened.geometryRepair.error==='opening-corridor-salon: invalid segment kind.'&&reopened.element.textContent.includes('Geometry not accepted'),'Invalid final geometry retains the rejected JSON and exact validator error in persistent correction guidance');
  assert(reopened.element.querySelectorAll('.sa-primary').length===1&&reopened.element.querySelector('.sa-primary').dataset.action==='copyGeometryRepairPrompt','Geometry validation failure makes the correction request the one primary action');
  await reopened.run('copyGeometryRepairPrompt');
  assert(clipboardText.includes('"validatorError": "opening-corridor-salon: invalid segment kind."')&&clipboardText.includes('"rejectedGeometryText"')&&clipboardText.includes('REGISTERED PRIOR')&&clipboardText.includes('untrusted data')&&reopened.element.querySelector('.sa-primary').dataset.action==='importGeometry','Geometry correction request includes the original contract and bounded rejection evidence, then advances to corrected import');
  const originalWalls=JSON.stringify(scene.walls),preserved=JSON.stringify([scene.lights,scene.tiles,scene.firstLevel.background]);
  const promptWallX=scene.walls[0].c[0];scene.walls[0].c[0]++;reopened.element.querySelector('[name="geometryJson"]').value=JSON.stringify(proposal);
  let staleRequest=false;try{await reopened.importGeometry();}catch(e){staleRequest=e.message.includes('current walls changed');}
  scene.walls[0].c[0]=promptWallX;
  assert(staleRequest,'Wall edits after copying the prompt invalidate registered geometry before import');
  reopened.element.querySelector('[name="geometryJson"]').value=JSON.stringify({...proposal,source:{...proposal.source,imageId:'wrong-image'}});
  let rejected=false;try{await reopened.importGeometry();}catch(e){rejected=e.message.includes('different analysis image');}
  assert(rejected&&JSON.stringify(scene.walls)===originalWalls,'JSON from a different analysis image is rejected without wall changes');
  const jsonTransfer=new DataTransfer();jsonTransfer.items.add(new File([JSON.stringify(proposal)],'geometry.json',{type:'application/json'}));
  reopened.element.querySelector('[name="geometryFile"]').files=jsonTransfer.files;
  await reopened.importGeometry();
  assert(!reopened.geometryRepair&&JSON.stringify(scene.walls)===originalWalls&&scene.getFlag('scene-architect','geometryProposal').registrationReviewRequired&&reopened.element.textContent.includes('treated as removed for this preview'),'Corrected file import clears repair state, tolerates missing source accounting and leaves walls unchanged');
  assert(same(pixel(reopened.element.querySelector('.sa-geometry-preview canvas'),200,336),[72,245,208,255]),'Geometry preview draws imported normalized coordinates over the fitted image');
  assert(reopened.element.querySelector('.sa-primary').dataset.action==='applyGeometry'&&reopened.element.querySelector('[data-next-action-text]').textContent.includes('apply the proposed geometry'),'Geometry preview keeps the primary button and textual next action in agreement');
  let needsReview=false;try{await reopened.applyGeometry();}catch(e){needsReview=e.message.includes('Review the orange');}
  assert(needsReview&&JSON.stringify(scene.walls)===originalWalls,'Flagged openings require review acknowledgement before replacement');
  reopened.element.querySelector('[name="geometryReviewed"]').checked=true;
  foundry.applications.api.DialogV2.confirm=async()=>false;await reopened.applyGeometry();
  assert(JSON.stringify(scene.walls)===originalWalls,'Cancelling geometry replacement leaves native documents untouched');
  foundry.applications.api.DialogV2.confirm=async()=>true;
  const wallX=scene.walls[0].c[0];scene.walls[0].c[0]++;
  let stale=false;try{await reopened.applyGeometry();}catch(e){stale=e.message.includes('Preview the proposed geometry')||e.message.includes('current walls changed');}
  assert(stale,'Manual wall edits invalidate the copied geometry request and earlier preview');
  scene.walls[0].c[0]=wallX;
  const beforeReplacement=structuredClone(scene.walls);
  await reopened.previewGeometry();await reopened.applyGeometry();
  assert(scene.walls.length===3&&scene.walls[1].door===1&&!scene.walls.some(w=>w.flags?.['scene-architect']?.analysisSegment==='gap'),'Apply creates native wall/door documents and leaves open passages unblocked');
  assert(JSON.stringify([scene.lights,scene.tiles,scene.firstLevel.background])===preserved,'Geometry replacement preserves lights, the image and existing Tiles');
  const geometryApp=new SceneArchitectApp();geometryApp.workflow={...projectFromScene(scene),legacySeparateFit:true};await geometryApp.render();
  assert(geometryApp.element.textContent.includes('Restore previous walls')&&geometryApp.element.querySelector('[name="geometryJson"]').value.includes('wall1'),'Reopening restores the geometry proposal and wall-backup action');
  assert(geometryApp.element.querySelectorAll('.sa-primary').length===1&&geometryApp.element.querySelector('.sa-primary').dataset.action==='copySourceLightingPrompt'&&geometryApp.element.querySelectorAll('[aria-current="step"]').length===1&&geometryApp.element.querySelector('.sa-progress-item[data-step="4"]').classList.contains('is-complete')&&geometryApp.element.querySelector('[aria-current="step"]').dataset.step==='5'&&geometryApp.element.querySelector('.sa-step[data-step="5"] details').open,'Applied geometry marks its step complete and opens same-chat lighting as the one primary action');
  await geometryApp.restoreGeometry();
  const stripId=wall=>{const c=structuredClone(wall);delete c.id;delete c._id;if(c.flags?.['scene-architect'])delete c.flags['scene-architect'].geometryBatch;return c;};
  assert(same(scene.walls.map(stripId),beforeReplacement.map(stripId)),'Restore action restores the previous wall coordinates, types and document settings');
  assert(geometryApp.element.querySelectorAll('.sa-primary').length===1&&geometryApp.element.querySelector('.sa-primary').dataset.action==='copySourceLightingPrompt','Restored geometry still keeps independent finished-map lighting as the one primary next action');
  const fittedLightRequest=await geometryApp.lightingRequest('fitted');
  assert(fittedLightRequest.width===scene.width&&fittedLightRequest.height===scene.height&&fittedLightRequest.registration.managedLights.length===2,'Fitted lighting request uses the applied scene frame and current managed-light prior');
  exportedBlob=undefined;HTMLAnchorElement.prototype.click=function(){};URL.createObjectURL=blob=>{exportedBlob=blob;return createURL.call(URL,blob);};
  await geometryApp.exportLightingImage();URL.createObjectURL=createURL;HTMLAnchorElement.prototype.click=anchorClick;
  const lightExportUrl=URL.createObjectURL(exportedBlob),lightExport=await loadImage(lightExportUrl),registeredLight=fittedLightRequest.registration.managedLights[0];
  const lightExportCanvas=renderWholeMap(lightExport,scene,{},false),cleanLightImage=renderWholeMap(await loadImage(scene.firstLevel.background.src),scene,{},false);
  assert(!same(pixel(lightExportCanvas,Math.round(registeredLight.center[0]*scene.width),Math.round(registeredLight.center[1]*scene.height)),pixel(cleanLightImage,Math.round(registeredLight.center[0]*scene.width),Math.round(registeredLight.center[1]*scene.height))),'Fitted lighting export overlays labelled managed and protected light context on unchanged artwork');URL.revokeObjectURL(lightExportUrl);
  const lightRequest=await geometryApp.lightingRequest('source');
  assert(lightRequest.registration.managedLights.length===2&&lightRequest.registration.protectedLights.length===1&&lightRequest.imageId===generation.imageId,'Same-chat lighting request registers managed lights and immutable protected context against the original generation');
  await geometryApp.copySourceLightingPrompt();
  assert(clipboardText.includes('tangible visible light emitters')&&clipboardText.includes('Do not ask me to attach')&&clipboardText.includes('Protected IDs are context only')&&clipboardText.includes('cannot disprove a temporal effect'),'Same-chat lighting prompt reuses the generated image and preserves semantic effects plus protected context');
  const portalSource=lightRequest.registration.managedLights.find(light=>light.preset==='magic-portal').id,lampSource=lightRequest.registration.managedLights.find(light=>light.preset==='flickering-lamp').id;
  const lightProposal={version:2,coordinateSpace:'normalized-source-image',requestId:lightRequest.requestId,source:{imageId:generation.imageId,width:200,height:100},lights:[
    {id:'portal-fit',name:'Portal fit',center:[.3,.3],preset:'magic-portal',spread:'large',color:'#954aff',evidence:'visible',reviewRequired:false,note:'Visible portal aperture',sourceIds:[portalSource],change:'moved'},
    {id:'lamp-added',name:'Painted wall lamp',center:[.7,.6],preset:'flickering-lamp',spread:'small',color:'#ffb45b',evidence:'visible',reviewRequired:false,note:'Visible wall fixture',sourceIds:[],change:'added'}
  ],removedSourceIds:[lampSource],reviewNotes:[]};
  const invalidLighting=structuredClone(lightProposal);invalidLighting.lights[1].preset='unknown-effect';
  const rejectedLightingJson=JSON.stringify(invalidLighting,null,2);
  geometryApp.element.querySelector('[name="lightingJson"]').value=rejectedLightingJson;await geometryApp.run('importLighting');
  assert(geometryApp.lightRepair?.json===rejectedLightingJson&&geometryApp.lightRepair.error==='lamp-added: preset is invalid.'&&geometryApp.element.textContent.includes('Lighting not accepted'),'Invalid lighting retains rejected JSON and exact validator error without changing geometry or native lights');
  assert(geometryApp.element.querySelectorAll('.sa-primary').length===1&&geometryApp.element.querySelector('.sa-primary').dataset.action==='copyLightRepairPrompt','Lighting validation failure makes its correction request the one primary action');
  await geometryApp.run('copyLightRepairPrompt');
  assert(clipboardText.includes('"validatorError": "lamp-added: preset is invalid."')&&clipboardText.includes('"rejectedLightingText"')&&clipboardText.includes('REGISTERED LIGHT PRIOR')&&clipboardText.includes('untrusted data'),'Lighting correction request includes the original registered contract and bounded rejection evidence');
  const lightStateBefore=JSON.stringify([scene.lights,scene.walls,scene.tiles,scene.firstLevel.background]);
  scene.lights.find(light=>light.id==='protected-light').x++;
  geometryApp.element.querySelector('[name="lightingJson"]').value=JSON.stringify(lightProposal);
  let staleProtected=false;try{await geometryApp.importLighting();}catch(e){staleProtected=e.message.includes('Native lights changed');}
  scene.lights.find(light=>light.id==='protected-light').x--;
  assert(staleProtected&&JSON.stringify([scene.walls,scene.tiles,scene.firstLevel.background])===JSON.stringify(JSON.parse(lightStateBefore).slice(1)),'Protected-light edits invalidate a copied request without changing geometry or non-light documents');
  await geometryApp.copySourceLightingPrompt();
  const freshLightRequest=scene.getFlag('scene-architect','lightingRequest');
  const correctedLighting={...lightProposal,requestId:freshLightRequest.requestId};
  geometryApp.element.querySelector('[name="lightingJson"]').value=JSON.stringify(correctedLighting);await geometryApp.importLighting();
  assert(!geometryApp.lightRepair&&!!geometryApp.element.querySelector('.sa-lighting-preview canvas')&&geometryApp.element.textContent.includes('Portal fit — magic-portal, large'),'Corrected lighting clears repair state and renders labelled visual plus textual review');
  assert(geometryApp.element.querySelector('.sa-primary').dataset.action==='applyLighting'&&geometryApp.element.querySelector('[data-next-action-text]').textContent.includes('apply the managed-light proposal'),'Lighting preview keeps the primary action and textual guidance in agreement');
  const protectedBefore=structuredClone(scene.lights.find(light=>light.id==='protected-light')),wallsBeforeLights=JSON.stringify(scene.walls);
  foundry.applications.api.DialogV2.confirm=async()=>false;await geometryApp.applyLighting();
  assert(scene.lights.filter(light=>light.flags?.['scene-architect']?.generated).length===2,'Cancelling managed-light replacement leaves current lights unchanged');
  foundry.applications.api.DialogV2.confirm=async()=>true;
  scene.lights.find(light=>light.id==='protected-light').config.dim++;
  let staleLightPreview=false;try{await geometryApp.applyLighting();}catch(e){staleLightPreview=e.message.includes('Native lights changed')||e.message.includes('protected context');}
  scene.lights.find(light=>light.id==='protected-light').config.dim--;
  assert(staleLightPreview,'Protected-light configuration changes invalidate an earlier lighting preview');
  await geometryApp.copySourceLightingPrompt();
  const finalLightRequest=scene.getFlag('scene-architect','lightingRequest');
  const finalLighting={...lightProposal,requestId:finalLightRequest.requestId};
  geometryApp.element.querySelector('[name="lightingJson"]').value=JSON.stringify(finalLighting);await geometryApp.importLighting();await geometryApp.applyLighting();
  assert(scene.lights.filter(light=>light.flags?.['scene-architect']?.generated).length===2&&same(scene.lights.find(light=>light.id==='protected-light'),protectedBefore),'Applying lighting replaces only Scene Architect-managed lights and preserves the protected document');
  assert(JSON.stringify(scene.walls)===wallsBeforeLights&&scene.getFlag('scene-architect','lightingBackup').lights.length===2,'Applying lighting preserves walls and saves a durable managed-light backup');
  assert(geometryApp.element.querySelectorAll('.sa-primary').length===1&&geometryApp.element.querySelector('.sa-primary').dataset.action==='viewScene'&&geometryApp.element.querySelector('.sa-progress-item[data-step="5"]').classList.contains('is-complete'),'Legacy domain checks still reach the live Foundry testing action');
  const appliedManaged=structuredClone(scene.lights.filter(light=>light.flags?.['scene-architect']?.generated));
  await geometryApp.restoreLighting();
  assert(scene.lights.filter(light=>light.flags?.['scene-architect']?.generated).some(light=>light.flags['scene-architect'].sourceId==='plan-light-1-portal')&&scene.getFlag('scene-architect','lightingBackup').lights.length===appliedManaged.length,'Restore returns the previous managed-light set and keeps one-level undo');
  assert(same(scene.lights.find(light=>light.id==='protected-light'),protectedBefore)&&JSON.stringify(scene.walls)===wallsBeforeLights,'Light restoration preserves protected lights and accepted geometry');
  scene.firstLevel.background.src='changed.png';
  let changedImage=false;try{await geometryApp.previewGeometry();}catch(e){changedImage=e.message.includes('analysis image has changed');}
  assert(changedImage,'Changing the background invalidates the stored geometry analysis');
  scene.firstLevel.background.src=background;
  let createdDrafts=0;
  globalThis.Scene={implementation:{async create(data){
    createdDrafts++;
    const draft={...scene,...structuredClone(data),id:'new-draft',walls:[],lights:[],tiles:[],firstLevel:{background:{src:''},async update(change){this.background.src=change['background.src'];}},
      async view(){},async createEmbeddedDocuments(type,items){const docs=items.map((x,i)=>({...x,id:type+'-'+i}));this[type==='Wall'?'walls':type==='AmbientLight'?'lights':'tiles'].push(...docs);return docs;}};
    scenes.set(draft.id,draft);return draft;
  }}};
  const invalid=structuredClone(fixture);invalid.lights=[{name:'Broken effect',preset:'magic-portal',sourceFeatureId:'instantiator',animation:{type:'missing-effect',speed:3,intensity:3,reverse:false}}];
  const rejectedDraft=new SceneArchitectApp();rejectedDraft.usePlan(invalid);
  let rejectedLight=false;try{await rejectedDraft.buildDraft();}catch(e){rejectedLight=e.message.includes('not available');}
  assert(rejectedLight&&createdDrafts===0,'Unavailable light effects fail before creating a scene or embedded documents');
  const semantic=structuredClone(fixture);semantic.lights=[
    {name:'Instantiator portal',preset:'magic-portal',sourceFeatureId:'instantiator',animation:{type:'rainbowswirl',speed:6,intensity:8,reverse:true}},
    {name:'Engine flicker',preset:'flickering-lamp',sourceFeatureId:'engine'},
    {name:'Medical lamp',preset:'steady-lamp',sourceFeatureId:'medical-1'},
    {name:'Legacy light',x:6,y:7,dim:4,bright:1}
  ];
  const installedAnimations=CONFIG.Canvas.lightAnimations;
  CONFIG.Canvas.lightAnimations={rainbowswirl:{}};
  const fresh=new SceneArchitectApp();fresh.usePlan(semantic);await fresh.buildDraft();
  CONFIG.Canvas.lightAnimations=installedAnimations;
  assert(fresh.scene.walls.filter(w=>w.door===1).length===2&&fresh.scene.walls.filter(w=>w.door===2).length===1,'Draft action creates native wide doors and secret door (mock Foundry)');
  assert(fresh.scene.lights.length===4&&fresh.scene.firstLevel.background.src.endsWith('guide.png'),'Draft action creates semantic and legacy native lights plus a geometry guide (mock Foundry)');
  assert(fresh.scene.lights[0].config.animation.type==='rainbowswirl'&&fresh.scene.lights[0].config.animation.speed===6&&fresh.scene.lights[0].x===14*70,'Semantic light mapping preserves runtime-validated effects, parameters and feature-centred placement');
  assert(fresh.scene.lights[1].config.animation.type===''&&fresh.scene.lights[2].config.animation.type===''&&fresh.scene.lights[3].config.animation.type==='','Unavailable semantic preset animations fall back to steady while steady and legacy lights remain valid');
  fresh.workflow.map={src:fresh.scene.firstLevel.background.src,scale:1,x:0,y:0,width:fresh.scene.width,height:fresh.scene.height,generationId:null};
  const lockedRequest=await fresh.analysisRequest('fitted');
  assert(lockedRequest.gridLocked&&lockedRequest.gridSize===70,'Unmodified deterministic draft geometry enables 70px grid locking');
  fresh.scene.walls[0].c[0]++;
  const freeFitRequest=await fresh.analysisRequest('fitted');
  assert(!freeFitRequest.gridLocked,'A manual off-grid wall edit keeps the free-fit geometry path');
  geometryApp.workflow.legacySeparateFit=false;
  await scene.setFlag('scene-architect','geometryProposal',null);await scene.setFlag('scene-architect','lightingProposal',null);
  await geometryApp.render();await geometryApp.copySceneFitPrompt();
  const fitGeometryRequest=scene.getFlag('scene-architect','geometryRequest'),fitLightingRequest=scene.getFlag('scene-architect','lightingRequest');
  const fitGeometryIds=[...fitGeometryRequest.registration.segments,...fitGeometryRequest.registration.openings].map(item=>item.id);
  const fitManagedIds=fitLightingRequest.registration.managedLights.map(item=>item.id);
  const fitGeometry={version:2,coordinateSpace:'normalized-source-image',boundaryConvention:'wall-centre',source:{imageId:generation.imageId,width:200,height:100},walls:[{id:'combined-wall',a:[.1,.2],b:[.9,.2],kind:'wall',evidence:'visible',reviewRequired:false,note:'',sourceIds:[],change:'added'}],openings:[],removedSourceIds:fitGeometryIds,reviewNotes:[]};
  const fitLighting={version:2,coordinateSpace:'normalized-source-image',requestId:fitLightingRequest.requestId,source:{imageId:generation.imageId,width:200,height:100},lights:[{id:'combined-lamp',name:'Combined lamp',center:[.5,.5],preset:'steady-lamp',spread:'medium',color:'#ffd6a0',evidence:'visible',reviewRequired:false,note:'',sourceIds:[],change:'added'}],removedSourceIds:fitManagedIds,reviewNotes:[]};
  const invalidFitLighting=structuredClone(fitLighting);invalidFitLighting.lights[0].preset='not-installed';
  geometryApp.element.querySelector('[name="sceneFitJson"]').value=JSON.stringify({kind:'scene-fit',version:1,geometry:fitGeometry,lighting:invalidFitLighting});
  await geometryApp.run('importSceneFit');
  assert(geometryApp.sceneFitRepair?.error==='Lighting: combined-lamp: preset is invalid.'&&!scene.getFlag('scene-architect','geometryProposal')&&!scene.getFlag('scene-architect','lightingProposal'),`Combined import rejects both proposals atomically and retains the domain-specific error (${geometryApp.sceneFitRepair?.error})`);
  geometryApp.element.querySelector('[name="sceneFitJson"]').value=JSON.stringify({kind:'scene-fit',version:1,geometry:fitGeometry,lighting:fitLighting});
  await geometryApp.importSceneFit();
  assert(!!geometryApp.element.querySelector('.sa-scene-fit-preview canvas')&&geometryApp.element.querySelector('.sa-primary').dataset.action==='applySceneFit','Valid combined JSON advances through one wall-and-light preview to one apply action');
  foundry.applications.api.DialogV2.confirm=async()=>true;await geometryApp.applySceneFit();
  assert(scene.walls.length===1&&scene.lights.filter(light=>light.flags?.['scene-architect']?.generated).length===1&&scene.lights.some(light=>light.id==='protected-light'),'Combined apply replaces walls and managed lights while preserving protected lights');
  assert(scene.getFlag('scene-architect','sceneFit').frame===analysisFrame(scene)&&geometryApp.element.querySelectorAll('.sa-progress-item').length===5&&geometryApp.element.querySelector('.sa-progress-item[data-step="4"]').classList.contains('is-complete')&&geometryApp.element.querySelector('[aria-current="step"]').dataset.step==='5','A frame-bound fit completes the required stage and opens stage 5 testing');
  const fittedFrame=scene.getFlag('scene-architect','sceneFit').frame;
  geometryApp.element.querySelector('[name="mapFile"]').files=transfer.files;
  await geometryApp.previewMap();await geometryApp.applyMap();
  assert(scene.getFlag('scene-architect','sceneFit').frame===fittedFrame&&analysisFrame(scene)!==fittedFrame&&geometryApp.element.querySelector('[aria-current="step"]').dataset.step==='4'&&geometryApp.element.querySelector('.sa-primary').dataset.action==='exportSceneFitImage','Applying a replacement map invalidates frame-bound completion and requires scene fitting again before Test');
  assert(!!fresh.scene.getFlag('scene-architect','revision')&&!geometryApp.element.textContent.includes('optional'),'New drafts persist and the normal journey exposes no optional fit branch');
  document.querySelector('#results').textContent=`PASS — ${results.length} browser assertions\n${results.join('\n')}`;
  document.querySelector('#results').hidden=true;document.querySelector('#assembly').hidden=true;
  document.querySelector('#assembly').style.display='none';
  const fitSection=document.querySelector('[name="sceneFitJson"]').closest('.sa-section'),hero=document.querySelector('.sa-hero');
  for(const section of document.querySelectorAll('.sa-section'))if(section!==hero&&section!==fitSection)section.style.display='none';
  window.scrollTo(0,0);
  await fetch('/output/browser-results.json',{method:'POST',body:JSON.stringify({passed:results.length,results},null,2)});
  document.title='PASS — Scene Architect';
} catch(error) {
  document.querySelector('#results').textContent=`FAIL: ${error.stack}\nPassed: ${results.join('\n')}`;
  await fetch('/output/browser-results.json',{method:'POST',body:JSON.stringify({error:error.stack,passed:results.length,results},null,2)});
  document.title='FAIL — Scene Architect';
}
