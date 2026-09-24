import {renderSceneArt,renderProp,makeCanvas,compositePreview,canvasBlob,loadImage} from '../scripts/renderer.js';
import {validatePlan} from '../scripts/plan.js';
import {usedAssets} from '../scripts/art-manifest.js';
import {compileGeometry} from '../scripts/geometry.js';
import {wallDataFromSegment} from '../scripts/foundry-data.js';
import {projectFromScene} from '../scripts/project.js';
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
  const scene={id:'browser-scene',name:p.scene.name,width:1960,height:1680,grid:{type:1,size:70},walls:compileGeometry(p).map(e=>wallDataFromSegment(e,70)),tiles:[],flags:{'scene-architect':{plan:p}},firstLevel:{background:{src:''},async update(data){this.background.src=data['background.src'];}},
    getFlag(scope,key){return this.flags[scope]?.[key];},async setFlag(scope,key,value){this.flags[scope][key]=structuredClone(value);},
    async update(data){applyDocumentUpdate(this,data);},
    async createEmbeddedDocuments(type,items){if(type!=='Tile')throw new Error('Unexpected document write');const docs=items.map((x,i)=>({...x,id:'tile-'+i}));this.tiles.push(...docs);return docs;},
    async deleteEmbeddedDocuments(type,ids){this.tiles=this.tiles.filter(t=>!ids.includes(t.id));}};
  scenes.set(scene.id,scene);
  const app=new SceneArchitectApp();app.workflow=projectFromScene(scene);await app.render();
  assert(document.querySelectorAll('[data-asset-id]').length===11,'Production template exposes exactly 11 used import slots');
  let card=document.querySelector('[data-asset-id="restraint-bed"]');card.open=true;
  const transfer=new DataTransfer();transfer.items.add(new File([bedBlob],'synthetic-bed.png',{type:'image/png'}));card.querySelector('[name="assetFile"]').files=transfer.files;
  await app.previewAsset(card.querySelector('[data-action="previewAsset"]'));
  assert(!!card.querySelector('.sa-fit-preview canvas'),'Asset preview draws from a selected ordinary PNG file');
  const trigger=async action=>{app.element.querySelector(`[data-action="${action}"]`).click();while(app.busy)await new Promise(r=>setTimeout(r,10));};
  // The first save button is for a material, so dispatch the bed slot explicitly.
  card.querySelector('[data-action="saveAsset"]').click();while(app.busy)await new Promise(r=>setTimeout(r,10));
  assert(uploads.length===1&&scene.flags['scene-architect'].plan.art.assignments['restraint-bed'].hasAlpha,'Real delegated save-slot action uploads and persists alpha assignment');
  const reopened=new SceneArchitectApp();reopened.workflow=projectFromScene(scene);await reopened.render();
  assert(reopened.plan.art.assignments['restraint-bed'].src.includes('/output/'),'Reopening restores assigned image paths');
  reopened.element.querySelector('[name="allowPlaceholders"]').checked=true;
  await reopened.saveSettings();
  assert(scene.flags['scene-architect'].plan.art.settings.allowPlaceholders,'Render settings persist through real UI handler');
  await reopened.renderArt();
  assert(scene.tiles.length===11&&scene.firstLevel.background.src.includes('background.png'),'Render action uploads a background and creates exactly 11 editable Tiles (mock Foundry)');
  assert(scene.tiles.filter(t=>t.flags['scene-architect'].assetId==='restraint-bed').every(t=>t.texture.src===scene.tiles[0].texture.src),'All three native restraint Tiles share one uploaded prop image');
  const before=uploads.length;scene.walls[0].c[0]++;
  let blocked=false;try{await reopened.renderArt();}catch(e){blocked=/Native walls differ/.test(e.message);}
  assert(blocked&&uploads.length===before,'Wall conflict blocks UI rendering before any uploads or writes');
  await reopened.render();assert(reopened.element.textContent.includes('Geometry conflict:'),'Wizard shows a reconciliation explanation for native wall edits');
  scene.walls[0].c[0]--;await reopened.render();
  globalThis.Scene={implementation:{async create(data){
    const draft={...scene,...structuredClone(data),id:'new-draft',walls:[],lights:[],tiles:[],firstLevel:{background:{src:''},async update(change){this.background.src=change['background.src'];}},
      async view(){},async createEmbeddedDocuments(type,items){const docs=items.map((x,i)=>({...x,id:type+'-'+i}));this[type==='Wall'?'walls':type==='AmbientLight'?'lights':'tiles'].push(...docs);return docs;}};
    scenes.set(draft.id,draft);return draft;
  }}};
  const fresh=new SceneArchitectApp();fresh.usePlan(structuredClone(fixture));await fresh.buildDraft();
  assert(fresh.scene.walls.filter(w=>w.door===1).length===2&&fresh.scene.walls.filter(w=>w.door===2).length===1,'Draft action creates native wide doors and secret door (mock Foundry)');
  assert(fresh.scene.lights.length===3&&fresh.scene.firstLevel.background.src.endsWith('wireframe.svg'),'Draft action creates three native lights and a geometry guide (mock Foundry)');
  assert(!!fresh.scene.getFlag('scene-architect','revision'),'New draft is linked and persisted for reopening');
  await reopened.render();
  document.querySelector('[data-asset-id="restraint-bed"]').open=true;
  document.querySelector('#results').textContent=`PASS — ${results.length} browser assertions\n${results.join('\n')}`;
  document.querySelector('#results').hidden=true;document.querySelector('#assembly').hidden=true;
  document.querySelector('#assembly').style.display='none';
  await fetch('/output/browser-results.json',{method:'POST',body:JSON.stringify({passed:results.length,results},null,2)});
  document.title='PASS — Scene Architect';
} catch(error) {
  document.querySelector('#results').textContent=`FAIL: ${error.stack}\nPassed: ${results.join('\n')}`;
  await fetch('/output/browser-results.json',{method:'POST',body:JSON.stringify({error:error.stack,passed:results.length,results},null,2)});
  document.title='FAIL — Scene Architect';
}
