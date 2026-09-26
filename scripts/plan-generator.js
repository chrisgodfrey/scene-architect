import { LIGHT_PRESETS, featureCorners, normalizePlan, openingRect, polygonsOverlap, validatePlan } from './plan.js';
import { DEFAULT_DIRECTION, migrateArt, validateArt } from './art-manifest.js';
import { normalizeSemanticFeatures, placeAnchors, semanticId, semanticKeys, validateIntentRelationships } from './anchors.js';

const INTENT_KIND='scene-intent';
const INTENT_VERSION=2;
const CIRCULATION=new Set(['linear','central-corridor']);
const SIZES=new Set(['small','medium','large']);
const SIZE_WEIGHT={small:1,medium:2,large:3};
const MAX_ROOMS=20;
const MAX_FEATURES_PER_ROOM=16;
const MIN_ROOM_SPAN=4;
const MARGIN=1;
const FEATURE_MARGIN=.75;
const FEATURE_STEP=.5;

const text=(value,fallback='')=>typeof value==='string'&&value.trim()?value.trim():fallback;
const slug=value=>text(value,'item').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'item';

function uniqueId(value,used,fallback) {
  const base=slug(value||fallback).slice(0,64)||fallback;
  let candidate=base,index=2;
  while(used.has(candidate))candidate=`${base.slice(0,Math.max(1,64-String(index).length-1))}-${index++}`;
  used.add(candidate);
  return candidate;
}

function whole(value,label,min,max) {
  if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${label} must be a whole number between ${min} and ${max}.`);
  return value;
}

function normalizeFeature(raw,index,used) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`rooms[].features[${index}] must be an object.`);
  const count=raw.count??1;
  whole(count,`${text(raw.id,`feature-${index+1}`)}.count`,1,MAX_FEATURES_PER_ROOM);
  const size=SIZES.has(raw.size)?raw.size:'medium';
  const lightPreset=raw.lightPreset==null?null:text(raw.lightPreset);
  if(lightPreset&&!LIGHT_PRESETS.has(lightPreset))throw new Error(`${text(raw.id,`feature-${index+1}`)}.lightPreset is unsupported.`);
  return {
    id:uniqueId(raw.id,used,`feature-${index+1}`),
    type:text(raw.type,'other'),
    description:text(raw.description,text(raw.type,'Scene feature')),
    size,
    count,
    lightPreset
  };
}

function normalizeRoom(raw,index,usedRoomIds,version) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`rooms[${index}] must be an object.`);
  if(version===2)semanticKeys(raw,['id','name','purpose','size','floor','features','ambientLight'],`rooms[${index}]`);
  const id=version===2?semanticId(raw.id,`rooms[${index}].id`):uniqueId(raw.id,usedRoomIds,`room-${index+1}`),usedFeatureIds=new Set();
  if(version===2) {
    if(usedRoomIds.has(id))throw new Error(`Ambiguous duplicate or reserved room ID after normalization: ${id}.`);
    usedRoomIds.add(id);
    if(raw.size!=null&&!SIZES.has(raw.size))throw new Error(`${id}.size must be small, medium or large.`);
    if(raw.ambientLight!=null&&typeof raw.ambientLight!=='boolean')throw new Error(`${id}.ambientLight must be boolean.`);
  }
  if(raw.features!=null&&!Array.isArray(raw.features))throw new Error(`${id}.features must be an array.`);
  return {
    id,
    name:text(raw.name,`Room ${index+1}`),
    purpose:text(raw.purpose,text(raw.name,'Usable scene space')),
    size:SIZES.has(raw.size)?raw.size:'medium',
    floor:text(raw.floor,'stone'),
    features:version===2?normalizeSemanticFeatures(raw.features??[],id):(raw.features??[]).map((feature,featureIndex)=>normalizeFeature(feature,featureIndex,usedFeatureIds)),
    ambientLight:raw.ambientLight===true
  };
}

export function normalizeSceneIntent(raw) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Scene design must be a JSON object.');
  if(raw.kind!==INTENT_KIND)throw new Error(`Scene design kind must be "${INTENT_KIND}".`);
  if(![1,INTENT_VERSION].includes(raw.version))throw new Error(`Unsupported scene design version. Use version 1 or ${INTENT_VERSION}.`);
  if(!raw.scene||typeof raw.scene!=='object'||Array.isArray(raw.scene))throw new Error('Scene design needs a scene object.');
  if(!Array.isArray(raw.rooms)||!raw.rooms.length)throw new Error('Scene design needs at least one room.');
  if(raw.rooms.length>MAX_ROOMS)throw new Error(`Scene design supports at most ${MAX_ROOMS} requested rooms.`);
  if(raw.version===2) {
    semanticKeys(raw,['kind','version','scene','rooms'],'Scene design');
    semanticKeys(raw.scene,['name','description','visualDirection','circulation'],'scene');
    if(raw.scene.circulation!=null&&!CIRCULATION.has(raw.scene.circulation))throw new Error('scene.circulation must be linear or central-corridor.');
  }
  const usedRoomIds=new Set(['circulation']),rooms=raw.rooms.map((room,index)=>normalizeRoom(room,index,usedRoomIds,raw.version));
  if(raw.version===2)validateIntentRelationships(rooms);
  return {
    kind:INTENT_KIND,
    version:raw.version,
    scene:{
      name:text(raw.scene.name,'New Scene'),
      description:text(raw.scene.description,''),
      visualDirection:text(raw.scene.visualDirection,DEFAULT_DIRECTION),
      circulation:CIRCULATION.has(raw.scene.circulation)?raw.scene.circulation:(rooms.length>=3?'central-corridor':'linear')
    },
    rooms
  };
}

function splitWeightedSpan(start,length,items) {
  const minimum=MIN_ROOM_SPAN*items.length,remaining=length-minimum;
  if(remaining<0)return null;
  const totalWeight=items.reduce((sum,item)=>sum+SIZE_WEIGHT[item.size],0);
  const shares=items.map((item,index)=>{
    const exact=remaining*SIZE_WEIGHT[item.size]/totalWeight;
    return {index,size:MIN_ROOM_SPAN+Math.floor(exact),fraction:exact-Math.floor(exact)};
  });
  let unassigned=length-shares.reduce((sum,share)=>sum+share.size,0);
  for(const share of [...shares].sort((a,b)=>b.fraction-a.fraction||a.index-b.index)) {
    if(!unassigned)break;
    shares[share.index].size++;
    unassigned--;
  }
  let cursor=start;
  return shares.map(share=>{
    const part={start:cursor,size:share.size};
    cursor+=share.size;
    return part;
  });
}

function sharedOpening(a,b) {
  if(a.x+a.width===b.x||b.x+b.width===a.x) {
    const x=a.x+a.width===b.x?b.x:a.x;
    const lo=Math.max(a.y,b.y),hi=Math.min(a.y+a.height,b.y+b.height);
    if(hi-lo<1)return null;
    return {x,y:lo+Math.floor((hi-lo-1)/2),orientation:'v',length:1,kind:'door'};
  }
  if(a.y+a.height===b.y||b.y+b.height===a.y) {
    const y=a.y+a.height===b.y?b.y:a.y;
    const lo=Math.max(a.x,b.x),hi=Math.min(a.x+a.width,b.x+b.width);
    if(hi-lo<1)return null;
    return {x:lo+Math.floor((hi-lo-1)/2),y,orientation:'h',length:1,kind:'door'};
  }
  return null;
}

function roomShape(room,rect) {
  return {
    id:room.id,
    name:room.name,
    x:rect.x,
    y:rect.y,
    width:rect.width,
    height:rect.height,
    floor:room.floor,
    description:room.purpose
  };
}

function linearLayout(rooms,columns,rows) {
  const width=columns-MARGIN*2,height=rows-MARGIN*2;
  let best=null;
  for(let columnCount=1;columnCount<=rooms.length;columnCount++) {
    const rowCount=Math.ceil(rooms.length/columnCount);
    if(Math.floor(width/columnCount)<MIN_ROOM_SPAN||Math.floor(height/rowCount)<MIN_ROOM_SPAN)continue;
    const cellRatio=(width/columnCount)/(height/rowCount),sceneRatio=width/height;
    const score=(columnCount*rowCount-rooms.length)*4+Math.abs(Math.log(cellRatio/sceneRatio));
    if(!best||score<best.score)best={columnCount,rowCount,score};
  }
  if(!best)throw new Error(`Scene design has too many rooms for a ${columns}x${rows} grid.`);
  const roomRows=[];
  for(let index=0;index<rooms.length;index+=best.columnCount)roomRows.push(rooms.slice(index,index+best.columnCount));
  const ys=splitWeightedSpan(MARGIN,height,roomRows.map(row=>({size:row.reduce((largest,room)=>SIZE_WEIGHT[room.size]>SIZE_WEIGHT[largest]?room.size:largest,'small')})));
  const rects=[];
  for(let row=0;row<roomRows.length;row++) {
    const rowRooms=roomRows[row],ordered=row%2===0?rowRooms:[...rowRooms].reverse();
    const xs=splitWeightedSpan(MARGIN,width,ordered),placed=new Map();
    for(let index=0;index<ordered.length;index++) {
      placed.set(ordered[index].id,{x:xs[index].start,y:ys[row].start,width:xs[index].size,height:ys[row].size});
    }
    rects.push(...rowRooms.map(room=>placed.get(room.id)));
  }
  const spaces=rooms.map((room,index)=>roomShape(room,rects[index])),openings=[];
  for(let index=0;index<spaces.length-1;index++) {
    const opening=sharedOpening(spaces[index],spaces[index+1]);
    if(!opening)throw new Error('Scene design could not construct connected linear circulation.');
    openings.push(opening);
  }
  return {spaces,openings};
}

function corridorCandidate(rooms,columns,rows,horizontal) {
  const width=columns-MARGIN*2,height=rows-MARGIN*2,corridorSpan=2;
  const firstCount=Math.ceil(rooms.length/2),secondCount=Math.floor(rooms.length/2);
  if(horizontal) {
    const corridorY=MARGIN+Math.floor((height-corridorSpan)/2);
    const topHeight=corridorY-MARGIN,bottomY=corridorY+corridorSpan,bottomHeight=rows-MARGIN-bottomY;
    if(topHeight<MIN_ROOM_SPAN||(secondCount&&bottomHeight<MIN_ROOM_SPAN))return null;
    if(Math.floor(width/firstCount)<MIN_ROOM_SPAN||(secondCount&&Math.floor(width/secondCount)<MIN_ROOM_SPAN))return null;
    const top=splitWeightedSpan(MARGIN,width,rooms.filter((_,index)=>index%2===0));
    const bottom=secondCount?splitWeightedSpan(MARGIN,width,rooms.filter((_,index)=>index%2===1)):[];
    const rects=rooms.map((_,index)=>index%2===0
      ? {x:top[index/2].start,y:MARGIN,width:top[index/2].size,height:topHeight}
      : {x:bottom[(index-1)/2].start,y:bottomY,width:bottom[(index-1)/2].size,height:bottomHeight});
    return {rects,corridor:{id:'circulation',name:'Central corridor',x:MARGIN,y:corridorY,width,height:corridorSpan,floor:'stone',description:'Main circulation connecting every requested room'}};
  }
  const corridorX=MARGIN+Math.floor((width-corridorSpan)/2);
  const leftWidth=corridorX-MARGIN,rightX=corridorX+corridorSpan,rightWidth=columns-MARGIN-rightX;
  if(leftWidth<MIN_ROOM_SPAN||(secondCount&&rightWidth<MIN_ROOM_SPAN))return null;
  if(Math.floor(height/firstCount)<MIN_ROOM_SPAN||(secondCount&&Math.floor(height/secondCount)<MIN_ROOM_SPAN))return null;
  const left=splitWeightedSpan(MARGIN,height,rooms.filter((_,index)=>index%2===0));
  const right=secondCount?splitWeightedSpan(MARGIN,height,rooms.filter((_,index)=>index%2===1)):[];
  const rects=rooms.map((_,index)=>index%2===0
    ? {x:MARGIN,y:left[index/2].start,width:leftWidth,height:left[index/2].size}
    : {x:rightX,y:right[(index-1)/2].start,width:rightWidth,height:right[(index-1)/2].size});
  return {rects,corridor:{id:'circulation',name:'Central corridor',x:corridorX,y:MARGIN,width:corridorSpan,height,floor:'stone',description:'Main circulation connecting every requested room'}};
}

function centralCorridorLayout(rooms,columns,rows) {
  const candidates=[corridorCandidate(rooms,columns,rows,columns>=rows),corridorCandidate(rooms,columns,rows,columns<rows)].filter(Boolean);
  if(!candidates.length)throw new Error(`Scene design has too many rooms for central-corridor circulation on a ${columns}x${rows} grid.`);
  const selected=candidates[0],spaces=rooms.map((room,index)=>roomShape(room,selected.rects[index]));
  const openings=spaces.map(space=>{
    const opening=sharedOpening(space,selected.corridor);
    if(!opening)throw new Error('Scene design could not connect a room to the central corridor.');
    return opening;
  });
  return {spaces:[...spaces,selected.corridor],openings};
}

function footprint(type,size) {
  const square={small:[1,1],medium:[1.5,1.5],large:[2,2]}[size];
  if(/bed|bench|shelf|bookcase/i.test(type))return size==='small'?[1,2]:size==='large'?[2,3]:[1.5,2.5];
  if(/table|desk|altar|machine/i.test(type))return size==='small'?[1.5,1]:size==='large'?[3,2]:[2,1.5];
  if(/stairs/i.test(type))return size==='large'?[3,2]:[2,2];
  return square;
}

function fitsFeature(candidate,placed,openings) {
  const corners=featureCorners(candidate);
  if(placed.some(feature=>polygonsOverlap(corners,featureCorners(feature))))return false;
  return !openings.some(opening=>opening.kind!=='window'&&polygonsOverlap(corners,featureCorners(openingRect(opening))));
}

function placeFeatures(intentRooms,spaces,openings) {
  const features=[],lights=[],featureIds=new Set();
  for(const roomIntent of intentRooms) {
    const room=spaces.find(space=>space.id===roomIntent.id);
    for(const featureIntent of roomIntent.features) {
      const [width,height]=footprint(featureIntent.type,featureIntent.size);
      for(let instance=0;instance<featureIntent.count;instance++) {
        const id=uniqueId(featureIntent.count===1?featureIntent.id:`${featureIntent.id}-${instance+1}`,featureIds,`feature-${features.length+1}`);
        let placed=null;
        for(let y=room.y+FEATURE_MARGIN;y+height<=room.y+room.height-FEATURE_MARGIN+1e-8&&!placed;y+=FEATURE_STEP) {
          for(let x=room.x+FEATURE_MARGIN;x+width<=room.x+room.width-FEATURE_MARGIN+1e-8;x+=FEATURE_STEP) {
            const candidate={id,type:featureIntent.type,x,y,width,height,rotation:0,layer:'prop',roomId:room.id,description:featureIntent.description};
            if(fitsFeature(candidate,features.filter(feature=>feature.roomId===room.id),openings)) {placed=candidate;break;}
          }
        }
        if(!placed)throw new Error(`Scene design cannot fit all requested features in ${room.name}. Increase the grid or reduce that room's contents.`);
        features.push(placed);
        if(featureIntent.lightPreset&&featureIntent.lightPreset!=='ambient-fill') {
          lights.push({name:`${placed.description} light`,preset:featureIntent.lightPreset,sourceFeatureId:placed.id});
        }
      }
    }
    if(roomIntent.ambientLight||roomIntent.features.some(feature=>feature.lightPreset==='ambient-fill')) {
      lights.push({name:`${room.name} ambience`,preset:'ambient-fill',roomId:room.id,x:room.x+room.width/2,y:room.y+room.height/2,dim:Math.max(3,Math.min(room.width,room.height)),bright:0});
    }
  }
  return {features,lights};
}

function boundGeneratedArtIds(plan) {
  const used=new Set(),ids=new Map();
  for(const asset of plan.art.assets) {
    const original=asset.id;
    asset.id=uniqueId(original,used,'asset');
    ids.set(original,asset.id);
  }
  plan.art.surroundAsset=ids.get(plan.art.surroundAsset);
  plan.art.wallAsset=ids.get(plan.art.wallAsset);
  for(const room of plan.spaces)room.floorAsset=ids.get(room.floorAsset);
  for(const feature of plan.features)feature.assetId=ids.get(feature.assetId);
}

export function compileSceneIntent(raw,fallback={}) {
  const intent=normalizeSceneIntent(raw);
  const columns=whole(Number(fallback.columns??34),'Scene columns',4,200);
  const rows=whole(Number(fallback.rows??28),'Scene rows',4,200);
  const gridSize=whole(Number(fallback.gridSize??70),'Grid size',50,400);
  const layout=intent.scene.circulation==='central-corridor'
    ? centralCorridorLayout(intent.rooms,columns,rows)
    : linearLayout(intent.rooms,columns,rows);
  const {features,lights}=intent.version===2
    ?placeAnchors(intent.rooms,layout.spaces,layout.openings,footprint)
    :placeFeatures(intent.rooms,layout.spaces,layout.openings);
  const rawPlan={
    version:1,
    scene:{
      name:intent.scene.name||text(fallback.sceneName,'New Scene'),
      columns,
      rows,
      gridSize,
      distance:5,
      units:'ft',
      description:intent.scene.description||text(fallback.brief,'')
    },
    spaces:layout.spaces,
    openings:layout.openings,
    barriers:[],
    features,
    lights
  };
  const plan=validatePlan(normalizePlan(rawPlan,fallback));
  migrateArt(plan);
  // Namespaced anchor IDs may exceed the independent art-manifest ID limit.
  if(intent.version===2)boundGeneratedArtIds(plan);
  plan.art.direction=intent.scene.visualDirection;
  return validateArt(validatePlan(plan));
}

export function buildSceneIntentPrompt(state) {
  const animationKeys=Array.isArray(state.animations)&&state.animations.length?state.animations.join(', '):'none reported';
  return `Design a semantic scene for Scene Architect. Scene Architect, not you, will choose every coordinate, room rectangle, opening position, prop footprint and light position so the result is valid by construction.

USER BRIEF:
${text(state.brief)}

TARGET:
- Scene name: ${text(state.sceneName,'New Scene')}
- Grid: ${Number(state.columns??34)} columns x ${Number(state.rows??28)} rows
- Grid size: ${Number(state.gridSize??70)}px

Return ONLY one JSON object. No markdown fences, comments, explanation or trailing prose.

Use exactly this coordinate-free contract:
{
  "kind": "scene-intent",
  "version": 2,
  "scene": {
    "name": "string",
    "description": "string",
    "visualDirection": "shared visual style",
    "circulation": "linear|central-corridor"
  },
  "rooms": [
    {
      "id": "stable-semantic-id",
      "name": "Room name",
      "purpose": "playable purpose and dressing",
      "size": "small|medium|large",
      "floor": "stone|wood|dirt|metal|other",
      "features": [
        {
          "id": "instantiator",
          "role": "major-anchor",
          "type": "machine",
          "description": "Large copper Instantiator with a glowing portal",
          "size": "large",
          "count": 1,
          "placement": "centered",
          "lightPreset": "magic-portal"
        },
        {
          "id": "restraint-bed",
          "role": "major-anchor",
          "type": "bed",
          "description": "Restraint bed, head/front directed at the Instantiator",
          "size": "medium",
          "count": 3,
          "facing": "instantiator"
        },
        {
          "id": "ordinary-dressing",
          "role": "soft-dressing",
          "type": "furniture",
          "description": "Ordinary stools, scattered papers and instrument trays",
          "count": 12
        }
      ],
      "ambientLight": false
    }
  ]
}

SEMANTIC RULES:
1. Describe between 1 and ${MAX_ROOMS} requested rooms. Do not include a corridor room when using central-corridor; Scene Architect adds it.
2. Use central-corridor for schools, hospitals, offices and other buildings where rooms need shared circulation. Use linear for sequences such as caves, tombs or railway spaces.
3. Every feature MUST have a role. major-anchor means an important obstacle, exact-count object, relation target or native light source: the deterministic plan assigns its footprint and orientation. At most ${MAX_FEATURES_PER_ROOM} total anchor instances per room; count is 1-${MAX_FEATURES_PER_ROOM}, size is small|medium|large (default medium).
4. soft-dressing means artwork-only ordinary furniture, clutter or decoration: retain description and count (1-200), never footprints or exact positions. Dressing counts are descriptive artwork requests, not guaranteed geometry counts. Use this role for most desks, chairs, shelves, towels, papers and ornament; promote objects needing exact counts/positions to anchors. At most 64 feature groups per room.
5. Use stable unique semantic IDs within each room, and unique room IDs (not circulation). IDs normalize to lowercase hyphenated names; duplicates are errors, not renamed. Do not include x, y, width, height, rotation, coordinates, openings, barriers, wall segments or light coordinates.
6. The ONLY optional spatial fields on a major-anchor are placement: "centered" (count must be 1) and facing: "target-id". Facing targets must be a named major-anchor in the SAME room with count 1, never a dressing group or ambiguous repeated object. Relations cannot form cycles. Omit placement for automatic placement. No against-wall, adjacency, free-text relations or other spatial fields. North=0 degrees, clockwise around the feature centre; the compiler turns the anchor's front/head toward the target's centre. Use facing, not description alone, for required facing.
7. Put lightPreset ONLY on major-anchor sources emitting native light: steady-lamp|flickering-lamp|flame|magic-portal|pulsing-magic. Each instance produces one linked light at its deterministic centre. Soft dressing cannot emit native lights; promote a source explicitly. Use flickering-lamp for ordinary lanterns and oil lamps, and flame for candles, braziers, hearths, furnaces and other open flames. Reserve steady-lamp for genuinely constant magical or electric fixtures. Use room ambientLight for non-directional room fill, not a feature ambient-fill preset.
8. Available Foundry animation keys are ${animationKeys}; semantic presets remain preferred. Older version 1 intents and saved low-level plans remain supported; generate version 2 for these strict semantics.
9. Return the semantic JSON once. Scene Architect deterministically constructs and validates the complete plan. Frontier artwork supplies appearance and soft dressing only, never inferred geometry.`;
}
