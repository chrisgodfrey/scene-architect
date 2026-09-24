// A single model-analysed sample. These coordinates are visual estimates from
// the original image, not the output of a reusable computer-vision algorithm.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {compileGeometry} from '../../scripts/geometry.js';

const root=path.resolve(import.meta.dirname,'../..');
const out=path.join(root,'test-output/geometry-proof');
const bytes=fs.readFileSync(path.join(out,'source.png'));
const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
assert.equal(width,1355);assert.equal(height,1161);
const fixture=JSON.parse(fs.readFileSync(path.join(root,'fixtures/laboratory.json')));
const readings=[
  ['outer-left',[32,331],[32,984]],
  ['outer-bottom',[32,984],[1321,984]],
  ['outer-right',[1321,984],[1321,331]],
  ['top-left',[32,331],[375,331]],
  ['top-centre-left',[375,331],[532,331]],
  ['top-access-left',[532,331],[639,331]],
  ['access-door',[639,331],[718,331],'secret','plan-informed',true,'Visible threshold; secret-door semantics come from the original plan. Review concealment.'],
  ['top-access-right',[718,331],[824,331]],
  ['top-centre-right',[824,331],[978,331]],
  ['top-right',[978,331],[1321,331]],
  ['access-left',[532,331],[532,44]],
  ['access-top',[532,44],[824,44]],
  ['access-right',[824,44],[824,331]],
  ['left-partition-upper',[375,331],[375,451]],
  ['machinery-door',[375,451],[375,544],'door'],
  ['left-partition-middle',[375,544],[375,650]],
  ['left-partition-medical-upper',[375,650],[375,736]],
  ['medical-passage',[375,736],[375,848],'open','plan-informed',true,'Jamb-like features suggest a passage, but dark stone and pipes obscure the walking surface. Original intent was an open passage; check this in Foundry.'],
  ['left-partition-lower',[375,848],[375,984]],
  ['infirmary-divider',[32,650],[375,650]],
  ['right-partition-upper',[978,331],[978,451]],
  ['constructs-door',[978,451],[978,544],'door'],
  ['right-partition-lower',[978,544],[978,984]]
];
const normalized=readings.map(([id,a,b,kind='wall',evidence='visible',reviewRequired=false,note='Visual estimate; use overlay to verify exact wall placement.'])=>({
  id,a:[a[0]/width,a[1]/height],b:[b[0]/width,b[1]/height],kind,evidence,reviewRequired,note
}));
const geometry={version:1,experimental:true,coordinateSpace:'normalized-image',boundaryConvention:'wall-centre',
  source:{name:'ChatGPT Image Sep 24, 2026, 09_50_34 AM.png',width,height,sha256:crypto.createHash('sha256').update(bytes).digest('hex')},
  provenance:'Model visual analysis of the original PNG in this Codex conversation, with one close-up of the obscured infirmary passage. No API call, image regeneration or automated detector. Original plan supplies semantic context only.',
  walls:normalized.filter(s=>s.kind!=='open'),openings:normalized.filter(s=>s.kind==='open'),
  reviewNotes:['One sample only; no independently measured accuracy or reliability rate.','Alpha.3 has no importer for this experimental schema. Do not paste this into the layout-plan importer.','Review the infirmary passage and northern secret-door classification. No prop collision walls or lighting changes are proposed.']};
for(const s of normalized){assert(s.a.concat(s.b).every(n=>Number.isFinite(n)&&n>=0&&n<=1));assert.notDeepEqual(s.a,s.b);}
assert.equal(new Set(normalized.map(s=>s.id)).size,normalized.length);
assert.equal(geometry.walls.filter(s=>s.kind==='door').length,2);
assert.equal(geometry.openings.length,1);
fs.writeFileSync(path.join(out,'proposed-geometry.json'),JSON.stringify(geometry,null,2));
const original=compileGeometry(fixture).map(s=>({a:[s.a[0]/28,s.a[1]/24],b:[s.b[0]/28,s.b[1]/24],kind:s.kind}));
fs.writeFileSync(path.join(out,'comparison-data.json'),JSON.stringify({width,height,original,proposed:normalized},null,2));
const lines=(segments,old=false)=>segments.map(s=>`<line x1="${s.a[0]*width}" y1="${s.a[1]*height}" x2="${s.b[0]*width}" y2="${s.b[1]*height}" stroke="${old?'#ffe45c':s.reviewRequired?'#ff9d3d':s.kind==='door'?'#ff75d8':'#48f5d0'}" stroke-width="3" ${s.reviewRequired?'stroke-dasharray="9 7"':''}><title>${s.id??s.kind}${s.reviewRequired?' — REVIEW':''}</title></line>`).join('');
const proposedLines=lines(normalized),originalLines=lines(original,true);
fs.writeFileSync(path.join(out,'comparison.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Laboratory wall geometry — one-image feasibility check</title>
<style>body{margin:0;background:#111820;color:#e9eef3;font:16px system-ui}header{padding:20px;max-width:1100px;margin:auto}h1{font-size:24px;margin:0 0 10px}p{line-height:1.5}button{background:#263444;color:white;border:1px solid #71849a;padding:10px 16px;border-radius:6px;margin:4px;cursor:pointer}button[aria-pressed=true]{border-color:#48f5d0;background:#17483f}.map{max-width:1355px;margin:auto}svg{display:block;width:100%;height:auto}.legend{font-size:14px;color:#c6d3df}strong{color:white}</style>
<header><h1>Laboratory: geometry estimated from the finished image</h1><p>Toggle the original planned geometry and the proposed image-derived geometry. The artwork is unchanged. This is one visually analysed sample, not a production importer or an accuracy benchmark.</p>
<nav aria-label="Overlay"><button data-mode="art">Artwork only</button><button data-mode="original">Original plan</button><button data-mode="proposed" aria-pressed="true">Image-derived proposal</button><button data-mode="both">Compare both</button></nav>
<p class="legend">Yellow = original plan · Mint = proposed walls · Pink = ordinary doors · Dashed orange = review required.</p>
<p><strong>Review:</strong> lower-left passage is visually obscured. Northern door is classified as secret from the original intent, not from its appearance. Positions are unsnapped visual estimates along wall centres.</p></header>
<div class="map"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Laboratory artwork with toggleable original and proposed geometry"><image width="${width}" height="${height}" href="data:image/png;base64,${bytes.toString('base64')}"/><g id="original" style="display:none">${originalLines}</g><g id="proposed">${proposedLines}</g></svg></div>
<script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>{const m=b.dataset.mode;document.getElementById('original').style.display=['original','both'].includes(m)?'':'none';document.getElementById('proposed').style.display=['proposed','both'].includes(m)?'':'none';document.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});</script></html>`);
console.log(JSON.stringify({source:[width,height],walls:geometry.walls.length,ordinaryDoors:2,secretDoors:1,reviewItems:2,output:out}));
