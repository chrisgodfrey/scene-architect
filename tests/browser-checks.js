import {renderSceneArt,renderProp,makeCanvas,compositePreview,canvasBlob,loadImage} from '../scripts/renderer.js';
import {validatePlan} from '../scripts/plan.js';
import {usedAssets} from '../scripts/art-manifest.js';
import {compileGeometry} from '../scripts/geometry.js';
import {wallDataFromSegment} from '../scripts/foundry-data.js';
import {projectFromScene} from '../scripts/project.js';
import {renderGuide,renderWholeMap} from '../scripts/whole-map.js';
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
  globalThis.ui={notifications:{info:m=>notices.push(m),warn:m=>notices.push(m),error:m=>{throw new Error(m);}}};
  const scenes=new Map();
  globalThis.game={scenes:{get:id=>scenes.get(id),[Symbol.iterator]:()=>scenes.values()},user:{isGM:true},world:{id:'mock-world'}};
  class App {
    async render(){this.element=document.querySelector('#wizard');this.element.innerHTML=template(await this._prepareContext());this.element.onclick=e=>{const button=e.target.closest('[data-action]');if(button)this.constructor.DEFAULT_OPTIONS.actions[button.dataset.action].call(this,e,button);};return this;}
  }
  const uploads=[];
  globalThis.foundry={applications:{api:{ApplicationV2:App,HandlebarsApplicationMixin:x=>x,DialogV2:{confirm:async()=>true}},apps:{FilePicker:{createDirectory:async()=>{},upload:async(_source,_dir,file)=>{uploads.push(file);const path='/output/'+file.name;await fetch(path,{method:'POST',body:file});return {path};}}}},utils:{}};
  globalThis.Hooks={once:()=>{},on:()=>{}};
  globalThis.CONST={GRID_TYPES:{SQUARE:1},WALL_DOOR_TYPES:{DOOR:1,SECRET:2}};
  const {SceneArchitectApp}=await import('../scripts/scene-architect.js');
  const p=structuredClone(fixture);p.art.assignments={};
  const scene={id:'browser-scene',name:p.scene.name,width:1960,height:1680,grid:{type:1,size:70},walls:compileGeometry(p).map((e,i)=>({...wallDataFromSegment(e,70),_id:`old-wall-${i}`})),tiles:[],flags:{'scene-architect':{plan:p}},firstLevel:{background:{src:''},async update(data){this.background.src=data['background.src'];}},
    getFlag(scope,key){return this.flags[scope]?.[key];},async setFlag(scope,key,value){this.flags[scope][key]=structuredClone(value);},
    async update(data){applyDocumentUpdate(this,data);},
    async createEmbeddedDocuments(type,items,options={}){const key=type==='Wall'?'walls':'tiles';const docs=items.map(x=>{const id=options.keepId?x._id:crypto.randomUUID();return {...structuredClone(x),_id:id,id};});this[key].push(...docs);return docs;},
    async deleteEmbeddedDocuments(type,ids){const key=type==='Wall'?'walls':'tiles';this[key]=this[key].filter(t=>!ids.includes(t.id??t._id));}};
  scenes.set(scene.id,scene);
  const app=new SceneArchitectApp();app.workflow=projectFromScene(scene);await app.render();
  assert(document.querySelectorAll('[name="mapFile"]').length===1&&!document.querySelector('[data-asset-id]'),'Wizard requests one complete map with no asset slots');
  const guide=renderGuide(p,scene);
  assert(guide.width===1960&&guide.height===1680,'PNG reference uses the exact full-scene dimensions');
  await fetch('/output/map-reference.png',{method:'POST',body:await canvasBlob(guide)});
  const transfer=new DataTransfer();transfer.items.add(new File([await canvasBlob(source)],'whole-map.png',{type:'image/png'}));app.element.querySelector('[name="mapFile"]').files=transfer.files;
  await app.previewMap();
  assert(!!app.element.querySelector('.sa-map-preview canvas'),'Selected complete image produces a real canvas overlay preview');
  assert(app.element.querySelector('.sa-map-warning').textContent.includes('aspect ratio'),'Different aspect ratio produces a visible stretching warning');
  scene.walls[0].c=[15,35,200,35];scene.walls[0].door=1;
  const withWalls=renderWholeMap(source,scene,{},true),withoutWalls=renderWholeMap(source,scene,{},false);
  assert(same(pixel(withWalls,100,35),[56,189,248,255]),'Preview uses edited native door coordinates and type');
  assert(same(pixel(withoutWalls,100,35),[255,0,0,255]),'Applied image contains no wall overlay');
  const shifted=renderWholeMap(source,scene,{scale:1,x:100,y:50});
  assert(same(pixel(shifted,10,10),[24,26,31,255])&&same(pixel(shifted,200,200),[255,0,0,255]),'Global offsets reposition image and fill exposed canvas');
  scene.tiles=[{id:'legacy',flags:{'scene-architect':{generated:true}}},{id:'custom',flags:{}}];
  const documents=JSON.stringify([scene.walls,scene.tiles]);
  let confirmText='';foundry.applications.api.DialogV2.confirm=async options=>{confirmText=options.content;return true;};
  await app.applyMap();
  assert(uploads.length===2&&scene.firstLevel.background.src.endsWith('-map.png'),'Apply uploads the original source and fitted full-map background');
  assert(JSON.stringify([scene.walls,scene.tiles])===documents,'Applying preserves manually edited walls and all existing Tiles');
  assert(confirmText.includes('older Scene Architect prop Tiles')&&confirmText.includes('aspect ratio'),'Confirmation explains legacy Tiles and aspect-ratio stretch');
  const uploadedMap=await loadImage(scene.firstLevel.background.src);
  assert(same(pixel(renderWholeMap(uploadedMap,scene),100,35),[255,0,0,255]),'Encoded uploaded PNG has no preview overlay');
  const reopened=new SceneArchitectApp();reopened.workflow=projectFromScene(scene);await reopened.render();
  assert(reopened.workflow.map.src.includes('-source.png'),'Reopen restores original full-map source');
  assert(reopened.element.textContent.includes('Manual wall and door edits are supported'),'Native edits show an advisory without blocking the workflow');
  reopened.element.querySelector('[name="mapX"]').value='12';
  const uploadCount=uploads.length;
  await reopened.previewMap();await reopened.applyMap();
  assert(uploads.length===uploadCount+1&&scene.getFlag('scene-architect','map').x===12,'Reapply reuses original source and persists new alignment');
  const background=scene.firstLevel.background.src;
  foundry.applications.api.DialogV2.confirm=async()=>false;await reopened.applyMap();
  assert(scene.firstLevel.background.src===background&&uploads.length===uploadCount+1,'Cancelling application preserves the background and performs no upload');
  foundry.applications.api.DialogV2.confirm=async()=>true;
  const originalUpload=foundry.applications.apps.FilePicker.upload;
  foundry.applications.apps.FilePicker.upload=async()=>({error:'simulated upload failure'});
  let failed=false;try{await reopened.applyMap();}catch(e){failed=e.message.includes('simulated upload failure');}
  assert(failed&&scene.firstLevel.background.src===background,'Upload failure leaves the existing background intact');
  foundry.applications.apps.FilePicker.upload=originalUpload;
  const request=await reopened.analysisRequest();
  assert(request.width===1960&&request.height===1680&&request.imageId,'Analysis request is tied to the currently fitted background and scene dimensions');
  const createURL=URL.createObjectURL,anchorClick=HTMLAnchorElement.prototype.click;let exportedBlob;
  // Inspect the actual export blob without starting an OS download in headless Edge.
  HTMLAnchorElement.prototype.click=function(){};
  URL.createObjectURL=blob=>{exportedBlob=blob;return createURL.call(URL,blob);};
  await reopened.exportAnalysisImage();URL.createObjectURL=createURL;HTMLAnchorElement.prototype.click=anchorClick;
  const exportUrl=URL.createObjectURL(exportedBlob),exportedImage=await loadImage(exportUrl);
  assert(exportedImage.width===1960&&same(pixel(renderWholeMap(exportedImage,scene),100,35),[255,0,0,255]),'Analysis export contains fitted artwork without native wall overlays');URL.revokeObjectURL(exportUrl);
  const seg=(id,a,b,kind='wall',reviewRequired=false)=>({id,a,b,kind,evidence:'visible',reviewRequired,note:reviewRequired?'Check this opening':''});
  const proposal={version:1,coordinateSpace:'normalized-image',boundaryConvention:'wall-centre',source:{imageId:request.imageId,width:1960,height:1680},walls:[seg('wall1',[.1,.2],[.4,.2]),seg('door1',[.4,.2],[.5,.2],'door'),seg('wall2',[.5,.2],[.9,.2])],openings:[seg('gap',[.1,.5],[.2,.5],'open',true)],reviewNotes:['Confirm the passage.']};
  const originalWalls=JSON.stringify(scene.walls),preserved=JSON.stringify([scene.tiles,scene.firstLevel.background]);
  reopened.element.querySelector('[name="geometryJson"]').value=JSON.stringify({...proposal,source:{...proposal.source,imageId:'wrong-image'}});
  let rejected=false;try{await reopened.importGeometry();}catch(e){rejected=e.message.includes('different analysis image');}
  assert(rejected&&JSON.stringify(scene.walls)===originalWalls,'JSON from a different analysis image is rejected without wall changes');
  const jsonTransfer=new DataTransfer();jsonTransfer.items.add(new File([JSON.stringify(proposal)],'geometry.json',{type:'application/json'}));
  reopened.element.querySelector('[name="geometryFile"]').files=jsonTransfer.files;
  await reopened.importGeometry();
  assert(JSON.stringify(scene.walls)===originalWalls&&scene.getFlag('scene-architect','geometryProposal').walls.length===3,'File import overrides pasted text and persists the proposal without modifying walls');
  assert(same(pixel(reopened.element.querySelector('.sa-geometry-preview canvas'),200,336),[72,245,208,255]),'Geometry preview draws imported normalized coordinates over the fitted image');
  let needsReview=false;try{await reopened.applyGeometry();}catch(e){needsReview=e.message.includes('Review the orange');}
  assert(needsReview&&JSON.stringify(scene.walls)===originalWalls,'Flagged openings require review acknowledgement before replacement');
  reopened.element.querySelector('[name="geometryReviewed"]').checked=true;
  foundry.applications.api.DialogV2.confirm=async()=>false;await reopened.applyGeometry();
  assert(JSON.stringify(scene.walls)===originalWalls,'Cancelling geometry replacement leaves native documents untouched');
  foundry.applications.api.DialogV2.confirm=async()=>true;
  scene.walls[0].c[0]++;
  let stale=false;try{await reopened.applyGeometry();}catch(e){stale=e.message.includes('Preview the proposed geometry');}
  assert(stale,'Manual wall edits invalidate an earlier geometry preview');
  const beforeReplacement=structuredClone(scene.walls);
  await reopened.previewGeometry();await reopened.applyGeometry();
  assert(scene.walls.length===3&&scene.walls[1].door===1&&!scene.walls.some(w=>w.flags?.['scene-architect']?.analysisSegment==='gap'),'Apply creates native wall/door documents and leaves open passages unblocked');
  assert(JSON.stringify([scene.tiles,scene.firstLevel.background])===preserved,'Geometry replacement preserves the image and existing Tiles');
  const geometryApp=new SceneArchitectApp();geometryApp.workflow=projectFromScene(scene);await geometryApp.render();
  assert(geometryApp.element.textContent.includes('Restore previous walls')&&geometryApp.element.querySelector('[name="geometryJson"]').value.includes('wall1'),'Reopening restores the geometry proposal and wall-backup action');
  await geometryApp.restoreGeometry();
  const stripId=wall=>{const c=structuredClone(wall);delete c.id;delete c._id;if(c.flags?.['scene-architect'])delete c.flags['scene-architect'].geometryBatch;return c;};
  assert(same(scene.walls.map(stripId),beforeReplacement.map(stripId)),'Restore action restores the previous wall coordinates, types and document settings');
  scene.firstLevel.background.src='changed.png';
  let changedImage=false;try{await geometryApp.previewGeometry();}catch(e){changedImage=e.message.includes('analysis image has changed');}
  assert(changedImage,'Changing the background invalidates the stored geometry analysis');
  scene.firstLevel.background.src=background;
  globalThis.Scene={implementation:{async create(data){
    const draft={...scene,...structuredClone(data),id:'new-draft',walls:[],lights:[],tiles:[],firstLevel:{background:{src:''},async update(change){this.background.src=change['background.src'];}},
      async view(){},async createEmbeddedDocuments(type,items){const docs=items.map((x,i)=>({...x,id:type+'-'+i}));this[type==='Wall'?'walls':type==='AmbientLight'?'lights':'tiles'].push(...docs);return docs;}};
    scenes.set(draft.id,draft);return draft;
  }}};
  const fresh=new SceneArchitectApp();fresh.usePlan(structuredClone(fixture));await fresh.buildDraft();
  assert(fresh.scene.walls.filter(w=>w.door===1).length===2&&fresh.scene.walls.filter(w=>w.door===2).length===1,'Draft action creates native wide doors and secret door (mock Foundry)');
  assert(fresh.scene.lights.length===3&&fresh.scene.firstLevel.background.src.endsWith('guide.png'),'Draft action creates three native lights and a geometry guide (mock Foundry)');
  assert(!!fresh.scene.getFlag('scene-architect','revision'),'New draft is linked and persisted for reopening');
  await reopened.render();
  await reopened.previewGeometry();
  document.querySelector('#results').textContent=`PASS — ${results.length} browser assertions\n${results.join('\n')}`;
  document.querySelector('#results').hidden=true;document.querySelector('#assembly').hidden=true;
  document.querySelector('#assembly').style.display='none';
  const geometrySection=document.querySelector('[name="geometryJson"]').closest('.sa-section');
  for(const section of document.querySelectorAll('.sa-section'))if(section!==geometrySection)section.style.display='none';
  window.scrollTo(0,0);
  await fetch('/output/browser-results.json',{method:'POST',body:JSON.stringify({passed:results.length,results},null,2)});
  document.title='PASS — Scene Architect';
} catch(error) {
  document.querySelector('#results').textContent=`FAIL: ${error.stack}\nPassed: ${results.join('\n')}`;
  await fetch('/output/browser-results.json',{method:'POST',body:JSON.stringify({error:error.stack,passed:results.length,results},null,2)});
  document.title='FAIL — Scene Architect';
}
