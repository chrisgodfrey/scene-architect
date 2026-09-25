import { makeCanvas } from './renderer.js';
import { lightIntentFromPlan } from './foundry-data.js';

export function mapSize(scene) {
  const {width,height}=scene;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192||width*height>24_000_000)
    throw new Error('Map limit: 8192px per side and 24 megapixels.');
  if(scene.levels?.size>1)throw new Error('Map import currently supports single-level scenes.');
  return {width,height};
}

export function mapAlignment(value={}) {
  const a={scale:Number(value.scale??1),x:Number(value.x??0),y:Number(value.y??0)};
  if(!Number.isFinite(a.scale)||a.scale<0.1||a.scale>4||![a.x,a.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=8192))
    throw new Error('Use a scale between 10% and 400% and offsets within ±8192 pixels.');
  return a;
}

export function assertMapFrame(scene) {
  mapSize(scene);
  if((scene.padding??0)!==0||(scene.shiftX??0)!==0||(scene.shiftY??0)!==0)
    throw new Error('Use zero scene padding and grid shift for the map preview. Manual wall and door edits are supported.');
  const t=scene.firstLevel?.textures;
  if(t&&(['offsetX','offsetY','rotation'].some(k=>(t[k]??0)!==0)||['scaleX','scaleY'].some(k=>(t[k]??1)!==1)))
    throw new Error('Reset the level background offset, rotation and scale before previewing the map. Scene Architect fits the image to the full scene.');
}

// Colours reflect the live document, including doors changed by the GM.
export function drawWallOverlay(canvas,scene) {
  const ctx=canvas.getContext('2d');ctx.save();
  ctx.lineWidth=Math.max(3,(scene.grid?.size??70)*.06);ctx.lineCap='butt';
  for(const wall of scene.walls??[]) {
    const w=wall.toObject?wall.toObject():wall,c=w.c;
    if(!c)continue;
    ctx.strokeStyle=w.door===2?'#c084fc':w.door===1?'#38bdf8':'#facc15';
    ctx.beginPath();ctx.moveTo(c[0],c[1]);ctx.lineTo(c[2],c[3]);ctx.stroke();
  }
  ctx.restore();return canvas;
}

export function renderGuide(plan,scene) {
  const {width,height}=mapSize(scene),g=plan.scene.gridSize,c=makeCanvas(width,height),ctx=c.getContext('2d');
  ctx.fillStyle='#202329';ctx.fillRect(0,0,width,height);
  ctx.font=`${Math.max(14,g*.2)}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  for(const r of plan.spaces) {
    ctx.fillStyle='#545e68';ctx.fillRect(r.x*g,r.y*g,r.width*g,r.height*g);
    ctx.fillStyle='#ffffff';ctx.fillText(r.name||r.id,(r.x+r.width/2)*g,(r.y+.35)*g,r.width*g-8);
  }
  for(const [i,f] of plan.features.entries()) {
    ctx.save();ctx.translate((f.x+f.width/2)*g,(f.y+f.height/2)*g);ctx.rotate((f.rotation??0)*Math.PI/180);
    ctx.fillStyle='#d946ef33';ctx.fillRect(-f.width*g/2,-f.height*g/2,f.width*g,f.height*g);
    ctx.strokeStyle='#f0abfc';ctx.setLineDash([8,6]);ctx.lineWidth=2;ctx.strokeRect(-f.width*g/2,-f.height*g/2,f.width*g,f.height*g);
    // Keep labels upright and near a corner so overlapping effects do not obscure
    // the machine's label beneath them.
    const angle=(f.rotation??0)*Math.PI/180,lx=-f.width*g/2+14,ly=-f.height*g/2+14;
    const x=(f.x+f.width/2)*g+lx*Math.cos(angle)-ly*Math.sin(angle);
    const y=(f.y+f.height/2)*g+lx*Math.sin(angle)+ly*Math.cos(angle);
    ctx.restore();ctx.fillStyle='#202329';ctx.fillRect(x-12,y-11,24,22);
    ctx.fillStyle='#ffffff';ctx.fillText(String(i+1),x,y);
  }
  for(const light of plan.lights) {
    ctx.beginPath();ctx.arc(light.x*g,light.y*g,Math.max(7,g*.12),0,Math.PI*2);
    ctx.fillStyle=light.color??'#ffb45b';ctx.fill();
    ctx.strokeStyle='#ffffff';ctx.setLineDash([]);ctx.lineWidth=2;ctx.stroke();
  }
  return drawWallOverlay(c,scene);
}

export function wholeMapPrompt(plan,scene,{generationId}={}) {
  const {width,height}=mapSize(scene);
  return `Create ONE complete battlemap by PAINTING OVER the attached Scene Architect PNG reference in place. Return one full-map image, not an asset pack or separate props.

PROJECTION IS A HARD TECHNICAL CONSTRAINT: use a camera exactly 90 degrees above the map for a true orthographic top-down 2D view. Preserve the reference as one flat Cartesian coordinate plane. Lines that are parallel in the reference must remain parallel, with no perspective convergence or distance-based scaling. Never use isometric, oblique, three-quarter or perspective projection. Do not show a horizon, vanishing point, foreshortening or vertical wall faces. Show architecture, furniture and props only as overhead plan-view surfaces and footprints.

SCENE: ${plan.scene.name}
${plan.scene.description}

Keep the reference's full canvas framing and ${width}:${height} aspect ratio (ideally ${width} × ${height} pixels). Paint the finished environment directly over the supplied layout without recomposing it. Preserve room positions, wall centre lines, corridor widths and every door opening as closely as possible. Do not add a border, crop the map, move rooms or invent doorways.
Reference legend: yellow lines are native wall boundaries, blue lines are ordinary doors, purple lines are secret doors. Replace these annotations with believable architecture; do not paint the coloured lines, labels, numbers or dashed boxes. Draw ordinary door openings with an open leaf so a permanently closed door is not baked into the floor. Secret-door concealment is visual and must be checked by the GM.

Paint one continuous environment with coherent lighting, materials and atmosphere. Machinery, pipes, wear and decoration should extend naturally across grid boundaries. There are no individual tile cells to fill. Numbered footprints indicate approximate centres, sizes and orientation, not hard clipping boxes. Keep circulation and doorways readable. No tactical grid, text, legend, cutout props, contact sheet or separated panels. True orthographic overhead view.

ROOMS:
${plan.spaces.map(r=>`${r.name||r.id}: ${r.description||r.floor||''}`).join('\n')}

NUMBERED FEATURES (each entry is one instance; preserve the requested counts):
${plan.features.map((f,i)=>`${i+1}. ${f.description||f.type} (${f.width} × ${f.height} grid squares; rotation ${f.rotation??0}°).`).join('\n')}

VISIBLE LIGHT SOURCES:
${plan.lights.length?plan.lights.map(l=>`${l.name||'Light'}: ${l.preset??'legacy light'}${l.sourceFeatureId?` linked to feature ${plan.features.findIndex(f=>f.id===l.sourceFeatureId)+1}`:''}${l.roomId?` in ${l.roomId}`:''}; use ${lightIntentFromPlan(l).animation?.type||'steady illumination'} as the intended visual mood.`).join('\n'):'No special visible light sources are required.'}

${generationId?`GENERATION REQUEST ID: ${generationId}\nKeep this image available in this conversation for an optional geometry-reading follow-up.`:''}

The final image will sit beneath a uniform square Foundry grid with editable walls and doors, so perspective imagery is unusable. Before returning the image, verify that it is still a pure 90-degree orthographic top-down 2D map: no isometric or diagonal projection axes, converging parallel lines, foreshortening, horizon, vanishing point or visible vertical wall faces. Following the reference reduces manual alignment work; it is not a request to generate geometry data.`;
}

export function renderWholeMap(image,scene,alignment={},overlay=false) {
  assertMapFrame(scene);
  const {width,height}=mapSize(scene),a=mapAlignment(alignment),c=makeCanvas(width,height),ctx=c.getContext('2d');
  ctx.fillStyle='#181a1f';ctx.fillRect(0,0,width,height);
  // Full-frame fit deliberately maps both image edges to the reference canvas.
  // Different source aspect ratios distort: the UI warns before application.
  const w=width*a.scale,h=height*a.scale;
  ctx.drawImage(image,(width-w)/2+a.x,(height-h)/2+a.y,w,h);
  return overlay?drawWallOverlay(c,scene):c;
}

// Only the background changes. Manual walls, doors, lights and Tiles survive.
export async function applyWholeMap(scene,background,setBackground) {
  assertMapFrame(scene);
  const old=scene.firstLevel?.background?.src??scene.background?.src??null;
  try {await setBackground(scene,background);}
  catch(error) {
    try{await setBackground(scene,old);}catch(rollback){console.error('Scene Architect: background rollback failed',rollback);}
    throw error;
  }
}
