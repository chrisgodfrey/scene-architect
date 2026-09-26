// Metadata only: paths and filename dimension hints never certify image contents.
const IMAGE_EXTENSION = /\.(png|jpe?g|webp)$/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const YIELD_INTERVAL = 512;
const MAX_SEARCH_RESULTS = 200;
const searchIndexes = new WeakMap();
let generationCounter = 0;

function fail(message) {
  throw new Error(`Asset catalogue: ${message}`);
}

function abortError() {
  const error = new Error('Asset catalogue operation cancelled.');
  error.name = 'AbortError';
  return error;
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

export async function yieldWork(signal) {
  checkAbort(signal);
  // Chained timers are throttled heavily in background browser tabs.
  if (typeof globalThis.scheduler?.yield === 'function') await globalThis.scheduler.yield();
  else await new Promise(resolve => setTimeout(resolve, 0));
  checkAbort(signal);
}

function optionsCheck(callback, name, onProgress, signal) {
  if (typeof callback !== 'function') fail(`${name} must be a function.`);
  if (typeof onProgress !== 'function') fail('onProgress must be a function.');
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean'
    || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
    fail('signal must be an AbortSignal.');
  }
  checkAbort(signal);
}

// Abort the wait even when an injected provider cannot cancel its underlying I/O.
async function io(operation, callback, signal) {
  checkAbort(signal);
  let listener;
  try {
    const work = Promise.resolve().then(() => {
      checkAbort(signal);
      return callback();
    });
    const result = signal ? await Promise.race([
      work,
      new Promise((resolve, reject) => {
        listener = () => reject(abortError());
        signal.addEventListener('abort', listener, { once: true });
        if (signal.aborted) listener();
      })
    ]) : await work;
    checkAbort(signal);
    return result;
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw abortError();
    throw new Error(`Asset catalogue: ${operation} failed: ${error?.message ?? String(error)}`, { cause: error });
  } finally {
    if (listener) signal.removeEventListener('abort', listener);
  }
}

/**
 * Canonical Data-relative URL path. Empty string denotes the Data root.
 * Decode aliases before checking each interpretation, including double-encoded
 * traversal. Literal percent signs must be URL-encoded; ambiguous encodings fail.
 */
export function normalizeAssetPath(path) {
  if (typeof path !== 'string') fail('path must be a string.');
  let decoded = path;
  for (let depth = 0; ; depth++) {
    if (/^[\\/]/.test(decoded) || /[\\:?#\u0000-\u001f\u007f-\u009f]/u.test(decoded)) {
      fail(`unsafe relative path: ${path}`);
    }
    if (decoded.split('/').some(part => part === '.' || part === '..')) fail(`path traversal: ${path}`);
    if (!decoded.includes('%') || (depth > 0 && !/%[0-9a-f]{2}/i.test(decoded))) break;
    if (depth === 8) fail(`excessively encoded path: ${path}`);
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      fail(`malformed path encoding: ${path}`);
    }
  }
  const segments = decoded.replace(/\/+$/, '').split('/');
  if (segments.some((part, index) => !part && index < segments.length - 1)) fail(`empty path segment: ${path}`);
  try {
    return segments.map(part => encodeURIComponent(part).replace(/[!'()*]/g,
      character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
  } catch {
    fail(`invalid Unicode path: ${path}`);
  }
}

const withinRoot = (path, root) => !root || path === root || path.startsWith(`${root}/`);
const comparePaths = (a, b) => a.src < b.src ? -1 : a.src > b.src ? 1 : 0;
const directoryOf = path => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const filenameOf = path => path.slice(path.lastIndexOf('/') + 1);

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(`${name} must be a safe integer >= ${minimum}.`);
  return value;
}

function record(value, allowedKeys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${name} must be a plain JSON object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) fail(`${name} contains a dangerous key.`);
    if (!allowedKeys.includes(key)) fail(`${name} contains an unexpected key: ${key}`);
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail(`${name} must not contain accessors.`);
  }
}

function version(value, name) {
  if (value !== 1) fail(`unsupported ${name} version; expected 1.`);
}

// Two independent 32-bit accumulators keep IDs short and portable. Every
// catalogue additionally checks collisions rather than assuming hash uniqueness.
function assetId(src) {
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let index = 0; index < src.length; index++) {
    const code = src.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `catalogue-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function entryFor(src) {
  const filename = decodeURIComponent(filenameOf(src)), stem = filename.replace(IMAGE_EXTENSION, '');
  const entry = { id: assetId(src), src, label: stem.replace(/[_-]+/g, ' ').trim() || stem || filename };
  const hint = /_(\d+)x(\d+)$/i.exec(stem);
  if (hint) {
    const width = Number(hint[1]), height = Number(hint[2]);
    if (Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0) {
      entry.width = width;
      entry.height = height;
    }
  }
  return entry;
}

function registerEntry(entry, paths, ids) {
  if (paths.has(entry.src)) fail(`duplicate asset path: ${entry.src}`);
  if (ids.has(entry.id)) fail(`duplicate asset ID or hash collision: ${entry.id}`);
  paths.add(entry.src);
  ids.set(entry.id, entry.src);
}

function validateEntry(value, root, paths, ids) {
  record(value, ['id', 'src', 'label', 'width', 'height'], 'entry');
  const src = normalizeAssetPath(value.src);
  if (!src || src === root || !withinRoot(src, root)) fail(`entry path is outside root: ${src}`);
  if (!IMAGE_EXTENSION.test(src)) fail(`unsupported image path: ${src}`);
  if (typeof value.id !== 'string' || FORBIDDEN_KEYS.has(value.id)) fail('entry has an invalid ID.');
  if (typeof value.label !== 'string' || !value.label.trim()) fail('entry label must be a nonempty string.');
  const entry = { id: value.id, src, label: value.label };
  if (Object.hasOwn(value, 'width') || Object.hasOwn(value, 'height')) {
    entry.width = integer(value.width, 'entry width', 1);
    entry.height = integer(value.height, 'entry height', 1);
  }
  registerEntry(entry, paths, ids);
  if (entry.id !== assetId(src)) fail(`entry ID does not match its canonical path: ${src}`);
  return entry;
}

function catalogueHeader(value) {
  record(value, ['version', 'root', 'entries', 'directoryCount'], 'catalogue');
  version(value.version, 'catalogue');
  const root = normalizeAssetPath(value.root);
  integer(value.directoryCount, 'directoryCount', 1);
  if (!Array.isArray(value.entries)) fail('catalogue entries must be an array.');
  return root;
}

function report(onProgress, phase, count, directoryCount, extra = {}) {
  onProgress({ phase, count, files: count, directoryCount, directories: directoryCount, ...extra });
}

/**
 * browse receives canonical Data-relative directories and returns Data-relative
 * files/dirs (not basenames). Limits count unique paths, including non-images.
 */
export async function buildCatalogue(root, {
  browse, onProgress = () => {}, signal, maxFiles = 500000, maxDirectories = 100000
} = {}) {
  optionsCheck(browse, 'browse', onProgress, signal);
  root = normalizeAssetPath(root);
  integer(maxFiles, 'maxFiles');
  integer(maxDirectories, 'maxDirectories', 1);
  const directories = new Set([root]), files = new Set(), ids = new Map(), entries = [];
  const queue = [root];
  let directoryCount = 0, processed = 0;
  for (let index = 0; index < queue.length; index++) {
    checkAbort(signal);
    const path = queue[index];
    const listing = await io(`browse "${path}"`, () => browse(path), signal);
    // Foundry providers may supply extra response metadata; only files/dirs are consumed.
    if (!listing || typeof listing !== 'object' || Array.isArray(listing)) {
      fail(`browse "${path}" must return files and dirs arrays.`);
    }
    record(listing, Object.keys(listing), 'browse response');
    if (!Array.isArray(listing.files) || !Array.isArray(listing.dirs)) {
      fail(`browse "${path}" must return files and dirs arrays.`);
    }
    directoryCount++;
    for (const raw of listing.files) {
      checkAbort(signal);
      const src = normalizeAssetPath(raw);
      if (!src || src === root || !withinRoot(src, root)) fail(`browsed file is outside root: ${src}`);
      if (directories.has(src)) fail(`path is both a file and directory: ${src}`);
      if (!files.has(src)) {
        if (files.size >= maxFiles) fail(`maxFiles limit (${maxFiles}) exceeded; catalogue not completed.`);
        files.add(src);
        if (IMAGE_EXTENSION.test(src)) {
          const entry = entryFor(src);
          if (ids.has(entry.id)) fail(`asset ID hash collision: ${entry.id}`);
          ids.set(entry.id, src);
          entries.push(entry);
        }
      }
      if (++processed % YIELD_INTERVAL === 0) {
        report(onProgress, 'scan', entries.length, directoryCount, { path, scannedFiles: files.size });
        await yieldWork(signal);
      }
    }
    const children = [];
    for (const raw of listing.dirs) {
      checkAbort(signal);
      const child = normalizeAssetPath(raw);
      if (!withinRoot(child, root)) fail(`browsed directory is outside root: ${child}`);
      if (files.has(child)) fail(`path is both a file and directory: ${child}`);
      if (!directories.has(child)) {
        if (directories.size >= maxDirectories) fail(`maxDirectories limit (${maxDirectories}) exceeded; catalogue not completed.`);
        directories.add(child);
        children.push(child);
      }
      if (++processed % YIELD_INTERVAL === 0) await yieldWork(signal);
    }
    children.sort();
    for (const child of children) queue.push(child);
    report(onProgress, 'scan', entries.length, directoryCount, { path, scannedFiles: files.size });
    if (directoryCount % 32 === 0) await yieldWork(signal);
  }
  checkAbort(signal);
  entries.sort(comparePaths);
  report(onProgress, 'scan', entries.length, directoryCount, { scannedFiles: files.size, done: true });
  checkAbort(signal);
  return { version: 1, root, entries, directoryCount };
}

const fold = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const tokens = value => fold(value).match(/[\p{L}\p{N}]+/gu) ?? [];

function searchIndex(catalogue) {
  let cached = searchIndexes.get(catalogue);
  if (cached && cached.entries === catalogue.entries && cached.length === catalogue.entries.length) return cached.rows;
  const root = catalogueHeader(catalogue), paths = new Set(), ids = new Map();
  const rows = catalogue.entries.map(value => {
    const entry = validateEntry(value, root, paths, ids);
    const name = decodeURIComponent(filenameOf(entry.src)).replace(IMAGE_EXTENSION, '');
    return {
      entry: value,
      name: tokens(name),
      folder: tokens(decodeURIComponent(directoryOf(entry.src))),
      phrase: tokens(name).join(' ')
    };
  });
  rows.sort((a, b) => comparePaths(a.entry, b.entry));
  // Catalogues are snapshots; replace the entries array if editing one in memory.
  cached = { entries: catalogue.entries, length: catalogue.entries.length, rows };
  searchIndexes.set(catalogue, cached);
  return rows;
}

function tokenScore(terms, term, exact, prefix, substring) {
  let score = 0;
  for (const token of terms) {
    if (token === term) return exact;
    if (token.startsWith(term)) score = Math.max(score, prefix);
    else if (token.includes(term)) score = Math.max(score, substring);
  }
  return score;
}

/**
 * AND-matches filename/folder tokens; filename and exact matches rank first.
 * limit is clamped to 200. Only the bounded best results are sorted per query.
 */
export function searchCatalogue(catalogue, query, { limit = 40 } = {}) {
  integer(limit, 'search limit');
  if (typeof query !== 'string') fail('query must be a string.');
  if (query.length > 4096) fail('query exceeds 4096 characters.');
  limit = Math.min(limit, MAX_SEARCH_RESULTS);
  if (!limit) return [];
  const rows = searchIndex(catalogue);
  if (!query.trim()) return rows.slice(0, limit).map(row => row.entry);
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return [];
  if (terms.length > 64) fail('query exceeds 64 tokens.');
  const phrase = tokens(query).join(' '), best = [];
  for (const row of rows) {
    let score = 0, matches = true;
    for (const term of terms) {
      const match = Math.max(tokenScore(row.name, term, 100, 60, 20), tokenScore(row.folder, term, 30, 15, 5));
      if (!match) { matches = false; break; }
      score += match;
    }
    if (!matches) continue;
    if (row.phrase === phrase) score += 200;
    else if (row.phrase.includes(phrase)) score += 40;
    let low = 0, high = best.length;
    while (low < high) {
      const middle = (low + high) >>> 1, previous = best[middle];
      if (score > previous.score || (score === previous.score && comparePaths(row.entry, previous.entry) < 0)) high = middle;
      else low = middle + 1;
    }
    if (low < limit) {
      best.splice(low, 0, { score, entry: row.entry });
      if (best.length > limit) best.pop();
    }
  }
  return best.map(result => result.entry);
}

function generationPrefix() {
  let nonce;
  if (globalThis.crypto?.randomUUID) nonce = globalThis.crypto.randomUUID();
  else if (globalThis.crypto?.getRandomValues) {
    nonce = [...globalThis.crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, '0')).join('');
  } else {
    nonce = `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  return `asset-catalogue-${Date.now().toString(36)}-${++generationCounter}-${nonce}`;
}

function jsonPath(value, name) {
  const path = normalizeAssetPath(value);
  if (!path || !/\.json$/i.test(path)) fail(`${name} must be a relative JSON file path.`);
  return path;
}

function uploadPath(value, filename, directory) {
  const path = jsonPath(value, 'upload result');
  if (filenameOf(path) !== filename) fail('upload result must preserve the unique generated filename.');
  if (directory !== undefined && directoryOf(path) !== directory) fail('uploaded catalogue files must share the manifest directory.');
  return path;
}

/**
 * Upload JSON objects, not strings. Shards are {version:1,root,entries}.
 * Manifest shard src paths are Data-relative and in the manifest's directory.
 * Failed/cancelled generations may leave unreferenced files, never a publication.
 */
export async function saveCatalogue(catalogue, {
  upload, onProgress = () => {}, signal, shardSize = 2000
} = {}) {
  optionsCheck(upload, 'upload', onProgress, signal);
  integer(shardSize, 'shardSize', 1);
  const root = catalogueHeader(catalogue), entries = [], paths = new Set(), ids = new Map();
  for (const value of catalogue.entries) {
    entries.push(validateEntry(value, root, paths, ids));
    if (entries.length % YIELD_INTERVAL === 0) await yieldWork(signal);
  }
  checkAbort(signal);
  entries.sort(comparePaths);
  const prefix = generationPrefix(), shards = [];
  let directory;
  report(onProgress, 'save', 0, catalogue.directoryCount, { total: entries.length, completed: 0 });
  for (let start = 0; start < entries.length; start += shardSize) {
    checkAbort(signal);
    const part = entries.slice(start, start + shardSize);
    const filename = `${prefix}-part-${String(shards.length + 1).padStart(6, '0')}.json`;
    const src = uploadPath(await io(`upload "${filename}"`, () => upload(filename, { version: 1, root, entries: part }), signal),
      filename, directory);
    directory = directoryOf(src);
    shards.push({ src, count: part.length });
    report(onProgress, 'save', start + part.length, catalogue.directoryCount, {
      total: entries.length, completed: start + part.length, shardCount: shards.length
    });
    if (shards.length % 32 === 0) await yieldWork(signal);
  }
  const manifest = { version: 1, root, count: entries.length, directoryCount: catalogue.directoryCount, shards };
  const filename = `${prefix}-manifest.json`;
  const path = uploadPath(await io(`upload "${filename}"`, () => upload(filename, manifest), signal), filename, directory);
  report(onProgress, 'save', entries.length, catalogue.directoryCount, {
    total: entries.length, completed: entries.length, shardCount: shards.length, done: true
  });
  checkAbort(signal);
  return { manifest, path };
}

export async function loadCatalogue(path, { fetchJson, onProgress = () => {}, signal } = {}) {
  optionsCheck(fetchJson, 'fetchJson', onProgress, signal);
  path = jsonPath(path, 'manifest path');
  const directory = directoryOf(path);
  const manifest = await io(`fetch "${path}"`, () => fetchJson(path), signal);
  record(manifest, ['version', 'root', 'count', 'directoryCount', 'shards'], 'manifest');
  version(manifest.version, 'manifest');
  const root = normalizeAssetPath(manifest.root);
  integer(manifest.count, 'manifest count');
  integer(manifest.directoryCount, 'directoryCount', 1);
  if (!Array.isArray(manifest.shards)) fail('manifest shards must be an array.');
  const shards = [], shardPaths = new Set();
  let declaredCount = 0;
  for (const value of manifest.shards) {
    record(value, ['src', 'count'], 'shard descriptor');
    const src = jsonPath(value.src, 'shard path'), count = integer(value.count, 'shard count', 1);
    if (directoryOf(src) !== directory) fail(`shard path is outside manifest directory: ${src}`);
    if (src === path || shardPaths.has(src)) fail(`duplicate or self-referencing shard path: ${src}`);
    shardPaths.add(src);
    declaredCount += count;
    if (!Number.isSafeInteger(declaredCount) || declaredCount > manifest.count) fail('manifest shard counts exceed manifest count.');
    shards.push({ src, count });
    if (shards.length % YIELD_INTERVAL === 0) await yieldWork(signal);
  }
  if (declaredCount !== manifest.count) fail('manifest count does not match shard counts.');
  const entries = [], paths = new Set(), ids = new Map();
  report(onProgress, 'load', 0, manifest.directoryCount, { total: manifest.count, completed: 0 });
  for (const descriptor of shards) {
    const shard = await io(`fetch "${descriptor.src}"`, () => fetchJson(descriptor.src), signal);
    record(shard, ['version', 'root', 'entries'], 'shard');
    version(shard.version, 'shard');
    if (normalizeAssetPath(shard.root) !== root) fail('shard root does not match manifest root.');
    if (!Array.isArray(shard.entries) || shard.entries.length !== descriptor.count) fail('shard entry count does not match descriptor.');
    for (const value of shard.entries) {
      checkAbort(signal);
      entries.push(validateEntry(value, root, paths, ids));
      if (entries.length % YIELD_INTERVAL === 0) {
        report(onProgress, 'load', entries.length, manifest.directoryCount, { total: manifest.count, completed: entries.length });
        await yieldWork(signal);
      }
    }
    report(onProgress, 'load', entries.length, manifest.directoryCount, { total: manifest.count, completed: entries.length });
    if (entries.length % 32 === 0) await yieldWork(signal);
  }
  if (entries.length !== manifest.count) fail('loaded entry count does not match manifest count.');
  checkAbort(signal);
  entries.sort(comparePaths);
  report(onProgress, 'load', entries.length, manifest.directoryCount, {
    total: manifest.count, completed: entries.length, done: true
  });
  checkAbort(signal);
  return { version: 1, root, entries, directoryCount: manifest.directoryCount };
}
