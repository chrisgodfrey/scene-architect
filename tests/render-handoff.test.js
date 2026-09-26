import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileSceneIntent } from '../scripts/plan-generator.js';
import { renderHandoffPrompt } from '../scripts/render-handoff.js';

test('one generic handoff includes reference legend, semantics, dressing, facing and exact frame',()=>{
  const intent=JSON.parse(fs.readFileSync(new URL('../fixtures/intents/laboratory.json',import.meta.url)));
  const plan=compileSceneIntent(intent,{columns:40,rows:32,gridSize:70}),before=structuredClone(plan);
  const prompt=renderHandoffPrompt(plan);
  for(const term of ['appearance-layer','2800 x 2240','Amber bands','Cyan','Blue boxes','VISUAL DIRECTION','Instantiator','Soft dressing','faces A1','front follows the arrow','Native lighting positions','Do not paint door leaves','not JSON'])
    assert(prompt.includes(term),term);
  assert.equal((prompt.match(/Iron restraint bed with leather straps/g)||[]).length,3);
  assert(!prompt.includes('never shift architecture by even part'));
  assert(!prompt.includes('geometry-reading follow-up'));
  assert(prompt.includes('Another resolution with the same aspect ratio is acceptable'));
  assert(prompt.includes("Verify the delivered file's actual dimensions"));
  assert.deepEqual(plan,before);
});

test('legacy decal semantics stay in the handoff without becoming compulsory anchor boxes',()=>{
  const plan=JSON.parse(fs.readFileSync(new URL('../fixtures/laboratory.json',import.meta.url)));
  const before=structuredClone(plan),prompt=renderHandoffPrompt(plan);
  for(const f of plan.features)assert(prompt.includes(f.description),f.id);
  assert.deepEqual(plan,before);
});
