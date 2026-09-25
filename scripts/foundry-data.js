const MODULE_ID="scene-architect";
export const LIGHT_PRESET_DATA={
  'steady-lamp':{dim:6,bright:3,color:'#ffb45b',alpha:.5},
  'flickering-lamp':{dim:6,bright:2,color:'#ffb45b',alpha:.55,animation:{type:'flicker',speed:3,intensity:4,reverse:false}},
  flame:{dim:6,bright:3,color:'#ff9b4a',alpha:.55,animation:{type:'torch',speed:3,intensity:4,reverse:false}},
  'magic-portal':{dim:8,bright:3,color:'#954aff',alpha:.6,animation:{type:'rainbowswirl',speed:3,intensity:6,reverse:false}},
  'pulsing-magic':{dim:7,bright:2,color:'#6f8cff',alpha:.55,animation:{type:'pulse',speed:3,intensity:5,reverse:false}},
  'ambient-fill':{dim:8,bright:0,color:'#ffffff',alpha:.35}
};
export const lightAnimationCatalog=()=>globalThis.CONFIG?.Canvas?.lightAnimations??{};
export const lightAnimationKeys=(catalog=lightAnimationCatalog())=>Object.keys(catalog).sort();
export const lightPresetKeys=()=>Object.keys(LIGHT_PRESET_DATA);
export const availableLightPresetKeys=(catalog=lightAnimationCatalog())=>lightPresetKeys().filter(key=>{
  const type=LIGHT_PRESET_DATA[key].animation?.type;
  return !type||Object.prototype.hasOwnProperty.call(catalog,type);
});
export function lightIntentFromPlan(light) {
  const preset=LIGHT_PRESET_DATA[light.preset]??{};
  return {preset,animation:light.animation??preset.animation};
}
export function resolvedLightConfig(light,catalog=lightAnimationCatalog(),spread='medium',{allowPresetAnimationFallback=true}={}) {
  const {preset,animation:configured}=lightIntentFromPlan(light);
  const factor={small:.75,medium:1,large:1.5}[spread];
  if(!factor)throw new Error(`${light.name||'Light'}: spread must be small, medium or large.`);
  let animation=configured?{
    type:configured.type,
    speed:Number(configured.speed),
    intensity:Number(configured.intensity),
    reverse:configured.reverse
  }:{type:"",speed:5,intensity:5,reverse:false};
  if(animation.type&&!Object.prototype.hasOwnProperty.call(catalog,animation.type)) {
    if(light.animation!=null||!allowPresetAnimationFallback)throw new Error(`${light.name||'Light'}: animation "${animation.type}" is not available in this Foundry installation.`);
    animation={type:"",speed:5,intensity:5,reverse:false};
  }
  return {
    dim:Number(light.dim ?? (preset.dim??6)*factor),
    bright:Number(light.bright ?? (preset.bright??3)*factor),
    angle:Number(light.angle ?? 360),
    alpha:Number(light.alpha ?? preset.alpha ?? 0.35),
    color:light.color || preset.color || "#ffb45b",
    attenuation:Number(light.attenuation ?? 0.5),
    luminosity:Number(light.luminosity ?? 0.5),
    saturation:Number(light.saturation ?? 0),
    contrast:Number(light.contrast ?? 0),
    shadows:Number(light.shadows ?? 0),
    animation
  };
}
export function lightDataFromIntent(light,{x,y,spread='medium',sourceId=null,analysisSources=[],change=null,allowPresetAnimationFallback=true}={},catalog=lightAnimationCatalog()) {
  const flags={generated:true,preset:light.preset??'legacy',sourceFeatureId:light.sourceFeatureId??null};
  if(sourceId)flags.sourceId=sourceId;
  if(analysisSources.length)flags.analysisSources=[...analysisSources];
  if(change)flags.analysisChange=change;
  return {
    name:light.name || "Scene Architect Light",
    x:Number(x),
    y:Number(y),
    walls:true,
    vision:false,
    hidden:false,
    config:resolvedLightConfig(light,catalog,spread,{allowPresetAnimationFallback}),
    flags:{[MODULE_ID]:flags}
  };
}
export function wallDataFromSegment(seg, grid) {
  const S=(globalThis.CONST ?? {}).EDGE_SENSE_TYPES ?? {NONE:0,LIMITED:10,NORMAL:20,PROXIMITY:30,DISTANCE:40};
  const M=(globalThis.CONST ?? {}).WALL_MOVEMENT_TYPES ?? {NONE:0,NORMAL:20};
  const D=(globalThis.CONST ?? {}).WALL_DOOR_TYPES ?? {NONE:0,DOOR:1,SECRET:2};
  const DS=(globalThis.CONST ?? {}).WALL_DOOR_STATES ?? {CLOSED:0,OPEN:1,LOCKED:2};
  const c=[seg.a[0]*grid,seg.a[1]*grid,seg.b[0]*grid,seg.b[1]*grid];
  const base={c,door:D.NONE,ds:DS.CLOSED,move:M.NORMAL,light:S.NORMAL,sight:S.NORMAL,sound:S.NORMAL,flags:{[MODULE_ID]:{kind:seg.kind}}};
  switch(seg.kind) {
    case "door": base.door=D.DOOR; break;
    case "secret": base.door=D.SECRET; break;
    case "window":
      base.move=M.NORMAL; base.light=S.PROXIMITY; base.sight=S.PROXIMITY; base.sound=S.PROXIMITY;
      base.threshold={attenuation:true,light:2,sight:2,sound:2};
      break;
    case "terrain": base.light=S.LIMITED; base.sight=S.LIMITED; base.sound=S.LIMITED; break;
    case "invisible": base.light=S.NONE; base.sight=S.NONE; base.sound=S.NONE; break;
    case "ethereal": base.move=M.NONE; base.sound=S.NONE; break;
  }
  return base;
}

export function lightDataFromPlan(l,plan,catalog=lightAnimationCatalog(),options={}) {
  const g=plan.scene.gridSize;
  return lightDataFromIntent(l,{x:Number(l.x)*g,y:Number(l.y)*g,sourceId:options.sourceId??l.sourceId??null},catalog);
}
