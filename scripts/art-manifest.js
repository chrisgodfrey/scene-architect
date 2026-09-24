// Art schema is independent of the plan schema. No Foundry or DOM dependencies.
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'asset';
export const DEFAULT_DIRECTION='Orthographic overhead, painterly dark stone and aged copper, restrained purple and green accents. Soft neutral illumination from upper left; no dramatic cast shadows, perspective, text, borders or grid.';

export function migrateArt(plan) {
  if(plan.art) return plan; // Never silently repair an explicit manifest or discard assignments.
  const assets=[];
  const add=(id,kind,description,ratio=1)=>{assets.push({id,kind,description,ratio,requirements:kind==='material'?'Seamless square texture, no objects or directional shadows.':'One isolated object, tightly framed, transparent PNG, no ground plane.'});return id;};
  const surround=add('surround-rock','material','Dark surrounding rock');
  const wall=add('wall-stone','material','Rough cut stone wall surface');
  const floors=new Map();
  for(const room of plan.spaces) {
    const key=room.floor||'stone';
    if(!floors.has(key)) floors.set(key,add(`floor-${floors.size+1}-${slug(key)}`,'material',`${key} floor material`));
    room.floorAsset=floors.get(key);
  }
  // Older features have no reliable semantic identity: do not merge distinct machines by type.
  for(const [i,f] of plan.features.entries()) f.assetId=add(`prop-${i+1}-${slug(f.id||f.type)}`,'prop',f.description||f.type||'Object',f.width/f.height);
  plan.art={version:1,direction:DEFAULT_DIRECTION,assets,surroundAsset:surround,wallAsset:wall,assignments:{},settings:{materialScale:2,wallWidth:.16,shadows:true,allowPlaceholders:false}};
  plan.version=2;
  return plan;
}

export function usedAssets(plan) {
  const ids=new Set([plan.art.surroundAsset,plan.art.wallAsset,...plan.spaces.map(r=>r.floorAsset),...plan.features.map(f=>f.assetId)]);
  return plan.art.assets.filter(a=>ids.has(a.id));
}

export function validateArt(plan) {
  const art=plan.art;
  if(!art||art.version!==1) throw new Error('Unsupported art manifest; expected art.version 1.');
  if(typeof art.direction!=='string'||!art.direction.trim()) throw new Error('Add shared visual direction.');
  if(!Array.isArray(art.assets)) throw new Error('art.assets must be an array.');
  const assets=new Map();
  for(const a of art.assets) {
    if(typeof a.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(a.id)||Object.hasOwn(Object.prototype,a.id)||a.id==='prototype'||assets.has(a.id)) throw new Error(`Invalid or duplicate art ID: ${a.id}`);
    if(!['material','prop'].includes(a.kind)) throw new Error(`${a.id}: kind must be material or prop.`);
    if(typeof a.description!=='string'||!a.description.trim()||typeof a.requirements!=='string') throw new Error(`${a.id}: description and image requirements are required.`);
    if(!Number.isFinite(a.ratio)||a.ratio<.05||a.ratio>20) throw new Error(`${a.id}: ratio must be between 0.05 and 20.`);
    assets.set(a.id,a);
  }
  const ref=(id,kind,label)=>{if(assets.get(id)?.kind!==kind) throw new Error(`${label}: ${id} must reference a ${kind} asset.`);};
  ref(art.surroundAsset,'material','Surround');ref(art.wallAsset,'material','Walls');
  for(const r of plan.spaces) ref(r.floorAsset,'material',r.id);
  for(const f of plan.features) ref(f.assetId,'prop',f.id);
  if(!art.assignments||typeof art.assignments!=='object'||Array.isArray(art.assignments)) throw new Error('art.assignments must be an object.');
  for(const [id,a] of Object.entries(art.assignments)) {
    if(!assets.has(id)) throw new Error(`Assignment refers to unknown asset ${id}.`);
    if(typeof a.src!=='string'||!a.src.trim()||/^(javascript|data|blob):/i.test(a.src)) throw new Error(`${id}: assign a persistent image path.`);
    if(!['contain','cover'].includes(a.fit)) throw new Error(`${id}: fit must be contain or cover.`);
    const c=a.crop;
    if(!c||!['x','y','width','height'].every(k=>Number.isFinite(c[k]))||c.x<0||c.y<0||c.width<=0||c.height<=0||c.x+c.width>1.000001||c.y+c.height>1.000001) throw new Error(`${id}: crop must be inside the image (0–100%).`);
  }
  const s=art.settings;
  if(!s||!Number.isFinite(s.materialScale)||s.materialScale<.25||s.materialScale>20||!Number.isFinite(s.wallWidth)||s.wallWidth<.05||s.wallWidth>.4||typeof s.shadows!=='boolean'||typeof s.allowPlaceholders!=='boolean') throw new Error('Invalid art settings: material scale 0.25–20 cells; wall width 0.05–0.4 cells; shadows and allowPlaceholders must be booleans.');
  return plan;
}

export function artworkRequests(plan) {
  validateArt(plan);
  return `SCENE ART KIT — ${plan.scene.name}\n${plan.scene.description}\n\nGenerate ALL import slots below as separate individual images/files. Work through every slot sequentially, generating exactly one image per slot, and continue automatically to the next until the full kit is complete. Do not stop after the first asset or ask for confirmation between assets. Preserve each slot's intended proportions and image requirements: materials must be seamless square textures, and props must show exactly one isolated subject with transparency where requested. Multiple images may require several generations and downloads. If an actual generation limit prevents completion, identify the completed and remaining slots so work can resume; do not claim ungenerated assets are complete. Do not make a sprite sheet or a whole map. Geometry, placement, rotation and instance counts are handled by Scene Architect. Generated pixel boundaries need not be exact.\n\nSHARED VISUAL DIRECTION\n${plan.art.direction}\nAll images: true overhead orthographic view; consistent palette and neutral lighting; no grid, labels, text or frame. Do not include permanent floor shadows with props.\n\n${usedAssets(plan).map(a=>`IMPORT SLOT: ${a.id}\nType: ${a.kind}\nSubject: ${a.description}\nIntended width:height: ${a.ratio.toFixed(2)}:1\nRequirements: ${a.requirements}\n${a.kind==='material'?'Tileable material only; no furniture, door leaves or architectural plan. Prefer a square PNG, at least 512px.':'Exactly one isolated subject; transparent PNG preferred, at least 512px on the long side. If transparency is unavailable, say so; an opaque background will remain visible after import.'}\nInstances using this image: ${a.kind==='prop'?plan.features.filter(f=>f.assetId===a.id).length:'surface material (repeated)'}\nSave separately using ${a.id}.png.`).join('\n\n')}`;
}
