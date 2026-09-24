function edgeKey(x1,y1,x2,y2) {
  if (x1>x2 || (x1===x2 && y1>y2)) return `${x2},${y2}|${x1},${y1}`;
  return `${x1},${y1}|${x2},${y2}`;
}

function parseEdgeKey(k) {
  const [a,b]=k.split("|").map(p=>p.split(",").map(Number));
  return {a,b};
}

function addEdge(map, x1,y1,x2,y2, kind="wall") {
  const k=edgeKey(x1,y1,x2,y2);
  const prev=map.get(k);
  if (!prev || prev.kind === "wall") map.set(k,{...parseEdgeKey(k),kind});
}

function compileGeometry(plan) {
  const edges = new Map();

  // Each rectangular space contributes a perimeter. Shared perimeters collapse to one edge.
  for (const r of plan.spaces) {
    const x0=r.x, y0=r.y, x1=r.x+r.width, y1=r.y+r.height;
    for (let x=x0; x<x1; x++) {
      addEdge(edges,x,y0,x+1,y0,"wall");
      addEdge(edges,x,y1,x+1,y1,"wall");
    }
    for (let y=y0; y<y1; y++) {
      addEdge(edges,x0,y,x0,y+1,"wall");
      addEdge(edges,x1,y,x1,y+1,"wall");
    }
  }

  // Explicit barriers can add interior walls/terrain/etc.
  for (const b of plan.barriers) {
    let [x1,y1]=b.a, [x2,y2]=b.b;
    if (x1===x2) {
      const lo=Math.min(y1,y2), hi=Math.max(y1,y2);
      for(let y=lo;y<hi;y++) addEdge(edges,x1,y,x1,y+1,b.kind);
    } else {
      const lo=Math.min(x1,x2), hi=Math.max(x1,x2);
      for(let x=lo;x<hi;x++) addEdge(edges,x,y1,x+1,y1,b.kind);
    }
  }

  // Openings override/remove unit edges.
  for (const o of plan.openings) {
    for(let i=0;i<o.length;i++) {
      const coords = o.orientation === "h"
        ? [o.x+i,o.y,o.x+i+1,o.y]
        : [o.x,o.y+i,o.x,o.y+i+1];
      const k=edgeKey(...coords);
      if (o.kind === "open") edges.delete(k);
      else edges.set(k,{...parseEdgeKey(k),kind:o.kind});
    }
  }

  const units=[...edges.values()];
  const mergeable = new Set(["wall","terrain","invisible","ethereal"]);
  // Each explicit opening is one native door/window, including multi-cell spans.
  const fixed = plan.openings.filter(o=>o.kind!=="open").map(o=>({
    a:[o.x,o.y],b:o.orientation==="h"?[o.x+o.length,o.y]:[o.x,o.y+o.length],kind:o.kind
  }));
  const merged=[];

  for (const kind of mergeable) {
    const hs=units.filter(e=>e.kind===kind && e.a[1]===e.b[1]).sort((u,v)=>u.a[1]-v.a[1]||u.a[0]-v.a[0]);
    const vs=units.filter(e=>e.kind===kind && e.a[0]===e.b[0]).sort((u,v)=>u.a[0]-v.a[0]||u.a[1]-v.a[1]);
    for (const list of [hs,vs]) {
      let cur=null;
      for (const e of list) {
        const horizontal=e.a[1]===e.b[1];
        const contiguous=cur && cur.kind===e.kind && ((horizontal && cur.a[1]===e.a[1] && cur.b[0]===e.a[0]) || (!horizontal && cur.a[0]===e.a[0] && cur.b[1]===e.a[1]));
        if (contiguous) cur.b=[...e.b];
        else { if(cur) merged.push(cur); cur={a:[...e.a],b:[...e.b],kind:e.kind}; }
      }
      if(cur) merged.push(cur);
    }
  }
  return [...merged,...fixed];
}


export { edgeKey, compileGeometry };
