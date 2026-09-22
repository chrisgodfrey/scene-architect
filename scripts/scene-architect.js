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
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(filename, text, type="text/plain;charset=utf-8") {
  downloadBlob(filename,new Blob([text],{type}));
}

const CRC32_TABLE=(()=>{
  const table=new Uint32Array(256);
  for(let n=0;n<256;n++) {
    let c=n;
    for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1;
    table[n]=c>>>0;
  }
  return table;
})();

function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes) crc=CRC32_TABLE[(crc^byte)&0xff]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}

function zipHeader(size) {
  const bytes=new Uint8Array(size);
  return {bytes,view:new DataView(bytes.buffer)};
}

function createZipBlob(entries) {
  const encoder=new TextEncoder();
  const localParts=[];
  const centralParts=[];
  let offset=0;

  for(const entry of entries) {
    const name=encoder.encode(entry.name);
    const data=encoder.encode(entry.content);
    const checksum=crc32(data);
    const local=zipHeader(30);
    local.view.setUint32(0,0x04034b50,true);
    local.view.setUint16(4,20,true);
    local.view.setUint16(6,0x0800,true);
    local.view.setUint32(14,checksum,true);
    local.view.setUint32(18,data.length,true);
    local.view.setUint32(22,data.length,true);
    local.view.setUint16(26,name.length,true);
    localParts.push(local.bytes,name,data);

    const central=zipHeader(46);
    central.view.setUint32(0,0x02014b50,true);
    central.view.setUint16(4,20,true);
    central.view.setUint16(6,20,true);
    central.view.setUint16(8,0x0800,true);
    central.view.setUint32(16,checksum,true);
    central.view.setUint32(20,data.length,true);
    central.view.setUint32(24,data.length,true);
    central.view.setUint16(28,name.length,true);
    central.view.setUint32(42,offset,true);
    centralParts.push(central.bytes,name);
    offset+=local.bytes.length+name.length+data.length;
  }

  const centralSize=centralParts.reduce((total,part)=>total+part.length,0);
  const end=zipHeader(22);
  end.view.setUint32(0,0x06054b50,true);
  end.view.setUint16(8,entries.length,true);
  end.view.setUint16(10,entries.length,true);
  end.view.setUint32(12,centralSize,true);
  end.view.setUint32(16,offset,true);
  return new Blob([...localParts,...centralParts,end.bytes],{type:"application/zip"});
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

function normalizePlan(raw, fallback={}) {
  const p = foundry.utils.deepClone(raw ?? {});
  p.version ??= 1;
  p.scene ??= {};
  p.scene.name = String(p.scene.name || fallback.sceneName || "New Scene");
  p.scene.columns = Number(p.scene.columns || fallback.columns || 34);
  p.scene.rows = Number(p.scene.rows || fallback.rows || 28);
  p.scene.gridSize = Number(p.scene.gridSize || fallback.gridSize || 70);
  p.scene.distance ??= 5;
  p.scene.units ??= "ft";
  p.scene.description ??= fallback.brief || "";
  p.spaces = Array.isArray(p.spaces) ? p.spaces : [];
  p.openings = Array.isArray(p.openings) ? p.openings : [];
  p.features = Array.isArray(p.features) ? p.features : [];
  p.lights = Array.isArray(p.lights) ? p.lights : [];
  p.barriers = Array.isArray(p.barriers) ? p.barriers : [];
  return p;
}

function assertInteger(n, label) {
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer.`);
}

function validatePlan(plan) {
  const {columns, rows, gridSize} = plan.scene;
  assertInteger(columns, "scene.columns");
  assertInteger(rows, "scene.rows");
  assertInteger(gridSize, "scene.gridSize");
  if (columns < 4 || rows < 4) throw new Error("Scene must be at least 4×4 squares.");
  if (gridSize < 50) throw new Error("Foundry requires a grid size of at least 50px.");

  const spaceIds = new Set();
  for (const [i, r] of plan.spaces.entries()) {
    for (const k of ["x","y","width","height"]) assertInteger(Number(r[k]), `spaces[${i}].${k}`);
    r.x=Number(r.x); r.y=Number(r.y); r.width=Number(r.width); r.height=Number(r.height);
    if (r.width < 1 || r.height < 1) throw new Error(`spaces[${i}] has invalid size.`);
    if (r.x < 0 || r.y < 0 || r.x+r.width > columns || r.y+r.height > rows) throw new Error(`spaces[${i}] lies outside the scene.`);
    r.id ??= `space-${i+1}`;
    if (spaceIds.has(r.id)) throw new Error(`Duplicate space id: ${r.id}`);
    spaceIds.add(r.id);
  }

  for (const [i, o] of plan.openings.entries()) {
    o.x=Number(o.x); o.y=Number(o.y);
    assertInteger(o.x, `openings[${i}].x`); assertInteger(o.y, `openings[${i}].y`);
    if (!["h","v"].includes(o.orientation)) throw new Error(`openings[${i}].orientation must be h or v.`);
    if (!["open","door","secret","window"].includes(o.kind)) throw new Error(`openings[${i}].kind is invalid.`);
    o.length = Number(o.length ?? 1);
    assertInteger(o.length, `openings[${i}].length`);
    if (o.length < 1) throw new Error(`openings[${i}].length must be >= 1.`);
  }

  for (const [i, b] of plan.barriers.entries()) {
    if (!Array.isArray(b.a) || !Array.isArray(b.b) || b.a.length !== 2 || b.b.length !== 2) throw new Error(`barriers[${i}] needs a and b points.`);
    b.a=b.a.map(Number); b.b=b.b.map(Number);
    b.a.forEach((n,j)=>assertInteger(n,`barriers[${i}].a[${j}]`));
    b.b.forEach((n,j)=>assertInteger(n,`barriers[${i}].b[${j}]`));
    if (b.a[0]!==b.b[0] && b.a[1]!==b.b[1]) throw new Error(`barriers[${i}] must be horizontal or vertical.`);
    b.kind ??= "wall";
  }
  return plan;
}

function edgeKey(x1,y1,x2,y2) {
  if (x1>x2 || (x1===x2 && y1>y2)) return `${x2},${y2}|${x1},${y1}`;
  return `${x1},${y1}|${x2},${y2}`;
}

function parseEdgeKey(k) {
  const [a,b]=k.split("|").map(p=>p.split(",").map(Number));
  return {a,b};
}

function addEdge(map, x1,y1,x2,y2, kind="wall") {
  const k=edgeKey(x1,y1,x2,y2);
  const prev=map.get(k);
  if (!prev || prev.kind === "wall") map.set(k,{...parseEdgeKey(k),kind});
}

function compileGeometry(plan) {
  const edges = new Map();

  // Each rectangular space contributes a perimeter. Shared perimeters collapse to one edge.
  for (const r of plan.spaces) {
    const x0=r.x, y0=r.y, x1=r.x+r.width, y1=r.y+r.height;
    for (let x=x0; x<x1; x++) {
      addEdge(edges,x,y0,x+1,y0,"wall");
      addEdge(edges,x,y1,x+1,y1,"wall");
    }
    for (let y=y0; y<y1; y++) {
      addEdge(edges,x0,y,x0,y+1,"wall");
      addEdge(edges,x1,y,x1,y+1,"wall");
    }
  }

  // Explicit barriers can add interior walls/terrain/etc.
  for (const b of plan.barriers) {
    let [x1,y1]=b.a, [x2,y2]=b.b;
    if (x1===x2) {
      const lo=Math.min(y1,y2), hi=Math.max(y1,y2);
      for(let y=lo;y<hi;y++) addEdge(edges,x1,y,x1,y+1,b.kind);
    } else {
      const lo=Math.min(x1,x2), hi=Math.max(x1,x2);
      for(let x=lo;x<hi;x++) addEdge(edges,x,y1,x+1,y1,b.kind);
    }
  }

  // Openings override/remove unit edges.
  for (const o of plan.openings) {
    for(let i=0;i<o.length;i++) {
      const coords = o.orientation === "h"
        ? [o.x+i,o.y,o.x+i+1,o.y]
        : [o.x,o.y+i,o.x,o.y+i+1];
      const k=edgeKey(...coords);
      if (o.kind === "open") edges.delete(k);
      else edges.set(k,{...parseEdgeKey(k),kind:o.kind});
    }
  }

  const units=[...edges.values()];
  const mergeable = new Set(["wall","terrain","invisible","ethereal"]);
  const fixed = units.filter(e=>!mergeable.has(e.kind));
  const merged=[];

  for (const kind of mergeable) {
    const hs=units.filter(e=>e.kind===kind && e.a[1]===e.b[1]).sort((u,v)=>u.a[1]-v.a[1]||u.a[0]-v.a[0]);
    const vs=units.filter(e=>e.kind===kind && e.a[0]===e.b[0]).sort((u,v)=>u.a[0]-v.a[0]||u.a[1]-v.a[1]);
    for (const list of [hs,vs]) {
      let cur=null;
      for (const e of list) {
        const horizontal=e.a[1]===e.b[1];
        const contiguous=cur && cur.kind===e.kind && ((horizontal && cur.a[1]===e.a[1] && cur.b[0]===e.a[0]) || (!horizontal && cur.a[0]===e.a[0] && cur.b[1]===e.a[1]));
        if (contiguous) cur.b=[...e.b];
        else { if(cur) merged.push(cur); cur={a:[...e.a],b:[...e.b],kind:e.kind}; }
      }
      if(cur) merged.push(cur);
    }
  }
  return [...merged,...fixed];
}

function wallDataFromSegment(seg, grid) {
  const S=CONST.EDGE_SENSE_TYPES ?? {NONE:0,LIMITED:10,NORMAL:20,PROXIMITY:30,DISTANCE:40};
  const M=CONST.WALL_MOVEMENT_TYPES ?? {NONE:0,NORMAL:20};
  const D=CONST.WALL_DOOR_TYPES ?? {NONE:0,DOOR:1,SECRET:2};
  const DS=CONST.WALL_DOOR_STATES ?? {CLOSED:0,OPEN:1,LOCKED:2};
  const c=[seg.a[0]*grid,seg.a[1]*grid,seg.b[0]*grid,seg.b[1]*grid];
  const base={c,door:D.NONE,ds:DS.CLOSED,move:M.NORMAL,light:S.NORMAL,sight:S.NORMAL,sound:S.NORMAL,flags:{[MODULE_ID]:{kind:seg.kind}}};
  switch(seg.kind) {
    case "door": base.door=D.DOOR; break;
    case "secret": base.door=D.SECRET; break;
    case "window":
      base.move=M.NORMAL; base.light=S.PROXIMITY; base.sight=S.PROXIMITY; base.sound=S.PROXIMITY;
      base.threshold={attenuation:true,light:2,sight:2,sound:2};
      break;
    case "terrain": base.light=S.LIMITED; base.sight=S.LIMITED; base.sound=S.LIMITED; break;
    case "invisible": base.light=S.NONE; base.sight=S.NONE; base.sound=S.NONE; break;
    case "ethereal": base.move=M.NONE; base.sound=S.NONE; break;
  }
  return base;
}

function lightDataFromPlan(l, plan) {
  const g=plan.scene.gridSize;
  return {
    name:l.name || "Scene Architect Light",
    x:Number(l.x)*g,
    y:Number(l.y)*g,
    walls:true,
    vision:false,
    hidden:false,
    config:{
      dim:Number(l.dim ?? 6),
      bright:Number(l.bright ?? 3),
      angle:Number(l.angle ?? 360),
      alpha:Number(l.alpha ?? 0.35),
      color:l.color || "#ffb45b",
      attenuation:Number(l.attenuation ?? 0.5),
      luminosity:Number(l.luminosity ?? 0.5),
      saturation:Number(l.saturation ?? 0),
      contrast:Number(l.contrast ?? 0),
      shadows:Number(l.shadows ?? 0),
      animation:l.animation ? {type:l.animation,speed:2,intensity:2,reverse:false} : {type:"",speed:5,intensity:5,reverse:false}
    },
    flags:{[MODULE_ID]:{generated:true}}
  };
}

function buildLayoutPrompt(state) {
  return `You are producing a deterministic grid layout for a Foundry VTT v14 scene.\n\nUSER BRIEF:\n${state.brief}\n\nTARGET:\n- Scene name: ${state.sceneName}\n- Grid: ${state.columns} columns × ${state.rows} rows\n- Grid size: ${state.gridSize}px per square\n- Top-down orthographic battlemap geometry.\n\nReturn ONLY valid JSON. No markdown fences, explanation, comments, or trailing prose.\n\nThe JSON MUST use this schema:\n{\n  "version": 1,\n  "scene": {\n    "name": "string",\n    "columns": ${state.columns},\n    "rows": ${state.rows},\n    "gridSize": ${state.gridSize},\n    "distance": 5,\n    "units": "ft",\n    "description": "string"\n  },\n  "spaces": [\n    {"id":"unique-id","name":"Room name","x":0,"y":0,"width":4,"height":4,"floor":"stone|wood|dirt|metal|other","description":"visual purpose and dressing"}\n  ],\n  "openings": [\n    {"x":4,"y":3,"orientation":"h|v","length":1,"kind":"open|door|secret|window"}\n  ],\n  "barriers": [\n    {"a":[1,1],"b":[5,1],"kind":"wall|terrain|invisible|ethereal"}\n  ],\n  "features": [\n    {"id":"feature-id","type":"machine|table|bed|altar|stairs|pit|furniture|other","x":10,"y":8,"width":3,"height":2,"description":"what should be painted here"}\n  ],\n  "lights": [\n    {"name":"Lamp","x":10.5,"y":8.5,"dim":6,"bright":3,"color":"#ffb45b","alpha":0.35,"animation":"torch"}\n  ]\n}\n\nGEOMETRY RULES:\n1. Every space is an axis-aligned rectangle measured in whole grid cells. x/y identify its top-left CELL; width/height are whole cells.\n2. Scene Architect deterministically builds a wall along every perimeter edge of every space. When two spaces touch, that shared edge becomes an internal wall.\n3. Use openings to alter one or more unit wall edges. A horizontal opening from x,y spans (x,y)→(x+length,y). A vertical opening spans (x,y)→(x,y+length).\n4. Use kind=open for a passage with no wall, door for an ordinary door, secret for a secret door, window for a Foundry proximity/window wall.\n5. If a room and corridor need free passage, you MUST specify an open opening on their shared boundary.\n6. All x/y/width/height values for spaces and all wall/opening coordinates are integers. Half coordinates are ONLY allowed for feature/light centres.\n7. Keep every space fully inside 0..${state.columns} by 0..${state.rows}.\n8. Prefer long rectangular spaces and sensible one-square-or-wider circulation. Avoid useless micro-rooms.\n9. Build a playable architectural plan, not an illustration. Walls should correspond to actual tactical boundaries.\n10. Include enough negative/rock/void space around the complex to make the composition attractive where appropriate.\n11. Use features for important visual objects, but features do not affect wall geometry.\n12. Lights should be sparse and intentional.\n\nThe result will be validated mechanically. If a coordinate is not grid-exact or a space exceeds the scene bounds, the import will fail.`;
}

function wallStroke(kind) {
  return ({wall:"#111111",door:"#2684ff",secret:"#8b5cf6",window:"#22d3ee",terrain:"#22c55e",invisible:"#60a5fa",ethereal:"#f472b6"})[kind] || "#111111";
}

function svgFromScene(scene, plan) {
  const g=plan.scene.gridSize, width=plan.scene.columns*g, height=plan.scene.rows*g;
  const roomRects=plan.spaces.map((r,i)=>{
    const palettes=["#42474f","#4a4038","#3d4840","#443d4a","#46443c"];
    const fill=palettes[i%palettes.length];
    return `<g data-space="${esc(r.id)}"><rect x="${r.x*g}" y="${r.y*g}" width="${r.width*g}" height="${r.height*g}" fill="${fill}" opacity="0.95"/><text x="${(r.x+r.width/2)*g}" y="${(r.y+r.height/2)*g}" fill="#e8eaed" font-family="sans-serif" font-size="${Math.max(14,g*0.22)}" text-anchor="middle" dominant-baseline="middle">${esc(r.name||r.id)}</text></g>`;
  }).join("\n");

  // LIVE scene walls are authoritative after the GM has edited them.
  const walls=[...scene.walls].map(w=>{
    const c=w.c ?? w.document?.c; if(!c) return "";
    const kind=w.getFlag?.(MODULE_ID,"kind") || w.flags?.[MODULE_ID]?.kind || (w.door===CONST.WALL_DOOR_TYPES?.SECRET?"secret":w.door===CONST.WALL_DOOR_TYPES?.DOOR?"door":"wall");
    return `<line x1="${c[0]}" y1="${c[1]}" x2="${c[2]}" y2="${c[3]}" stroke="${wallStroke(kind)}" stroke-width="${Math.max(8,g*0.13)}" stroke-linecap="square"/>`;
  }).join("\n");

  const features=plan.features.map(f=>`<g data-feature="${esc(f.id||f.type)}"><rect x="${f.x*g}" y="${f.y*g}" width="${f.width*g}" height="${f.height*g}" rx="${g*.08}" fill="#d946ef" fill-opacity="0.18" stroke="#e879f9" stroke-width="2" stroke-dasharray="8 6"/><text x="${(f.x+f.width/2)*g}" y="${(f.y+f.height/2)*g}" fill="#f5d0fe" font-family="sans-serif" font-size="${Math.max(12,g*.18)}" text-anchor="middle" dominant-baseline="middle">${esc(f.type||"feature")}</text></g>`).join("\n");
  const lights=plan.lights.map(l=>`<circle cx="${l.x*g}" cy="${l.y*g}" r="${Math.max(4,g*.08)}" fill="#fde047" stroke="#fff7ae" stroke-width="2"/>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<rect width="100%" height="100%" fill="#181a1f"/>\n${roomRects}\n${features}\n${lights}\n${walls}\n</svg>`;
}

function buildArtPrompt(plan,{packageHandoff=false}={}) {
  const W=plan.scene.columns*plan.scene.gridSize, H=plan.scene.rows*plan.scene.gridSize;
  const spaces=plan.spaces.map(r=>`- ${r.name||r.id}: ${r.description||r.floor||"room"}`).join("\n");
  const features=plan.features.map(f=>`- ${f.type}: ${f.description||""} at the marked magenta rectangle`).join("\n");
  const handoff=packageHandoff
    ? "The attached ZIP is a Scene Architect art package. Extract it and use art-guide.svg as the visual input. The package also contains scene-plan.json for supplemental structured context."
    : "Use the attached Scene Architect SVG guide as the visual input.";
  return `${handoff}\n\nCreate a polished TOP-DOWN ORTHOGRAPHIC VTT battlemap by painting the Scene Architect SVG guide.\n\nABSOLUTE GEOMETRY CONSTRAINTS:\n- The SVG is authoritative geometry. Preserve every wall centreline and opening position EXACTLY.\n- Do not move, curve, widen, narrow, rotate, add or remove architectural walls.\n- Render physical wall artwork symmetrically around each black wall centreline, so the line runs down the middle of the graphical wall thickness.\n- Blue segments are DOORS. Purple segments are SECRET DOORS. Cyan segments are WINDOWS. Green segments are TERRAIN boundaries.\n- Do NOT render these guide colours in the finished art. They are semantic guides only.\n- Keep the exact canvas aspect ratio ${W}:${H}. The intended scene is ${plan.scene.columns}×${plan.scene.rows} squares at ${plan.scene.gridSize}px per square (${W}×${H}px).\n- NO visible grid lines in the final artwork.\n- Do not invent a floor-tile pattern that implies a competing grid. Floor texture may be irregular/subtle.\n- Keep doors/openings centred exactly on their guide segments.\n- Treat magenta rectangles as object-placement guides; paint appropriate objects within those bounds without altering walls.\n\nSCENE BRIEF:\n${plan.scene.description||""}\n\nROOMS:\n${spaces}\n\nIMPORTANT FEATURES:\n${features||"- none specified"}\n\nSTYLE:\nHigh quality richly detailed tabletop RPG battlemap; coherent top-down lighting; readable tactical silhouettes; believable materials and clutter; no perspective/isometric distortion; no labels or text in the final image.\n\nReturn the finished battlemap as a PNG, JPEG or WebP image with the exact ${W}×${H}px canvas. The image must be usable as a skin underneath the exact Foundry geometry. Geometry fidelity is more important than decorative detail.`;
}

function buildArtPackage(scene,plan) {
  const base=slugify(scene.name);
  const prompt=buildArtPrompt(plan,{packageHandoff:true});
  const instructions=`SCENE ARCHITECT ART PACKAGE

1. Upload this ZIP to a frontier model that can generate images.
2. Paste the complete prompt copied by Scene Architect.
3. Ask the model to extract this package and use art-guide.svg as authoritative geometry.
4. Download the generated PNG, JPEG or WebP.
5. Return to Foundry and select Import finished artwork.

PACKAGE CONTENTS

- art-guide.svg: live Foundry wall geometry and feature guides
- scene-plan.json: structured scene, room, feature and lighting data
- art-prompt.txt: a backup copy of the complete prompt

If the model cannot inspect ZIP files, extract this archive yourself, upload art-guide.svg, and paste art-prompt.txt.
`;
  const blob=createZipBlob([
    {name:"art-guide.svg",content:svgFromScene(scene,plan)},
    {name:"scene-plan.json",content:JSON.stringify(plan,null,2)},
    {name:"art-prompt.txt",content:prompt},
    {name:"README.txt",content:instructions}
  ]);
  return {filename:`${base}-art-package.zip`,prompt,blob};
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
  return res.path || res.url || `${dir}/${filename}`;
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

class SceneArchitectApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS={
    id:"scene-architect-app",
    classes:["scene-architect"],
    tag:"div",
    position:{width:760,height:"auto"},
    window:{title:"Scene Architect",icon:"fa-solid fa-drafting-compass",resizable:true},
    actions:{
      copyLayoutPrompt:this.#copyLayoutPrompt,
      pastePlan:this.#pastePlan,
      buildDraft:this.#buildDraft,
      viewScene:this.#viewScene,
      downloadArtPackage:this.#downloadArtPackage,
      exportGuide:this.#exportGuide,
      copyArtPrompt:this.#copyArtPrompt,
      downloadPlan:this.#downloadPlan,
      importArtwork:this.#importArtwork
    }
  };
  static PARTS={main:{template:`modules/${MODULE_ID}/templates/scene-architect.hbs`}};

  constructor(options={}) {
    super(options);
    this.workflow={sceneName:"New Scene",columns:34,rows:28,gridSize:70,brief:"",plan:null,sceneId:null};
  }

  async _prepareContext(_options) {
    const scene=this.workflow.sceneId ? game.scenes.get(this.workflow.sceneId) : null;
    return {
      sceneName:this.workflow.sceneName,columns:this.workflow.columns,rows:this.workflow.rows,gridSize:this.workflow.gridSize,brief:this.workflow.brief,
      hasPlan:!!this.workflow.plan,
      planSummary:this.workflow.plan ? `${this.workflow.plan.spaces.length} spaces, ${this.workflow.plan.openings.length} openings, ${this.workflow.plan.features.length} features, ${this.workflow.plan.lights.length} lights.` : "",
      planJson:this.workflow.plan ? JSON.stringify(this.workflow.plan,null,2) : "",
      sceneReady:!!scene,
      sceneNameLinked:scene?.name || ""
    };
  }

  syncForm() { Object.assign(this.workflow,readForm(this)); }

  /** @this {SceneArchitectApp} */
  static async #copyLayoutPrompt() {
    this.syncForm();
    await copyText(buildLayoutPrompt(this.workflow));
  }

  /** @this {SceneArchitectApp} */
  static async #pastePlan() {
    this.syncForm();
    const fd=await DialogV2.input({
      window:{title:"Paste Scene Architect layout JSON"},
      content:`<p>Paste the JSON returned by the web model.</p><textarea name="json" style="width:100%;height:480px" autofocus></textarea>`,
      ok:{label:"Validate & Import",icon:"fa-solid fa-check"},modal:true
    });
    if (!fd?.json) return;
    try {
      const raw=JSON.parse(fd.json);
      this.workflow.plan=validatePlan(normalizePlan(raw,this.workflow));
      this.workflow.sceneName=this.workflow.plan.scene.name;
      this.workflow.columns=this.workflow.plan.scene.columns;
      this.workflow.rows=this.workflow.plan.scene.rows;
      this.workflow.gridSize=this.workflow.plan.scene.gridSize;
      this.workflow.brief=this.workflow.plan.scene.description || this.workflow.brief;
      ui.notifications.info(`${MODULE_TITLE}: plan is valid.`);
      await this.render();
    } catch(err) {
      console.error(`${MODULE_ID} | Plan import failed`,err);
      ui.notifications.error(`${MODULE_TITLE}: ${err.message}`);
    }
  }

  /** @this {SceneArchitectApp} */
  static async #buildDraft() {
    if(!this.workflow.plan) return;
    try {
      const p=this.workflow.plan, g=p.scene.gridSize;
      const geometry=compileGeometry(p);
      const scene=await Scene.implementation.create({
        name:p.scene.name,
        width:p.scene.columns*g,
        height:p.scene.rows*g,
        padding:0,
        navigation:false,
        tokenVision:true,
        grid:{type:CONST.GRID_TYPES.SQUARE,size:g,distance:Number(p.scene.distance||5),units:p.scene.units||"ft",alpha:0.25,color:"#888888"},
        flags:{[MODULE_ID]:{plan:p,createdAt:Date.now()}}
      });
      if(!scene) throw new Error("Foundry did not create the Scene.");

      const wallData=geometry.map(s=>wallDataFromSegment(s,g));
      if(wallData.length) await scene.createEmbeddedDocuments("Wall",wallData);
      if(p.lights.length) await scene.createEmbeddedDocuments("AmbientLight",p.lights.map(l=>lightDataFromPlan(l,p)));

      // Generate and upload an exact wireframe as the temporary map background.
      const svg=svgFromScene(scene,p);
      const guidePath=await uploadBlobToWorld(`${slugify(p.scene.name)}-wireframe.svg`,new Blob([svg],{type:"image/svg+xml"}));
      await setLevelBackground(scene,guidePath);
      await scene.setFlag(MODULE_ID,"guidePath",guidePath);

      this.workflow.sceneId=scene.id;
      await scene.view();
      ui.notifications.info(`${MODULE_TITLE}: draft created. Review the walls, then download the art package.`);
      await this.render();
    } catch(err) {
      console.error(`${MODULE_ID} | Build failed`,err);
      ui.notifications.error(`${MODULE_TITLE}: ${err.message}`);
    }
  }

  /** @this {SceneArchitectApp} */
  static async #viewScene() {
    const scene=game.scenes.get(this.workflow.sceneId); if(scene) await scene.view();
  }

  /** @this {SceneArchitectApp} */
  static async #downloadArtPackage() {
    const scene=game.scenes.get(this.workflow.sceneId); if(!scene) return;
    const plan=this.workflow.plan || scene.getFlag(MODULE_ID,"plan"); if(!plan) return;
    try {
      const artPackage=buildArtPackage(scene,plan);
      downloadBlob(artPackage.filename,artPackage.blob);
      const copied=await copyText(artPackage.prompt,{notify:false});
      const next=copied
        ? "ZIP downloaded and full prompt copied. Upload the ZIP to your model and paste the prompt."
        : "ZIP downloaded. Copy the prompt from the open dialog, then upload the ZIP and paste it.";
      ui.notifications.info(`${MODULE_TITLE}: ${next}`,{permanent:true});
    } catch(err) {
      console.error(`${MODULE_ID} | Art package failed`,err);
      ui.notifications.error(`${MODULE_TITLE}: ${err.message}`);
    }
  }

  /** @this {SceneArchitectApp} */
  static async #exportGuide() {
    const scene=game.scenes.get(this.workflow.sceneId); if(!scene) return;
    const plan=this.workflow.plan || scene.getFlag(MODULE_ID,"plan"); if(!plan) return;
    const svg=svgFromScene(scene,plan);
    downloadText(`${slugify(scene.name)}-art-guide.svg`,svg,"image/svg+xml;charset=utf-8");
    ui.notifications.info(`${MODULE_TITLE}: SVG guide exported from the scene's LIVE wall geometry.`);
  }

  /** @this {SceneArchitectApp} */
  static async #copyArtPrompt() {
    const scene=game.scenes.get(this.workflow.sceneId); if(!scene) return;
    const plan=this.workflow.plan || scene.getFlag(MODULE_ID,"plan"); if(!plan) return;
    await copyText(buildArtPrompt(plan));
  }

  /** @this {SceneArchitectApp} */
  static async #downloadPlan() {
    const scene=game.scenes.get(this.workflow.sceneId); if(!scene) return;
    const plan=this.workflow.plan || scene.getFlag(MODULE_ID,"plan"); if(!plan) return;
    downloadText(`${slugify(scene.name)}-sceneplan.json`,JSON.stringify(plan,null,2),"application/json;charset=utf-8");
  }

  /** @this {SceneArchitectApp} */
  static async #importArtwork() {
    const scene=game.scenes.get(this.workflow.sceneId); if(!scene) return;
    const plan=this.workflow.plan || scene.getFlag(MODULE_ID,"plan"); if(!plan) return;
    const expectedW=plan.scene.columns*plan.scene.gridSize, expectedH=plan.scene.rows*plan.scene.gridSize;
    const result=await DialogV2.wait({
      window:{title:"Import finished artwork"},modal:true,
      content:`<p>Expected canvas: <strong>${expectedW}×${expectedH}px</strong>.</p><input type="file" name="artwork" accept="image/png,image/jpeg,image/webp" style="width:100%"><p class="hint">The image may be globally scaled to the scene canvas, but Scene Architect cannot repair local geometry distortion introduced by the art model.</p>`,
      buttons:[{action:"import",label:"Import Artwork",icon:"fa-solid fa-upload",default:true,callback:(_e,button)=>button.form.elements.artwork.files?.[0]||null},{action:"cancel",label:"Cancel"}],
      rejectClose:false
    });
    if(!result || result==="cancel") return;
    const file=result;
    try {
      let actualW=null,actualH=null;
      try { const bmp=await createImageBitmap(file); actualW=bmp.width; actualH=bmp.height; bmp.close(); } catch(_) {}
      if(actualW && (actualW!==expectedW || actualH!==expectedH)) ui.notifications.warn(`${MODULE_TITLE}: artwork is ${actualW}×${actualH}, expected ${expectedW}×${expectedH}. Foundry will fit it to the scene, but inspect alignment.`);
      const path=await uploadBlobToWorld(`${slugify(scene.name)}-art-${Date.now()}.${(file.name.split('.').pop()||'webp').toLowerCase()}`,file);
      await setLevelBackground(scene,path);
      await scene.setFlag(MODULE_ID,"artworkPath",path);
      ui.notifications.info(`${MODULE_TITLE}: artwork installed. Walls, doors and lights were not moved.`);
      if(scene.isView) await canvas.draw();
    } catch(err) {
      console.error(`${MODULE_ID} | artwork import failed`,err);
      ui.notifications.error(`${MODULE_TITLE}: ${err.message}`);
    }
  }
}

async function launch() {
  if(!game.user.isGM) return ui.notifications.warn(`${MODULE_TITLE} is GM-only.`);
  try {
    const app=new SceneArchitectApp();
    await app.render({force:true});
    return app;
  } catch(err) {
    console.error(`${MODULE_ID} | Launch failed`,err);
    ui.notifications.error(`${MODULE_TITLE}: ${err.message}`);
  }
}

Hooks.once("init",()=>{
  console.log(`${MODULE_TITLE} | Initialising v0.1.0-alpha.4`);
  game.settings.register(MODULE_ID,"enabled",{name:"Enable Scene Architect",scope:"world",config:true,type:Boolean,default:true,restricted:true});
});

Hooks.on("renderSceneDirectory",(app,element)=>{
  if(!game.user.isGM || !game.settings.get(MODULE_ID,"enabled")) return;
  if(element.querySelector?.(".scene-architect-launch")) return;
  const button=document.createElement("button");
  button.type="button";
  button.className="scene-architect-launch";
  button.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i> Scene Architect';
  button.addEventListener("click",launch);
  const footer=element.querySelector?.(".directory-footer") || element.querySelector?.("footer");
  if(footer) footer.appendChild(button);
  else {
    const header=element.querySelector?.(".directory-header") || element;
    header.appendChild(button);
  }
});

Hooks.once("ready",()=>{
  game.modules.get(MODULE_ID).api={launch,compileGeometry,validatePlan,buildLayoutPrompt,buildArtPrompt};
});
