import { compileGeometry } from './geometry.js';
import { usedAssets, validateArt } from './art-manifest.js';
import { validatePlan } from './plan.js';

export function makeCanvas(width,height) {
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(width);canvas.height=Math.ceil(height);
  if(!canvas.getContext('2d')) throw new Error('Canvas 2D is unavailable.');
  return canvas;
}

export function canvasBlob(canvas) {
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not encode artwork.')),'image/png'));
}

export function loadImage(src,{signal,maxPixels=40_000_000}={}) {
  return new Promise((resolve,reject)=>{
    if(!Number.isInteger(maxPixels)||maxPixels<1||maxPixels>40_000_000){reject(new Error('Invalid image pixel budget.'));return;}
    if(signal?.aborted){reject(new DOMException('Image loading cancelled.','AbortError'));return;}
    const img=new Image();img.crossOrigin='anonymous';
    const cleanup=()=>{img.onload=null;img.onerror=null;signal?.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();img.src='';reject(new DOMException('Image loading cancelled.','AbortError'));};
    img.onload=()=>{
      cleanup();
      if(img.width*img.height>maxPixels){img.src='';reject(new Error(`Asset exceeds the ${maxPixels/1_000_000} megapixels image budget. Resize it before importing.`));}
      else resolve(img);
    };
    img.onerror=()=>{cleanup();reject(new Error(`Could not load image: ${src}. Check its path and image permissions.`));};
    signal?.addEventListener('abort',abort,{once:true});img.src=src;
  });
}

export function fitRect(sw,sh,dw,dh,fit='contain') {
  const scale=fit==='cover'?Math.max(dw/sw,dh/sh):Math.min(dw/sw,dh/sh);
  return {x:(dw-sw*scale)/2,y:(dh-sh*scale)/2,width:sw*scale,height:sh*scale};
}

function drawFitted(ctx,img,assignment,w,h) {
  const c=assignment.crop,sw=img.width*c.width,sh=img.height*c.height,d=fitRect(sw,sh,w,h,assignment.fit);
  ctx.save();ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
  ctx.drawImage(img,img.width*c.x,img.height*c.y,sw,sh,d.x,d.y,d.width,d.height);ctx.restore();
}

export function renderMaterialPreview(img,assignment,size=100) {
  const tile=makeCanvas(size,size),canvas=makeCanvas(size*3,size*3);
  drawFitted(tile.getContext('2d'),img,assignment,size,size);
  const ctx=canvas.getContext('2d');
  ctx.fillStyle=ctx.createPattern(tile,'repeat');ctx.fillRect(0,0,canvas.width,canvas.height);
  return canvas;
}

export function renderProp(img,assignment,width,height,{shadows=true,placeholder=false}={}) {
  const canvas=makeCanvas(width,height),ctx=canvas.getContext('2d');
  if(placeholder) {
    ctx.fillStyle='#a12887';ctx.fillRect(2,2,width-4,height-4);ctx.strokeStyle='#ff99eb';ctx.strokeRect(3,3,width-6,height-6);
    ctx.fillStyle='white';ctx.font=`${Math.max(10,Math.min(width,height)*.14)}px sans-serif`;ctx.textAlign='center';ctx.fillText('PLACEHOLDER',width/2,height/2,width-8);
  } else {
    // Small, consistent contact shadow is kept within the declared footprint.
    const inset=shadows?Math.min(width,height)*.04:0;
    if(shadows) {ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=inset;ctx.shadowOffsetY=inset/2;}
    ctx.translate(inset,inset);drawFitted(ctx,img,assignment,width-inset*2,height-inset*2);
  }
  return canvas;
}

export async function renderSceneArt(plan,{imageLoader=loadImage}={}) {
  validatePlan(plan);validateArt(plan);
  const g=plan.scene.gridSize,w=plan.scene.columns*g,h=plan.scene.rows*g,s=plan.art.settings;
  if(w>8192||h>8192||w*h>24_000_000) throw new Error('Render limit: 8192px per side and 24 megapixels. Reduce grid size or scene dimensions in a new plan.');
  const missing=usedAssets(plan).filter(a=>!plan.art.assignments[a.id]);
  if(missing.length&&!s.allowPlaceholders) throw new Error(`Import these assets first: ${missing.map(a=>a.id).join(', ')}. Or enable labelled synthetic placeholders for testing.`);
  const images=new Map();
  // Load each source once, including repeated prop instances.
  for(const a of usedAssets(plan)) {
    const assignment=plan.art.assignments[a.id];
    if(assignment&&!images.has(assignment.src)) images.set(assignment.src,await imageLoader(assignment.src));
  }
  const background=makeCanvas(w,h),ctx=background.getContext('2d'),patterns=new Map();
  const material=id=>{
    if(patterns.has(id))return patterns.get(id);
    const a=plan.art.assignments[id];let pattern;
    if(a) {
      const tile=makeCanvas(g*s.materialScale,g*s.materialScale);
      drawFitted(tile.getContext('2d'),images.get(a.src),a,tile.width,tile.height);
      pattern=ctx.createPattern(tile,'repeat');
    } else {
      const tile=makeCanvas(g,g),t=tile.getContext('2d');
      t.fillStyle=id===plan.art.surroundAsset?'#20242b':id===plan.art.wallAsset?'#998577':'#535b62';t.fillRect(0,0,g,g);
      t.fillStyle='#c6a8bd';t.font='9px sans-serif';t.fillText('SYNTHETIC',3,g/2);pattern=ctx.createPattern(tile,'repeat');
    }
    patterns.set(id,pattern);return pattern;
  };
  ctx.fillStyle='#222';ctx.fillRect(0,0,w,h);
  ctx.fillStyle=material(plan.art.surroundAsset);ctx.fillRect(0,0,w,h);
  for(const r of plan.spaces) {
    ctx.save();ctx.beginPath();ctx.rect(r.x*g,r.y*g,r.width*g,r.height*g);ctx.clip();
    ctx.fillStyle='#555';ctx.fillRect(r.x*g,r.y*g,r.width*g,r.height*g);
    ctx.fillStyle=material(r.floorAsset);ctx.fillRect(r.x*g,r.y*g,r.width*g,r.height*g);ctx.restore();
  }
  // Only solid boundaries receive artwork. Door/secret/open/window spans stay clear.
  const wallWidth=g*s.wallWidth;
  ctx.lineCap='butt';
  for(const edge of compileGeometry(plan).filter(e=>e.kind==='wall'||e.kind==='terrain')) {
    ctx.beginPath();ctx.moveTo(edge.a[0]*g,edge.a[1]*g);ctx.lineTo(edge.b[0]*g,edge.b[1]*g);
    ctx.strokeStyle='#17171c';ctx.lineWidth=wallWidth+2;ctx.stroke();
    ctx.strokeStyle=material(plan.art.wallAsset);ctx.lineWidth=wallWidth;ctx.stroke();
  }
  // Clear perpendicular end caps and wall outlines out of opening spans, too.
  for(const o of plan.openings) {
    const depth=wallWidth/2+2;
    const rect=o.orientation==='h'?[o.x*g,o.y*g-depth,o.length*g,depth*2]:[o.x*g-depth,o.y*g,depth*2,o.length*g];
    const mid=[o.x+(o.orientation==='h'?o.length/2:0),o.y+(o.orientation==='v'?o.length/2:0)];
    const room=plan.spaces.find(r=>mid[0]>=r.x&&mid[0]<=r.x+r.width&&mid[1]>=r.y&&mid[1]<=r.y+r.height);
    ctx.fillStyle=material(room?.floorAsset||plan.art.surroundAsset);ctx.fillRect(...rect);
  }
  const props=[],cache=new Map();
  for(const f of plan.features) {
    const a=plan.art.assignments[f.assetId],key=JSON.stringify([f.assetId,f.width,f.height,f.layer]);
    if(!cache.has(key)) cache.set(key,renderProp(a?images.get(a.src):null,a,f.width*g,f.height*g,{shadows:s.shadows&&f.layer==='prop',placeholder:!a}));
    props.push({feature:f,canvas:cache.get(key),key});
  }
  return {background,props,missing:missing.map(a=>a.id)};
}

export function compositePreview(rendered,plan) {
  const c=makeCanvas(rendered.background.width,rendered.background.height),ctx=c.getContext('2d'),g=plan.scene.gridSize;
  ctx.drawImage(rendered.background,0,0);
  for(const {feature:f,canvas} of [...rendered.props].sort((a,b)=>(a.feature.layer==='decal'?0:1)-(b.feature.layer==='decal'?0:1))) {
    ctx.save();ctx.translate((f.x+f.width/2)*g,(f.y+f.height/2)*g);ctx.rotate(f.rotation*Math.PI/180);ctx.drawImage(canvas,-f.width*g/2,-f.height*g/2,f.width*g,f.height*g);ctx.restore();
  }
  return c;
}
