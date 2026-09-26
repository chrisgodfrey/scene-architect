import { makeCanvas } from './renderer.js';
import { architecturalRegions, artworkMapping, segmentRect } from './architecture.js';

const FLOOR={stone:'#626267',wood:'#78624a',metal:'#596168',dirt:'#67594a',water:'#315d69',other:'#626267'};
const SURROUND='#27282c';
const fill=(ctx,r)=>ctx.fillRect(r.x,r.y,r.width,r.height);
const MATERIAL={
  stone:{base:'#8e887d',edge:'#353536',highlight:'#b8ae97',joint:'#69645d'},
  wood:{base:'#79604a',edge:'#312821',highlight:'#ac8960',joint:'#58412f'},
  metal:{base:'#707d84',edge:'#2b3339',highlight:'#b1bac0',joint:'#4b585f'}
};

export function renderStructuralMask(regions) {
  const canvas=makeCanvas(regions.width,regions.height),ctx=canvas.getContext('2d');
  ctx.fillStyle='#ffffff';
  for(const rect of regions.protectedRects)fill(ctx,rect);
  return canvas;
}

function floors(ctx,regions) {
  ctx.fillStyle=SURROUND;ctx.fillRect(0,0,regions.width,regions.height);
  for(const room of regions.rooms) {
    const floor=String(room.floor??'stone').toLowerCase();
    const kind=/water|pool/.test(floor)?'water':/wood|timber|parquet/.test(floor)?'wood'
      :/metal|iron|steel/.test(floor)?'metal':/dirt|earth|sand/.test(floor)?'dirt':'stone';
    ctx.fillStyle=FLOOR[kind];fill(ctx,room);
  }
}

export function renderWallFootprint(regions) {
  const canvas=makeCanvas(regions.width,regions.height),ctx=canvas.getContext('2d'),half=regions.wallWidth/2;
  ctx.fillStyle='#ffffff';
  for(const s of regions.segments.filter(s=>['wall','secret','terrain','ethereal'].includes(s.kind)))
    fill(ctx,segmentRect(s.a,s.b,half,half));
  for(const o of regions.openings.filter(o=>o.kind!=='secret'))ctx.clearRect(o.rect.x,o.rect.y,o.rect.width,o.rect.height);
  return canvas;
}

export function renderArchitecture(regions) {
  const canvas=makeCanvas(regions.width,regions.height),ctx=canvas.getContext('2d');
  floors(ctx,regions);
  const solid=regions.segments.filter(s=>['wall','secret','terrain','ethereal'].includes(s.kind));
  const half=regions.wallWidth/2,g=regions.gridSize,material=MATERIAL[regions.settings.material];
  const wallMask=renderWallFootprint(regions),maskCtx=wallMask.getContext('2d');
  for(const [depth,colour] of [[.14,'#00000012'],[.09,'#00000018'],[.04,material.edge]]) {
    ctx.fillStyle=colour;
    for(const s of solid)fill(ctx,segmentRect(s.a,s.b,half+g*depth,half+g*depth));
  }
  const tile=makeCanvas(g,g),t=tile.getContext('2d');
  t.fillStyle=material.base;t.fillRect(0,0,g,g);
  // World-anchored material is continuous across merged segments and secret spans.
  t.fillStyle=material.joint;
  const joint=Math.max(1,Math.round(g*.015));
  for(let row=0;row<3;row++) {
    const y=Math.floor(row*g/3);
    t.fillRect(0,y,g,joint);
    t.fillRect(Math.floor((row%2? .25:.75)*g),y,joint,g/3);
  }
  t.fillStyle=material.highlight;
  for(let i=0;i<35;i++)t.fillRect((i*19+7)%g,(i*31+11)%g,1+(i%2),1);
  maskCtx.globalCompositeOperation='source-in';
  maskCtx.fillStyle=maskCtx.createPattern(tile,'repeat');maskCtx.fillRect(0,0,wallMask.width,wallMask.height);
  ctx.drawImage(wallMask,0,0);
  // Clear wall end caps across the full aperture, including perpendicular corners.
  for(const opening of regions.openings.filter(o=>o.kind!=='secret')) {
    ctx.save();ctx.beginPath();ctx.rect(opening.rect.x,opening.rect.y,opening.rect.width,opening.rect.height);ctx.clip();
    floors(ctx,regions);ctx.restore();
    if(opening.kind==='door'||opening.kind==='window') {
      const threshold=segmentRect(opening.a,opening.b,half*.45);
      ctx.fillStyle=opening.kind==='window'?'#7c9ba1':'#a0917838';fill(ctx,threshold);
      if(opening.kind==='window') {
        ctx.fillStyle=material.edge;fill(ctx,segmentRect(opening.a,opening.b,Math.max(1,g*.02)));
      }
      // Jambs end at, never inside, the authoritative aperture.
      const jamb=Math.max(2,Math.round(g*.045)),horizontal=opening.orientation==='h';
      ctx.fillStyle=material.highlight;
      for(const [point,side] of [[opening.a,-1],[opening.b,0]]) {
        fill(ctx,horizontal?{x:point[0]+side*jamb,y:Math.floor(point[1]-half),width:jamb,height:Math.ceil(half*2)}
          :{x:Math.floor(point[0]-half),y:point[1]+side*jamb,width:Math.ceil(half*2),height:jamb});
      }
    }
  }
  ctx.globalCompositeOperation='destination-in';ctx.drawImage(renderStructuralMask(regions),0,0);
  ctx.globalCompositeOperation='source-over';
  return canvas;
}

export function renderArchitecturalPreview(plan) {
  const regions=architecturalRegions(plan),canvas=makeCanvas(regions.width,regions.height),ctx=canvas.getContext('2d');
  floors(ctx,regions);ctx.drawImage(renderArchitecture(regions),0,0);
  return canvas;
}

/**
 * Source artwork is mapped to the full canvas. Protected pixels have no source contribution.
 * @returns {{canvas:HTMLCanvasElement,regions:import('./architecture.js').ArchitecturalRegions,mapping:import('./architecture.js').ArtworkMapping}}
 */
export function composeArtwork(plan,image) {
  const regions=architecturalRegions(plan),mapping=artworkMapping(image,regions);
  const canvas=makeCanvas(regions.width,regions.height),ctx=canvas.getContext('2d');
  floors(ctx,regions);
  ctx.drawImage(image,0,0,mapping.sourceWidth,mapping.sourceHeight,0,0,mapping.width,mapping.height);
  ctx.drawImage(renderArchitecture(regions),0,0);
  return {canvas,regions,mapping};
}
