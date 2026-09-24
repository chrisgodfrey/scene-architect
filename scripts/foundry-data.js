const MODULE_ID="scene-architect";
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

export function lightDataFromPlan(l, plan) {
  const g=plan.scene.gridSize;
  return {
    name:l.name || "Scene Architect Light",
    x:Number(l.x)*g,
    y:Number(l.y)*g,
    walls:true,
    vision:false,
    hidden:false,
    config:{
      dim:Number(l.dim ?? 6),
      bright:Number(l.bright ?? 3),
      angle:Number(l.angle ?? 360),
      alpha:Number(l.alpha ?? 0.35),
      color:l.color || "#ffb45b",
      attenuation:Number(l.attenuation ?? 0.5),
      luminosity:Number(l.luminosity ?? 0.5),
      saturation:Number(l.saturation ?? 0),
      contrast:Number(l.contrast ?? 0),
      shadows:Number(l.shadows ?? 0),
      animation:l.animation ? {type:l.animation,speed:2,intensity:2,reverse:false} : {type:"",speed:5,intensity:5,reverse:false}
    },
    flags:{[MODULE_ID]:{generated:true}}
  };
}

