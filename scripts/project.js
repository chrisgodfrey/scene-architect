import { compileGeometry } from './geometry.js';
import { wallDataFromSegment } from './foundry-data.js';
import { normalizePlan, validatePlan } from './plan.js';
import { migrateArt, validateArt } from './art-manifest.js';

export const MODULE_ID='scene-architect';
const wallShape=w=>{
  const data=w.toObject?w.toObject():w;
  const c=[...data.c];
  if(c[0]>c[2]||(c[0]===c[2]&&c[1]>c[3]))c.push(...c.splice(0,2));
  // Door state is deliberately omitted: opening or locking a door is safe.
  const threshold=['light','sight','sound'].map(k=>[30,40].includes(data[k])?(data.threshold?.[k]??0):0);
  return JSON.stringify([c,...['door','move','light','sight','sound','dir'].map(k=>data[k]??0),...threshold,threshold.some(Boolean)?(data.threshold?.attenuation??false):false]);
};
function wallUnits(w,grid) {
  const data=w.toObject?w.toObject():w,c=data.c;
  if(!c||c.length!==4)return ['invalid wall'];
  const [x,y,x2,y2]=c.map(v=>v/grid),length=Math.abs(x2-x)+Math.abs(y2-y);
  if(![x,y,x2,y2].every(Number.isInteger)||(x!==x2&&y!==y2)||!length)return [wallShape(data)];
  const dx=Math.sign(x2-x),dy=Math.sign(y2-y);
  return Array.from({length},(_,i)=>wallShape({...data,c:[(x+dx*i)*grid,(y+dy*i)*grid,(x+dx*(i+1))*grid,(y+dy*(i+1))*grid]}));
}
export function geometryConflict(scene,plan) {
  if(scene.width!==plan.scene.columns*plan.scene.gridSize||scene.height!==plan.scene.rows*plan.scene.gridSize||scene.grid?.size!==plan.scene.gridSize||(scene.grid?.type??1)!==1||(scene.shiftX??0)!==0||(scene.shiftY??0)!==0||(scene.padding??0)!==0) return 'Scene dimensions, padding or grid differ from the saved plan.';
  if(scene.levels?.size>1) return 'This milestone supports a single level. Build a separate scene from the saved plan.';
  const transform=scene.firstLevel?.textures;
  if(transform&&(['offsetX','offsetY','rotation'].some(k=>(transform[k]??0)!==0)||['scaleX','scaleY'].some(k=>(transform[k]??1)!==1)))return 'Level background transform differs from the plan. Reset its offset, rotation and scale before rendering.';
  const expected=compileGeometry(plan).flatMap(s=>wallUnits(wallDataFromSegment(s,plan.scene.gridSize),plan.scene.gridSize)).sort();
  const actual=[...scene.walls].flatMap(w=>wallUnits(w,plan.scene.gridSize)).sort();
  return JSON.stringify(expected)===JSON.stringify(actual)?null:'Native walls differ from the saved rectangular plan (coordinates, count, door type or blocking settings).';
}

export function projectFromScene(scene) {
  const raw=scene.getFlag(MODULE_ID,'plan');
  if(!raw) throw new Error('This scene has no Scene Architect plan.');
  const plan=validateArt(migrateArt(validatePlan(normalizePlan(raw))));
  return {plan,sceneId:scene.id,sceneName:plan.scene.name,columns:plan.scene.columns,rows:plan.scene.rows,gridSize:plan.scene.gridSize,brief:plan.scene.description,map:structuredClone(scene.getFlag(MODULE_ID,'map')??null),generation:structuredClone(scene.getFlag(MODULE_ID,'generation')??null),revision:scene.getFlag(MODULE_ID,'revision')??null};
}

export async function saveProject(scene,workflow) {
  validatePlan(workflow.plan);validateArt(workflow.plan);
  if((scene.getFlag(MODULE_ID,'revision')??null)!==(workflow.revision??null)) throw new Error('This project changed in another window. Reopen it before saving.');
  const revision=globalThis.crypto.randomUUID();
  const data=structuredClone(workflow.plan);
  // Foundry merges flag objects recursively. Explicit deletion keys remove old assignments
  // while preserving other module flags and unrelated scene data.
  const saved=scene.getFlag(MODULE_ID,'plan')?.art?.assignments??{};
  for(const id of Object.keys(saved))if(!Object.hasOwn(data.art.assignments,id))data.art.assignments[`-=${id}`]=null;
  await scene.update({[`flags.${MODULE_ID}.plan`]:data,[`flags.${MODULE_ID}.map`]:structuredClone(workflow.map??null),[`flags.${MODULE_ID}.generation`]:structuredClone(workflow.generation??null),[`flags.${MODULE_ID}.revision`]:revision});
  workflow.revision=revision;
}

export function propTileData(feature,src,grid) {
  return {name:feature.description||feature.id,x:feature.x*grid,y:feature.y*grid,width:feature.width*grid,height:feature.height*grid,rotation:feature.rotation??0,texture:{src},alpha:1,hidden:false,locked:false,elevation:0,sort:feature.layer==='decal'?0:100,flags:{[MODULE_ID]:{featureId:feature.id,assetId:feature.assetId,generated:true}}};
}

// Uploads happen before this call. Native walls/lights and unrelated Tiles are untouched.
export async function applyRenderedArt(scene,plan,{background,tiles},setBackground) {
  const conflict=geometryConflict(scene,plan);if(conflict) throw new Error(conflict);
  const oldTiles=[...(scene.tiles??[])].filter(t=>t.flags?.[MODULE_ID]?.generated);
  const oldBackground=scene.firstLevel?.background?.src??scene.background?.src??null;
  let created=[];
  try {
    created=tiles.length?await scene.createEmbeddedDocuments('Tile',tiles):[];
    if(created.length!==tiles.length)throw new Error('Foundry did not create every prop Tile. Previous artwork was kept.');
    // Recheck after asynchronous document creation before replacing any existing art.
    const changed=geometryConflict(scene,plan);if(changed)throw new Error(changed);
    await setBackground(scene,background);
    if(oldTiles.length)await scene.deleteEmbeddedDocuments('Tile',oldTiles.map(t=>t.id));
  } catch(error) {
    if(created.length)await scene.deleteEmbeddedDocuments('Tile',created.map(t=>t.id));
    await setBackground(scene,oldBackground);
    throw error;
  }
}
