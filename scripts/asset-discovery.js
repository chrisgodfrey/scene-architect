import { normalizeAssetPath, yieldWork } from './asset-catalogue.js';

const MAX_CANDIDATES = 64;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_TOTAL_PIXELS = 64_000_000;
const MAX_SKIPPED_DETAILS = 200;
const FALLBACK_DENSITY = 100;
const ROLES = ['material', 'wall', 'prop'];
const IMAGE_EXTENSION = /\.(png|jpe?g|webp)$/i;
const indexCache = new WeakMap();
const words = text => text.normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const IRREGULAR_PLURALS = new Map([['shelves', 'shelf'], ['bookshelves', 'bookshelf'], ['knives', 'knife'], ['leaves', 'leaf']]);
const singular = word => (IRREGULAR_PLURALS.get(word)
  ?? (word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
const terms = text => words(text).map(singular);
const wordSet = text => new Set(terms(text));
const intersects = (set, values) => values.some(value => set.has(value));
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const basename = src => decodeURIComponent(src.slice(src.lastIndexOf('/') + 1)).replace(IMAGE_EXTENSION, '');
const withinRoot = (src, root) => !root || src.startsWith(`${root}/`);
const validNumber = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const validPixels = value => Number.isInteger(value) && value >= 1 && value <= 40000;
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)
  && !Object.hasOwn(Object.prototype, value) && value !== 'prototype';
const compareRank = (a, b) => b.score - a.score || lexical(a.src, b.src) || lexical(a.id, b.id);
// Apply strip evidence only within a family; retain brief relevance between roles.
const compareFamilyRank = (a, b) => (b.wallEvidence ?? 0) - (a.wallEvidence ?? 0) || compareRank(a, b);

const EXCLUDED = wordSet('map maps battlemap battlemaps token tokens portrait portraits avatar handout preview thumbnail overview spritesheet tileset');
const FLOOR_OVERLAYS = wordSet('break broken damage crack hole gap edge transition border inlay decoration overlay');
const WALL_SHAPES = wordSet('corner curved curve round diagonal junction intersection archway arch circular connector connection ending end endcap cap broken rubble ruined damage damaged');
const PROPS = terms(`lamp lantern torch candle sconce chandelier beacon telescope lens
  rowboat boat ship canoe raft oar paddle anchor buoy rope coil net fishing barrel crate chest sack basket
  bed bunk cot pillow blanket wardrobe dresser nightstand bedside mattress cushion sofa couch armchair
  desk table chair stool bench bookshelf bookcase shelf cabinet cupboard book scroll quill ink paper globe lectern
  ladder stair staircase steps painting tapestry banner hanging mirror curtain window door gate rug carpet
  fireplace hearth stove oven cauldron kettle pot pan plate bowl cup mug bottle flask food bread fruit
  anvil forge furnace workbench tool hammer saw weapon sword spear shield armor rack chain cage machine
  altar statue pedestal fountain well urn vase plant flower tree bush rock boulder stalagmite crystal
  wagon cart wheel saddle hay trough saddlebag fence pillar column bedroll tent campfire firewood log
  bath bathtub toilet basin sink screen partition cushion instrument piano organ harp drum coffin tomb sarcophagus`);
const PROP_SET = new Set(PROPS);
const PROP_CONTEXT = wordSet('prop props object objects furniture furnishing furnishings clutter equipment decor decorations');
const MATERIAL_WORDS = wordSet('floor flooring texture textures seamless material materials terrain ground grass sand dirt gravel cobblestone paving');
const MATERIAL_FAMILIES = [
  ['wood', terms('wood wooden walnut oak pine timber plank parquet bamboo')],
  ['stone', terms('stone marble granite slate flagstone cobblestone cobble rock brick tile tiled paving concrete')],
  ['sand', terms('sand sandy beach')],
  ['earth', terms('dirt earth mud soil gravel')],
  ['grass', terms('grass moss meadow turf foliage')],
  ['snow', terms('snow ice frozen')],
  ['metal', terms('metal iron steel brass copper bronze')],
  ['water', terms('water ocean sea river liquid')]
];
const PROP_FAMILIES = [
  ['light', terms('lamp lantern torch candle sconce chandelier beacon')],
  ['boat', terms('rowboat boat ship canoe raft')],
  ['bed', terms('bed bunk cot mattress bedroll')],
  ['seat', terms('chair stool bench armchair sofa couch')],
  ['bookshelf', terms('bookshelf bookcase shelf')],
  ['storage', terms('wardrobe dresser cabinet cupboard nightstand bedside')],
  ['table', terms('desk table workbench')],
  ['rug', terms('rug carpet')],
  ['stairs', terms('stair staircase steps ladder')],
  ['hanging', terms('painting tapestry banner hanging curtain')],
  ['rope', terms('rope coil net')],
  ['rock', terms('rock boulder stalagmite')]
];
const THEMES = [
  [terms('lighthouse beacon coastal coast nautical harbor harbour seashore seaside maritime ocean sea beach fishing pirate dock port'),
    terms('beacon lantern lamp lens telescope brass rope coil net anchor buoy boat rowboat canoe oar barrel crate stone rock weathered sand ladder stair')],
  [terms('bedroom bedchamber sleeping sleep dormitory inn guestroom'),
    terms('bed bunk cot pillow blanket wardrobe dresser nightstand bedside mattress rug carpet mirror curtain candle lamp cushion')],
  [terms('study library scholar office observatory wizard reading'),
    terms('desk bookshelf bookcase book shelf chair scroll quill ink paper globe lectern telescope lamp rug')],
  [terms('kitchen cooking bakery pantry'),
    terms('stove oven cauldron kettle pot pan plate bowl cup mug food bread barrel shelf table')],
  [terms('tavern pub dining restaurant feast'),
    terms('table chair stool bench barrel bottle mug cup fireplace hearth food candle')],
  [terms('workshop smith forge factory laboratory alchemy'),
    terms('anvil forge furnace workbench tool hammer saw machine cauldron flask bottle metal chain')],
  [terms('dungeon prison crypt tomb castle fortress'),
    terms('stone brick wall torch chain cage chest coffin tomb sarcophagus pillar gate weapon')],
  [terms('temple church shrine chapel ritual'),
    terms('altar statue pedestal pillar candle banner urn organ bench')],
  [terms('forest woodland garden grove outdoor wilderness'),
    terms('tree bush plant flower grass moss log rock campfire tent bedroll')],
  [terms('cave cavern underground mine'),
    terms('rock boulder stalagmite crystal dirt torch cart pickaxe')],
  [terms('stable farm barn'),
    terms('hay trough saddle wagon cart sack barrel fence wood')]
];
const CLASSIFICATION_WORDS = new Set([
  ...EXCLUDED, ...FLOOR_OVERLAYS, ...WALL_SHAPES, ...PROP_SET, ...PROP_CONTEXT, ...MATERIAL_WORDS,
  ...MATERIAL_FAMILIES.flatMap(([, names]) => names), ...PROP_FAMILIES.flatMap(([, names]) => names),
  'wall', 'straight', 'strip', 'horizontal', 'path', 'segment', 'texture', 'material', 'seamless'
]);

function fail(message, code = 'INVALID_INPUT', details) {
  const error = new Error(`Asset discovery: ${message}`);
  error.code = code;
  if (details) Object.assign(error, details);
  throw error;
}

function abortError() {
  const error = new Error('Asset preparation cancelled.');
  error.name = 'AbortError';
  return error;
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) fail(`${label} contains a dangerous key.`);
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail(`${label} cannot contain accessors.`);
  }
}

function validateLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 2) fail('limit must be an integer of at least 2, reserving a material and wall.');
  return Math.min(limit, MAX_CANDIDATES);
}

function validateBrief(brief) {
  if (typeof brief !== 'string' || !brief.trim() || brief.length > 10000) fail('Describe the scene in a brief of 1–10000 characters.');
}

function hintFor(entry) {
  if (entry.width !== undefined || entry.height !== undefined) {
    if (!(Number.isFinite(entry.width) && entry.width > 0 && Number.isFinite(entry.height) && entry.height > 0)) {
      fail(`${entry.src}: filename footprint hints must be a pair of positive numbers.`);
    }
    return { width: entry.width, height: entry.height };
  }
  const match = /_(\d+)x(\d+)$/i.exec(basename(entry.src));
  if (!match) return null;
  const width = Number(match[1]), height = Number(match[2]);
  return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0 ? { width, height } : null;
}

function materialFamily(tokens) {
  return MATERIAL_FAMILIES.find(([, names]) => intersects(tokens, names))?.[0] ?? 'other';
}

function classify(name, folders, all) {
  if (intersects(all, [...EXCLUDED])) return { code: 'excluded-category', reason: 'Maps, tokens, portraits and preview sheets are not scene furnishing assets.' };
  if (intersects(all, ['floor', 'flooring']) && intersects(all, [...FLOOR_OVERLAYS])) {
    return { code: 'floor-overlay', reason: 'Floor breaks, borders, damage and decorative inlays are not repeating floor materials.' };
  }
  const namedProps = [...name].filter(token => PROP_SET.has(token));
  const contextProps = [...folders].filter(token => PROP_SET.has(token));
  if (intersects(name, ['texture', 'seamless', 'flooring']) && namedProps.every(token => ['rock', 'tree', 'plant', 'log'].includes(token))) {
    return { kind: 'material', family: `material:${materialFamily(all)}` };
  }
  // Named objects take precedence over a generic "Wall" folder or suffix.
  if (namedProps.length) {
    const family = PROP_FAMILIES.find(([, names]) => intersects(name, names))?.[0] ?? namedProps[0];
    return { kind: 'prop', family: `prop:${family}` };
  }
  if (contextProps.length && !intersects(name, ['wall', 'floor', 'flooring', 'texture', 'material', 'seamless'])) {
    const family = PROP_FAMILIES.find(([, names]) => intersects(folders, names))?.[0] ?? contextProps[0];
    return { kind: 'prop', family: `prop:${family}` };
  }
  const wall = all.has('wall');
  if (wall && intersects(all, [...WALL_SHAPES])) {
    return { code: 'wall-shape', reason: 'Connectors, endings, broken, curved, corner and junction walls are not straight horizontal strips.' };
  }
  if (wall && (intersects(all, ['straight', 'strip', 'horizontal', 'path', 'segment'])
    || !intersects(all, ['texture', 'material', 'seamless']))) {
    const wallEvidence = intersects(all, ['strip', 'horizontal']) || all.has('straight') && all.has('path')
      ? 2 : all.has('straight') ? 1 : 0;
    return { kind: 'wall', family: `wall:${materialFamily(all)}`, wallEvidence };
  }
  if (intersects(all, [...MATERIAL_WORDS])) return { kind: 'material', family: `material:${materialFamily(all)}` };
  if (contextProps.length || intersects(all, [...PROP_CONTEXT])) {
    const family = PROP_FAMILIES.find(([, names]) => intersects(folders, names))?.[0] ?? contextProps[0] ?? 'other';
    return { kind: 'prop', family: `prop:${family}` };
  }
  return { code: 'unknown-role', reason: 'No recognizable floor texture, straight wall or furnishing semantics in this filename or its folders.' };
}

function indexState(catalogue) {
  plainObject(catalogue, 'Catalogue');
  if (catalogue.version !== 1 || !Array.isArray(catalogue.entries)) fail('Expected a version 1 catalogue with entries.');
  const root = normalizeAssetPath(catalogue.root);
  const cached = indexCache.get(catalogue);
  return {
    root, entries: catalogue.entries, length: catalogue.entries.length,
    rows: cached?.entries === catalogue.entries && cached.length === catalogue.entries.length && cached.root === root ? cached.rows : null
  };
}

function* indexRows(entries, root) {
  const ids = new Set(), paths = new Set(), folderTokens = new Map(), nameTokens = new Map(), vocabulary = new Map();
  const semanticKeys = new WeakMap(), classifications = new Map();
  const semanticKey = tokens => {
    let result = semanticKeys.get(tokens);
    if (result !== undefined) return result;
    result = [...tokens].filter(token => CLASSIFICATION_WORDS.has(token)).join(' ');
    semanticKeys.set(tokens, result);
    return result;
  };
  const sharedTokens = (text, cache, decode = false) => {
    let result = cache.get(text);
    if (result) return result;
    result = new Set(terms(decode ? decodeURIComponent(text) : text).map(token => {
      const existing = vocabulary.get(token);
      if (existing !== undefined) return existing;
      vocabulary.set(token, token);
      return token;
    }));
    cache.set(text, result);
    return result;
  };
  for (const raw of entries) {
    plainObject(raw, 'Catalogue entry');
    if (!safeId(raw.id) || ids.has(raw.id)) fail('Catalogue entries need unique safe IDs.');
    ids.add(raw.id);
    const normalized = normalizeAssetPath(raw.src);
    const src = normalized === raw.src ? raw.src : normalized;
    if (!src || src === root || !withinRoot(src, root)) fail(`Source path is outside the catalogue root: ${src}`);
    if (paths.has(src)) fail(`Duplicate source path: ${src}`);
    paths.add(src);
    if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 500) fail(`${src}: labels must contain 1–500 characters.`);
    const entry = { id: raw.id, src, label: raw.label };
    if (raw.width !== undefined) entry.width = raw.width;
    if (raw.height !== undefined) entry.height = raw.height;
    const hint = hintFor(entry);
    const name = sharedTokens(basename(src), nameTokens);
    // The configured root identifies storage, not the categories of its assets.
    const relative = root ? src.slice(root.length + 1) : src;
    const folders = sharedTokens(relative.slice(0, Math.max(0, relative.lastIndexOf('/'))), folderTokens, true);
    let role;
    if (IMAGE_EXTENSION.test(src)) {
      const key = `${semanticKey(name)}/${semanticKey(folders)}`;
      role = classifications.get(key);
      if (!role) {
        // Non-semantic variants share classification, not their query tokens.
        role = classify(name, folders, { has: token => name.has(token) || folders.has(token) });
        classifications.set(key, role);
      }
    } else role = { code: 'unsupported-image', reason: 'Only PNG, JPG, JPEG and WebP source images are supported.' };
    yield { ...entry, hint, name, folders, ...role };
  }
}

function catalogueIndex(catalogue) {
  const state = indexState(catalogue);
  if (state.rows) return state.rows;
  const rows = [...indexRows(state.entries, state.root)];
  // Catalogue snapshots are immutable; replacing entries invalidates the index.
  indexCache.set(catalogue, { ...state, rows });
  return rows;
}

async function prepareIndex(catalogue, signal) {
  const state = indexState(catalogue);
  if (state.rows) return;
  const rows = [];
  for (const row of indexRows(state.entries, state.root)) {
    rows.push(row);
    if (rows.length % 2048 === 0) {
      await yieldWork();
      checkAbort(signal);
      if (catalogue.entries !== state.entries || catalogue.entries.length !== state.length || normalizeAssetPath(catalogue.root) !== state.root) {
        fail('Catalogue changed during preparation; retry with the current catalogue.');
      }
    }
  }
  checkAbort(signal);
  indexCache.set(catalogue, { ...state, rows });
}

function reviewedMetadata(value) {
  return value.confirmed === true && ROLES.includes(value.kind)
    && validPixels(value.pixelWidth) && validPixels(value.pixelHeight)
    && value.pixelWidth * value.pixelHeight <= MAX_SOURCE_PIXELS
    && validNumber(value.width, .05, 100) && validNumber(value.height, .05, 100)
    && Math.abs(value.width / value.height / (value.pixelWidth / value.pixelHeight) - 1) <= .002
    && validNumber(value.anchorY, 0, 1);
}

function knownSources(known) {
  if (!Array.isArray(known)) fail('known must be an array of saved palette entries.');
  const result = new Map();
  for (const value of known) {
    plainObject(value, 'Known palette entry');
    const src = normalizeAssetPath(value.src);
    if (!src) fail('Known palette sources cannot be empty.');
    if (result.has(src)) fail(`Duplicate known source: ${src}`);
    result.set(src, value);
  }
  return result;
}

function skipCollector() {
  const skipped = [], counts = {};
  const metadataCodes = new Set(['excluded-category', 'floor-overlay', 'wall-shape', 'unknown-role', 'unsupported-image']);
  const compareDetails = (a, b) => Number(metadataCodes.has(a.code)) - Number(metadataCodes.has(b.code))
    || lexical(a.src, b.src);
  let count = 0;
  return {
    add(entry, code, reason) {
      count++;
      counts[code] = (counts[code] ?? 0) + 1;
      const detail = { id: entry.id, src: entry.src, label: entry.label, code, reason };
      let low = 0, high = skipped.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (compareDetails(detail, skipped[middle]) < 0) high = middle;
        else low = middle + 1;
      }
      if (low < MAX_SKIPPED_DETAILS) {
        skipped.splice(low, 0, detail);
        if (skipped.length > MAX_SKIPPED_DETAILS) skipped.pop();
      }
    },
    details: () => skipped.slice(),
    summary: () => ({ skipped: count, skippedOmitted: count - skipped.length, skippedReasons: { ...counts } })
  };
}

function relevance(brief) {
  const direct = wordSet(brief), expanded = new Set();
  for (const [triggers, expansion] of THEMES) if (intersects(direct, triggers)) for (const word of expansion) expanded.add(word);
  return row => {
    let score = row.hint ? 1 : 0;
    for (const word of direct) {
      if (row.name.has(word)) score += 15;
      else if (row.folders.has(word)) score += 5;
    }
    for (const word of expanded) {
      if (row.name.has(word)) score += 7;
      else if (row.folders.has(word)) score += 2;
    }
    return score;
  };
}

function missingRoles(rows) {
  return ['material', 'wall'].filter(kind => !rows.some(row => row.kind === kind));
}

function requireCore(rows, collector, afterDecode = false) {
  const missing = missingRoles(rows);
  if (!missing.length) return;
  const labels = missing.map(kind => kind === 'material' ? 'floor material' : 'horizontal wall strip').join(' and ');
  fail(`No usable ${labels}${afterDecode ? ' after image checks' : ''}. Connect or refresh a library containing named floor textures and straight wall strips.`,
    'MISSING_CORE_ROLES', { skipped: collector.details(), summary: { ...collector.summary(), missingRoles: missing } });
}

function* rankedRows(catalogue, brief, known, collector) {
  validateBrief(brief);
  const saved = knownSources(known), score = relevance(brief), rows = catalogueIndex(catalogue);
  if (!rows.length) fail('The asset library is empty. Connect a populated image folder and refresh its catalogue.', 'EMPTY_LIBRARY');
  const roles = new Set();
  for (const original of rows) {
    const reviewed = saved.get(original.src);
    let row = original;
    if (reviewedMetadata(reviewed ?? {}) && (!row.code || row.code === 'unknown-role')) {
      const family = row.kind === reviewed.kind ? row.family : `${reviewed.kind}:reviewed`;
      row = { ...row, kind: reviewed.kind, family, code: undefined, reason: undefined };
    }
    if (row.code) { collector.add(row, row.code, row.reason); continue; }
    roles.add(row.kind);
    yield { ...row, reviewed, inferred: original, score: score(row) };
  }
  requireCore([...roles].map(kind => ({ kind })), collector);
}

// Keep only a bounded number per family before sorting. Variant floods therefore
// cannot crowd out other object families or force an all-library query sort.
function groupedCandidates(rows, variantLimit) {
  const families = new Map();
  for (const row of rows) {
    let family = families.get(row.family);
    if (!family) { family = []; families.set(row.family, family); }
    let index = family.findIndex(previous => compareFamilyRank(row, previous) < 0);
    if (index < 0) index = family.length;
    if (index < variantLimit) {
      family.splice(index, 0, row);
      if (family.length > variantLimit) family.pop();
    }
  }
  return families;
}

function shortlistFamilies(families, limit, variantLimit) {
  const selected = [], used = new Set();
  const add = row => { if (row && !used.has(row.src) && selected.length < limit) { selected.push(row); used.add(row.src); } };
  const first = [...families.values()].map(family => family[0]).sort(compareRank);
  add(first.find(row => row.kind === 'material'));
  add(first.find(row => row.kind === 'wall'));
  for (let round = 0; round < variantLimit && selected.length < limit; round++) {
    const batch = [...families.values()].map(family => family[round]).filter(Boolean).sort(compareRank);
    for (const row of batch) add(row);
  }
  return selected;
}

function shortlist(rows, limit, variantLimit = 2) {
  return shortlistFamilies(groupedCandidates(rows, variantLimit), limit, variantLimit);
}

function publicCandidate(row) {
  const candidate = { id: row.id, src: row.src, label: row.label, kind: row.kind, family: row.family };
  if (row.hint) { candidate.width = row.hint.width; candidate.height = row.hint.height; }
  return candidate;
}

function preparationCandidates(rows) {
  const families = groupedCandidates(rows, 8);
  const primary = shortlistFamilies(families, MAX_CANDIDATES, 8);
  const recovery = ['material', 'wall'].flatMap(kind => shortlistFamilies(
    new Map([...families].filter(([, family]) => family[0].kind === kind)), kind === 'wall' ? 8 : 4, 4));
  const result = [], used = new Set();
  for (const row of [...primary.slice(0, MAX_CANDIDATES - recovery.length), ...recovery, ...primary]) {
    if (!used.has(row.src) && result.length < MAX_CANDIDATES) {
      result.push(row);
      used.add(row.src);
    }
  }
  return result;
}

/** Synchronous metadata shortlist; async preparation yields while warming a cold index. */
export function selectAssetCandidates(catalogue, brief, { known = [], limit = 36 } = {}) {
  limit = validateLimit(limit);
  const collector = skipCollector();
  return shortlist(rankedRows(catalogue, brief, known, collector), limit).map(publicCandidate);
}

function closeImage(image) {
  if (typeof image?.close === 'function') image.close();
}

async function decode(src, imageLoader, signal, maxPixels) {
  checkAbort(signal);
  let listener;
  const work = Promise.resolve().then(() => {
    checkAbort(signal);
    return imageLoader(src, { signal, maxPixels });
  }).then(image => {
    if (signal?.aborted) { closeImage(image); throw abortError(); }
    return image;
  });
  try {
    return signal ? await Promise.race([work, new Promise((resolve, reject) => {
      listener = () => reject(abortError());
      signal.addEventListener('abort', listener, { once: true });
      if (signal.aborted) listener();
    })]) : await work;
  } finally {
    if (listener) signal.removeEventListener('abort', listener);
  }
}

function dimensions(image) {
  const width = image?.naturalWidth ?? image?.width, height = image?.naturalHeight ?? image?.height;
  if (!validPixels(width) || !validPixels(height)) fail('Decoded image dimensions must be positive integers up to 40000 pixels.', 'INVALID_DIMENSIONS');
  if (width * height > MAX_SOURCE_PIXELS) fail('Source exceeds the 40-megapixel image limit.', 'SOURCE_PIXEL_LIMIT');
  return { pixelWidth: width, pixelHeight: height };
}

function densitySample(row) {
  if (row.reuse) return row.pixelWidth / row.reviewed.width;
  if (row.kind !== 'prop' || !row.hint) return null;
  const x = row.pixelWidth / row.hint.width, y = row.pixelHeight / row.hint.height;
  // Disagreeing filename aspect is not a reliable library-resolution sample.
  return Math.abs(x / y - 1) <= .2 ? Math.sqrt(x * y) : null;
}

function inferEntry(row, density, warnings) {
  const { id, src, label, kind, pixelWidth, pixelHeight } = row;
  if (row.reuse) {
    const { width, height, anchorY } = row.reviewed;
    return { id, src, label, kind, width, height, pixelWidth, pixelHeight, anchorY, confirmed: true };
  }
  let pixelsPerCell = row.hint ? Math.max(pixelWidth / row.hint.width, pixelHeight / row.hint.height) : density;
  const minimumDensity = Math.max(pixelWidth, pixelHeight) / 100;
  const maximumDensity = Math.min(pixelWidth, pixelHeight) / .05;
  if (minimumDensity > maximumDensity) fail('Full-frame aspect cannot fit the 0.05–100 cell size limits.', 'UNUSABLE_ASPECT');
  const boundedDensity = Math.max(minimumDensity, Math.min(maximumDensity, pixelsPerCell));
  if (boundedDensity !== pixelsPerCell) warnings.add('Some automatic scales were bounded to 0.05–100 cells while preserving full-frame aspect.');
  pixelsPerCell = boundedDensity;
  if (row.hint && Math.abs(row.hint.width / row.hint.height / (pixelWidth / pixelHeight) - 1) > .002) {
    warnings.add('Some filename footprints disagree with decoded aspect; full-frame images were fitted inside the hinted footprint without distortion.');
  }
  return {
    id, src, label, kind,
    width: Math.max(.05, Math.min(100, pixelWidth / pixelsPerCell)),
    height: Math.max(.05, Math.min(100, pixelHeight / pixelsPerCell)),
    pixelWidth, pixelHeight, anchorY: .5, confirmed: false,
    calibration: { source: 'automatic', method: row.hint ? 'filename' : 'library-density', pixelsPerCell }
  };
}

/**
 * imageLoader(src,{signal,maxPixels}) returns a decoded image with width/height
 * (or naturalWidth/naturalHeight), optionally close(). A header-aware loader can
 * enforce maxPixels before allocating; returned dimensions are always rechecked.
 * No raster is retained. Skipped details cap at 200; summary retains total counts.
 */
export async function prepareAssetPalette(catalogue, brief, {
  known = [], limit = 36, imageLoader, signal, onProgress = () => {}
} = {}) {
  checkAbort(signal);
  limit = validateLimit(limit);
  if (typeof imageLoader !== 'function') fail('An imageLoader is required to verify library image dimensions.');
  if (typeof onProgress !== 'function') fail('onProgress must be a function.');
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean'
    || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) fail('signal must be an AbortSignal.');
  validateBrief(brief);
  knownSources(known);
  await prepareIndex(catalogue, signal);
  checkAbort(signal);
  const collector = skipCollector(), warnings = new Set();
  const ranked = rankedRows(catalogue, brief, known, collector);
  // Additional variants are recovery candidates, not permission to flood the palette.
  const candidates = preparationCandidates(ranked), pending = [...candidates], decoded = [];
  let attempts = 0, consumedPixels = 0, budgetLimited = false;
  const progress = (src, done = false) => {
    onProgress({
      phase: 'prepare', count: attempts, decoded: attempts, total: candidates.length,
      ready: decoded.length, skipped: collector.summary().skipped, path: src, done
    });
    checkAbort(signal);
  };
  progress();
  while (pending.length) {
    checkAbort(signal);
    if (shortlist(decoded, limit).length >= limit && !missingRoles(decoded).length) break;
    if (consumedPixels >= MAX_TOTAL_PIXELS) { budgetLimited = true; break; }
    const missing = missingRoles(decoded);
    const needed = missing.length ? pending.findIndex(row => row.kind === missing[0]) : 0;
    if (needed < 0) requireCore(decoded, collector, true);
    const candidate = pending.splice(Math.max(0, needed), 1)[0];
    let image;
    attempts++;
    try {
      image = await decode(candidate.src, imageLoader, signal, Math.min(MAX_SOURCE_PIXELS, MAX_TOTAL_PIXELS - consumedPixels));
      checkAbort(signal);
      const measured = dimensions(image), pixels = measured.pixelWidth * measured.pixelHeight;
      if (consumedPixels + pixels > MAX_TOTAL_PIXELS) {
        collector.add(candidate, 'total-pixel-budget', 'This source would exceed the 64-megapixel preparation budget.');
        budgetLimited = true;
        break;
      }
      consumedPixels += pixels;
      const reuse = reviewedMetadata(candidate.reviewed ?? {}) && candidate.reviewed.pixelWidth === measured.pixelWidth
        && candidate.reviewed.pixelHeight === measured.pixelHeight;
      if (candidate.reviewed?.confirmed === true && !reuse) {
        warnings.add('Some saved reviewed metadata no longer matches decoded dimensions; its scale was inferred again without human confirmation.');
        if (candidate.inferred.code) {
          collector.add(candidate, 'stale-reviewed-metadata', 'Saved reviewed dimensions changed and the current filename has no independently recognizable role.');
          continue;
        }
      }
      const kind = reuse ? candidate.kind : candidate.inferred.kind;
      const family = reuse ? candidate.family : candidate.inferred.family;
      if (kind === 'wall' && measured.pixelWidth / measured.pixelHeight < 2) {
        collector.add(candidate, 'not-horizontal-wall', 'Decoded wall is not a horizontal strip (at least 2:1 width to height).');
        continue;
      }
      if (Math.max(measured.pixelWidth, measured.pixelHeight) / Math.min(measured.pixelWidth, measured.pixelHeight) > 2000) {
        collector.add(candidate, 'unusable-aspect', 'Full-frame aspect cannot fit the 0.05–100 cell size limits.');
        continue;
      }
      decoded.push({ ...candidate, ...measured, kind, family, reuse });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError();
      collector.add(candidate, error.code === 'SOURCE_PIXEL_LIMIT' ? 'source-pixel-limit'
        : error.code === 'INVALID_DIMENSIONS' ? 'invalid-dimensions' : 'decode-failed', error?.message ?? String(error));
    } finally {
      closeImage(image);
      progress(candidate.src);
      if (attempts % 8 === 0) {
        await yieldWork();
        checkAbort(signal);
      }
    }
  }
  if (budgetLimited) warnings.add('The 64-megapixel preparation budget limited this palette; use a lower-resolution library for more candidates.');
  if (attempts === MAX_CANDIDATES) warnings.add('Reached the 64-image decode limit; untested catalogue entries were not included.');
  requireCore(decoded, collector, true);
  // One sample per family prevents color variants from biasing the library density.
  const samplesByFamily = new Map();
  for (const row of decoded) {
    const sample = densitySample(row);
    if (Number.isFinite(sample) && sample > 0 && !samplesByFamily.has(row.family)) samplesByFamily.set(row.family, sample);
  }
  const samples = [...samplesByFamily.values()].sort((a, b) => a - b);
  const middle = Math.floor(samples.length / 2);
  const density = samples.length ? (samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2) : FALLBACK_DENSITY;
  if (!samples.length) warnings.add('No reliable grid-sized sample was available; automatic scale uses a fallback of 100 pixels per cell.');
  const selected = shortlist(decoded, limit), palette = selected.map(row => inferEntry(row, density, warnings));
  const roles = Object.fromEntries(ROLES.map(kind => [kind, palette.filter(entry => entry.kind === kind).length]));
  const reviewed = palette.filter(entry => entry.confirmed).length;
  const sourcePixels = palette.reduce((sum, entry) => sum + entry.pixelWidth * entry.pixelHeight, 0);
  const summary = {
    candidates: candidates.length, decoded: attempts, selected: palette.length,
    reviewed, automatic: palette.length - reviewed, sourcePixels, consumedPixels,
    pixelsPerCell: density, densitySamples: samples.length, fallbackDensity: !samples.length,
    roles, ...collector.summary(), warnings: [...warnings],
    message: `Prepared ${palette.length} library assets (${roles.material} materials, ${roles.wall} walls, ${roles.prop} props); ${palette.length - reviewed} automatically calibrated, ${reviewed} reviewed. `
      + `Library density: ${density} pixels per cell (${samples.length ? `${samples.length} sampled families` : 'automatic fallback; no reliable sized samples'}). `
      + `Skipped ${collector.summary().skipped} unusable sources.`
  };
  progress(undefined, true);
  return { palette, skipped: collector.details(), summary };
}
