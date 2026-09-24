import { compileGeometry, edgeKey } from "./geometry.js";

function normalizePlan(raw, fallback={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw new Error('Plan must be a JSON object.');
  for(const name of ['spaces','openings','features','lights','barriers']) if(raw[name]!=null&&!Array.isArray(raw[name])) throw new Error(`${name} must be an array.`);
  const p = structuredClone(raw ?? {});
  p.version ??= 1;
  p.scene ??= {};
  p.scene.name = String(p.scene.name || fallback.sceneName || "New Scene");
  p.scene.columns = Number(p.scene.columns ?? fallback.columns ?? 34);
  p.scene.rows = Number(p.scene.rows ?? fallback.rows ?? 28);
  p.scene.gridSize = Number(p.scene.gridSize ?? fallback.gridSize ?? 70);
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

function validateBasePlan(plan) {
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

const finite = (n, label, min=0, max=Infinity) => {
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be a number between ${min} and ${max}.`);
};
const inside = (r, x, y) => x >= r.x-1e-8 && y >= r.y-1e-8 && x <= r.x+r.width+1e-8 && y <= r.y+r.height+1e-8;

export function featureCorners(f) {
  const angle=(f.rotation ?? 0)*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[
    f.x+f.width/2+x*f.width/2*c-y*f.height/2*s,
    f.y+f.height/2+x*f.width/2*s+y*f.height/2*c
  ]);
}

export function polygonsOverlap(a,b) {
  for (const p of [a,b]) for(let i=0;i<p.length;i++) {
    const q=p[(i+1)%p.length], axis=[q[1]-p[i][1],p[i][0]-q[0]];
    const ap=a.map(v=>v[0]*axis[0]+v[1]*axis[1]), bp=b.map(v=>v[0]*axis[0]+v[1]*axis[1]);
    if (Math.max(...ap)<=Math.min(...bp)+1e-8 || Math.max(...bp)<=Math.min(...ap)+1e-8) return false;
  }
  return true;
}

export function openingRect(o, depth=0.5) {
  return o.orientation==='h' ? {x:o.x,y:o.y-depth,width:o.length,height:depth*2}
    : {x:o.x-depth,y:o.y,width:depth*2,height:o.length};
}

function unitKeys(seg) {
  const keys=[];
  for(let x=Math.min(seg.a[0],seg.b[0]),y=Math.min(seg.a[1],seg.b[1]),i=0;
    i<Math.abs(seg.b[0]-seg.a[0])+Math.abs(seg.b[1]-seg.a[1]);i++) {
    const dx=seg.a[1]===seg.b[1]?1:0,dy=1-dx;
    keys.push(edgeKey(x+i*dx,y+i*dy,x+(i+1)*dx,y+(i+1)*dy));
  }
  return keys;
}

export function validatePlan(plan) {
  if (![1,2].includes(plan.version)) throw new Error('Unsupported plan version. Use version 1 or 2.');
  validateBasePlan(plan);
  const {columns,rows,gridSize}=plan.scene;
  if (columns>200 || rows>200 || gridSize>400) throw new Error('Maximum scene size is 200×200 cells at 400px per cell.');
  finite(plan.scene.distance,'scene.distance',0.01);
  if (!plan.spaces.length) throw new Error('Add at least one room.');
  for(const [i,r] of plan.spaces.entries()) {
    if(typeof r.id!=='string' || !r.id) throw new Error('Room IDs must be nonempty strings.');
    if(r.rotation)throw new Error(`${r.id}: rooms must be axis-aligned; only props support rotation.`);
    for(const other of plan.spaces.slice(i+1)) if(polygonsOverlap(featureCorners(r),featureCorners(other))) throw new Error(`Rooms ${r.id} and ${other.id} overlap. Use adjoining rectangles.`);
  }
  for(const [i,b] of plan.barriers.entries()) {
    if(!['wall','terrain','invisible','ethereal'].includes(b.kind)) throw new Error(`Invalid barrier kind at ${i}.`);
    if(b.a.every((v,j)=>v===b.b[j])) throw new Error(`Barrier ${i} has zero length.`);
    for(const [x,y] of [b.a,b.b]) if(x<0||y<0||x>columns||y>rows) throw new Error(`Barrier ${i} is outside the scene.`);
  }
  const perimeter=new Set(compileGeometry({...plan,openings:[]}).flatMap(unitKeys)), seen=new Set();
  for(const [i,o] of plan.openings.entries()) {
    const seg={a:[o.x,o.y],b:o.orientation==='h'?[o.x+o.length,o.y]:[o.x,o.y+o.length]};
    for(const key of unitKeys(seg)) {
      if(!perimeter.has(key)) throw new Error(`Opening ${i+1} does not belong to a wall: ${key}.`);
      if(seen.has(key)) throw new Error(`Opening ${i+1} overlaps another opening.`);
      seen.add(key);
    }
  }
  const ids=new Set();
  for(const [i,f] of plan.features.entries()) {
    f.id ??= `feature-${i+1}`;
    if(typeof f.id!=='string'||!f.id||ids.has(f.id)) throw new Error(`Invalid or duplicate feature id: ${f.id}`);
    ids.add(f.id);
    for(const k of ['x','y','width','height']) finite(f[k],`${f.id}.${k}`,k==='width'||k==='height'?0.1:0);
    f.rotation ??= 0; f.layer ??= 'prop';
    finite(f.rotation,`${f.id}.rotation`,0,359.999);
    if(!['decal','prop'].includes(f.layer)) throw new Error(`${f.id}.layer must be prop or decal.`);
    const corners=featureCorners(f);
    const room=plan.spaces.find(r=>(!f.roomId||r.id===f.roomId)&&corners.every(([x,y])=>inside(r,x,y)));
    if(!room) throw new Error(`${f.id}: rotated footprint must fit entirely inside its room.`);
    f.roomId=room.id;
    if(f.layer==='prop') {
      for(const o of plan.openings.filter(o=>o.kind!=='window')) if(polygonsOverlap(corners,featureCorners(openingRect(o)))) throw new Error(`${f.id} blocks an opening. Leave half a cell clear on both sides.`);
      for(const b of plan.barriers) {
        const r=b.a[0]===b.b[0]?{x:b.a[0]-.01,y:Math.min(b.a[1],b.b[1]),width:.02,height:Math.abs(b.a[1]-b.b[1])}
          :{x:Math.min(b.a[0],b.b[0]),y:b.a[1]-.01,width:Math.abs(b.a[0]-b.b[0]),height:.02};
        if(polygonsOverlap(corners,featureCorners(r))) throw new Error(`${f.id} crosses a barrier.`);
      }
    }
  }
  for(const [i,f] of plan.features.entries()) for(const other of plan.features.slice(i+1)) {
    if(f.layer==='prop'&&other.layer==='prop'&&polygonsOverlap(featureCorners(f),featureCorners(other))) throw new Error(`Props ${f.id} and ${other.id} overlap.`);
  }
  for(const [i,l] of plan.lights.entries()) {
    finite(l.x,`lights[${i}].x`,0,columns); finite(l.y,`lights[${i}].y`,0,rows);
    finite(l.dim ?? 6,`lights[${i}].dim`); finite(l.bright ?? 3,`lights[${i}].bright`);
    if(l.color && !/^#[0-9a-f]{6}$/i.test(l.color)) throw new Error(`lights[${i}].color must be a hex colour.`);
    for(const k of ['alpha','attenuation','shadows']) if(l[k]!=null) finite(l[k],`lights[${i}].${k}`,0,1);
    if(l.angle!=null) finite(l.angle,`lights[${i}].angle`,0,360);
  }
  return plan;
}

export function planWarnings(plan) {
  const graph=new Map(plan.spaces.map(r=>[r.id,new Set()]));
  for(const o of plan.openings.filter(o=>o.kind!=='window')) {
    // A room pair needs a traversable unit on the same opening.
    for(let i=0;i<o.length;i++) {
      const x=o.x+(o.orientation==='h'?i+.5:0),y=o.y+(o.orientation==='v'?i+.5:0);
      const dx=o.orientation==='v'?.1:0,dy=o.orientation==='h'?.1:0;
      const a=plan.spaces.find(r=>inside(r,x-dx,y-dy)),b=plan.spaces.find(r=>inside(r,x+dx,y+dy));
      if(a&&b&&a!==b) {graph.get(a.id).add(b.id);graph.get(b.id).add(a.id);}
    }
  }
  const reached=new Set(),visit=id=>{if(reached.has(id))return;reached.add(id);for(const n of graph.get(id)||[])visit(n);};
  visit(plan.spaces[0]?.id);
  const isolated=plan.spaces.filter(r=>!reached.has(r.id));
  return isolated.length?[`Rooms not connected to ${plan.spaces[0].id} by passages or doors: ${isolated.map(r=>r.id).join(', ')}. Check access and circulation.`]:[];
}

export { normalizePlan };

