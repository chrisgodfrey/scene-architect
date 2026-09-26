import { compileGeometry } from './geometry.js';
import { normalizePlan, validatePlan } from './plan.js';
import { geometryConflict, saveProject } from './project.js';
import { mapSize } from './whole-map.js';

/** @typedef {{x:number,y:number,width:number,height:number}} PixelRect */
/** @typedef {{version:1,wallWidth:number,bandPadding:number,material:string}} ArchitectureSettings */
/** @typedef {{a:number[],b:number[],kind:string}} PixelSegment */
/**
 * @typedef {object} ArchitecturalRegions
 * @property {number} version
 * @property {number} width
 * @property {number} height
 * @property {number} gridSize
 * @property {ArchitectureSettings} settings
 * @property {number} wallWidth
 * @property {number} bandDepth
 * @property {PixelSegment[]} segments
 * @property {(PixelSegment & {rect:PixelRect,orientation:string})[]} openings
 * @property {PixelRect[]} protectedRects
 * @property {(PixelRect & {id:string,floor?:string})[]} rooms
 */
/** @typedef {{sourceWidth:number,sourceHeight:number,width:number,height:number,scaleX:number,scaleY:number,x:number,y:number}} ArtworkMapping */

export function architectureSettings(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Architecture settings must be an object.');
  const settings={version:1,wallWidth:.18,bandPadding:.3,material:'stone',...value};
  if(settings.version!==1)throw new Error('Unsupported architecture settings version.');
  for(const [key,min,max] of [['wallWidth',.08,.35],['bandPadding',.1,.65]]) {
    if(typeof settings[key]!=='number'||!Number.isFinite(settings[key])||settings[key]<min||settings[key]>max)
      throw new Error(`Architecture ${key} must be between ${min} and ${max} grid cells.`);
  }
  if(!['stone','wood','metal'].includes(settings.material))throw new Error('Architecture material must be stone, wood or metal.');
  return settings;
}

// Rectangles enclose pixel centres; rounding outwards keeps mask edges binary.
export function segmentRect(a,b,halfWidth,cap=0) {
  const x=Math.floor(Math.min(a[0],b[0])-(a[0]===b[0]?halfWidth:cap));
  const y=Math.floor(Math.min(a[1],b[1])-(a[1]===b[1]?halfWidth:cap));
  return {x,y,width:Math.ceil(Math.max(a[0],b[0])+(a[0]===b[0]?halfWidth:cap))-x,
    height:Math.ceil(Math.max(a[1],b[1])+(a[1]===b[1]?halfWidth:cap))-y};
}

/**
 * Grid cells -> scene pixels, once. Foundry and raster use these same segments.
 * Source-image coordinates never enter this descriptor.
 * @returns {ArchitecturalRegions}
 */
export function architecturalRegions(input) {
  const plan=validatePlan(normalizePlan(input)),g=plan.scene.gridSize;
  const {width,height}=mapSize({width:plan.scene.columns*g,height:plan.scene.rows*g});
  const settings=architectureSettings(plan.rendering),wallWidth=settings.wallWidth*g;
  const bandDepth=wallWidth/2+settings.bandPadding*g;
  const segments=compileGeometry(plan).map(segment=>({
    ...segment,a:segment.a.map(n=>n*g),b:segment.b.map(n=>n*g)
  }));
  const openings=plan.openings.map(o=>{
    const a=[o.x*g,o.y*g],b=o.orientation==='h'?[(o.x+o.length)*g,o.y*g]:[o.x*g,(o.y+o.length)*g];
    return {...o,a,b,rect:segmentRect(a,b,bandDepth)};
  });
  const protectedRects=[
    ...segments.map(s=>segmentRect(s.a,s.b,bandDepth,bandDepth)),
    ...openings.map(o=>segmentRect(o.a,o.b,bandDepth,bandDepth))
  ];
  return {version:1,width,height,gridSize:g,settings,wallWidth,bandDepth,segments,openings,protectedRects,
    rooms:plan.spaces.map(r=>({...r,x:r.x*g,y:r.y*g,width:r.width*g,height:r.height*g}))};
}

/** @returns {ArtworkMapping} */
export function artworkMapping(image,regions) {
  const width=image.naturalWidth??image.width,height=image.naturalHeight??image.height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>40_000_000)
    throw new Error('Artwork must have valid dimensions and contain at most 40 megapixels.');
  // Only one-pixel integer rounding at the source resolution is tolerated.
  const error=Math.abs(width*regions.height-height*regions.width);
  if(error>Math.max(regions.width,regions.height)||error/(height*regions.width)>.002)
    throw new Error(`Artwork aspect ratio is incompatible. Expected ${regions.width}:${regions.height}; received ${width}:${height}. Regenerate with the full reference canvas; no cropping or stretching is permitted.`);
  return {sourceWidth:width,sourceHeight:height,width:regions.width,height:regions.height,
    scaleX:regions.width/width,scaleY:regions.height/height,x:0,y:0};
}

export function assertArchitectureScene(scene,plan) {
  const conflict=geometryConflict(scene,plan);
  if(conflict)throw new Error(`${conflict} Create a new scene from the original plan; artwork cannot redefine native geometry.`);
  if(scene.lights) {
    const normalized=validatePlan(normalizePlan(plan)),g=normalized.scene.gridSize;
    const expected=normalized.lights.map(l=>JSON.stringify([l.x*g,l.y*g])).sort();
    const actual=[...scene.lights].filter(l=>l.flags?.['scene-architect']?.generated===true).map(l=>JSON.stringify([l.x,l.y])).sort();
    if(JSON.stringify(expected)!==JSON.stringify(actual))
      throw new Error('Managed light positions differ from the saved plan. Create a new scene from the original plan; artwork cannot redefine native lighting.');
  }
}

export async function applyCompositedMap(scene,workflow,map,background,setBackground) {
  assertArchitectureScene(scene,workflow.plan);
  if((scene.getFlag('scene-architect','revision')??null)!==(workflow.revision??null))
    throw new Error('This project changed in another window. Reopen it before saving.');
  const old=workflow.map,oldBackground=scene.firstLevel?.background?.src??scene.background?.src??null;
  try {
    await setBackground(scene,background);
    assertArchitectureScene(scene,workflow.plan);
    workflow.map=map;
    await saveProject(scene,workflow);
  } catch(error) {
    workflow.map=old;
    const currentBackground=scene.firstLevel?.background?.src??scene.background?.src??null;
    if(currentBackground!==background&&currentBackground!==oldBackground)
      throw new Error(`${error.message} Another background change was detected; it was preserved. Reopen the scene before retrying.`,{cause:error});
    if((scene.getFlag('scene-architect','revision')??null)!==(workflow.revision??null))
      throw new Error(`${error.message} Project revision changed during application; automatic restoration stopped. Reopen the scene and inspect its background.`,{cause:error});
    try {await setBackground(scene,oldBackground);}
    catch(rollback) {throw new Error(`${error.message} Background restoration failed: ${rollback.message}. Reopen the scene and restore its background manually.`,{cause:error});}
    throw error;
  }
}
