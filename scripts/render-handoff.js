import { architecturalRegions } from './architecture.js';
import { renderArchitecturalPreview, renderStructuralMask } from './artwork-compositor.js';
import { makeCanvas } from './renderer.js';
import { normalizePlan, validatePlan } from './plan.js';

const isAnchor=(plan,feature)=>feature.layer!=='decal'||plan.lights.some(l=>l.sourceFeatureId===feature.id);

export function renderAnchorMask(plan) {
  const regions=architecturalRegions(plan),canvas=makeCanvas(regions.width,regions.height),ctx=canvas.getContext('2d'),g=regions.gridSize;
  ctx.fillStyle='#ffffff';
  for(const feature of plan.features.filter(f=>isAnchor(plan,f))) {
    ctx.save();ctx.translate((feature.x+feature.width/2)*g,(feature.y+feature.height/2)*g);
    ctx.rotate((feature.rotation??0)*Math.PI/180);
    ctx.fillRect(-feature.width*g/2,-feature.height*g/2,feature.width*g,feature.height*g);ctx.restore();
  }
  return canvas;
}

export function renderReference(plan) {
  const regions=architecturalRegions(plan),canvas=renderArchitecturalPreview(plan),ctx=canvas.getContext('2d'),g=regions.gridSize;
  const mask=renderStructuralMask(regions),m=mask.getContext('2d');
  m.globalCompositeOperation='source-in';m.fillStyle='#cb913acc';m.fillRect(0,0,mask.width,mask.height);
  ctx.drawImage(mask,0,0);
  for(const o of regions.openings.filter(o=>o.kind==='door'||o.kind==='open')) {
    ctx.fillStyle='#64dce0';ctx.fillRect(o.rect.x,o.rect.y,o.rect.width,o.rect.height);
  }
  ctx.font=`bold ${Math.round(g*.24)}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  for(const [index,room] of regions.rooms.entries()) {
    const x=room.x+g*.4,y=room.y+g*.45;
    ctx.fillStyle='#20282c';ctx.fillRect(x-g*.28,y-g*.18,g*.56,g*.36);
    ctx.fillStyle='#ffffff';ctx.fillText(`R${index+1}`,x,y);
  }
  for(const [index,feature] of plan.features.entries()) {
    if(!isAnchor(plan,feature))continue;
    ctx.save();ctx.translate((feature.x+feature.width/2)*g,(feature.y+feature.height/2)*g);
    ctx.rotate((feature.rotation??0)*Math.PI/180);
    ctx.fillStyle='#385581cc';ctx.fillRect(-feature.width*g/2,-feature.height*g/2,feature.width*g,feature.height*g);
    ctx.strokeStyle='#9cceff';ctx.lineWidth=2;ctx.strokeRect(-feature.width*g/2,-feature.height*g/2,feature.width*g,feature.height*g);
    const tip=-feature.height*g*.4;
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,tip);ctx.lineTo(-g*.1,tip+g*.13);ctx.moveTo(0,tip);ctx.lineTo(g*.1,tip+g*.13);ctx.stroke();
    ctx.restore();
    ctx.fillStyle='#ffffff';ctx.fillText(`A${index+1}`,(feature.x+feature.width/2)*g,(feature.y+feature.height*.75)*g);
  }
  return canvas;
}

export function renderHandoffPrompt(input) {
  const plan=validatePlan(normalizePlan(input));
  const {width,height}=architecturalRegions(plan);
  const label=id=>`A${plan.features.findIndex(f=>f.id===id)+1}`;
  const rooms=plan.spaces.map((r,i)=>{
    const dressing=[...(r.dressing??[]),...plan.features.filter(f=>f.roomId===r.id&&!isAnchor(plan,f)).map(f=>({count:1,description:f.description||f.type}))];
    return `R${i+1} ${r.name||r.id}: ${r.description||'Usable interior'}. Floor: ${r.floor||'stone'}.${
      dressing.length?`\n  Soft dressing (free placement, keep circulation clear): ${dressing.map(d=>`${d.count} ${d.description}`).join('; ')}.`:''}`;
  }).join('\n');
  const anchors=plan.features.filter(f=>isAnchor(plan,f)).map(f=>`${label(f.id)} in R${plan.spaces.findIndex(r=>r.id===f.roomId)+1}: ${f.description||f.type}; ${f.width} x ${f.height} cells; front follows the arrow (${Math.round(f.rotation??0)} degrees clockwise from north)${f.facing?`; faces ${label(f.facing)}`:''}${f.placement==='centered'?'; centered in its room':''}.`).join('\n');
  return `Produce ONE attractive appearance-layer image for the attached Scene Architect reference. Return an image, not JSON or individual assets. This is a provider-independent rendering contract.

SCENE: ${plan.scene.name}
${plan.scene.description||''}
VISUAL DIRECTION: ${plan.art?.direction||'Coherent hand-painted overhead battlemap.'}

AUTHORITY AND FRAMING
Scene Architect owns topology, traversability, grid alignment, structural boundaries, openings and major-anchor regions. Do not redesign the floor plan. Generated artwork is appearance, never the spatial source of truth. Protected architectural bands will be replaced by Scene Architect during final composition; do not rely on painted architecture there.
Keep the entire ${width}:${height} canvas, ideally ${width} x ${height} pixels. No crop, border, perspective, isometric/oblique view, foreshortening, vertical wall faces or changed proportions. Camera exactly 90 degrees overhead, strictly orthographic.
Do not add structural walls, obstruct entrances or move rooms. Do not paint door leaves across openings: Scene Architect renders clear thresholds and native Foundry doors are interactive. Keep corridors and marked passages clear.
Concentrate visual richness inside eligible rooms: materials, wear, furnishing, atmosphere and environmental storytelling. Place each major feature substantially within its marked region and preserve counts and facing relationships. Ordinary dressing is free inside its room; it does not need individual assets or exact coordinates.

REFERENCE LEGEND
Amber bands: protected architecture, replaced in the final composite. Cyan: exact clear passages/doorways. Grey interiors: generative room regions. Blue boxes A#: major-anchor footprints; arrows show their front. R#: room IDs. Do not reproduce ANY colours used as annotations, labels, arrows, boxes or a tactical grid. Walls with concealed interactions look like ordinary walls; no secret-door markings are requested.

ROOMS
${rooms}

MAJOR ANCHORS (each entry is one instance)
${anchors||'None; furnish according to room purposes.'}

LIGHTING MOOD
${plan.lights.length?plan.lights.map(l=>`${l.name||'Light'}: ${l.preset||'ambient illumination'}${l.sourceFeatureId?` at ${label(l.sourceFeatureId)}`:''}${l.color?`, ${l.color}`:''}.`).join('\n'):'Use coherent subtle ambient illumination.'}
Baked lighting is stylistic. Native lighting positions and effects remain deterministic and will not be inferred from your image.

FINAL CHECK
Return one coherent overhead image with full framing, rich interiors, clear circulation and the requested major features. Do not supply geometry corrections. If artwork drifts, Scene Architect restores protected architecture rather than fitting native walls to pixels.`;
}
