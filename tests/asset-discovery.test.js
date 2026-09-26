import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue, normalizeAssetPath } from '../scripts/asset-catalogue.js';
import { selectAssetCandidates, prepareAssetPalette } from '../scripts/asset-discovery.js';
import { validatePalette } from '../scripts/asset-plan.js';

const CORE = ['Wooden_Flooring_Walnut.jpg', 'Wall_Stone_Straight_Path.webp'];
const brief = 'A coastal lighthouse with a study.';
const abort = error => error.name === 'AbortError';

async function catalogue(names, root = 'arbitrary/library') {
  return buildCatalogue(root, {
    browse: async () => ({ files: names.map(name => `${root}/${name}`), dirs: [] })
  });
}

function loader(overrides = {}, calls = []) {
  return async (src, options) => {
    calls.push({ src, ...options });
    const name = decodeURIComponent(src.slice(src.lastIndexOf('/') + 1));
    if (overrides[name] instanceof Error) throw overrides[name];
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (/Wall/i.test(name)) return { width: 800, height: 100 };
    const hint = /_(\d+)x(\d+)\./i.exec(name);
    if (hint) return { width: Number(hint[1]) * 200, height: Number(hint[2]) * 200 };
    return { width: 400, height: 400 };
  };
}

function assertPalette(palette) {
  assert(palette.length >= 2 && palette.length <= 64);
  assert(palette.some(entry => entry.kind === 'material'));
  assert(palette.some(entry => entry.kind === 'wall'));
  assert(palette.reduce((sum, entry) => sum + entry.pixelWidth * entry.pixelHeight, 0) <= 64_000_000);
  for (const entry of palette) {
    assert(entry.pixelWidth * entry.pixelHeight <= 40_000_000);
    assert(entry.width >= .05 && entry.width <= 100);
    assert(entry.height >= .05 && entry.height <= 100);
    assert(Math.abs(entry.width / entry.height / (entry.pixelWidth / entry.pixelHeight) - 1) < 1e-10);
    if (!entry.confirmed) {
      assert.equal(entry.calibration.source, 'automatic');
      assert(['filename', 'library-density'].includes(entry.calibration.method));
      assert(Number.isFinite(entry.calibration.pixelsPerCell) && entry.calibration.pixelsPerCell > 0);
      assert(Math.abs(entry.width * entry.calibration.pixelsPerCell - entry.pixelWidth) < 1e-6);
    }
  }
}

test('selection is provider neutral, deterministic, nonmutating and role-aware', async () => {
  const input = await catalogue([
    ...CORE, 'Lamp_Metal_Brass_A_1x1.webp', 'Rowboat_Wood_A_1x4.webp', 'Desk_Oak_A_2x1.png'
  ], 'another-provider/unusual nesting');
  const original = structuredClone(input);
  const selected = selectAssetCandidates(input, brief);
  const shuffled = { ...input, entries: [...input.entries].reverse() };
  assert.deepEqual(selectAssetCandidates(shuffled, brief), selected);
  assert.deepEqual(input, original);
  assert.equal(selected.length, 5);
  assert.equal(selected[0].kind, 'material');
  assert.equal(selected[1].kind, 'wall');
  assert.equal(selected.find(entry => entry.src.includes('Rowboat')).kind, 'prop');
  assert(selected.every(entry => entry.src.startsWith('another-provider/unusual%20nesting/')));
});

test('oversubscribed lighthouse and bedroom briefs retrieve different useful families without variant floods', async () => {
  const variants = [];
  for (let index = 0; index < 80; index++) {
    for (const noun of ['Lamp', 'Rowboat', 'Bed', 'Wardrobe', 'Rope', 'Pillow', 'Telescope', 'Dresser']) {
      variants.push(`${noun}_Metal_Red_Variant_${index}_1x1.webp`);
    }
  }
  const input = await catalogue([...CORE, ...variants, 'Stone_Floor_Texture.jpg', 'Wall_Wood_Straight_Path.png']);
  const lighthouse = selectAssetCandidates(input, 'A windswept coastal lighthouse.', { limit: 9 });
  const bedroom = selectAssetCandidates(input, 'A comfortable bedroom.', { limit: 9 });
  for (const result of [lighthouse, bedroom]) {
    assert.equal(result.length, 9);
    assert(result.some(entry => entry.kind === 'material'));
    assert(result.some(entry => entry.kind === 'wall'));
    assert.equal(new Set(result.map(entry => entry.family)).size, result.length);
  }
  assert(lighthouse.some(entry => entry.src.includes('Rowboat')));
  assert(lighthouse.some(entry => entry.src.includes('Telescope')));
  assert(bedroom.some(entry => entry.src.includes('Bed_')));
  assert(bedroom.some(entry => entry.src.includes('Wardrobe_') || entry.src.includes('Dresser_')));
  assert.notDeepEqual(lighthouse.map(entry => entry.id), bedroom.map(entry => entry.id));
  const seaProps = lighthouse.filter(entry => entry.kind === 'prop').map(entry => entry.label).join(' ');
  const bedProps = bedroom.filter(entry => entry.kind === 'prop').map(entry => entry.label).join(' ');
  assert(seaProps.indexOf('Rowboat') < seaProps.indexOf('Bed') || !seaProps.includes('Bed'));
  assert(bedProps.indexOf('Bed') < bedProps.indexOf('Rowboat') || !bedProps.includes('Rowboat'));
  const seaPalette = await prepareAssetPalette(input, 'A windswept coastal lighthouse.', { limit: 9, imageLoader: loader() });
  const bedPalette = await prepareAssetPalette(input, 'A comfortable bedroom.', { limit: 9, imageLoader: loader() });
  assertPalette(seaPalette.palette);
  assertPalette(bedPalette.palette);
  assert.equal(seaPalette.palette.length, 9);
  assert.equal(bedPalette.palette.length, 9);
  assert(seaPalette.palette.some(entry => entry.src.includes('Rowboat')));
  assert(bedPalette.palette.some(entry => entry.src.includes('Bed_')));
  assert.notDeepEqual(seaPalette.palette.map(entry => entry.id), bedPalette.palette.map(entry => entry.id));
});

test('study semantics and arbitrary folder layouts classify generic names without provider IDs', async () => {
  const input = await catalogue([
    'surfaces/textures/stone/A.jpg', 'architecture/walls/straight/B.png',
    'furniture/bookshelves/C_2x1.webp', 'decor/lamps/D_1x1.webp',
    'boats/rowboats/E_1x4.webp', 'plants/F_1x1.webp'
  ]);
  const selected = selectAssetCandidates(input, 'A quiet reading study and library.', { limit: 4 });
  assert.equal(selected[0].kind, 'material');
  assert.equal(selected[1].kind, 'wall');
  assert(selected.some(entry => entry.src.includes('bookshelves')));
  assert(selected.some(entry => entry.src.includes('lamps')));
  const prepared = await prepareAssetPalette(input, 'A quiet reading study.', {
    limit: 4,
    imageLoader: async src => src.includes('/straight/') ? { width: 600, height: 100 } : { width: 200, height: 100 }
  });
  assertPalette(prepared.palette);
});

test('floor breaks are not materials; ladders and wall hangings are props; maps and tokens are excluded', async () => {
  const input = await catalogue([
    ...CORE, 'Floor_Break_Path_Wood_A.webp', 'Floor_Damage_Stone.png',
    'Ladder_Metal_Gray_Wall_1x3.webp', 'Painting_Wall_1x2.webp', 'Wall_Hanging_Banner_1x2.webp',
    'Wall_Stone_Corner.png', 'maps/Bedroom_20x20.jpg', 'tokens/Lamp_1x1.png',
    'Portrait_Lamp_1x1.webp', 'thumbnails/Stone_Floor.jpg'
  ]);
  const selected = selectAssetCandidates(input, brief);
  for (const name of ['Ladder', 'Painting', 'Hanging']) assert.equal(selected.find(entry => entry.src.includes(name)).kind, 'prop');
  assert(!selected.some(entry => /Break|Damage|Corner|maps|tokens|Portrait|thumbnails/.test(entry.src)));
  const result = await prepareAssetPalette(input, brief, { imageLoader: loader() });
  assertPalette(result.palette);
  assert(result.skipped.some(entry => entry.code === 'floor-overlay'));
  assert(result.skipped.some(entry => entry.code === 'excluded-category'));
  assert(result.skipped.some(entry => entry.code === 'wall-shape'));
});

test('semantic child folders, camel-case filenames and explicit rock textures classify without layout assumptions', async () => {
  const input = await catalogue([
    'Rock_Texture.jpg', 'StoneWallStraight.png', 'walls/ladders/A_1x3.webp', 'walls/paintings/B_1x1.webp'
  ]);
  const selected = selectAssetCandidates(input, brief);
  assert.equal(selected.find(entry => entry.src.includes('Rock_Texture')).kind, 'material');
  assert.equal(selected.find(entry => entry.src.includes('StoneWallStraight')).kind, 'wall');
  assert(selected.filter(entry => entry.src.includes('/walls/')).every(entry => entry.kind === 'prop'));
  const relocated = await catalogue(['Lamp_1x1.webp', ...CORE], 'tokens');
  assert.equal(selectAssetCandidates(relocated, brief).length, 3);
});

test('configured map-library, token-assets and texture-library roots never supply category or relevance signals', async () => {
  const names = [
    ...CORE, 'Lamp_Brass_1x1.webp', 'Bed_Wood_2x3.webp', 'furniture/A_1x1.webp', 'opaque_1x1.webp',
    'Maps/Bedroom_20x20.jpg', 'Tokens/Lamp_1x1.webp', 'Portraits/Painting_1x2.webp',
    'Floor_Break_Path_Wood.webp', 'Ladder_Metal_Gray_Wall_1x3.webp', 'Map_Lamp_1x1.webp'
  ];
  const roots = ['assets/library', 'assets/map-library', 'provider/token-assets', 'assets/texture-library',
    'Maps/Tokens/Portraits/texture-library', 'bedroom/study/map-library'];
  const queries = ['A coastal lighthouse.', 'A comfortable bedroom.'];
  const expectedCandidates = new Map();
  let expectedPalette, expectedSkipped;
  for (const root of roots) {
    const input = await catalogue(names, root);
    const relativeEntry = ({ id, src, ...metadata }) => ({ src: src.slice(input.root.length + 1), ...metadata });
    for (const query of queries) {
      const selected = selectAssetCandidates(input, query).map(relativeEntry);
      if (!expectedCandidates.has(query)) expectedCandidates.set(query, selected);
      assert.deepEqual(selected, expectedCandidates.get(query), `${root}: ${query}`);
      assert(!selected.some(entry => /Maps\/|Tokens\/|Portraits\/|Floor_Break|Map_Lamp|opaque/.test(entry.src)));
      assert.equal(selected.find(entry => entry.src.includes('Ladder')).kind, 'prop');
    }
    const prepared = await prepareAssetPalette(input, brief, { imageLoader: loader() });
    assertPalette(prepared.palette);
    const palette = prepared.palette.map(relativeEntry), skipped = prepared.skipped.map(relativeEntry);
    expectedPalette ??= palette;
    expectedSkipped ??= skipped;
    assert.deepEqual(palette, expectedPalette, root);
    assert.deepEqual(skipped, expectedSkipped, root);
    assert.equal(prepared.skipped.filter(entry => entry.code === 'excluded-category').length, 4);
    assert(prepared.skipped.some(entry => entry.code === 'unknown-role' && entry.src.includes('opaque')));
    assert(prepared.skipped.some(entry => entry.code === 'floor-overlay'));
  }
});

test('empty and opaque libraries and missing core roles return actionable errors, never placeholders', async () => {
  const empty = await catalogue([]);
  assert.throws(() => selectAssetCandidates(empty, brief), /empty.*Connect/);
  await assert.rejects(prepareAssetPalette(empty, brief, { imageLoader: loader() }), /empty.*Connect/);
  for (const names of [['a123.webp', 'b456.jpg'], ['Chair_1x1.webp'], ['Stone_Floor_Texture.jpg'], ['Wall_Stone_Straight.png']]) {
    const input = await catalogue(names);
    assert.throws(() => selectAssetCandidates(input, brief), error => {
      assert.equal(error.code, 'MISSING_CORE_ROLES');
      assert.match(error.message, /Connect or refresh/);
      return true;
    });
  }
});

test('prepare uses actual pixels and sampled prop density for unsized textures and walls', async () => {
  const input = await catalogue([...CORE, 'Lamp_Brass_1x1.webp', 'Rowboat_Wood_1x4.webp']);
  const calls = [], progress = [];
  const result = await prepareAssetPalette(input, brief, { imageLoader: loader({}, calls), onProgress: value => progress.push(value) });
  assertPalette(result.palette);
  assert.equal(result.summary.pixelsPerCell, 200);
  assert.equal(result.summary.densitySamples, 2);
  assert.equal(result.summary.fallbackDensity, false);
  assert(result.palette.every(entry => entry.confirmed === false));
  const floor = result.palette.find(entry => entry.kind === 'material');
  const wall = result.palette.find(entry => entry.kind === 'wall');
  const boat = result.palette.find(entry => entry.src.includes('Rowboat'));
  assert.deepEqual([floor.width, floor.height], [2, 2]);
  assert.deepEqual([wall.width, wall.height], [4, .5]);
  assert.deepEqual([boat.width, boat.height], [1, 4]);
  assert.equal(floor.calibration.method, 'library-density');
  assert.equal(boat.calibration.method, 'filename');
  assert.equal(progress.at(-1).done, true);
  assert(calls.every(call => call.maxPixels > 0 && call.maxPixels <= 40_000_000));
});

test('density samples are family-diverse and mismatching filename aspect never stretches images', async () => {
  const input = await catalogue([
    ...CORE, 'Lamp_Red_1x1.webp', 'Lamp_Blue_1x1.webp', 'Lamp_Green_1x1.webp',
    'Rowboat_1x4.webp', 'Desk_2x1.webp', 'Chair_1x1.webp'
  ]);
  const result = await prepareAssetPalette(input, brief, {
    imageLoader: loader({
      'Lamp_Red_1x1.webp': { width: 100, height: 100 }, 'Lamp_Blue_1x1.webp': { width: 100, height: 100 },
      'Lamp_Green_1x1.webp': { width: 100, height: 100 }, 'Desk_2x1.webp': { width: 600, height: 300 },
      'Chair_1x1.webp': { width: 600, height: 300 }
    })
  });
  assertPalette(result.palette);
  assert.equal(result.summary.densitySamples, 3);
  assert.equal(result.summary.pixelsPerCell, 200);
  const chair = result.palette.find(entry => entry.src.includes('Chair'));
  assert.deepEqual([chair.width, chair.height], [1, .5]);
  assert.equal(chair.calibration.method, 'filename');
  assert(result.summary.warnings.some(warning => warning.includes('disagree')));
});

test('automatic fallback density is explicit and scale clamping preserves full-frame aspect', async () => {
  const input = await catalogue([...CORE, 'Desk.png']);
  const result = await prepareAssetPalette(input, brief, {
    imageLoader: loader({ 'Desk.png': { width: 20000, height: 1000 } })
  });
  assertPalette(result.palette);
  assert.equal(result.summary.fallbackDensity, true);
  assert.equal(result.summary.pixelsPerCell, 100);
  assert(result.summary.warnings.some(warning => warning.includes('fallback of 100')));
  assert(result.summary.warnings.some(warning => warning.includes('bounded')));
  const desk = result.palette.find(entry => entry.kind === 'prop');
  assert.deepEqual([desk.width, desk.height], [100, 5]);
  assert.equal(desk.calibration.pixelsPerCell, 200);
});

test('only matching, valid human-reviewed metadata can remain confirmed', async () => {
  const input = await catalogue([...CORE, 'Lamp_Brass_1x1.webp']);
  const lamp = input.entries.find(entry => entry.src.includes('Lamp'));
  const reviewed = {
    ...lamp, kind: 'prop', width: 2, height: 2, pixelWidth: 200, pixelHeight: 200, anchorY: .3, confirmed: true
  };
  const result = await prepareAssetPalette(input, brief, { known: [reviewed], imageLoader: loader() });
  const reused = result.palette.find(entry => entry.id === lamp.id);
  assert.equal(reused.confirmed, true);
  assert.equal(reused.width, 2);
  assert.equal(reused.anchorY, .3);
  assert.equal(reused.calibration, undefined);
  assert.equal(result.summary.reviewed, 1);
  const changed = await prepareAssetPalette(input, brief, {
    known: [reviewed], imageLoader: loader({ 'Lamp_Brass_1x1.webp': { width: 400, height: 200 } })
  });
  assert.equal(changed.palette.find(entry => entry.id === lamp.id).confirmed, false);
  assert(changed.summary.warnings.some(warning => warning.includes('no longer matches')));
  for (const patch of [{ confirmed: false }, { width: 0 }, { height: 1 }, { anchorY: 2 }]) {
    const inferred = await prepareAssetPalette(input, brief, { known: [{ ...reviewed, ...patch }], imageLoader: loader() });
    assert.equal(inferred.palette.find(entry => entry.id === lamp.id).confirmed, false);
  }
});

test('reviewed source metadata can identify opaque files but never introduce outside-catalogue assets', async () => {
  const input = await catalogue(['a.png', 'b.png', 'c.png']);
  const known = input.entries.map((entry, index) => ({
    ...entry, kind: ['material', 'wall', 'prop'][index], width: index === 1 ? 8 : 2, height: 1,
    pixelWidth: index === 1 ? 800 : 200, pixelHeight: 100, anchorY: .5, confirmed: true
  }));
  known.push({ ...known[0], src: 'other/not-in-catalogue.png', id: 'outside' });
  const result = await prepareAssetPalette(input, brief, {
    known, imageLoader: async src => ({ width: src.endsWith('/b.png') ? 800 : 200, height: 100 })
  });
  assert.equal(result.palette.length, 3);
  assert(result.palette.every(entry => entry.confirmed));
  assert(!result.palette.some(entry => entry.id === 'outside'));
  await assert.rejects(prepareAssetPalette(input, brief, {
    known, imageLoader: async () => ({ width: 400, height: 100 })
  }), error => error.code === 'MISSING_CORE_ROLES' && error.skipped.some(entry => entry.code === 'stale-reviewed-metadata'));
});

test('decoded wall aspect is verified and alternate variants recover without placeholders', async () => {
  const input = await catalogue(['Wooden_Flooring_Walnut.jpg', 'Wall_Stone_A_Straight_Path.webp', 'Wall_Stone_B_Straight_Path.webp']);
  const result = await prepareAssetPalette(input, brief, {
    imageLoader: loader({ 'Wall_Stone_A_Straight_Path.webp': { width: 100, height: 800 } })
  });
  assert.equal(result.palette.find(entry => entry.kind === 'wall').src.endsWith('Wall_Stone_B_Straight_Path.webp'), true);
  assert(result.skipped.some(entry => entry.code === 'not-horizontal-wall'));
  await assert.rejects(prepareAssetPalette(await catalogue(CORE), brief, {
    imageLoader: loader({ 'Wall_Stone_Straight_Path.webp': { width: 500, height: 500 } })
  }), error => error.code === 'MISSING_CORE_ROLES' && error.skipped.some(entry => entry.code === 'not-horizontal-wall'));
  const reviewedInput = await catalogue([...CORE, 'Lamp_1x1.png']);
  const lamp = reviewedInput.entries.find(entry => entry.src.includes('Lamp'));
  const stale = { ...lamp, kind: 'material', pixelWidth: 200, pixelHeight: 200, width: 1, height: 1, anchorY: .5, confirmed: true };
  const restored = await prepareAssetPalette(reviewedInput, brief, {
    known: [stale], imageLoader: loader({ 'Lamp_1x1.png': { width: 400, height: 400 } })
  });
  assert.equal(restored.palette.find(entry => entry.id === lamp.id).kind, 'prop');
  assert.equal(restored.palette.find(entry => entry.id === lamp.id).confirmed, false);
});

test('unsupported files, decoder failures and malformed dimensions produce explicit skip reasons', async () => {
  const input = await catalogue([...CORE, 'Chair_1x1.webp', 'Desk_2x1.webp', 'Boat_1x4.webp', 'Lamp_1x1.webp']);
  input.entries.push({ id: 'unsupported', src: `${input.root}/Lamp.gif`, label: 'Lamp GIF' });
  const result = await prepareAssetPalette(input, brief, {
    imageLoader: loader({
      'Chair_1x1.webp': new Error('Missing image'), 'Desk_2x1.webp': null,
      'Boat_1x4.webp': { width: 0, height: 4 }, 'Lamp_1x1.webp': { width: 1.5, height: 2 }
    })
  });
  assertPalette(result.palette);
  assert.equal(result.palette.length, 2);
  assert(result.skipped.some(entry => entry.reason.includes('Missing image')));
  assert.equal(result.skipped.filter(entry => entry.code === 'invalid-dimensions').length, 3);
  assert(result.skipped.some(entry => entry.code === 'unsupported-image'));
});

test('per-source and total pixel budgets reject excessive inputs and bound the palette', async () => {
  const input = await catalogue([...CORE, 'Chair_1x1.webp', 'Desk_2x1.webp']);
  const result = await prepareAssetPalette(input, brief, {
    imageLoader: loader({ 'Chair_1x1.webp': { width: 7000, height: 7000 }, 'Desk_2x1.webp': { width: 40001, height: 1 } })
  });
  assertPalette(result.palette);
  assert(result.skipped.some(entry => entry.code === 'source-pixel-limit'));
  assert(result.skipped.some(entry => entry.code === 'invalid-dimensions'));
  const calls = [];
  const limited = await prepareAssetPalette(input, brief, {
    imageLoader: loader({
      'Wooden_Flooring_Walnut.jpg': { width: 6000, height: 6000 },
      'Wall_Stone_Straight_Path.webp': { width: 10000, height: 1000 },
      'Desk_2x1.webp': { width: 5000, height: 4000 }, 'Chair_1x1.webp': { width: 5000, height: 4000 }
    }, calls)
  });
  assertPalette(limited.palette);
  assert.equal(limited.palette.length, 2);
  assert(limited.skipped.some(entry => entry.code === 'total-pixel-budget'));
  assert(limited.summary.warnings.some(warning => warning.includes('64-megapixel')));
  assert.equal(calls.at(-1).maxPixels, 18_000_000);
});

test('extreme aspects are skipped; native pixel dimensions win over presentation dimensions', async () => {
  const input = await catalogue([...CORE, 'Chair_1x1.webp', 'Lamp_1x1.webp']);
  const result = await prepareAssetPalette(input, brief, {
    imageLoader: loader({
      'Chair_1x1.webp': { width: 40000, height: 1 },
      'Lamp_1x1.webp': { width: 100, height: 100, naturalWidth: 400, naturalHeight: 200 }
    })
  });
  assertPalette(result.palette);
  assert(result.skipped.some(entry => entry.code === 'unusable-aspect'));
  const lamp = result.palette.find(entry => entry.src.includes('Lamp'));
  assert.deepEqual([lamp.pixelWidth, lamp.pixelHeight], [400, 200]);
});

test('unsafe source paths, duplicate identities, malformed options and inputs never reach imageLoader', async () => {
  const input = await catalogue(CORE);
  for (const src of ['https://evil.test/a.png', '../a.png', 'arbitrary/library/%252e%252e/a.png', '/a.png', 'outside/a.png']) {
    const corrupt = structuredClone(input);
    corrupt.entries[0].src = src;
    let calls = 0;
    await assert.rejects(prepareAssetPalette(corrupt, brief, { imageLoader: async () => { calls++; } }));
    assert.equal(calls, 0);
  }
  for (const mutate of [
    value => { value.entries[1].id = value.entries[0].id; },
    value => { value.entries[1].src = value.entries[0].src; },
    value => { value.entries[0].id = '__proto__'; },
    value => { value.entries[0].width = 0; value.entries[0].height = 1; },
    value => { value.entries[0].label = ''; },
    value => { value.version = 2; }
  ]) {
    const corrupt = structuredClone(input);
    mutate(corrupt);
    assert.throws(() => selectAssetCandidates(corrupt, brief));
  }
  for (const limit of [-1, 0, 1, 2.5, Infinity, '5']) assert.throws(() => selectAssetCandidates(input, brief, { limit }), /limit/);
  for (const value of ['', '  ', null, 'a'.repeat(10001)]) assert.throws(() => selectAssetCandidates(input, value), /brief/);
  await assert.rejects(prepareAssetPalette(input, brief), /imageLoader/);
  await assert.rejects(prepareAssetPalette(input, brief, { imageLoader: loader(), onProgress: null }), /onProgress/);
  await assert.rejects(prepareAssetPalette(input, brief, { imageLoader: loader(), signal: {} }), /AbortSignal/);
  assert.throws(() => selectAssetCandidates(input, brief, { known: {} }), /known/);
  assert.throws(() => selectAssetCandidates(input, brief, { known: [{ src: 'https://evil.test/a.png' }] }));
});

test('default final count is bounded at 36 and all decode paths are bounded at 64 attempts', async () => {
  const nouns = 'lamp rowboat bed wardrobe rope pillow telescope dresser desk chair bookshelf barrel crate chest sack basket ladder painting mirror curtain rug fireplace stove cauldron kettle pot pan plate cup bottle food anvil hammer sword shield cage machine altar statue fountain urn vase plant tree wagon wheel hay trough tent'.split(' ');
  const input = await catalogue([...CORE, ...nouns.map(noun => `${noun}_1x1.webp`)]);
  const calls = [], result = await prepareAssetPalette(input, 'A complex building.', { imageLoader: loader({}, calls) });
  assert.equal(result.palette.length, 36);
  assert.equal(calls.length, 36);
  assertPalette(result.palette);
  const variants = await catalogue([...CORE, ...Array.from({ length: 100 }, (_, index) => `Chair_${index}_1x1.webp`)]);
  const failedCalls = [];
  const failed = await prepareAssetPalette(variants, brief, {
    limit: 1000, imageLoader: async src => {
      failedCalls.push(src);
      if (src.includes('Chair')) throw new Error('Cannot decode chair');
      return loader()(src);
    }
  });
  assert(failedCalls.length <= 64);
  assert(failed.palette.length <= 64);
  assert.equal(new Set(failedCalls).size, failedCalls.length);
  const large = await catalogue([
    ...CORE,
    ...nouns.flatMap(noun => Array.from({ length: 6 }, (_, index) => `${noun}_variant_${index}_1x1.webp`))
  ]);
  let attempts = 0;
  const capped = await prepareAssetPalette(large, brief, {
    imageLoader: async src => {
      attempts++;
      if (!src.includes('Flooring') && !src.includes('Wall_')) throw new Error('Unavailable source');
      return loader()(src);
    }
  });
  assert.equal(attempts, 64);
  assert.equal(capped.summary.decoded, 64);
  assert(capped.summary.warnings.some(warning => warning.includes('64-image')));
});

test('cancellation is prompt before/during decoding and never returns partial success', async () => {
  const input = await catalogue(CORE), before = new AbortController();
  before.abort();
  let calls = 0;
  await assert.rejects(prepareAssetPalette(input, brief, {
    signal: before.signal, imageLoader: async () => { calls++; }
  }), abort);
  assert.equal(calls, 0);
  const during = new AbortController();
  const pending = prepareAssetPalette(input, brief, {
    signal: during.signal, imageLoader: () => new Promise(() => {})
  });
  setTimeout(() => during.abort(), 0);
  await assert.rejects(pending, abort);
  const progressAbort = new AbortController();
  await assert.rejects(prepareAssetPalette(input, brief, {
    signal: progressAbort.signal, imageLoader: loader(),
    onProgress: value => { if (value.decoded === 1) progressAbort.abort(); }
  }), abort);
  const misclassified = await catalogue([
    'Wooden_Flooring_Walnut.jpg',
    ...['Stone', 'Wood', 'Metal', 'Brick'].flatMap(material => Array.from({ length: 8 }, (_, index) => `Wall_${material}_${index}_Straight_Path.png`))
  ]);
  const invalidAbort = new AbortController();
  const invalid = prepareAssetPalette(misclassified, brief, {
    signal: invalidAbort.signal, imageLoader: async () => ({ width: 200, height: 200 })
  });
  setTimeout(() => invalidAbort.abort(), 0);
  await assert.rejects(invalid, abort);
});

test('decoded image resources are closed, including late completion after cancellation', async () => {
  const input = await catalogue(CORE), closed = [];
  await prepareAssetPalette(input, brief, {
    imageLoader: async src => ({ width: src.includes('Wall') ? 800 : 200, height: 100, close: () => closed.push(src) })
  });
  assert.equal(closed.length, 2);
  const controller = new AbortController();
  let finish;
  const promise = prepareAssetPalette(input, brief, {
    signal: controller.signal, imageLoader: () => new Promise(resolve => { finish = resolve; })
  });
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await assert.rejects(promise, abort);
  let lateClosed = false;
  finish({ width: 100, height: 100, close() { lateClosed = true; } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(lateClosed, true);
});

test('skipped reporting remains bounded and discloses omitted details without hiding counts', async () => {
  const input = await catalogue([...CORE, ...Array.from({ length: 250 }, (_, index) => `opaque_${index}.png`)]);
  const result = await prepareAssetPalette(input, brief, { imageLoader: loader() });
  assert.equal(result.skipped.length, 200);
  assert.equal(result.summary.skipped, 250);
  assert.equal(result.summary.skippedOmitted, 50);
  assert.equal(result.summary.skippedReasons['unknown-role'], 250);
});

test('encoded Unicode and space paths are normalized once and passed unchanged to the loader', async () => {
  const input = await catalogue([...CORE, 'Desk_石 café_2x1.webp'], 'library with spaces');
  const calls = [], result = await prepareAssetPalette(input, brief, { imageLoader: loader({}, calls) });
  assertPalette(result.palette);
  for (const entry of result.palette) assert.equal(entry.src, normalizeAssetPath(entry.src));
  assert(calls.some(call => call.src.includes('%E7%9F%B3%20caf%C3%A9')));
});

test('shared filename and folder tokens retain independent roles, relevance and reviewed overrides', async () => {
  const input = await catalogue([
    'textures/wood/A_1x1.webp', 'walls/straight/A_1x1.webp',
    'props/lamps/A_1x1.webp', 'props/lamps/B_1x1.webp',
    'props/bed/A_1x1.webp', 'props/bed/B_1x1.webp'
  ]);
  const cold = selectAssetCandidates(input, 'A coastal lighthouse.', { limit: 3 });
  assert.deepEqual(cold.map(entry => entry.kind), ['material', 'wall', 'prop']);
  assert(cold[2].src.includes('/lamps/'));
  const bedroom = selectAssetCandidates(input, 'A bedroom.', { limit: 3 });
  assert(bedroom[2].src.includes('/bed/'));
  assert.deepEqual(selectAssetCandidates(input, 'A coastal lighthouse.', { limit: 3 }), cold);
  const known = {
    ...input.entries.find(entry => entry.src.includes('/bed/A_')),
    kind: 'material', width: 1, height: 1, pixelWidth: 200, pixelHeight: 200, anchorY: .5, confirmed: true
  };
  const changed = selectAssetCandidates(input, 'A bedroom.', { known: [known] });
  assert.equal(changed.find(entry => entry.src === known.src).kind, 'material');
  assert.equal(changed.find(entry => entry.src.includes('/bed/B_')).kind, 'prop');
  assert.equal(selectAssetCandidates(input, 'A bedroom.').find(entry => entry.src === known.src).kind, 'prop');
  const rebuilt = { ...input, entries: [...input.entries].reverse() };
  assert.deepEqual(selectAssetCandidates(rebuilt, 'A coastal lighthouse.', { limit: 3 }), cold);
});

test('bounded ranked streaming still validates every source before decoding', async () => {
  const input = await catalogue([...CORE, ...Array.from({ length: 1000 }, (_, index) => `Lamp_${index}_1x1.webp`)]);
  input.entries.push({ id: 'unsafe-last', src: 'https://example.invalid/image.png', label: 'Late unsafe source' });
  let calls = 0;
  await assert.rejects(prepareAssetPalette(input, brief, {
    limit: 2, imageLoader: async () => { calls++; return { width: 800, height: 100 }; }
  }), /unsafe relative path/);
  assert.equal(calls, 0);
});

test('classification reuse preserves query variants and ordered object semantics', async () => {
  const input = await catalogue([
    ...CORE, 'Lamp_Red_1x1.webp', 'Lamp_Blue_1x1.webp', 'Anvil_Hammer_1x1.webp', 'Hammer_Anvil_1x1.webp'
  ]);
  const red = selectAssetCandidates(input, 'A red lamp.', { limit: 3 });
  const blue = selectAssetCandidates(input, 'A blue lamp.', { limit: 3 });
  assert(red[2].src.includes('Lamp_Red'));
  assert(blue[2].src.includes('Lamp_Blue'));
  const all = selectAssetCandidates(input, 'A workshop.');
  assert.equal(all.find(entry => entry.src.includes('Anvil_Hammer')).family, 'prop:anvil');
  assert.equal(all.find(entry => entry.src.includes('Hammer_Anvil')).family, 'prop:hammer');
});

test('cold asynchronous preparation yields and shares its completed index with synchronous selection', async () => {
  const input = await catalogue([...CORE, ...Array.from({ length: 5000 }, (_, index) => `Lamp_${index}_1x1.webp`)]);
  let timerRan = false;
  const timer = setTimeout(() => { timerRan = true; }, 0);
  const result = await prepareAssetPalette(input, brief, {
    imageLoader: async src => {
      assert.equal(timerRan, true, 'cold metadata indexing must yield before image decoding');
      return loader()(src);
    }
  });
  clearTimeout(timer);
  assertPalette(result.palette);
  assert.deepEqual(result.palette.map(entry => entry.id), selectAssetCandidates(input, brief).map(entry => entry.id));
});

test('cold index cancellation or catalogue replacement never publishes a partial cache or decodes images', async () => {
  for (const replace of [false, true]) {
    const input = await catalogue([...CORE, ...Array.from({ length: 5000 }, (_, index) => `Lamp_${index}_1x1.webp`)]);
    const controller = new AbortController();
    let calls = 0;
    const timer = setTimeout(() => {
      if (replace) input.entries = [...input.entries];
      else controller.abort();
    }, 0);
    const pending = prepareAssetPalette(input, brief, {
      signal: controller.signal, imageLoader: async () => { calls++; return { width: 800, height: 100 }; }
    });
    await assert.rejects(pending, replace ? /Catalogue changed during preparation/ : abort);
    clearTimeout(timer);
    assert.equal(calls, 0);
    const selected = selectAssetCandidates(input, brief);
    assert(selected.some(entry => entry.kind === 'material'));
    assert(selected.some(entry => entry.kind === 'wall'));
  }
});

test('oversubscribed structural variants cannot displace actual straight strips from core recovery', async () => {
  const names = ['Wooden_Flooring_Walnut.jpg'];
  for (const material of ['Stone', 'Wood', 'Metal', 'Adobe']) {
    for (const shape of ['Connector', 'Connection', 'Ending', 'End', 'Endcap', 'Broken', 'Rubble']) {
      for (let variant = 0; variant < 24; variant++) {
        names.push(`structures/walls/Wall_${material}_Brass_Lighthouse_Warm_Wooden_${shape}_${variant}_1x1.webp`);
      }
    }
    for (let variant = 0; variant < 12; variant++) names.push(`structures/walls/Wall_${material}_Brass_Lighthouse_Wooden_A_${variant}_1x1.webp`);
    names.push(`structures/walls/Wall_${material}_Straight_Path.webp`);
  }
  names.push('Floor_Decoration_Metal_Brass_A_1x1.webp', 'Floor_Inlay_Stone_1x1.webp',
    'Ladder_Metal_Gray_Wall_1x3.webp', 'Painting_Wall_1x2.webp',
    ...'Lamp Rowboat Bed Wardrobe Rope Pillow Telescope Dresser Desk Chair Bookshelf Barrel Crate Chest Sack Basket Mirror Curtain Rug Fireplace Stove Cauldron Kettle Pot Pan Plate Cup Bottle Food Anvil Hammer Sword Shield Cage Machine Altar Statue Fountain Urn Vase Plant Tree Wagon Wheel Hay Trough Tent'.split(' ').map(noun => `${noun}_1x1.webp`));
  const input = await catalogue(names, 'provider/map-library');
  const queries = [
    'A coastal lighthouse keeper lodge with a bedroom, workshop, wooden floors and warm lamps',
    'A comfortable bedroom with wardrobes, warm lamps and wooden floors'
  ];
  for (const query of queries) {
    const calls = [];
    const result = await prepareAssetPalette(input, query, { imageLoader: async src => {
      calls.push(src);
      if (/\/Wall_/.test(src)) {
        assert(src.includes('Straight_Path'), 'generic square/connector variants must not displace explicit strips');
        return { width: 1200, height: 200 };
      }
      return loader()(src);
    } });
    assert.equal(result.palette.length, 36);
    assert(calls.length <= 64);
    assertPalette(result.palette);
    assert.doesNotThrow(() => validatePalette(result.palette));
    assert(result.palette.every(entry => entry.confirmed === false));
    assert(result.palette.filter(entry => entry.kind === 'wall').every(entry => entry.src.includes('Straight_Path')));
    assert(!result.palette.some(entry => /Floor_(Decoration|Inlay)/.test(entry.src)));
    assert(result.summary.skippedReasons['wall-shape'] >= 4 * 7 * 24);
  }
});

test('explicit wall strips recover within 64 attempts after a higher-ranked strip fails its real dimensions', async () => {
  const input = await catalogue([
    'Wooden_Flooring_Walnut.jpg', 'Wall_Stone_Lighthouse_Straight_Path.webp',
    'Wall_Stone_Straight_Path.webp', 'Ladder_Metal_Wall_End_1x3.webp', 'Painting_Wall_Corner_1x1.webp'
  ]);
  const calls = [];
  const result = await prepareAssetPalette(input, 'A lighthouse.', {
    imageLoader: loader({ 'Wall_Stone_Lighthouse_Straight_Path.webp': { width: 200, height: 200 } }, calls)
  });
  assertPalette(result.palette);
  assert.doesNotThrow(() => validatePalette(result.palette));
  assert(result.skipped.some(entry => entry.code === 'not-horizontal-wall'));
  assert(calls.length <= 64);
  assert.equal(result.palette.find(entry => entry.src.includes('Ladder')).kind, 'prop');
  assert.equal(result.palette.find(entry => entry.src.includes('Painting')).kind, 'prop');
});

test('runtime core failures survive metadata skip limits and stop before decoding unrelated furnishings', async () => {
  const input = await catalogue([
    ...CORE, ...Array.from({ length: 500 }, (_, index) => `aaa-opaque-${index}.png`),
    ...'Chair Desk Lamp Boat Bed Wardrobe'.split(' ').map(noun => `${noun}_1x1.webp`)
  ]);
  const calls = [];
  await assert.rejects(prepareAssetPalette(input, brief, {
    imageLoader: loader({ 'Wall_Stone_Straight_Path.webp': { width: 200, height: 200 } }, calls)
  }), error => {
    assert.equal(error.code, 'MISSING_CORE_ROLES');
    assert.equal(error.skipped.length, 200);
    assert.equal(error.skipped[0].code, 'not-horizontal-wall');
    assert.equal(error.summary.skippedReasons['unknown-role'], 500);
    return true;
  });
  assert.equal(calls.length, 2);
});
