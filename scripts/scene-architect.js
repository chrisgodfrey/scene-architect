import { wallDataFromSegment, lightDataFromPlan } from "./foundry-data.js";
import { normalizePlan, validatePlan, planWarnings } from "./plan.js";
import { compileGeometry } from "./geometry.js";
import { migrateArt, usedAssets, validateArt, artworkRequests } from "./art-manifest.js";
import { renderSceneArt, renderProp, loadImage, canvasBlob, compositePreview } from "./renderer.js";
import { geometryConflict, projectFromScene, saveProject, applyRenderedArt, propTileData } from "./project.js";

const MODULE_ID = "scene-architect";
const MODULE_TITLE = "Scene Architect";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const FilePickerV14 = foundry.applications.apps.FilePicker;

function esc(s="") {
  return String(s).replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function slugify(s) {
  return String(s || "scene").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene";
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 600000);
}

async function downloadText(filename, text, type="text/plain;charset=utf-8") {
  const foundrySave=foundry.utils.saveDataToFile;
  if(typeof foundrySave==="function") {
    await foundrySave(text,type,filename);
    return;
  }
  if(typeof globalThis.saveDataToFile==="function") {
    await globalThis.saveDataToFile(text,type,filename);
    return;
  }
  downloadBlob(filename,new Blob([text],{type}));
}

async function copyText(text,{notify=true}={}) {
  try {
    await navigator.clipboard.writeText(text);
    if(notify) ui.notifications.info(`${MODULE_TITLE}: copied to clipboard.`);
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | Clipboard failed`, err);
    await DialogV2.input({
      window: {title: `${MODULE_TITLE}: Copy text`},
      content: `<textarea name="text" style="width:100%;height:420px">${esc(text)}</textarea>`,
      ok: {label: "Close"}
    });
    return false;
  }
}

function readForm(app) {
  const root = app.element;
  if (!root) return {};
  const val = name => root.querySelector(`[name="${name}"]`)?.value;
  return {
    sceneName: val("sceneName")?.trim() || "New Scene",
    columns: Number.parseInt(val("columns") || "34", 10),
    rows: Number.parseInt(val("rows") || "28", 10),
    gridSize: Number.parseInt(val("gridSize") || "70", 10),
    brief: val("brief")?.trim() || ""
  };
}

function buildLayoutPrompt(state) {
  return `You are producing a deterministic grid layout for a Foundry VTT v14 scene.\n\nUSER BRIEF:\n${state.brief}\n\nTARGET:\n- Scene name: ${state.sceneName}\n- Grid: ${state.columns} columns × ${state.rows} rows\n- Grid size: ${state.gridSize}px per square\n- Top-down orthographic battlemap geometry.\n\nReturn ONLY valid JSON. No markdown fences, explanation, comments, or trailing prose.\n\nThe JSON MUST use this schema:\n{\n  "version": 1,\n  "scene": {\n    "name": "string",\n    "columns": ${state.columns},\n    "rows": ${state.rows},\n    "gridSize": ${state.gridSize},\n    "distance": 5,\n    "units": "ft",\n    "description": "string"\n  },\n  "spaces": [\n    {"id":"unique-id","name":"Room name","x":0,"y":0,"width":4,"height":4,"floor":"stone|wood|dirt|metal|other","description":"visual purpose and dressing"}\n  ],\n  "openings": [\n    {"x":4,"y":3,"orientation":"h|v","length":1,"kind":"open|door|secret|window"}\n  ],\n  "barriers": [\n    {"a":[1,1],"b":[5,1],"kind":"wall|terrain|invisible|ethereal"}\n  ],\n  "features": [\n    {"id":"feature-id","type":"machine|table|bed|altar|stairs|pit|furniture|other","x":10,"y":8,"width":3,"height":2,"description":"isolated object description"}\n  ],\n  "lights": [\n    {"name":"Lamp","x":10.5,"y":8.5,"dim":6,"bright":3,"color":"#ffb45b","alpha":0.35,"animation":"torch"}\n  ]\n}\n\nGEOMETRY RULES:\n1. Every space is an axis-aligned rectangle measured in whole grid cells. x/y identify its top-left CELL; width/height are whole cells.\n2. Scene Architect deterministically builds a wall along every perimeter edge of every space. When two spaces touch, that shared edge becomes an internal wall.\n3. Use openings to alter one or more unit wall edges. A horizontal opening from x,y spans (x,y)→(x+length,y). A vertical opening spans (x,y)→(x,y+length).\n4. Use kind=open for a passage with no wall, door for an ordinary door, secret for a secret door, window for a Foundry proximity/window wall.\n5. If a room and corridor need free passage, you MUST specify an open opening on their shared boundary.\n6. All x/y/width/height values for spaces and all wall/opening coordinates are integers. Features use top-left x/y and width/height in cells, with fractional values allowed. rotation is clockwise degrees about the footprint centre. Lights use centre coordinates. Rooms must not overlap; features must fit inside one room without overlapping other props or blocking openings.\n7. Keep every space fully inside 0..${state.columns} by 0..${state.rows}.\n8. Prefer long rectangular spaces and sensible one-square-or-wider circulation. Avoid useless micro-rooms.\n9. Build a playable architectural plan, not an illustration. Walls should correspond to actual tactical boundaries.\n10. Include enough negative/rock/void space around the complex to make the composition attractive where appropriate.\n11. Use features for important visual objects, but features do not affect wall geometry.\n12. Lights should be sparse and intentional.\n\nThe result will be validated mechanically. If a coordinate is not grid-exact or a space exceeds the scene bounds, the import will fail.`;
}

function wallStroke(kind) {
  return ({wall:"#111111",door:"#2684ff",secret:"#8b5cf6",window:"#22d3ee",terrain:"#22c55e",invisible:"#60a5fa",ethereal:"#f472b6"})[kind] || "#111111";
}

function svgFromScene(scene, plan) {
  const conflict=geometryConflict(scene,plan);if(conflict)throw new Error(conflict);
  const g=plan.scene.gridSize, width=plan.scene.columns*g, height=plan.scene.rows*g;
  const roomRects=plan.spaces.map((r,i)=>{
    const palettes=["#42474f","#4a4038","#3d4840","#443d4a","#46443c"];
    const fill=palettes[i%palettes.length];
    return `<g data-space="${esc(r.id)}"><rect x="${r.x*g}" y="${r.y*g}" width="${r.width*g}" height="${r.height*g}" fill="${fill}" opacity="0.95"/><text x="${(r.x+r.width/2)*g}" y="${(r.y+r.height/2)*g}" fill="#e8eaed" font-family="sans-serif" font-size="${Math.max(14,g*0.22)}" text-anchor="middle" dominant-baseline="middle">${esc(r.name||r.id)}</text></g>`;
  }).join("\n");

  // The caller refuses mixed plan/live geometry when wall edits conflict.
  const walls=[...scene.walls].map(w=>{
    const c=w.c ?? w.document?.c; if(!c) return "";
    const kind=w.getFlag?.(MODULE_ID,"kind") || w.flags?.[MODULE_ID]?.kind || (w.door===CONST.WALL_DOOR_TYPES?.SECRET?"secret":w.door===CONST.WALL_DOOR_TYPES?.DOOR?"door":"wall");
    return `<line x1="${c[0]}" y1="${c[1]}" x2="${c[2]}" y2="${c[3]}" stroke="${wallStroke(kind)}" stroke-width="${Math.max(8,g*0.13)}" stroke-linecap="square"/>`;
  }).join("\n");

  const features=plan.features.map(f=>`<g data-feature="${esc(f.id||f.type)}" transform="rotate(${f.rotation??0} ${(f.x+f.width/2)*g} ${(f.y+f.height/2)*g})"><rect x="${f.x*g}" y="${f.y*g}" width="${f.width*g}" height="${f.height*g}" rx="${g*.08}" fill="#d946ef" fill-opacity="0.18" stroke="#e879f9" stroke-width="2" stroke-dasharray="8 6"/><text x="${(f.x+f.width/2)*g}" y="${(f.y+f.height/2)*g}" fill="#f5d0fe" font-family="sans-serif" font-size="${Math.max(12,g*.18)}" text-anchor="middle" dominant-baseline="middle">${esc(f.type||"feature")}</text></g>`).join("\n");
  const lights=plan.lights.map(l=>`<circle cx="${l.x*g}" cy="${l.y*g}" r="${Math.max(4,g*.08)}" fill="#fde047" stroke="#fff7ae" stroke-width="2"/>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<rect width="100%" height="100%" fill="#181a1f"/>\n${roomRects}\n${features}\n${lights}\n${walls}\n</svg>`;
}

async function ensureDir(path) {
  const parts=path.split("/").filter(Boolean);
  let cur="";
  for(const p of parts) {
    const next=cur?`${cur}/${p}`:p;
    try { await FilePickerV14.createDirectory("data", next); } catch (_) { /* likely exists */ }
    cur=next;
  }
}

async function uploadBlobToWorld(filename, blob) {
  const dir=`worlds/${game.world.id}/scene-architect`;
  await ensureDir(dir);
  const file=new File([blob], filename, {type:blob.type || "application/octet-stream"});
  const res=await FilePickerV14.upload("data",dir,file,{}, {notify:false});
  if(!res || res.error || !(res.path || res.url)) throw new Error(res?.error || "Foundry upload failed.");
  return res.path || res.url;
}

async function setLevelBackground(scene, path) {
  const level=scene.firstLevel;
  if (level) {
    await level.update({"background.src":path});
    return;
  }
  // Defensive fallback for installations using a legacy-compatible Scene schema.
  await scene.update({"background.src":path});
}

export class SceneArchitectApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS={
    id:'scene-architect-app',classes:['scene-architect'],tag:'div',position:{width:820,height:850},
    window:{title:'Scene Architect — scene art kit',icon:'fa-solid fa-drafting-compass',resizable:true},
    actions:Object.fromEntries(['copyLayoutPrompt','pastePlan','loadExample','buildDraft','viewScene','exportGuide','downloadPlan','copyRequests','saveSettings','previewAsset','saveAsset','renderArt','previewScene','reopen','newProject','editArt'].map(name=>[name,async function(event,target){await this.run(name,target);}]))
  };
  static PARTS={main:{template:`modules/${MODULE_ID}/templates/scene-architect.hbs`}};

  constructor(options={}) {
    super(options);
    this.workflow={sceneName:'New Scene',columns:34,rows:28,gridSize:70,brief:'',plan:null,sceneId:null,revision:null};
    this.busy=false;
  }

  async run(name,target) {
    if(this.busy)return;
    this.busy=true;
    this.element?.setAttribute('aria-busy','true');
    try {await this[name](target);}
    catch(err) {console.error(`${MODULE_ID} | ${name}`,err);ui.notifications.error(`${MODULE_TITLE}: ${err.message}`);}
    finally {this.busy=false;this.element?.removeAttribute('aria-busy');}
  }

  get scene() {return game.scenes.get(this.workflow.sceneId);}
  get plan() {return this.workflow.plan;}
  assertGeometry() {
    if(!this.scene)throw new Error('Build or reopen a scene first.');
    const conflict=geometryConflict(this.scene,this.plan);
    if(conflict)throw new Error(`${conflict} Undo manual changes, or edit the exported plan and build a new scene. Existing walls will not be replaced.`);
  }

  async _prepareContext() {
    const p=this.plan,scene=this.scene;
    return {...this.workflow,hasPlan:!!p,sceneReady:!!scene,sceneNameLinked:scene?.name,
      projects:[...game.scenes].filter(s=>s.getFlag(MODULE_ID,'plan')).map(s=>({id:s.id,name:s.name,selected:s.id===scene?.id})),
      conflict:scene&&p?geometryConflict(scene,p):null,
      warnings:p?planWarnings(p):[],planJson:p?JSON.stringify(p,null,2):'',
      planSummary:p?`${p.spaces.length} rooms · ${p.features.length} objects · ${usedAssets(p).length} required images`:'',
      art:p?.art,assets:p?usedAssets(p).map(a=>{
        const assigned=p.art.assignments[a.id],crop=assigned?.crop??{x:0,y:0,width:1,height:1};
        return {...a,src:assigned?.src,assigned:!!assigned,opaque:assigned?.hasAlpha===false,isCover:assigned?.fit==='cover',
          cropX:crop.x*100,cropY:crop.y*100,cropW:crop.width*100,cropH:crop.height*100,
          instances:p.features.filter(f=>f.assetId===a.id).length};
      }):[]};
  }

  syncForm() {Object.assign(this.workflow,readForm(this));}
  usePlan(p) {
    this.workflow={plan:p,sceneId:null,revision:null,sceneName:p.scene.name,columns:p.scene.columns,rows:p.scene.rows,gridSize:p.scene.gridSize,brief:p.scene.description};
  }
  async persist() {if(this.scene)await saveProject(this.scene,this.workflow);}
  async reopen() {
    const id=this.element.querySelector('[name="projectId"]').value;
    if(!id)return;
    this.workflow=projectFromScene(game.scenes.get(id));await this.render();
  }
  async newProject() {this.workflow={sceneName:'New Scene',columns:34,rows:28,gridSize:70,brief:'',plan:null,sceneId:null,revision:null};await this.render();}
  async copyLayoutPrompt() {this.syncForm();await copyText(buildLayoutPrompt(this.workflow));}
  async pastePlan() {
    this.syncForm();
    const result=await DialogV2.input({window:{title:'Import or edit plan — creates a new draft'},content:`<p>Changing geometry starts a new project. Build a new scene to apply it; the current scene is preserved.</p><textarea name="json" style="width:100%;height:400px">${esc(this.plan?JSON.stringify(this.plan,null,2):'')}</textarea>`,ok:{label:'Validate & import'},rejectClose:false});
    if(!result?.json)return;
    this.usePlan(validateArt(migrateArt(validatePlan(normalizePlan(JSON.parse(result.json),this.workflow)))));
    await this.render();ui.notifications.info('Plan imported. Build a draft to save this project in Foundry.');
  }
  async loadExample() {
    const response=await fetch(`modules/${MODULE_ID}/fixtures/laboratory.json`);if(!response.ok)throw new Error('Could not load laboratory fixture.');
    this.usePlan(validateArt(migrateArt(validatePlan(normalizePlan(await response.json())))));await this.render();
  }
  async buildDraft() {
    if(!this.plan)return;
    const p=validateArt(validatePlan(this.plan)),g=p.scene.gridSize;
    const scene=await Scene.implementation.create({name:p.scene.name,width:p.scene.columns*g,height:p.scene.rows*g,padding:0,navigation:false,tokenVision:true,
      grid:{type:CONST.GRID_TYPES.SQUARE,size:g,distance:p.scene.distance,units:p.scene.units,alpha:.25,color:'#888888'},
      flags:{[MODULE_ID]:{plan:structuredClone(p),createdAt:Date.now()}}});
    if(!scene)throw new Error('Foundry did not create the scene.');
    // Link immediately so a failed upload still leaves a recoverable draft.
    this.workflow.sceneId=scene.id;this.workflow.revision=null;
    try {
      await scene.createEmbeddedDocuments('Wall',compileGeometry(p).map(s=>wallDataFromSegment(s,g)));
      if(p.lights.length)await scene.createEmbeddedDocuments('AmbientLight',p.lights.map(l=>lightDataFromPlan(l,p)));
      const path=await uploadBlobToWorld(`${scene.id}-wireframe.svg`,new Blob([svgFromScene(scene,p)],{type:'image/svg+xml'}));
      await setLevelBackground(scene,path);await this.persist();await scene.view();
      ui.notifications.info('Draft saved. Request the art kit, then import images into its slots.');
    } finally {await this.render();}
  }
  async viewScene() {await this.scene?.view();}
  async exportGuide() {
    this.assertGeometry();await downloadText(`${slugify(this.scene.name)}-guide.svg`,svgFromScene(this.scene,this.plan),'image/svg+xml');
  }
  async downloadPlan() {if(this.plan)await downloadText(`${slugify(this.plan.scene.name)}-sceneplan.json`,JSON.stringify(this.plan,null,2),'application/json');}
  async copyRequests() {if(this.plan)await copyText(artworkRequests(this.plan));}

  async editArt() {
    const result=await DialogV2.input({window:{title:'Edit art slots and references'},content:`<p>Change visual direction, asset descriptions or reuse an asset ID on several features. Geometry is fixed here. Use Import / edit plan for geometry changes.</p><textarea name="json" style="width:100%;height:440px">${esc(JSON.stringify({art:this.plan.art,floors:this.plan.spaces.map(r=>({id:r.id,assetId:r.floorAsset})),props:this.plan.features.map(f=>({id:f.id,assetId:f.assetId}))},null,2))}</textarea>`,ok:{label:'Save art manifest'},rejectClose:false});
    if(!result?.json)return;
    const data=JSON.parse(result.json),p=structuredClone(this.plan);p.art=data.art;
    for(const r of p.spaces)r.floorAsset=data.floors.find(x=>x.id===r.id)?.assetId;
    for(const f of p.features)f.assetId=data.props.find(x=>x.id===f.id)?.assetId;
    validateArt(p);const old=this.plan;this.workflow.plan=p;
    try{await this.persist();}catch(e){this.workflow.plan=old;throw e;}await this.render();
  }

  async saveSettings() {
    const root=this.element,s=this.plan.art.settings,old=structuredClone(s);
    Object.assign(s,{materialScale:Number(root.querySelector('[name="materialScale"]').value),wallWidth:Number(root.querySelector('[name="wallWidth"]').value),shadows:root.querySelector('[name="shadows"]').checked,allowPlaceholders:root.querySelector('[name="allowPlaceholders"]').checked});
    try{validateArt(this.plan);await this.persist();}catch(e){Object.assign(s,old);throw e;}
    ui.notifications.info('Rendering settings saved.');await this.render();
  }

  async readAsset(target) {
    const card=target.closest('[data-asset-id]'),id=card.dataset.assetId,asset=this.plan.art.assets.find(a=>a.id===id);
    const value=name=>card.querySelector(`[name="${name}"]`).value,file=card.querySelector('[name="assetFile"]').files[0];
    if(file&&(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>30*1024*1024))throw new Error('Choose a PNG, JPEG or WebP up to 30 MB.');
    const existing=this.plan.art.assignments[id],src=file?URL.createObjectURL(file):existing?.src;
    if(!src)throw new Error('Choose an image file first.');
    const assignment={src:existing?.src||'pending.png',fit:value('fit'),crop:{x:Number(value('cropX'))/100,y:Number(value('cropY'))/100,width:Number(value('cropW'))/100,height:Number(value('cropH'))/100}};
    try {
      const test=structuredClone(this.plan);test.art.assignments[id]=assignment;validateArt(test);
      const image=await loadImage(src);return {card,id,asset,file,image,assignment};
    } finally {if(file)URL.revokeObjectURL(src);}
  }

  async previewAsset(target) {
    const {card,asset,image,assignment}=await this.readAsset(target);
    const first=this.plan.features.find(f=>f.assetId===asset.id),ratio=first?first.width/first.height:asset.ratio;
    const w=ratio>1?260:260*ratio,h=ratio>1?260/ratio:260;
    const result=renderProp(image,assignment,w,h,{shadows:asset.kind==='prop'&&first?.layer!=='decal'&&this.plan.art.settings.shadows});
    result.setAttribute('aria-label',`Fitted preview of ${asset.id}`);card.querySelector('.sa-fit-preview').replaceChildren(result);
  }

  async saveAsset(target) {
    if(!this.scene)throw new Error('Build a draft before uploading images.');
    const {id,file,image,assignment}=await this.readAsset(target),old=this.plan.art.assignments[id];
    // Inspect alpha without altering pixels. Opaque source backgrounds are never keyed out.
    const sample=document.createElement('canvas');sample.width=128;sample.height=128;
    const context=sample.getContext('2d');context.drawImage(image,0,0,128,128);
    const pixels=context.getImageData(0,0,128,128).data;assignment.hasAlpha=pixels.some((v,i)=>i%4===3&&v<255);
    assignment.width=image.width;assignment.height=image.height;
    if(file)assignment.src=await uploadBlobToWorld(`${this.scene.id}-${id}-${crypto.randomUUID()}.${file.type==='image/jpeg'?'jpg':file.type.split('/')[1]}`,file);
    this.plan.art.assignments[id]=assignment;
    try{await this.persist();}catch(e){if(old)this.plan.art.assignments[id]=old;else delete this.plan.art.assignments[id];throw e;}
    await this.render();ui.notifications.info(`Saved ${id}. ${assignment.hasAlpha?'Source alpha preserved.':'No transparency detected; its background will remain visible.'}`);
  }

  async previewScene() {
    this.assertGeometry();const rendered=await renderSceneArt(this.plan),url=URL.createObjectURL(await canvasBlob(compositePreview(rendered,this.plan)));
    try{await DialogV2.wait({window:{title:'Deterministic art preview'},position:{width:800},content:`<p>${rendered.missing.length?'Includes labelled synthetic placeholders.':'Imported art kit.'} No Foundry documents have changed.</p><img src="${esc(url)}" style="width:100%;max-height:65vh;object-fit:contain" alt="Assembled scene preview">`,buttons:[{action:'close',label:'Close'}],rejectClose:false});}
    finally{URL.revokeObjectURL(url);}
  }

  async renderArt() {
    this.assertGeometry();
    const existing=[...this.scene.tiles].filter(t=>t.flags?.[MODULE_ID]?.generated);
    if(existing.length&&!await DialogV2.confirm({window:{title:'Replace Scene Architect artwork?'},content:`<p>This replaces the background and ${existing.length} Scene Architect prop Tiles from the saved plan, including any manual changes to those Tiles. Other Tiles, walls and lights are preserved.</p>`,rejectClose:false}))return;
    const scene=this.scene,p=structuredClone(this.plan),rendered=await renderSceneArt(p),stamp=crypto.randomUUID(),uploaded=new Map();
    ui.notifications.info('Uploading assembled background and prop images…');
    const background=await uploadBlobToWorld(`${scene.id}-${stamp}-background.png`,await canvasBlob(rendered.background));
    const tiles=[];
    for(const item of rendered.props) {
      if(!uploaded.has(item.key))uploaded.set(item.key,await uploadBlobToWorld(`${scene.id}-${stamp}-prop-${uploaded.size+1}.png`,await canvasBlob(item.canvas)));
      tiles.push(propTileData(item.feature,uploaded.get(item.key),p.scene.gridSize));
    }
    this.assertGeometry();await this.persist();
    await applyRenderedArt(scene,p,{background,tiles},setLevelBackground);
    await scene.setFlag(MODULE_ID,'lastRender',{background,at:Date.now(),synthetic:rendered.missing});
    ui.notifications.info(`Artwork applied: ${tiles.length} editable prop Tiles. Native door openings remain clear.`);await this.render();
  }
}

export async function launch() {
  if(!game.user.isGM)return ui.notifications.warn('Scene Architect is GM-only.');
  const app=new SceneArchitectApp();
  const scene=game.scenes.viewed??globalThis.canvas?.scene;
  if(scene?.getFlag(MODULE_ID,'plan')) {
    try{app.workflow=projectFromScene(scene);}catch(e){ui.notifications.warn(`Could not reopen saved plan: ${e.message} Export the scene's flags to repair it.`);}
  }
  await app.render({force:true});return app;
}

Hooks.once('init',()=>{game.settings.register(MODULE_ID,'enabled',{name:'Enable Scene Architect',scope:'world',config:true,type:Boolean,default:true,restricted:true});});
Hooks.on('renderSceneDirectory',(_app,element)=>{
  if(!game.user.isGM||!game.settings.get(MODULE_ID,'enabled')||element.querySelector?.('.scene-architect-launch'))return;
  const button=document.createElement('button');button.type='button';button.className='scene-architect-launch';button.textContent='Scene Architect';
  button.addEventListener('click',()=>launch().catch(e=>ui.notifications.error(e.message)));
  (element.querySelector?.('.directory-footer')||element.querySelector?.('footer')||element).appendChild(button);
});
Hooks.once('ready',()=>{game.modules.get(MODULE_ID).api={launch,compileGeometry,validatePlan,buildLayoutPrompt,artworkRequests,renderSceneArt};});
