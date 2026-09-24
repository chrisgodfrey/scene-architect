import {assertMapFrame} from './whole-map.js';
import {wallDataFromSegment} from './foundry-data.js';

const MODULE='scene-architect';
const active=new Set();
export const backgroundPath=scene=>scene.firstLevel?.background?.src??scene.background?.src??'';
export function analysisFrame(scene) {
  assertMapFrame(scene);
  if(!backgroundPath(scene))throw new Error('Apply a map background first.');
  return JSON.stringify([scene.id,scene.width,scene.height,backgroundPath(scene)]);
}
export function snapshotWalls(scene) {
  return [...scene.walls].map(w=>{
    const data=structuredClone(w.toObject?w.toObject():w);
    data._id??=w.id;delete data.id;
    return data;
  });
}
export const wallSignature=scene=>JSON.stringify(snapshotWalls(scene).sort((a,b)=>String(a._id).localeCompare(String(b._id))));

export function analysisPrompt(plan,request) {
  const sourceMode=request.mode==='source',version=sourceMode?2:1,coordinateSpace=sourceMode?'normalized-source-image':'normalized-image';
  const subject=sourceMode
    ? 'Analyse the complete battlemap image you generated earlier in this conversation. Do not ask me to attach the same image again and do not generate another image.'
    : 'Analyse the attached FINISHED battlemap PNG and return wall/door geometry matching the artwork. Do not generate another image.';
  return `${subject} Return ONLY valid JSON, without markdown fences.

Use the entire ${sourceMode?'previously generated source image':'attached image'}: top-left [0,0], bottom-right [1,1]. Coordinates are fractions of image width/height. Do not snap to grid squares. Trace simple, consistent WALL CENTRE LINES, ignoring shadows, pipes, furniture and floor-tile seams. Preserve diagonals if visible. Measure the finished image; do not reuse the original plan's coordinates.

Schema (example segments demonstrate format only; replace them with your analysis):
{"version":${version},"coordinateSpace":"${coordinateSpace}","boundaryConvention":"wall-centre","source":{"imageId":"${request.imageId}","width":${request.width},"height":${request.height}},"walls":[{"id":"wall-1","a":[0.1,0.2],"b":[0.4,0.2],"kind":"wall","evidence":"visible","reviewRequired":false,"note":""},{"id":"door-1","a":[0.4,0.2],"b":[0.45,0.2],"kind":"door","evidence":"visible","reviewRequired":false,"note":""}],"openings":[],"reviewNotes":[]}

Copy source EXACTLY. For walls, kind must be wall, door, secret or window. Ordinary open passages go in openings with kind open and the same segment fields; they are gaps, not blocking walls. Split solid walls at every doorway/passage so no solid span covers an opening. Shared endpoints must match exactly. IDs must be unique. Do not duplicate segments or draw both edges of a thick wall. Include the complete scene wall network, not only corrections. Do not add collision walls around props.

Evidence must be visible or plan-informed. Set reviewRequired true and explain any ambiguous opening or uncertain boundary. All secret doors and plan-informed segments need review. An unclear passage must not be presented as confidently detected. reviewNotes is an array of brief strings. Geometry estimates are subject to the GM's review.

Original intent for semantic context only (the image controls positions):
Scene: ${plan.scene.name}
${plan.scene.description}
Rooms: ${plan.spaces.map(r=>r.name||r.id).join('; ')}.
Planned opening types: ${plan.openings.map(o=>o.kind).join(', ')}. These describe intent, not proof of what was drawn. Secret-door semantics cannot be inferred reliably from appearance alone.`;
}

function overlap(a,b) {
  const dx=a.b[0]-a.a[0],dy=a.b[1]-a.a[1],length=Math.hypot(dx,dy);
  const cross=p=>Math.abs(dx*(p[1]-a.a[1])-dy*(p[0]-a.a[0]))/length;
  if(cross(b.a)>1e-7||cross(b.b)>1e-7)return false;
  const project=p=>((p[0]-a.a[0])*dx+(p[1]-a.a[1])*dy)/length;
  const p=project(b.a),q=project(b.b);
  return Math.min(length,Math.max(p,q))-Math.max(0,Math.min(p,q))>1e-7;
}
export function validateImageGeometry(input,request) {
  let raw=input;
  if(typeof raw==='string') {
    if(raw.length>1_000_000)throw new Error('Geometry JSON exceeds 1 MB.');
    raw=JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'));
  }
  const mode=request?.mode??'fitted',sourceInput=raw?.version===2&&raw?.coordinateSpace==='normalized-source-image';
  const canonicalSource=mode==='source'&&raw?.version===1&&raw?.coordinateSpace==='normalized-image'&&raw?.origin?.version===2&&raw?.origin?.coordinateSpace==='normalized-source-image';
  const fittedInput=raw?.version===1&&raw?.coordinateSpace==='normalized-image';
  if(!raw||raw.boundaryConvention!=='wall-centre'||(mode==='source'?!sourceInput&&!canonicalSource:!fittedInput))throw new Error(mode==='source'?'Use geometry version 2 with normalized-source-image coordinates.':'Use geometry version 1 with normalized-image coordinates and wall-centre boundaries.');
  const identity=canonicalSource?raw.origin.source:raw.source;
  if(!request||identity?.imageId!==request.imageId||identity?.width!==request.width||identity?.height!==request.height)throw new Error('Geometry belongs to a different analysis image or generation. Copy its geometry prompt again.');
  if(canonicalSource&&(raw.source?.width!==(request.sceneWidth??request.width)||raw.source?.height!==(request.sceneHeight??request.height)))throw new Error('Saved geometry does not match the current fitted scene.');
  if(!Array.isArray(raw.walls)||!raw.walls.length||!Array.isArray(raw.openings)||raw.walls.length+raw.openings.length>2000)throw new Error('Supply 1–2000 segments, with walls and openings arrays.');
  if(!Array.isArray(raw.reviewNotes)||raw.reviewNotes.length>100)throw new Error('reviewNotes must be an array of up to 100 strings.');
  const inputWidth=canonicalSource?(request.sceneWidth??request.width):request.width,inputHeight=canonicalSource?(request.sceneHeight??request.height):request.height;
  const ids=new Set(),text=(v,label)=>{if(typeof v!=='string'||v.length>2000)throw new Error(`${label} must be text up to 2000 characters.`);return v;};
  const clean=(s,isOpening)=>{
    if(!s||typeof s.id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(s.id)||ids.has(s.id))throw new Error('Each segment needs a unique ID (letters, numbers, hyphens or underscores).');
    ids.add(s.id);
    for(const point of [s.a,s.b])if(!Array.isArray(point)||point.length!==2||!point.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1))throw new Error(`${s.id}: coordinates must be two numbers between 0 and 1.`);
    if(Math.round(s.a[0]*inputWidth)===Math.round(s.b[0]*inputWidth)&&Math.round(s.a[1]*inputHeight)===Math.round(s.b[1]*inputHeight))throw new Error(`${s.id}: segment has zero pixel length.`);
    if(!(isOpening?['open']:['wall','door','secret','window']).includes(s.kind))throw new Error(`${s.id}: invalid segment kind.`);
    if(!['visible','plan-informed'].includes(s.evidence)||typeof s.reviewRequired!=='boolean')throw new Error(`${s.id}: include evidence and reviewRequired.`);
    return {id:s.id,a:[...s.a],b:[...s.b],kind:s.kind,evidence:s.evidence,reviewRequired:s.reviewRequired||s.evidence==='plan-informed'||s.kind==='secret',note:text(s.note??'',s.id)};
  };
  let walls=raw.walls.map(s=>clean(s,false)),openings=raw.openings.map(s=>clean(s,true));
  if(sourceInput) {
    const sceneWidth=request.sceneWidth,sceneHeight=request.sceneHeight,alignment=request.alignment;
    if(!Number.isFinite(sceneWidth)||!Number.isFinite(sceneHeight)||!alignment||!Number.isFinite(alignment.scale)||alignment.scale<=0||!Number.isFinite(alignment.offsetX)||!Number.isFinite(alignment.offsetY))throw new Error('Source-image geometry is missing its saved map alignment.');
    const transform=([x,y])=>[(1-alignment.scale)/2+alignment.offsetX/sceneWidth+x*alignment.scale,(1-alignment.scale)/2+alignment.offsetY/sceneHeight+y*alignment.scale];
    const clippedNotes=[];
    const clip=s=>{
      const a=transform(s.a),b=transform(s.b),dx=b[0]-a[0],dy=b[1]-a[1];let t0=0,t1=1;
      for(const [p,q] of [[-dx,a[0]],[dx,1-a[0]],[-dy,a[1]],[dy,1-a[1]]]) {
        if(Math.abs(p)<1e-12) {if(q<0)return null;continue;}
        const r=q/p;
        if(p<0) {if(r>t1)return null;t0=Math.max(t0,r);}
        else {if(r<t0)return null;t1=Math.min(t1,r);}
      }
      const clipped=t0>1e-10||t1<1-1e-10;
      const result={...s,a:[a[0]+t0*dx,a[1]+t0*dy],b:[a[0]+t1*dx,a[1]+t1*dy]};
      if(clipped) {
        result.reviewRequired=true;
        result.note=[result.note,'Clipped to the visible fitted scene.'].filter(Boolean).join(' ');
        clippedNotes.push(`${s.id} was clipped to the visible fitted scene.`);
      }
      return result;
    };
    const convert=items=>items.flatMap(s=>{const result=clip(s);if(result)return [result];clippedNotes.push(`${s.id} was outside the visible fitted scene and was omitted.`);return [];});
    walls=convert(walls);openings=convert(openings);
    if(!walls.length)throw new Error('No blocking wall segments remain inside the visible fitted scene.');
    if(raw.reviewNotes.length+clippedNotes.length>100)throw new Error('Source geometry creates more than 100 clipping review notes. Reduce cropped segments or use the fitted-image fallback.');
    raw={...raw,reviewNotes:[...raw.reviewNotes,...clippedNotes]};
  }
  const all=[...walls,...openings];
  const sceneWidth=request.sceneWidth??request.width,sceneHeight=request.sceneHeight??request.height;
  for(const s of all)if(Math.round(s.a[0]*sceneWidth)===Math.round(s.b[0]*sceneWidth)&&Math.round(s.a[1]*sceneHeight)===Math.round(s.b[1]*sceneHeight))throw new Error(`${s.id}: segment has zero fitted pixel length.`);
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)if(overlap(all[i],all[j]))throw new Error(`${all[i].id} overlaps ${all[j].id}. Split walls at doors and passages; remove duplicate spans.`);
  const result={version:1,coordinateSpace:'normalized-image',boundaryConvention:'wall-centre',source:{imageId:request.imageId,width:sceneWidth,height:sceneHeight},walls,openings,reviewNotes:raw.reviewNotes.map(v=>text(v,'Review note'))};
  if(sourceInput||canonicalSource)result.origin={version:2,coordinateSpace:'normalized-source-image',source:{imageId:request.imageId,width:request.width,height:request.height}};
  return result;
}
export function proposedWallData(geometry,scene) {
  return geometry.walls.map(s=>{
    const convert=p=>[Math.round(p[0]*scene.width),Math.round(p[1]*scene.height)];
    const data=wallDataFromSegment({a:convert(s.a),b:convert(s.b),kind:s.kind},1);
    data.flags[MODULE]={...data.flags[MODULE],analysisSegment:s.id,reviewRequired:s.reviewRequired};
    return data;
  });
}
export function drawProposal(canvas,geometry) {
  const ctx=canvas.getContext('2d');ctx.save();ctx.lineWidth=3;
  for(const s of [...geometry.walls,...geometry.openings]) {
    ctx.strokeStyle=s.reviewRequired?'#ff9d3d':s.kind==='door'?'#ff75d8':'#48f5d0';
    ctx.setLineDash(s.reviewRequired||s.kind==='open'?[9,7]:[]);
    ctx.beginPath();ctx.moveTo(s.a[0]*canvas.width,s.a[1]*canvas.height);ctx.lineTo(s.b[0]*canvas.width,s.b[1]*canvas.height);ctx.stroke();
  }
  ctx.restore();return canvas;
}

// Stage replacements before deleting any existing wall. Save a durable snapshot
// first. On a partial failure, remove our new documents and recreate missing old
// documents using their original IDs. Restore itself saves a new undo snapshot.
export async function replaceSceneWalls(scene,desired,expectedSignature,expectedFrame,{restoring=false}={}) {
  if(active.has(scene.id))throw new Error('Another geometry operation is running on this scene.');
  const check=()=>{
    if(analysisFrame(scene)!==expectedFrame||wallSignature(scene)!==expectedSignature)throw new Error('The background, dimensions or walls changed. Preview again before applying.');
  };
  check();active.add(scene.id);
  const before=snapshotWalls(scene),batch=crypto.randomUUID();
  try {
    if(before.some(w=>!w._id))throw new Error('Could not identify existing walls for backup.');
    const nextBackup={at:Date.now(),width:scene.width,height:scene.height,walls:before};
    // During restore, retain the backup being restored until the operation succeeds.
    if(!restoring)await scene.setFlag(MODULE,'geometryBackup',nextBackup);
    check();
    const staged=desired.map(w=>{const d=structuredClone(w);delete d._id;delete d.id;d.flags??={};d.flags[MODULE]={...d.flags[MODULE],geometryBatch:batch};return d;});
    let deletionStarted=false;
    try {
      const created=staged.length?await scene.createEmbeddedDocuments('Wall',staged):[];
      if(created.length!==staged.length)throw new Error('Foundry did not create every proposed wall.');
      // Check original documents still match while ignoring only our staged walls.
      const remaining=[...scene.walls].filter(w=>(w.flags?.[MODULE]?.geometryBatch)!==batch);
      if(analysisFrame(scene)!==expectedFrame||wallSignature({walls:remaining})!==expectedSignature)throw new Error('Scene changed during geometry application.');
      if(before.length){deletionStarted=true;await scene.deleteEmbeddedDocuments('Wall',before.map(w=>w._id));}
      if([...scene.walls].some(w=>before.some(old=>old._id===(w.id??w._id))))throw new Error('Foundry did not remove every previous wall.');
      if(restoring)await scene.setFlag(MODULE,'geometryBackup',nextBackup);
    } catch(error) {
      try {
        const stagedIds=[...scene.walls].filter(w=>w.flags?.[MODULE]?.geometryBatch===batch).map(w=>w.id??w._id);
        if(stagedIds.length)await scene.deleteEmbeddedDocuments('Wall',stagedIds);
        const existing=new Set([...scene.walls].map(w=>w.id??w._id));
        const missing=deletionStarted?before.filter(w=>!existing.has(w._id)):[];
        if(missing.length)await scene.createEmbeddedDocuments('Wall',missing,{keepId:true});
      }catch(rollback){throw new Error(`${error.message} Automatic recovery failed: ${rollback.message}. The saved wall backup is available under Restore previous walls.`);}
      throw error;
    }
  } finally {active.delete(scene.id);}
}
