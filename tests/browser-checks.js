import {renderSceneArt,renderProp,makeCanvas,compositePreview,canvasBlob,loadImage} from '../scripts/renderer.js';
import {validatePlan} from '../scripts/plan.js';
import {usedAssets} from '../scripts/art-manifest.js';
import {compileSceneIntent} from '../scripts/plan-generator.js';
import {compileGeometry} from '../scripts/geometry.js';
import {architecturalRegions} from '../scripts/architecture.js';
import {composeArtwork,renderStructuralMask} from '../scripts/artwork-compositor.js';
import {renderReference,renderAnchorMask} from '../scripts/render-handoff.js';
import {projectFromScene} from '../scripts/project.js';
import {applyDocumentUpdate} from './mock-update.js';
import {checkComposition,checkStructuralVariants} from './composition-browser.js';
import {checkAssetWorkflow} from './asset-browser-checks.js';
import {checkGuidedWorkflow} from './guided-workflow-checks.js';

const results=[],assert=(truth,message)=>{if(!truth)throw new Error(message);results.push(message);};
const pixel=(canvas,x,y)=>[...canvas.getContext('2d').getImageData(x,y,1,1).data];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const output=async(name,blob)=>{const response=await fetch('/output/'+name,{method:'POST',body:blob});if(!response.ok)throw new Error('Output failed: '+name);};
const rejects=async(fn,pattern,message)=>{let caught;try {await fn();}catch(error){caught=error;}const matches=caught&&pattern.test(caught.message);assert(matches,`${message}${matches?'':`: ${caught?.message??'expected rejection'}`}`);};
let priorArtwork={status:'not-checked',scope:'Earlier five-room laboratory artwork only; not new six-room/three-scene validation or visual acceptance.'};
const fixture=await (await fetch('/fixtures/laboratory.json')).json();
const fullCrop={x:0,y:0,width:1,height:1},images=new Map();
const colours={'surround-rock':'#202a34','wall-stone':'#ad8d68','floor-1-stone':'#657780','floor-2-metal':'#496370'};
for(const asset of usedAssets(fixture)) {
  const c=makeCanvas(asset.kind==='prop'?Math.round(128*asset.ratio):128,128),ctx=c.getContext('2d');
  if(asset.kind==='material'){ctx.fillStyle=colours[asset.id];ctx.fillRect(0,0,c.width,c.height);}
  else {ctx.fillStyle=asset.id==='vapour'?'#a56dbb66':'#c4a577';ctx.fillRect(c.width*.08,10,c.width*.84,108);ctx.fillStyle='#2b363e';ctx.fillRect(c.width*.2,26,c.width*.6,70);ctx.fillStyle='white';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.fillText('SYNTHETIC',c.width/2,65,c.width-8);}
  images.set(asset.id,c);fixture.art.assignments[asset.id]={src:asset.id+'.png',fit:'contain',crop:fullCrop};
}
try {
  checkStructuralVariants(assert);
  checkComposition(fixture,assert);validatePlan(fixture);
  let loads=0;
  const rendered=await renderSceneArt(fixture,{imageLoader:async src=>{loads++;return images.get(src.replace('.png',''));}});
  assert(loads===11,'Legacy renderer loads exactly 11 used assets');
  assert(rendered.props.length===11,'Legacy renderer places exactly 11 feature instances');
  const beds=rendered.props.filter(p=>p.feature.assetId==='restraint-bed');
  assert(beds.length===3&&beds[0].canvas===beds[1].canvas&&beds[1].canvas===beds[2].canvas,'Three restraint beds share one fitted texture');
  assert(same(pixel(rendered.background,40,40),[32,42,52,255]),'Legacy surrounding material stays outside rooms');
  assert(same(pixel(rendered.background,9*70,9*70),[101,119,128,255]),'Exact room interior receives stone floor');
  assert(same(pixel(rendered.background,4*70,9*70),[73,99,112,255]),'Adjoining room receives its own floor');
  assert(same(pixel(rendered.background,8*70,13*70),[173,141,104,255]),'Solid legacy wall receives wall texture');
  assert(same(pixel(rendered.background,8*70,11*70),[101,119,128,255]),'Legacy native door span stays clear');
  assert(same(pixel(rendered.background,8*70,17*70),[101,119,128,255]),'Legacy open passage stays clear');
  assert(same(pixel(rendered.background,14*70,8*70),[101,119,128,255]),'Legacy secret doorway does not paint a closed door');
  assert(same(pixel(rendered.background,9*70,9*70),pixel(rendered.background,9*70+1,9*70+1)),'Renderer adds no baked grid');
  assert(pixel(beds[0].canvas,0,0)[3]===0,'Transparent source remains transparent');
  const source=makeCanvas(200,100),sc=source.getContext('2d');sc.fillStyle='red';sc.fillRect(0,0,100,100);sc.fillStyle='lime';sc.fillRect(100,0,100,100);
  const contained=renderProp(source,{crop:fullCrop,fit:'contain'},100,100,{shadows:false});
  assert(pixel(contained,50,1)[3]===0&&pixel(contained,50,50)[3]===255,'Contain preserves proportional letterboxing');
  assert(same(pixel(renderProp(source,{crop:{x:.5,y:0,width:.5,height:1},fit:'cover'},100,100,{shadows:false}),10,10),[0,255,0,255]),'Legacy crop selects the requested source region');
  assert(pixel(renderProp(source,{crop:fullCrop,fit:'cover'},100,100,{shadows:false}),0,0)[3]===255,'Opaque backgrounds are preserved');
  const assembly=compositePreview(rendered,fixture),png=await canvasBlob(assembly);await output('laboratory-legacy-synthetic.png',png);
  document.querySelector('#assembly').src=URL.createObjectURL(png);
  const bedUrl=URL.createObjectURL(await canvasBlob(images.get('restraint-bed'))),bedImage=await loadImage(bedUrl);
  assert(bedImage.width===64&&bedImage.height===128,'PNG source decodes at original proportions');URL.revokeObjectURL(bedUrl);

  const plans=new Map(),synthetics=new Map();
  for(const name of ['laboratory','civic','bathhouse']) {
    const intent=await (await fetch(`/fixtures/intents/${name}.json`)).json();
    const plan=compileSceneIntent(intent,{columns:40,rows:32,gridSize:70});plans.set(name,plan);
    const regions=architecturalRegions(plan),image=makeCanvas(regions.width,regions.height),ctx=image.getContext('2d');
    ctx.fillStyle='#35444f';ctx.fillRect(0,0,image.width,image.height);
    for(const [i,room] of regions.rooms.entries()) {ctx.fillStyle=['#52666d','#655952','#565d75'][i%3];ctx.fillRect(room.x,room.y,room.width,room.height);ctx.fillStyle='#eeeeee';ctx.font='28px sans-serif';ctx.fillText('SYNTHETIC TEST',room.x+40,room.y+70);}
    const blob=await canvasBlob(image);synthetics.set(name,new File([blob],`${name}-synthetic-source.png`,{type:'image/png'}));
    await output(`${name}-synthetic-source.png`,blob);
    const composed=composeArtwork(plan,image).canvas;
    await output(`${name}-synthetic-composite.png`,await canvasBlob(composed));
    await output(`${name}-reference.png`,await canvasBlob(renderReference(plan)));
    await output(`${name}-protected-mask.png`,await canvasBlob(renderStructuralMask(regions)));
    await output(`${name}-anchor-mask.png`,await canvasBlob(renderAnchorMask(plan)));
    const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');
    img.src=`/output/${name}-synthetic-composite.png`;img.alt=`${name}: synthetic composition test, not model artwork`;
    caption.textContent=`${name} — synthetic test colours, NOT evidence of generated-art quality`;figure.append(img,caption);document.querySelector('#samples').append(figure);
    checkComposition(plan,assert);
  }
  // Optional ignored artifact: normal browser tests must not depend on its presence.
  try {
    const response=await fetch('/test-output/geometry-proof/source.png');
    if(response.status===404)priorArtwork={...priorArtwork,status:'absent',message:'Optional earlier artwork source is absent; no qualitative composite exported.'};
    else {
      if(!response.ok)throw new Error(`Optional source request failed: HTTP ${response.status}`);
      const url=URL.createObjectURL(await response.blob());
      try {
        const image=await loadImage(url),composite=composeArtwork(fixture,image).canvas;
        await output('existing-laboratory-composite.png',await canvasBlob(composite));
        await output('existing-laboratory-reference.png',await canvasBlob(renderReference(fixture)));
        priorArtwork={...priorArtwork,status:'exported',sourceWidth:image.width,sourceHeight:image.height,
          outputs:['existing-laboratory-composite.png','existing-laboratory-reference.png'],
          message:'Earlier five-room laboratory source recomposited for human inspection only. Oblique objects and feature alignment are not automatically accepted.'};
        const img=document.createElement('img');img.src='/output/existing-laboratory-composite.png';img.alt='Earlier five-room laboratory artwork with authoritative architecture; not visually accepted';img.style.maxWidth='100%';
        document.querySelector('#existing-artwork').append(img);
      } finally {URL.revokeObjectURL(url);}
    }
  } catch(error) {
    console.warn('Optional earlier-artwork evidence unavailable',error);
    priorArtwork={...priorArtwork,status:'unavailable',message:`Optional earlier artwork could not be composed: ${error.message}`};
  }
  document.querySelector('#existing-artwork-note').textContent=`${priorArtwork.message} ${priorArtwork.scope}`;
  const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const galleryImage=(name,label)=>`<figure><a href="${name}"><img loading="lazy" src="${name}" alt="${escapeHtml(label)}"></a><figcaption><a href="${name}">${escapeHtml(label)}</a></figcaption></figure>`;
  const syntheticSections=['laboratory','civic','bathhouse'].map(name=>`<section id="${name}"><h2>${name[0].toUpperCase()+name.slice(1)} — synthetic v2 test</h2>
    <p>40 × 32 cells. Flat test colours and text only: not model-generated artwork, not furnished-room validation, and not visual acceptance.</p>
    <div class="images">${[
      [`${name}-synthetic-source.png`,'Synthetic source'],
      [`${name}-reference.png`,'Annotated reference'],
      [`${name}-protected-mask.png`,'Protected structural mask'],
      [`${name}-anchor-mask.png`,'Major-anchor mask'],
      [`${name}-synthetic-composite.png`,'Authoritative composite']
    ].map(([file,label])=>galleryImage(file,`${name}: ${label}`)).join('')}</div></section>`).join('');
  const priorSection=priorArtwork.status==='exported'
    ? `<p>Existing 1355 × 1161 model artwork, recomposited against the older 28 × 24, five-room laboratory plan. Oblique machinery and feature alignment still require inspection. This is NOT the new six-room laboratory, NOT three-scene model validation, and NOT visual acceptance.</p><div class="images">${
      galleryImage('geometry-proof/source.png','Earlier five-room original artwork')+
      galleryImage('existing-laboratory-reference.png','Earlier five-room annotated reference')+
      galleryImage('existing-laboratory-composite.png','Earlier five-room authoritative composite')}</div>`
    : `<p>${escapeHtml(priorArtwork.message)} Any older files left in this directory are not evidence from this run.</p>`;
  await output('composition-gallery.html',`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scene Architect — persistent composition evidence</title>
<style>body{margin:0;background:#151922;color:#eee;font:16px/1.5 system-ui}main{max-width:1500px;margin:auto;padding:24px}a{color:#a5d7ff}a:focus-visible{outline:3px solid #ffca59;outline-offset:4px}h1{font-size:1.8rem}section{margin:24px 0;padding:18px;border:1px solid #727989;border-radius:8px}.notice{border-left:4px solid #ffca59;padding:12px;background:#262c38}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}figure{margin:0;min-width:0}img{display:block;width:100%;height:auto;background:#070b10;border:1px solid #727989}figcaption{padding-top:8px}nav{display:flex;gap:20px;flex-wrap:wrap}</style></head>
<body><main><h1>Scene Architect — persistent composition evidence</h1>
<p class="notice"><strong>Evidence limitations:</strong> The three v2 scenes below are synthetic compositor tests. They do not demonstrate generated-art quality, feature fidelity, playable Foundry behaviour, or visual acceptance. Optional prior artwork is a separate, earlier five-room example.</p>
<p>Exported ${escapeHtml(new Date().toISOString())}. This static file opens directly from disk; no server or harness rerun is required. Select any thumbnail or caption to inspect its full-resolution PNG.</p>
<nav aria-label="Evidence sections"><a href="#laboratory">Laboratory</a><a href="#civic">Civic</a><a href="#bathhouse">Bathhouse</a><a href="#prior">Earlier five-room artwork</a><a href="browser-results.json">Browser results JSON</a></nav>
${syntheticSections}<section id="prior"><h2>Optional earlier five-room artwork — qualitative inspection only</h2>${priorSection}</section>
<p>Foundry APIs were mocked in browser verification. Test native vision, doors and lighting in a real Foundry v14 installation before acceptance.</p>
</main></body></html>`);

  // Real production template, real image decoding/canvas; only Foundry host APIs are mocked.
  const template=Handlebars.compile(await (await fetch('/templates/scene-architect.hbs')).text());
  const notices=[],scenes=new Map(),settings=new Map(),uploads=[],downloads=[],mutations=[];
  const faults={};
  let clipboardText='',confirm=true,dialogValue=null;
  globalThis.ui={notifications:{info:m=>notices.push(m),warn:m=>notices.push(m),error:m=>notices.push(m)}};
  globalThis.game={scenes:{get:id=>scenes.get(id),[Symbol.iterator]:()=>scenes.values()},user:{isGM:true},world:{id:'mock-world'},
    settings:{register:(_scope,key,config)=>{if(!settings.has(key))settings.set(key,config.default);},get:(_scope,key)=>settings.get(key),set:async(_scope,key,value)=>{settings.set(key,value);}}};
  class App {
    async render(){this.element=document.querySelector('#wizard');const context=await this._prepareContext();this.element.innerHTML=template(context);
      this.element.onclick=e=>{const button=e.target.closest('[data-action]');if(button&&!button.disabled)this.constructor.DEFAULT_OPTIONS.actions[button.dataset.action].call(this,e,button);};
      await this._onRender(context,{});return this;}
    async close(){this.element?.replaceChildren();}
  }
  document.addEventListener('click',e=>{const link=e.target.closest('a[download]');if(link){e.preventDefault();downloads.push({name:link.download,href:link.href});}});
  globalThis.foundry={applications:{api:{ApplicationV2:App,HandlebarsApplicationMixin:x=>x,DialogV2:{
    confirm:async()=>confirm,input:async()=>dialogValue}},apps:{FilePicker:class {
      constructor(options){this.options=options;}
      async render(){faults.pickerOptions=this.options;this.options.callback(faults.folderSelection??'output');return this;}
      static async createDirectory(){}
      static async browse(){return {};}
      static async upload(_source,_dir,file){
        if(faults.upload){faults.upload=false;throw new Error('Injected upload failure');}
        uploads.push(file);await output(file.name,file);
        if(faults.afterUpload){const callback=faults.afterUpload;delete faults.afterUpload;callback();}
        return {path:'/output/'+file.name};
      }}}},utils:{saveDataToFile:async(text,type,name)=>downloads.push({text,type,name})}};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{clipboardText=text;}}});
  globalThis.Hooks={once:(event,fn)=>{if(event==='init')fn();},on:()=>{}};
  globalThis.CONST={GRID_TYPES:{SQUARE:1},WALL_DOOR_TYPES:{DOOR:1,SECRET:2}};
  class NativeDocument {
    static schema={fields:{x:{clean:Math.round},y:{clean:Math.round}}};
    constructor(data){this.data=data;}
    validate(){if(faults.validation)throw new Error('Injected native validation failure');return true;}
  }
  globalThis.CONFIG={Canvas:{lightAnimations:{flicker:{},torch:{},rainbowswirl:{},pulse:{}}},Wall:{documentClass:NativeDocument},AmbientLight:{documentClass:NativeDocument}};
  globalThis.Scene={implementation:{create:async data=>{
    if(faults.create){faults.create=false;throw new Error('Injected scene creation failure');}
    const scene={...structuredClone(data),id:crypto.randomUUID(),walls:[],lights:[],tiles:[],flags:structuredClone(data.flags),view:async()=>{},
      getFlag(scope,key){return this.flags[scope]?.[key];},
      async update(patch){if(faults.flags){faults.flags=false;throw new Error('Injected flag save failure');}applyDocumentUpdate(this,patch);mutations.push('flags');},
      async delete(){if(faults.cleanup){faults.cleanup=false;throw new Error('Injected cleanup failure');}scenes.delete(this.id);mutations.push('delete-scene');},
      async createEmbeddedDocuments(type,items){
        mutations.push(type);
        if(faults.native===type){delete faults.native;throw new Error('Injected native creation failure');}
        const documents=items.map(item=>({...structuredClone(item),id:crypto.randomUUID()}));
        if(type==='AmbientLight')for(const document of documents) {
          document.x=NativeDocument.schema.fields.x.clean(document.x);
          document.y=NativeDocument.schema.fields.y.clean(document.y);
        }
        if(faults.short===type){delete faults.short;documents.pop();}
        this[type==='Wall'?'walls':'lights'].push(...documents);return documents;
      }};
    scene.firstLevel={background:{src:''},async update(patch){
      if(faults.backgrounds?.shift())throw new Error('Injected background restoration failure');
      if(faults.background){faults.background=false;throw new Error('Injected background failure');}
      this.background.src=patch['background.src'];mutations.push('background');
      if(faults.afterBackground){const callback=faults.afterBackground;delete faults.afterBackground;callback();}
    }};
    scenes.set(scene.id,scene);mutations.push('create-scene');return scene;
  }}};
  const {SceneArchitectApp,buildLayoutPrompt,buildSceneIntentPrompt}=await import('../scripts/scene-architect.js');
  const file=synthetics.get('laboratory'),plan=plans.get('laboratory');
  const fresh=async()=>{settings.set('localDraft','');const app=new SceneArchitectApp();app.usePlan(plan);await app.render();return app;};
  const select=async(app,file)=>{
    const transfer=new DataTransfer();if(file)transfer.items.add(file);
    const input=app.element.querySelector('[name="mapFile"]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await app.localSave;
  };
  const review=app=>{const checkbox=app.element.querySelector('[name="artworkReviewed"]');checkbox.checked=true;checkbox.dispatchEvent(new Event('change',{bubbles:true}));};
  const ready=async()=>{const app=await fresh();await app.buildPlan();await select(app,file);await app.previewArtwork();review(app);return app;};
  const beforeNative=()=>JSON.stringify([...scenes.values()].map(s=>[s.id,s.walls,s.lights,s.tiles]));
  const app=await fresh();
  assert(app.element.querySelectorAll('[aria-current="step"]').length===1,'Exactly one progress step is current');
  assert(app.element.querySelector('.sa-primary').dataset.action==='buildPlan','Imported design leads to local Build');
  assert(!Object.keys(SceneArchitectApp.DEFAULT_OPTIONS.actions).some(name=>/fit|Geometry|Lighting|Draft/i.test(name)),'Primary application contains no fitting, geometry replacement or draft creation actions');
  assert(buildLayoutPrompt(app.workflow,['flicker']).includes('sourceFeatureId')&&buildSceneIntentPrompt(app.workflow).includes('scene-intent'),'Legacy and semantic prompt exports remain available');
  await app.buildPlan();
  assert(scenes.size===0&&uploads.length===0,'Build creates no native scene and uploads nothing');
  assert(app.element.querySelector('.sa-plan-preview canvas')&&app.element.querySelector('.sa-primary').dataset.action==='handoff','Build displays a clean local preview and advances to handoff');
  const savedBuild=JSON.parse(settings.get('localDraft'));
  assert(savedBuild.version===1&&savedBuild.workflow.plan.spaces.length===plan.spaces.length,'Validated local geometry is durably saved before handoff');
  settings.set('localDraft',JSON.stringify({version:1,workflow:{...savedBuild.workflow,built:'untrusted'}}));
  const invalidDraft=new SceneArchitectApp();
  assert(!invalidDraft.plan&&invalidDraft.status.includes('Invalid local build'),'Malformed serialized workflow is rejected instead of restoring unvalidated state');
  await app.persistLocal();
  await app.handoff();
  assert(downloads.at(-1).name.endsWith('-reference.png')&&clipboardText.includes('appearance-layer')&&app.element.querySelector('[data-handoff-text] textarea'),'One handoff action downloads reference, copies provider-independent prompt and shows prompt text');
  navigator.clipboard.writeText=async()=>{throw new Error('Clipboard denied for test');};await app.handoff();
  assert(!app.workflow.generation.copied&&app.element.textContent.includes('Clipboard unavailable'),'Clipboard failure has a visible manual-copy and downloadable prompt fallback');
  await app.downloadPrompt();assert(downloads.at(-1).name.endsWith('-artwork-prompt.txt'),'Handoff prompt is downloadable');
  navigator.clipboard.writeText=async text=>{clipboardText=text;};
  await select(app,file);await app.render();
  assert(app.selectedFile===file&&app.element.textContent.includes(file.name),'Local file selection survives redraw even though native file input resets');
  const before=beforeNative();await app.previewArtwork();
  assert(beforeNative()===before&&scenes.size===0,'Import and preview cannot mutate native geometry or create a scene');
  await rejects(()=>app.createScene(),/Inspect/, 'Creation requires explicit visual inspection');
  review(app);confirm=false;await app.createScene();confirm=true;
  assert(scenes.size===0&&uploads.length===0,'Cancelled confirmation creates no scene and uploads nothing');
  const expectedBytes=Array.from(new Uint8Array(await app.preview.blob.arrayBuffer()));review(app);await app.createScene();
  const scene=app.scene;
  assert(scene&&scene.walls.length===compileGeometry(plan).length&&scene.lights.length===plan.lights.length,'Create Scene verifies native wall/light counts');
  assert(plan.lights.some(l=>!Number.isInteger(l.x*plan.scene.gridSize)||!Number.isInteger(l.y*plan.scene.gridSize)),'Scene creation regression includes fractional-pixel source lights');
  assert(scene.lights.every((l,i)=>l.x===Math.round(plan.lights[i].x*plan.scene.gridSize)&&l.y===Math.round(plan.lights[i].y*plan.scene.gridSize)),'Create Scene accepts host-cleaned coordinates without altering the plan');
  assert(same(expectedBytes,Array.from(new Uint8Array(await uploads.at(-1).arrayBuffer()))),'Created background is byte-exact preview PNG, not a second render');
  assert(scene.grid.alpha===0&&scene.firstLevel.background.src===app.workflow.map.composite,'Scene uses composite background and no baked/native grid overlay by default');
  assert(app.workflow.map.architectureVersion===1&&app.workflow.map.mapping.x===0&&app.workflow.map.sourceWidth===2800,'Saved map retains original dimensions, identity mapping and architecture version');
  const originalSource=app.workflow.map.src,sourceUploads=uploads.filter(f=>f.name.includes('-source.')).length;
  const door=scene.walls.find(w=>w.door);if(door)door.ds=2;
  const nativeSnapshot=beforeNative();await app.previewArtwork();review(app);await app.updateScene();
  assert(app.workflow.map.src===originalSource&&uploads.filter(f=>f.name.includes('-source.')).length===sourceUploads,'Recomposition reuses durable original source, never the composite or a resampled copy');
  assert(beforeNative()===nativeSnapshot&&(!door||door.ds===2),'Background update preserves native light positions and door states without embedded-document replacement');

  // Ratio rejection and all stale-input gates happen before upload/document mutation.
  const ratio=await fresh();await ratio.buildPlan();
  const square=new File([await canvasBlob(makeCanvas(100,100))],'wrong-ratio.png',{type:'image/png'});
  await select(ratio,square);const ratioCounts=[uploads.length,scenes.size];
  await rejects(()=>ratio.previewArtwork(),/aspect ratio/, 'Incompatible source ratio is rejected without crop or stretch');
  assert(same(ratioCounts,[uploads.length,scenes.size]),'Ratio failure makes no uploads or scene');
  await select(ratio,new File([await canvasBlob(makeCanvas(3,2))],'tiny-incompatible.png',{type:'image/png'}));
  await rejects(()=>ratio.previewArtwork(),/aspect ratio/, 'Relative aspect cap rejects tiny incompatible sources');
  const near=await fresh();await near.buildPlan();
  const nearSource=makeCanvas(1403,1121),nearContext=nearSource.getContext('2d');
  nearContext.fillStyle='#a04c71';nearContext.fillRect(0,0,1403,1121);
  for(const [x,y,color] of [[0,0,'red'],[1373,0,'lime'],[0,1091,'blue'],[1373,1091,'yellow']]) {
    nearContext.fillStyle=color;nearContext.fillRect(x,y,30,30);
  }
  const nearFile=new File([await canvasBlob(nearSource)],'reported-1403x1121.png',{type:'image/png'});
  await select(near,nearFile);
  const nearPlan=JSON.stringify(near.plan),beforeNear=beforeNative();await near.previewArtwork();
  assert(near.preview.canvas.width===2800&&near.preview.canvas.height===2240&&JSON.stringify(near.plan)===nearPlan&&beforeNative()===beforeNear,'Reported 1403x1121 source previews at 2800x2240 without native or plan changes');
  assert(near.element.querySelector('[data-artwork-adjustment]')?.textContent.includes('0.125%'),'Preview explicitly discloses the tiny aspect correction');
  for(const [x,y,expected] of [[2,2,[255,0,0,255]],[2797,2,[0,255,0,255]],[2,2237,[0,0,255,255]],[2797,2237,[255,255,0,255]]])
    assert(same(pixel(near.preview.canvas,x,y),expected),'Near-matching source retains the full frame, including corner markers');
  await rejects(()=>near.createScene(),/Inspect/,'Minor aspect correction still requires inspection before saving');
  const nearBytes=Array.from(new Uint8Array(await near.preview.blob.arrayBuffer()));review(near);await near.createScene();
  assert(same(nearBytes,Array.from(new Uint8Array(await uploads.at(-1).arrayBuffer())))&&near.workflow.map.sourceWidth===1403&&near.workflow.map.sourceHeight===1121,'Near-matching artwork saves exact preview bytes and original source dimensions');
  const nearNative=beforeNative();await near.previewArtwork();review(near);await near.updateScene();
  assert(beforeNative()===nearNative&&near.workflow.map.mapping.sourceWidth===1403,'Reapplying near-matching original preserves native geometry and original mapping');
  await near.previewArtwork();await select(near,file);
  assert(!near.element.querySelector('[data-artwork-adjustment]'),'Changing artwork removes the stale aspect-correction notice');
  await near.previewArtwork();
  assert(!near.element.querySelector('[data-artwork-adjustment]'),'Exact-aspect artwork does not show a correction notice');
  const stale=await ready();
  assert([...stale.element.querySelectorAll('.sa-primary')].filter(b=>b.checkVisibility()).length===1,'A legacy preview exposes one primary action even without a generated handoff');
  await select(stale,new File([file],'unseen.png',{type:'image/png'}));
  await rejects(()=>stale.createScene(),/Preview/, 'Changing the file invalidates the pending preview');
  await stale.previewArtwork();review(stale);
  const width=stale.element.querySelector('[name="wallWidth"]');width.value='.25';width.dispatchEvent(new Event('input',{bubbles:true}));
  assert(!stale.preview&&!stale.workflow.generation,'Editing rendering settings invalidates preview and handoff immediately');
  await rejects(()=>stale.createScene(),/Apply/, 'Unapplied settings cannot create unseen artwork');
  await stale.applyRendering();assert(stale.plan.rendering.wallWidth===.25,'Advanced settings update appearance without changing geometry');
  await stale.previewArtwork();await stale.cancelPreview();
  assert(!stale.preview&&stale.selectedFile,'Cancel preview retains selected source for another inspection');
  const pending=await ready();await pending.close();
  const restored=new SceneArchitectApp();await restored.render();
  assert(restored.plan&&!restored.preview&&!restored.selectedFile&&restored.status.includes('reselect'),'Closing and reopening restores geometry, not unsaved images or preview approval');
  assert(!/blob:|data:image/.test(settings.get('localDraft')),'Local settings never contain image data or object URLs');
  const imported=await ready(),oldPlan=imported.plan,oldPreview=imported.preview;
  imported.element.querySelector('[name="responseText"]').value=JSON.stringify(fixture);await rejects(()=>imported.pastePlan(),/scene-intent/, 'Semantic import rejects low-level JSON');
  assert(imported.plan===oldPlan&&imported.preview===oldPreview&&!imported.workflow.planRepair,'Semantic rejection is atomic, preserving valid plan and pending preview');
  dialogValue={json:'not JSON'};await rejects(()=>imported.pastePlan({dataset:{mode:'advanced'}}),/JSON/, 'Advanced invalid JSON enters bounded repair guidance');
  assert(imported.plan===oldPlan&&imported.workflow.planRepair?.json==='not JSON','Advanced rejection preserves plan and retains rejected input for repair');
  dialogValue={json:JSON.stringify(plan)};await imported.pastePlan({dataset:{mode:'advanced'}});
  assert(!imported.preview&&!imported.selectedFile&&!imported.workflow.map,'Accepted usePlan clears pending images and scene linkage');
  await imported.newProject();assert(!imported.plan&&!imported.selectedFile,'New project clears local pending state');
  await imported.loadExample();assert(imported.plan.features.some(f=>f.placement==='centered'||f.facing)&&imported.workflow.columns===40,'Load example uses v2 semantic laboratory and 40 × 32 dimensions');

  const reopen=async scene=>{
    settings.set('localDraft','');const app=new SceneArchitectApp();await app.render();
    app.element.querySelector('[name="projectId"]').value=scene.id;await app.reopen();return app;
  };
  const reopened=await reopen(scene);
  assert(reopened.workflow.map.src===originalSource&&reopened.plan.rendering.version===1&&!reopened.preview&&!reopened.selectedFile,'Reopen retains original source/settings and clears pending images');
  await reopened.previewArtwork();review(reopened);
  const reopenedNative=beforeNative();await reopened.updateScene();
  assert(beforeNative()===reopenedNative,'Reopened project updates artwork with cleaned coordinates without replacing lights or walls');
  await reopened.previewArtwork();review(reopened);
  scene.flags['scene-architect'].revision='external-revision';const beforeStale=uploads.length;
  await rejects(()=>reopened.updateScene(),/another window/, 'Stale project revision rejects update before uploads');
  assert(uploads.length===beforeStale,'Stale revision never uploads');
  const concurrent=await reopen(scene);await concurrent.previewArtwork();review(concurrent);
  const backgroundBefore=scene.firstLevel.background.src;
  faults.afterUpload=()=>{scene.flags['scene-architect'].revision='revision-during-upload';};
  await rejects(()=>concurrent.updateScene(),/another window/, 'Revision changed during upload refuses background write');
  assert(scene.firstLevel.background.src===backgroundBefore,'Concurrent revision preserves prior background');
  const modified=await reopen(scene);scene.walls[0].c[0]+=4;const oldGeometry=JSON.stringify(scene.walls);
  await modified.previewArtwork();review(modified);
  await rejects(()=>modified.updateScene(),/new scene/i,'Fitted/modified native geometry refuses artwork update');
  await modified.createNewScene();
  assert(modified.scene.id!==scene.id&&JSON.stringify(scene.walls)===oldGeometry&&scene.firstLevel.background.src===backgroundBefore,'Explicit Create NEW Scene preserves modified old scene and uses original plan');
  const tileScene=modified.scene;tileScene.tiles.push({id:'legacy-prop',flags:{'scene-architect':{generated:true}}});
  const legacy=await reopen(tileScene);await legacy.previewArtwork();review(legacy);
  await rejects(()=>legacy.updateScene(),/Tiles/, 'Legacy generated Tiles block update without deleting user content');
  await legacy.createNewScene();assert(tileScene.tiles.length===1,'Create NEW preserves old generated Tiles');
  const legacyMap=legacy.scene.flags['scene-architect'].map;
  delete legacyMap.architectureVersion;legacyMap.scale=2;legacyMap.x=180;legacyMap.y=-60;
  const oldSource=await reopen(legacy.scene);await oldSource.previewArtwork();
  assert(oldSource.preview.mapping.x===0&&oldSource.preview.mapping.y===0&&oldSource.preview.mapping.scaleX===1,'Legacy source import ignores all old stretch and offset metadata');
  const light=oldSource.scene.lights[0],lightX=light.x;light.x+=10;review(oldSource);
  await rejects(()=>oldSource.updateScene(),/light positions/, 'Modified managed light positions refuse update; artwork cannot redefine native lighting');
  light.x=lightX;
  oldSource.scene.firstLevel.textures={offsetX:20};await oldSource.render();review(oldSource);
  await rejects(()=>oldSource.updateScene(),/transform/, 'Legacy background offset refuses update rather than silently reusing a transform');
  delete oldSource.scene.firstLevel.textures;

  for(const failure of ['validation','upload','create','native','short','background','flags']) {
    const failing=await ready(),count=scenes.size,uploadCount=uploads.length;
    faults[failure]=failure==='native'?'AmbientLight':failure==='short'?'Wall':true;
    await rejects(()=>failing.createScene(),/Injected|every native/,`${failure} failure does not report completion`);
    delete faults[failure];
    assert(scenes.size===count&&!failing.scene,`${failure} failure leaves no partially linked or orphaned new scene`);
    if(failure==='validation')assert(uploads.length===uploadCount,'Runtime native validation occurs before first upload or document mutation');
  }
  const compositeFailure=await ready(),beforeComposite=scenes.size;
  faults.afterUpload=()=>{faults.upload=true;};
  await rejects(()=>compositeFailure.createScene(),/upload failure/, 'Composite upload failure after original upload creates no scene');
  assert(scenes.size===beforeComposite,'Failed second upload leaves only an unreferenced uploaded source, never a partial scene');
  const shortLights=await ready(),beforeShort=scenes.size;faults.short='AmbientLight';
  await rejects(()=>shortLights.createScene(),/every native light/, 'Partial native light count is detected');
  assert(scenes.size===beforeShort,'Short light count cleans up only the just-created scene');
  const cleanup=await ready(),cleanupCount=scenes.size;faults.native='Wall';faults.cleanup=true;
  await rejects(()=>cleanup.createScene(),/Partial scene.*NOT complete/, 'Cleanup failure identifies the exact partial scene and never marks complete');
  assert(cleanup.partialScene&&scenes.size===cleanupCount+1&&!cleanup.scene,'Partial scene remains explicitly unlinked after cleanup failure');
  await scenes.get(cleanup.partialScene).delete();
  const current=oldSource.scene;
  for(const failure of ['background','flags']) {
    const update=await reopen(current);await update.previewArtwork();review(update);
    const oldBackground=current.firstLevel.background.src,oldMap=JSON.stringify(update.workflow.map),oldNative=beforeNative();faults[failure]=true;
    await rejects(()=>update.updateScene(),/Injected/,`Update ${failure} failure surfaces an error`);
    assert(current.firstLevel.background.src===oldBackground&&JSON.stringify(update.workflow.map)===oldMap&&beforeNative()===oldNative,`Update ${failure} failure preserves background, original source and native geometry`);
  }
  const rollback=await reopen(current);await rollback.previewArtwork();review(rollback);
  const restoreBackground=current.firstLevel.background.src;faults.flags=true;faults.backgrounds=[false,true];
  await rejects(()=>rollback.updateScene(),/restoration failed/i, 'Background rollback failure reports manual recovery instead of claiming success');
  delete faults.backgrounds;current.firstLevel.background.src=restoreBackground;
  const concurrentBackground=await reopen(current);await concurrentBackground.previewArtwork();review(concurrentBackground);
  faults.afterBackground=()=>{current.firstLevel.background.src='unrelated-background.png';};faults.flags=true;
  await rejects(()=>concurrentBackground.updateScene(),/Another background change.*preserved/, 'Failure after an unrelated background write does not roll it back');
  assert(current.firstLevel.background.src==='unrelated-background.png','Concurrent unrelated background is preserved for manual recovery');
  current.firstLevel.background.src=restoreBackground;
  const concurrentRevision=await reopen(current);await concurrentRevision.previewArtwork();review(concurrentRevision);
  faults.afterBackground=()=>{current.flags['scene-architect'].revision='revision-during-background-write';};
  await rejects(()=>concurrentRevision.updateScene(),/revision changed during application/i, 'Revision change during background write stops automatic restoration');
  assert(current.firstLevel.background.src!==restoreBackground,'Revision conflict leaves current background untouched rather than overwriting concurrent work');
  current.firstLevel.background.src=restoreBackground;
  current.lights.push({id:'independent-gm-light',x:33,y:44,config:{dim:17,bright:5},flags:{custom:{owner:'GM'}}});
  current.lights.find(light=>light.flags?.['scene-architect']?.generated).config.alpha=.12;
  const independent=await reopen(current),lightsBefore=JSON.stringify(current.lights);await independent.previewArtwork();review(independent);await independent.updateScene();
  assert(JSON.stringify(current.lights)===lightsBefore,'Independent GM lights and customized managed effects survive artwork update unchanged');
  const asyncFile=await ready(),asyncCount=scenes.size;faults.afterUpload=()=>{asyncFile.selectedFile=null;asyncFile.invalidate();};
  await rejects(()=>asyncFile.createScene(),/Preview/,'File change while uploading rejects stale preview');
  assert(scenes.size===asyncCount,'Asynchronous file change creates no native scene');
  const asyncSettings=await ready();faults.afterUpload=()=>{
    const input=asyncSettings.element.querySelector('[name="bandPadding"]');input.value='.4';input.dispatchEvent(new Event('input',{bubbles:true}));
  };
  await rejects(()=>asyncSettings.createScene(),/Apply/, 'Rendering change during upload prevents a stale background or scene');
  const asyncPreview=await ready(),pendingPreview=asyncPreview.previewArtwork();
  asyncPreview.invalidate('Changed during decode');
  await rejects(()=>pendingPreview,/changed during preview/, 'A source decode completing after invalidation cannot restore a stale preview');
  const final=await reopen(current);await final.previewArtwork();
  final.element.querySelector('[name="diagnosticView"]').value='protected';await final.showDiagnostic();
  assert(final.element.querySelectorAll('.sa-diagnostic-preview canvas').length===1&&final.element.querySelectorAll('.sa-artwork-preview canvas').length===1,'Diagnostics stay separate from the exact clean primary preview');
  assert([...final.element.querySelectorAll('button')].every(b=>b.type==='button')&&final.element.querySelector('[data-status]').getAttribute('role')==='status','Native keyboard controls and live status semantics are present (not a full accessibility audit)');
  await final.run('updateScene');
  assert(notices.at(-1).includes('Inspect')&&final.element.querySelector('[data-status]').textContent.includes('Inspect'),'Action errors are notified, logged and exposed as live status');
  final.status='Synthetic verification preview only. No generated-art quality or live Foundry behaviour has been verified.';await final.render();
  await checkAssetWorkflow({assert,rejects,SceneArchitectApp,settings,scenes,uploads,review,output,setDialog:value=>dialogValue=value});
  await checkGuidedWorkflow({assert,rejects,SceneArchitectApp,settings,scenes,uploads,output,faults});
  document.querySelector('#check-summary').textContent=`PASS — ${results.length} browser checks (expand details)`;
  document.querySelector('#results').textContent=`PASS — ${results.length} checks\n`+results.join('\n');
  await output('browser-results.json',JSON.stringify({passed:results.length,checks:results,priorArtwork,limitations:['Foundry host APIs mocked; real v14 document/vision check still required.','The three v2 samples are synthetic, not model-generated artwork or evidence of visual success.','Optional prior artwork is earlier five-room evidence only, not visual acceptance or new six-room/three-scene validation.','Accessibility checks cover control semantics; no assistive-technology audit performed.']}));
} catch(error) {
  document.querySelector('#check-details').open=true;document.querySelector('#check-summary').textContent='Browser checks failed';
  document.querySelector('#results').textContent='FAIL: '+error.stack;
  await output('browser-results.json',JSON.stringify({error:error.stack,passed:results.length,checks:results,priorArtwork}));
}
