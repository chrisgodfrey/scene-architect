import { architecturalRegions } from '../scripts/architecture.js';
import { composeArtwork, renderArchitecture, renderStructuralMask, renderWallFootprint } from '../scripts/artwork-compositor.js';
import { makeCanvas } from '../scripts/renderer.js';

export function checkComposition(plan,assert) {
  const regions=architecturalRegions(plan),before=JSON.stringify(plan);
  const source=makeCanvas(regions.width,regions.height),ctx=source.getContext('2d');
  ctx.fillStyle='#ff00ff';ctx.fillRect(0,0,source.width,source.height);
  const first=composeArtwork(plan,source).canvas,second=composeArtwork(plan,source).canvas;
  const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  const a=pixels(first),b=pixels(second),mask=pixels(renderStructuralMask(regions)),architecture=pixels(renderArchitecture(regions));
  let protectedCount=0,interiorCount=0;
  for(let i=0;i<a.length;i+=4) {
    if(mask[i+3]!==0&&mask[i+3]!==255)throw new Error(`Partially protected pixel at ${i/4}`);
    if(mask[i+3]===255) {
      protectedCount++;
      for(let n=0;n<4;n++)if(a[i+n]!==architecture[i+n])throw new Error(`Source leaked into protected pixel ${i/4}`);
    } else {
      interiorCount++;
      if(a[i]!==255||a[i+1]!==0||a[i+2]!==255||a[i+3]!==255)throw new Error(`Interior artwork changed at ${i/4}`);
    }
    for(let n=0;n<4;n++)if(a[i+n]!==b[i+n])throw new Error(`Non-deterministic composite pixel ${i/4}`);
  }
  assert(protectedCount>0&&interiorCount>0,'Every protected pixel excludes source artwork; every unprotected pixel preserves it');
  assert(JSON.stringify(plan)===before,'Composition and mask rendering cannot mutate geometry or semantic lights');
  assert(first.width===regions.width&&first.height===regions.height,'Composite has exact deterministic scene dimensions');
  assert(true,'Identical composition inputs produce byte-identical RGBA pixels');
  const colour=(x,y)=>Array.from(a.slice((y*first.width+x)*4,(y*first.width+x)*4+4)).join(',');
  const solid=regions.segments.filter(s=>['wall','secret','terrain','ethereal'].includes(s.kind));
  const wallPixels=pixels(renderWallFootprint(regions));
  for(const s of solid) {
    const x=Math.floor((s.a[0]+s.b[0])/2),y=Math.floor((s.a[1]+s.b[1])/2);
    if(x<0||y<0||x>=first.width||y>=first.height)continue;
    if(colour(x,y)==='255,0,255,255')throw new Error('Native segment has no structural raster');
    if(wallPixels[(y*first.width+x)*4+3]!==255)throw new Error('Native segment centre is outside its exact wall footprint');
  }
  assert(true,'Compiled native wall centre lines have authoritative structural pixels');
  for(const o of regions.openings.filter(o=>o.kind==='open'||o.kind==='door')) {
    const horizontal=o.a[1]===o.b[1],length=horizontal?o.b[0]-o.a[0]:o.b[1]-o.a[1];
    // Compare an aperture centre against its floor, not against a debug colour.
    for(let i=2;i<length-2;i++) {
      const x=Math.floor(o.a[0]+(horizontal?i:0)),y=Math.floor(o.a[1]+(horizontal?0:i));
      if(colour(x,y)==='255,0,255,255')throw new Error('Painted source blocks a protected opening');
      if(wallPixels[(y*first.width+x)*4+3]!==0)throw new Error('Wall raster blocks a native aperture');
    }
  }
  assert(true,'All pixels along open/door spans exclude painted source obstructions');
  assert(true,'Native door/open apertures remain outside the solid-wall footprint across their exact spans');
  const secretWallPlan=structuredClone(plan);
  secretWallPlan.openings=secretWallPlan.openings.filter(o=>o.kind!=='secret');
  const concealed=pixels(renderArchitecture(architecturalRegions(secretWallPlan)));
  for(const o of regions.openings.filter(o=>o.kind==='secret')) {
    const horizontal=o.a[1]===o.b[1],length=horizontal?o.b[0]-o.a[0]:o.b[1]-o.a[1];
    for(let n=0;n<length;n++) {
      const x=Math.floor(o.a[0]+(horizontal?n:0)),y=Math.floor(o.a[1]+(horizontal?0:n));
      const i=(y*first.width+x)*4;
      for(let channel=0;channel<4;channel++)if(architecture[i+channel]!==concealed[i+channel])throw new Error('Secret span differs visually from ordinary wall');
    }
  }
  assert(true,'Secret doorway surface is indistinguishable from continuous ordinary wall');
  return first;
}

export function checkStructuralVariants(assert) {
  for(const gridSize of [50,100]) {
    const plan={version:1,scene:{name:'Structural variants',columns:12,rows:12,gridSize,distance:5,units:'ft'},
      spaces:[{id:'room',x:1,y:1,width:10,height:10,floor:'stone'}],features:[],lights:[],
      openings:[
        {x:3,y:1,length:2,orientation:'h',kind:'door'},
        {x:1,y:3,length:2,orientation:'v',kind:'open'},
        {x:6,y:11,length:2,orientation:'h',kind:'window'},
        {x:11,y:6,length:2,orientation:'v',kind:'secret'}
      ],
      barriers:[{a:[3,6],b:[5,6],kind:'terrain'},{a:[7,3],b:[7,5],kind:'invisible'},{a:[3,8],b:[5,8],kind:'ethereal'}]};
    const regions=architecturalRegions(plan),architecture=renderArchitecture(regions),footprint=renderWallFootprint(regions);
    const at=(c,x,y)=>[...c.getContext('2d').getImageData(x*gridSize,y*gridSize,1,1).data];
    assert(at(footprint,4,1)[3]===0&&at(footprint,1,4)[3]===0,'Horizontal doors and vertical passages cut the exact solid-wall footprint');
    assert(at(footprint,11,7)[3]===255,'Vertical secret span retains a continuous wall footprint');
    assert(at(footprint,4,6)[3]===255&&at(footprint,4,8)[3]===255&&at(footprint,7,4)[3]===0,'Terrain/ethereal barriers render; invisible barriers remain visually clear');
    assert(at(architecture,7,11).join(',')!==at(architecture,4,1).join(','),'Window sill differs from the clear door threshold without adding a door leaf');
    const source=makeCanvas(regions.width,regions.height),ctx=source.getContext('2d');
    ctx.fillStyle='red';ctx.fillRect(0,0,source.width,source.height);
    const first=composeArtwork(plan,source).canvas;
    ctx.fillStyle='blue';ctx.fillRect(0,0,source.width,source.height);
    const second=composeArtwork(plan,source).canvas;
    for(const [x,y] of [[1,1],[4,1],[1,4],[7,11],[11,7],[4,6],[7,4],[4,8]])
      assert(at(first,x,y).join(',')===at(second,x,y).join(','),'Changing source artwork cannot change protected architectural pixels');
  }
}
