import {validateAssetPlan} from './asset-plan.js';
import {compileGeometry} from './geometry.js';
import {makeCanvas,loadImage} from './renderer.js';
import {architectureSettings,segmentRect} from './architecture.js';

export async function renderAssetScene(plan,{imageLoader=loadImage}={}) {
  validateAssetPlan(plan);
  const g=plan.scene.gridSize,spec=plan.assetScene,settings=architectureSettings(plan.rendering);
  const assets=new Map(spec.palette.map(a=>[a.id,a])),images=new Map();
  const used=new Set([spec.surroundAsset,spec.wallAsset,...plan.spaces.map(r=>r.floorAsset),...plan.features.map(f=>f.assetId)]);
  const sources=new Map([...used].map(id=>{const a=assets.get(id);return [a.src,a.pixelWidth*a.pixelHeight];}));
  if([...sources.values()].reduce((a,b)=>a+b,0)>64_000_000)throw new Error('Selected source images exceed the 64-megapixel decode budget. Use smaller assets.');
  for(const id of used) {
    const a=assets.get(id);
    if(!images.has(a.src))images.set(a.src,await imageLoader(a.src));
    const image=images.get(a.src);
    if(image.width!==a.pixelWidth||image.height!==a.pixelHeight)throw new Error(`${a.label}: image dimensions changed. Recalibrate the palette before rendering.`);
  }
  const canvas=makeCanvas(plan.scene.columns*g,plan.scene.rows*g),ctx=canvas.getContext('2d'),patterns=new Map();
  const pattern=id=>{
    if(!patterns.has(id)) {
      const a=assets.get(id),p=ctx.createPattern(images.get(a.src),'repeat');
      if(!p)throw new Error(`Cannot create material pattern: ${a.label}.`);
      p.setTransform(new DOMMatrix().scale(a.width*g/a.pixelWidth,a.height*g/a.pixelHeight));
      patterns.set(id,p);
    }
    return patterns.get(id);
  };
  ctx.fillStyle=pattern(spec.surroundAsset);ctx.fillRect(0,0,canvas.width,canvas.height);
  for(const r of plan.spaces) {ctx.fillStyle=pattern(r.floorAsset);ctx.fillRect(r.x*g,r.y*g,r.width*g,r.height*g);}
  const floor=makeCanvas(canvas.width,canvas.height);floor.getContext('2d').drawImage(canvas,0,0);
  const segments=compileGeometry(plan),wall=assets.get(spec.wallAsset),strip=images.get(wall.src),half=settings.wallWidth*g/2;
  const wallLayer=makeCanvas(canvas.width,canvas.height),wc=wallLayer.getContext('2d');
  for(const edge of segments.filter(e=>['wall','secret','terrain','ethereal'].includes(e.kind))) {
    const length=Math.hypot(edge.b[0]-edge.a[0],edge.b[1]-edge.a[1])*g;
    wc.save();wc.translate(edge.a[0]*g,edge.a[1]*g);wc.rotate(Math.atan2(edge.b[1]-edge.a[1],edge.b[0]-edge.a[0]));
    wc.beginPath();wc.rect(-half,-half,length+2*half,2*half);wc.clip();
    const tileWidth=wall.width*g;
    for(let x=-half;x<length+half;x+=tileWidth) {
      const width=Math.min(tileWidth,length+half-x);
      wc.drawImage(strip,0,0,width/tileWidth*strip.width,strip.height,x,-wall.anchorY*wall.height*g,width,wall.height*g);
    }
    wc.restore();
  }
  // Clear full apertures after every strip, including perpendicular corner caps.
  for(const o of plan.openings.filter(o=>o.kind!=='secret')) {
    const a=[o.x*g,o.y*g],b=o.orientation==='h'?[(o.x+o.length)*g,o.y*g]:[o.x*g,(o.y+o.length)*g];
    const r=segmentRect(a,b,half+1);
    wc.clearRect(r.x,r.y,r.width,r.height);
  }
  ctx.save();ctx.shadowColor='rgba(0,0,0,.3)';ctx.shadowBlur=g*.08;ctx.shadowOffsetY=g*.035;ctx.drawImage(wallLayer,0,0);ctx.restore();
  for(const o of plan.openings.filter(o=>o.kind!=='secret')) {
    const a=[o.x*g,o.y*g],b=o.orientation==='h'?[(o.x+o.length)*g,o.y*g]:[o.x*g,(o.y+o.length)*g];
    const r=segmentRect(a,b,half+1);ctx.drawImage(floor,r.x,r.y,r.width,r.height,r.x,r.y,r.width,r.height);
    if(o.kind==='door'||o.kind==='window') {
      const sill=segmentRect(a,b,Math.max(1,g*.035));
      ctx.fillStyle=o.kind==='window'?'#9bbac1':'#a8977055';ctx.fillRect(sill.x,sill.y,sill.width,sill.height);
    }
  }
  for(const f of [...plan.features].sort((a,b)=>(a.layer==='decal'?0:1)-(b.layer==='decal'?0:1))) {
    const a=assets.get(f.assetId);
    ctx.save();ctx.translate((f.x+f.width/2)*g,(f.y+f.height/2)*g);ctx.rotate(f.rotation*Math.PI/180);
    ctx.drawImage(images.get(a.src),-f.width*g/2,-f.height*g/2,f.width*g,f.height*g);ctx.restore();
  }
  return {canvas,wallLayer,mapping:{sourceWidth:canvas.width,sourceHeight:canvas.height,width:canvas.width,height:canvas.height,scaleX:1,scaleY:1,x:0,y:0}};
}
