import { LIGHT_PRESETS, featureCorners, openingRect, polygonsOverlap } from './plan.js';

export const MAX_ANCHORS_PER_ROOM=16;
export const MAX_DRESSING_COUNT=200;
export const MAX_SEMANTIC_GROUPS=64;
const SIZES=new Set(['small','medium','large']);
const MARGIN=.75,STEP=.5,EPSILON=1e-8;

export function semanticKeys(value,keys,label) {
  for(const key of Object.keys(value)) {
    if(!keys.includes(key))throw new Error(`${label}.${key} is unsupported in scene-intent version 2; do not supply coordinates or unsupported relations.`);
  }
}

export function semanticId(value,label) {
  if(typeof value!=='string'||!value.trim())throw new Error(`${label} must be a nonempty semantic ID.`);
  const id=value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  if(!id||id.length>64)throw new Error(`${label} must normalize to 1-64 letters, digits or hyphens.`);
  return id;
}

export function normalizeSemanticFeatures(raw,roomId) {
  if(raw.length>MAX_SEMANTIC_GROUPS)throw new Error(`${roomId} supports at most ${MAX_SEMANTIC_GROUPS} feature groups.`);
  const ids=new Set();
  const features=raw.map((source,index)=>{
    const label=`${roomId}.features[${index}]`;
    if(!source||typeof source!=='object'||Array.isArray(source))throw new Error(`${label} must be an object.`);
    if(!['major-anchor','soft-dressing'].includes(source.role))throw new Error(`${label}.role must be major-anchor or soft-dressing.`);
    const anchor=source.role==='major-anchor';
    if(!anchor&&source.lightPreset!=null)throw new Error(`${label}: soft-dressing cannot emit native lights; promote the source to a major-anchor.`);
    semanticKeys(source,['id','role','type','description','count',...(anchor?['size','placement','facing','lightPreset']:[])],label);
    const id=semanticId(source.id,`${label}.id`);
    if(ids.has(id))throw new Error(`${roomId}: ambiguous duplicate feature ID after normalization: ${id}.`);
    ids.add(id);
    const count=source.count??1,limit=anchor?MAX_ANCHORS_PER_ROOM:MAX_DRESSING_COUNT;
    if(!Number.isInteger(count)||count<1||count>limit)throw new Error(`${label}.count must be a whole number between 1 and ${limit}.`);
    for(const key of ['type','description'])if(typeof source[key]!=='string'||!source[key].trim())throw new Error(`${label}.${key} must be nonempty text.`);
    const feature={id,role:source.role,type:source.type.trim(),description:source.description.trim(),count};
    if(anchor) {
      if(source.size!=null&&!SIZES.has(source.size))throw new Error(`${label}.size must be small, medium or large.`);
      feature.size=source.size??'medium';
      if(Object.hasOwn(source,'placement')) {
        if(source.placement!=='centered')throw new Error(`${label}.placement is unsupported; only centered is supported.`);
        if(count!==1)throw new Error(`${label}: centered placement requires count 1.`);
        feature.placement='centered';
      }
      if(Object.hasOwn(source,'facing'))feature.facing=semanticId(source.facing,`${label}.facing`);
      if(source.lightPreset!=null) {
        if(!LIGHT_PRESETS.has(source.lightPreset)||source.lightPreset==='ambient-fill')throw new Error(`${label}.lightPreset is unsupported for an anchor; use room ambientLight for ambient-fill.`);
        feature.lightPreset=source.lightPreset;
      }
    }
    return feature;
  });
  if(features.reduce((sum,f)=>sum+(f.role==='major-anchor'?f.count:0),0)>MAX_ANCHORS_PER_ROOM)throw new Error(`${roomId} supports at most ${MAX_ANCHORS_PER_ROOM} major-anchor instances; use soft-dressing for ordinary contents.`);
  return features;
}

export function validateIntentRelationships(rooms) {
  for(const room of rooms) {
    const byId=new Map(room.features.map(f=>[f.id,f])),visiting=new Set(),visited=new Set();
    const visit=feature=>{
      if(visited.has(feature.id))return;
      if(visiting.has(feature.id))throw new Error(`${room.id}: facing relations contain a cycle at ${feature.id}.`);
      visiting.add(feature.id);
      if(feature.facing) {
        const target=byId.get(feature.facing);
        if(!target)throw new Error(`${room.id}.${feature.id}: facing target ${feature.facing} is missing; it must be in the same room.`);
        if(target.role!=='major-anchor')throw new Error(`${room.id}.${feature.id}: facing target must be a major-anchor.`);
        if(target.count!==1)throw new Error(`${room.id}.${feature.id}: facing target ${target.id} is ambiguous (count must be 1).`);
        visit(target);
      }
      visiting.delete(feature.id);visited.add(feature.id);
    };
    room.features.forEach(visit);
  }
}

// A feature's front is north at 0 degrees; positive rotation is clockwise about its centre.
function facingRotation(x,y,target) {
  return (Math.atan2(target.x+target.width/2-x,y-target.y-target.height/2)*180/Math.PI+360)%360;
}

function* candidateCentres(room,source,target,width,height,instance) {
  if(source.placement==='centered') {
    yield [room.x+room.width/2,room.y+room.height/2];
    return;
  }
  if(target) {
    const tx=target.x+target.width/2,ty=target.y+target.height/2,corners=featureCorners(target);
    // Try different sides first for repeated facing anchors, then search the half-cell lattice.
    for(let offset=0;offset<4;offset++) {
      const [dx,dy]=[[0,-1],[1,0],[0,1],[-1,0]][(instance+offset)%4];
      const extent=Math.max(...corners.map(([x,y])=>(x-tx)*dx+(y-ty)*dy));
      const distance=extent+height/2+.5;
      yield [tx+dx*distance,ty+dy*distance];
    }
  }
  const lattice=[];
  for(let y=room.y+MARGIN+height/2;y<=room.y+room.height-MARGIN;y+=STEP) {
    for(let x=room.x+MARGIN+width/2;x<=room.x+room.width-MARGIN;x+=STEP) {
      if(target)lattice.push([x,y]);
      else yield [x,y];
    }
  }
  if(target) {
    const tx=target.x+target.width/2,ty=target.y+target.height/2;
    lattice.sort((a,b)=>Math.hypot(a[0]-tx,a[1]-ty)-Math.hypot(b[0]-tx,b[1]-ty));
    yield* lattice;
  }
}

export function placeAnchors(intentRooms,spaces,openings,footprint) {
  const features=[],lights=[];
  for(const roomIntent of intentRooms) {
    const room=spaces.find(space=>space.id===roomIntent.id);
    room.dressing=roomIntent.features.filter(f=>f.role==='soft-dressing').map(f=>({...f}));
    const sources=roomIntent.features.filter(f=>f.role==='major-anchor'),placed=[],done=new Set();
    const idFor=id=>`${room.id}--${id}`;
    const fail=()=>{throw new Error(`Scene design cannot fit all requested major-anchor footprints and relations in ${room.name} using bounded deterministic placement. Increase the grid or reduce anchors.`);};
    const area=sources.reduce((sum,f)=>{
      const [width,height]=footprint(f.type,f.size);
      return sum+width*height*f.count;
    },0);
    if(area>(room.width-2*MARGIN)*(room.height-2*MARGIN)+EPSILON)fail();
    const place=source=>{
      if(done.has(source.id))return;
      if(source.facing)place(sources.find(f=>f.id===source.facing));
      const target=source.facing?placed.find(f=>f.id===idFor(source.facing)):null;
      const [width,height]=footprint(source.type,source.size);
      for(let instance=0;instance<source.count;instance++) {
        const id=idFor(source.id)+(source.count>1?`--${instance+1}`:'');
        let result=null;
        for(const [cx,cy] of candidateCentres(room,source,target,width,height,instance)) {
          if(target&&Math.hypot(cx-target.x-target.width/2,cy-target.y-target.height/2)<EPSILON)continue;
          const rotation=target?facingRotation(cx,cy,target):0;
          const candidate={id,role:'major-anchor',type:source.type,description:source.description,roomId:room.id,x:cx-width/2,y:cy-height/2,width,height,rotation,layer:'prop',
            ...(source.placement?{placement:source.placement}:{}),...(target?{facing:target.id}:{})};
          const corners=featureCorners(candidate);
          if(!corners.every(([x,y])=>x>=room.x+MARGIN-EPSILON&&x<=room.x+room.width-MARGIN+EPSILON&&y>=room.y+MARGIN-EPSILON&&y<=room.y+room.height-MARGIN+EPSILON))continue;
          if(placed.some(other=>polygonsOverlap(corners,featureCorners(other))))continue;
          if(openings.some(o=>o.kind!=='window'&&polygonsOverlap(corners,featureCorners(openingRect(o)))))continue;
          result=candidate;break;
        }
        if(!result)fail();
        placed.push(result);
        if(source.lightPreset)lights.push({name:`${result.description} light`,preset:source.lightPreset,sourceFeatureId:result.id});
      }
      done.add(source.id);
    };
    // Fixed centres and their dependencies must precede unconstrained furniture.
    [...sources.filter(f=>f.placement==='centered'),...sources].forEach(place);
    features.push(...placed);
    if(roomIntent.ambientLight)lights.push({name:`${room.name} ambience`,preset:'ambient-fill',roomId:room.id,x:room.x+room.width/2,y:room.y+room.height/2,dim:Math.max(3,Math.min(room.width,room.height)),bright:0});
  }
  return {features,lights};
}
