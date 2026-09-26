import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAssetPath, buildCatalogue, searchCatalogue, saveCatalogue, loadCatalogue, yieldWork
} from '../scripts/asset-catalogue.js';

const root = 'assets';
const abort = error => error.name === 'AbortError';
const buildFiles = (files, options = {}) => buildCatalogue(root, {
  browse: async () => ({ files, dirs: [] }), ...options
});

test('cooperative work uses scheduler tasks and preserves cancellation and failures', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'scheduler', original);
    else delete globalThis.scheduler;
  });
  let calls = 0;
  const scheduler = { async yield() { assert.equal(this, scheduler); calls++; } };
  Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: scheduler });
  t.mock.method(globalThis, 'setTimeout', () => { throw new Error('Unexpected throttled timer'); });
  await yieldWork();
  assert.equal(calls, 1);

  const before = new AbortController();
  before.abort();
  await assert.rejects(yieldWork(before.signal), abort);
  assert.equal(calls, 1);

  const during = new AbortController();
  scheduler.yield = async () => { during.abort(); };
  await assert.rejects(yieldWork(during.signal), abort);
  scheduler.yield = async () => { throw new Error('Scheduler failed'); };
  await assert.rejects(yieldWork(), /Scheduler failed/);
});

test('cooperative work retains the timer fallback without scheduler support', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'scheduler', original);
    else delete globalThis.scheduler;
  });
  const timer = t.mock.method(globalThis, 'setTimeout');
  for (const value of [undefined, {}]) {
    Object.defineProperty(globalThis, 'scheduler', { configurable: true, value });
    await yieldWork();
  }
  assert.equal(timer.mock.callCount(), 2);
  assert(timer.mock.calls.every(call => call.arguments[1] === 0));
});

function storage() {
  const objects = new Map(), uploads = [], reads = [];
  return {
    objects, uploads, reads,
    async upload(filename, value) {
      const path = `worlds/demo/catalogues/${filename}`;
      uploads.push(path);
      objects.set(path, structuredClone(value));
      return path;
    },
    async fetchJson(path) {
      reads.push(path);
      if (!objects.has(path)) throw new Error(`Missing ${path}`);
      return structuredClone(objects.get(path));
    }
  };
}

async function saved(files = ['assets/chair.png', 'assets/floor.jpg', 'assets/rug.webp']) {
  const catalogue = await buildFiles(files), store = storage();
  const result = await saveCatalogue(catalogue, { upload: store.upload, shardSize: 2 });
  return { catalogue, store, ...result };
}

test('paths canonicalize spaces, Unicode, encoding aliases and trailing directory slashes', () => {
  assert.equal(normalizeAssetPath(''), '');
  assert.equal(normalizeAssetPath('assets/'), 'assets');
  assert.equal(normalizeAssetPath('assets/石 café.webp'), 'assets/%E7%9F%B3%20caf%C3%A9.webp');
  assert.equal(normalizeAssetPath('assets/%e7%9f%b3%20caf%c3%a9.webp'), 'assets/%E7%9F%B3%20caf%C3%A9.webp');
  assert.equal(normalizeAssetPath('assets/a%2520b.png'), 'assets/a%20b.png');
  assert.equal(normalizeAssetPath('assets/100%25.png'), 'assets/100%25.png');
  assert.equal(normalizeAssetPath('assets/__proto__/safe.png'), 'assets/__proto__/safe.png');
  assert.equal(normalizeAssetPath("assets/it's (fine).png"), 'assets/it%27s%20%28fine%29.png');
});

test('paths reject external URLs, leading separators, traversal, fragments and encoded variants', () => {
  const unsafe = [
    'https://host/image.png', 'data:image/png;base64,AA', 'javascript:alert(1)', 'blob:abc',
    '//host/a.png', '/assets/a.png', '\\assets\\a.png', 'C:\\assets\\a.png',
    '../a.png', 'assets/../a.png', 'assets/./a.png', '.', '..',
    'assets/%2e%2e/a.png', 'assets/%252e%252e/a.png', 'assets/%25252e%25252e/a.png',
    'assets%2f..%2fa.png', 'assets/%2e%2e%5ca.png', '%2fassets/a.png',
    '%68%74%74%70%73%3a%2f%2fhost/a.png', 'assets%3fa.png', 'assets/a.png?x=1',
    'assets/a.png#fragment', 'assets/a.png%23fragment', 'assets/a%00.png', 'assets/a%0a.png',
    'assets//a.png', 'assets/bad%.png', 'assets/bad%ZZ.png', 'assets/%E0%A4.png',
    `assets/${'\ud800'}.png`, 'assets/%252525252525252525252e%252525252525252525252e/a.png'
  ];
  for (const path of unsafe) assert.throws(() => normalizeAssetPath(path), /Asset catalogue:/, path);
  for (const value of [null, undefined, 1, {}, []]) assert.throws(() => normalizeAssetPath(value), /path must be a string/);
});

test('recursive scanning visits each canonical directory once, tolerates cycles and sorts entries', async () => {
  const calls = [], progress = [];
  const listings = {
    assets: { files: ['assets/z.JPG', 'assets/readme.txt'], dirs: ['assets/b', 'assets/a', 'assets/b/', 'assets'] },
    'assets/a': { files: ['assets/a/floor_4x6.PNG', 'assets/a/café chair.webp', 'assets/a/caf%C3%A9%20chair.webp'], dirs: ['assets', 'assets/b'] },
    'assets/b': { files: ['assets/b/machine_2X3.jpeg', 'assets/z.JPG'], dirs: ['assets/a'] }
  };
  const catalogue = await buildCatalogue('assets/', {
    browse: async path => { calls.push(path); return listings[path]; },
    onProgress: value => progress.push(value)
  });
  assert.deepEqual(calls, ['assets', 'assets/a', 'assets/b']);
  assert.equal(catalogue.version, 1);
  assert.equal(catalogue.root, 'assets');
  assert.equal(catalogue.directoryCount, 3);
  assert.deepEqual(catalogue.entries.map(entry => entry.src), [
    'assets/a/caf%C3%A9%20chair.webp', 'assets/a/floor_4x6.PNG', 'assets/b/machine_2X3.jpeg', 'assets/z.JPG'
  ]);
  assert.equal(progress.at(-1).done, true);
  assert.equal(progress.at(-1).count, 4);
  assert.equal(progress.at(-1).scannedFiles, 5);
  assert.deepEqual(catalogue.entries.find(entry => entry.src.endsWith('floor_4x6.PNG')), {
    id: catalogue.entries.find(entry => entry.src.endsWith('floor_4x6.PNG')).id,
    src: 'assets/a/floor_4x6.PNG', label: 'floor 4x6', width: 4, height: 6
  });
});

test('IDs are canonical-path stable across listing order, roots, aliases and later additions', async () => {
  const first = await buildFiles(['assets/café chair.png', 'assets/floor.jpg']);
  const second = await buildFiles(['assets/z.png', 'assets/floor.jpg', 'assets/caf%C3%A9%20chair.png']);
  const broader = await buildCatalogue('', { browse: async () => ({ files: ['assets/café chair.png'], dirs: [] }) });
  for (const entry of first.entries) assert.equal(second.entries.find(candidate => candidate.src === entry.src).id, entry.id);
  assert.equal(first.entries[0].id, broader.entries[0].id);
  assert.match(first.entries[0].id, /^catalogue-[a-f0-9]{16}$/);
  assert.notEqual(first.entries[0].id, first.entries[1].id);
});

test('only supported image extensions are indexed and positive suffixes are unverified dimension hints', async () => {
  const catalogue = await buildFiles([
    'assets/table_12x003.webp', 'assets/room_0x2.png', 'assets/room_2.5x3.png',
    'assets/room_9007199254740992x2.png', 'assets/room_2x3_extra.png', 'assets/no-hint.jpeg',
    'assets/movie.webm', 'assets/logo.svg', 'assets/a.gif', 'assets/noextension', 'assets/readme.png.txt'
  ]);
  assert.equal(catalogue.entries.length, 6);
  const table = catalogue.entries.find(entry => entry.src.includes('table'));
  assert.equal(table.width, 12);
  assert.equal(table.height, 3);
  for (const entry of catalogue.entries.filter(value => value !== table)) {
    assert.equal(Object.hasOwn(entry, 'width'), false);
    assert.equal(Object.hasOwn(entry, 'height'), false);
  }
});

test('extension-only and punctuation-only filenames remain valid catalogue entries', async () => {
  const { catalogue, store, path } = await saved(['assets/.png', 'assets/__.jpg', 'assets/石 café_2x3.PNG']);
  assert.equal(catalogue.entries.find(entry => entry.src === 'assets/.png').label, '.png');
  assert.equal(catalogue.entries.find(entry => entry.src === 'assets/__.jpg').label, '__');
  assert.deepEqual(await loadCatalogue(path, { fetchJson: store.fetchJson }), catalogue);
});

test('empty catalogues and the Data root are supported', async () => {
  const catalogue = await buildCatalogue('', { browse: async () => ({ files: [], dirs: [''] }) });
  assert.deepEqual(catalogue, { version: 1, root: '', entries: [], directoryCount: 1 });
  assert.deepEqual(searchCatalogue(catalogue, ''), []);
  const store = storage(), result = await saveCatalogue(catalogue, { upload: store.upload });
  assert.equal(store.uploads.length, 1);
  assert.deepEqual(result.manifest.shards, []);
  assert.deepEqual(await loadCatalogue(result.path, { fetchJson: store.fetchJson }), catalogue);
});

test('malformed listings, missing paths, provider failures, outside roots and conflicting paths fail explicitly', async () => {
  for (const listing of [null, {}, { files: [] }, { dirs: [] }, { files: 'x', dirs: [] }, { files: [], dirs: null }]) {
    await assert.rejects(buildCatalogue(root, { browse: async () => listing }), /must return files and dirs arrays/);
  }
  for (const files of [[null], [''], ['assets'], ['assets-other/a.png'], ['other/a.png'], ['assets/%2e%2e/a.txt']]) {
    await assert.rejects(buildFiles(files), /Asset catalogue:/);
  }
  await assert.rejects(buildFiles([], { browse: async () => { throw new Error('Permission denied'); } }), /browse "assets" failed: Permission denied/);
  await assert.rejects(buildFiles([], { browse: () => { throw new Error('Offline'); } }), /browse "assets" failed: Offline/);
  await assert.rejects(buildFiles([], { browse: async () => ({ files: [], dirs: ['assets-other'] }) }), /outside root/);
  await assert.rejects(buildFiles([], { browse: async () => ({ files: [], dirs: [null] }) }), /path must be a string/);
  await assert.rejects(buildFiles([], { browse: async () => ({ files: ['assets/file.png'], dirs: ['assets/file.png'] }) }), /both a file and directory/);
  await assert.rejects(buildFiles([], { browse: async path => path === 'assets'
    ? { files: [], dirs: ['assets/sub'] }
    : { files: ['assets/sub'], dirs: [] } }), /both a file and directory/);
  await assert.rejects(buildFiles([], { browse: async path => path === 'assets'
    ? { files: [], dirs: ['assets/missing'] }
    : undefined }), /must return files and dirs arrays/);
  const extraMetadata = await buildFiles([], { browse: async () => ({ files: [], dirs: [], target: root, private: false }) });
  assert.equal(extraMetadata.entries.length, 0);
  await assert.rejects(buildFiles([], {
    browse: async () => JSON.parse('{"files":[],"dirs":[],"__proto__":{}}')
  }), /dangerous key/);
});

test('unique file and directory limits throw without silent truncation', async () => {
  const duplicates = await buildFiles(['assets/a.png', 'assets/a.png'], { maxFiles: 1 });
  assert.equal(duplicates.entries.length, 1);
  await assert.rejects(buildFiles(['assets/a.png', 'assets/b.png'], { maxFiles: 1 }), /maxFiles limit/);
  await assert.rejects(buildFiles(['assets/not-an-image.txt'], { maxFiles: 0 }), /maxFiles limit/);
  await assert.rejects(buildFiles([], { maxDirectories: 1, browse: async () => ({ files: [], dirs: ['assets/sub'] }) }), /maxDirectories limit/);
  const boundary = await buildCatalogue(root, {
    maxFiles: 0, maxDirectories: 2,
    browse: async path => ({ files: [], dirs: path === root ? ['assets/sub', root] : [root] })
  });
  assert.equal(boundary.directoryCount, 2);
  for (const options of [{ maxFiles: -1 }, { maxFiles: Infinity }, { maxFiles: 1.5 }, { maxDirectories: 0 }]) {
    await assert.rejects(buildFiles([], options), /safe integer/);
  }
});

test('abort before scanning and during pending I/O rejects promptly', async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  await assert.rejects(buildFiles([], { signal: before.signal, browse: async () => { calls++; } }), abort);
  assert.equal(calls, 0);
  const during = new AbortController();
  const promise = buildFiles([], { signal: during.signal, browse: () => new Promise(() => {}) });
  setTimeout(() => during.abort(), 0);
  await assert.rejects(promise, abort);
});

test('large file and directory listings periodically yield and can be cancelled', async () => {
  for (const directories of [false, true]) {
    const controller = new AbortController(), calls = [];
    const values = Array.from({ length: 5000 }, (_, index) => `assets/item-${index}${directories ? '' : '.png'}`);
    const promise = buildCatalogue(root, {
      signal: controller.signal,
      browse: async path => {
        calls.push(path);
        return directories ? { files: [], dirs: values } : { files: values, dirs: [] };
      }
    });
    setTimeout(() => controller.abort(), 0);
    await assert.rejects(promise, abort);
    assert.deepEqual(calls, [root]);
  }
});

test('large catalogues finish without truncation and roundtrip across yielding boundaries', async () => {
  const values = Array.from({ length: 1025 }, (_, index) => `assets/item-${index}.png`);
  let timerRan = false;
  const timer = setTimeout(() => { timerRan = true; }, 0);
  const catalogue = await buildFiles(values);
  clearTimeout(timer);
  assert.equal(timerRan, true);
  assert.equal(catalogue.entries.length, values.length);
  const store = storage(), result = await saveCatalogue(catalogue, { upload: store.upload, shardSize: 512 });
  assert.deepEqual(result.manifest.shards.map(shard => shard.count), [512, 512, 1]);
  assert.deepEqual(await loadCatalogue(result.path, { fetchJson: store.fetchJson }), catalogue);
  assert.equal(searchCatalogue(catalogue, 'item', { limit: 100000 }).length, 200);
});

test('search ranks filenames above folders, exact above prefixes, and supports Unicode token AND matching', async () => {
  const catalogue = await buildFiles([
    'assets/chair/floor.png', 'assets/furniture/chair.png', 'assets/furniture/chairman.png',
    'assets/furniture/armchair.png', 'assets/stone/red_chair_2x3.webp', 'assets/bois/café_石.png'
  ]);
  const search = query => searchCatalogue(catalogue, query).map(entry => entry.src);
  assert.deepEqual(search('chair'), [
    'assets/furniture/chair.png', 'assets/stone/red_chair_2x3.webp', 'assets/furniture/chairman.png',
    'assets/furniture/armchair.png', 'assets/chair/floor.png'
  ]);
  assert.deepEqual(search('stone chair'), ['assets/stone/red_chair_2x3.webp']);
  assert.deepEqual(search('FURNITURE CHAIR'), ['assets/furniture/chair.png', 'assets/furniture/chairman.png', 'assets/furniture/armchair.png']);
  assert.deepEqual(search('cafe 石'), ['assets/bois/caf%C3%A9_%E7%9F%B3.png']);
  assert.deepEqual(search('nonexistent'), []);
  assert.deepEqual(search('!!!'), []);
  assert.deepEqual(search(''), catalogue.entries.map(entry => entry.src));
  assert.deepEqual(search('   '), search(''));
  assert.deepEqual(search('chair'), search('chair'));
});

test('search bounds output, sorts ties deterministically and does not mutate catalogue entries', async () => {
  const catalogue = await buildFiles(Array.from({ length: 250 }, (_, index) => `assets/chair_${index}.png`));
  const snapshot = structuredClone(catalogue);
  assert.equal(searchCatalogue(catalogue, '').length, 40);
  assert.equal(searchCatalogue(catalogue, 'chair', { limit: 10000 }).length, 200);
  assert.equal(searchCatalogue(catalogue, 'chair', { limit: 0 }).length, 0);
  const small = searchCatalogue(catalogue, 'chair', { limit: 3 });
  assert.deepEqual(small.map(entry => entry.src), catalogue.entries.slice(0, 3).map(entry => entry.src));
  assert.equal(small[0], catalogue.entries[0]);
  assert.deepEqual(catalogue, snapshot);
  for (const limit of [-1, 0.5, Infinity, NaN, '3']) assert.throws(() => searchCatalogue(catalogue, '', { limit }), /safe integer/);
  assert.throws(() => searchCatalogue(catalogue, null), /query must be a string/);
  assert.throws(() => searchCatalogue(catalogue, 'a'.repeat(4097)), /4096/);
  assert.throws(() => searchCatalogue(catalogue, Array.from({ length: 65 }, (_, index) => `word${index}`).join(' ')), /64 tokens/);
});

test('multiple shards roundtrip with a manifest written last and no implicit publication', async () => {
  const { catalogue, store, manifest, path } = await saved();
  assert.equal(manifest.version, 1);
  assert.equal(manifest.root, root);
  assert.equal(manifest.count, 3);
  assert.equal(manifest.directoryCount, 1);
  assert.deepEqual(manifest.shards.map(shard => shard.count), [2, 1]);
  assert.equal(store.uploads.length, 3);
  assert.equal(store.uploads.at(-1), path);
  for (const shard of manifest.shards) assert(store.objects.get(shard.src).entries);
  const progress = [];
  const loaded = await loadCatalogue(path, { fetchJson: store.fetchJson, onProgress: value => progress.push(value) });
  assert.deepEqual(loaded, catalogue);
  assert.deepEqual(store.reads, [path, ...manifest.shards.map(shard => shard.src)]);
  assert.equal(progress.at(-1).done, true);
  assert.equal(progress.at(-1).count, catalogue.entries.length);
  assert.deepEqual(searchCatalogue(loaded, 'floor'), searchCatalogue(catalogue, 'floor'));
});

test('generation filenames never reuse previous shards or manifest paths', async () => {
  const catalogue = await buildFiles(['assets/a.png']), store = storage();
  const first = await saveCatalogue(catalogue, { upload: store.upload });
  const second = await saveCatalogue(catalogue, { upload: store.upload });
  assert.notEqual(first.path, second.path);
  assert.notEqual(first.manifest.shards[0].src, second.manifest.shards[0].src);
  assert.equal(new Set(store.uploads).size, store.uploads.length);
  assert.deepEqual(await loadCatalogue(first.path, { fetchJson: store.fetchJson }), catalogue);
});

test('failed or cancelled shard uploads never attempt the manifest and cannot replace caller settings', async () => {
  const catalogue = await buildFiles(['assets/a.png', 'assets/b.png', 'assets/c.png']);
  for (const cancel of [false, true]) {
    const controller = new AbortController(), calls = [];
    let published = 'old-manifest.json';
    const promise = saveCatalogue(catalogue, {
      shardSize: 1, signal: controller.signal,
      upload: async filename => {
        calls.push(filename);
        if (calls.length === 2) {
          if (cancel) controller.abort();
          else throw new Error('Disk full');
        }
        return `catalogues/${filename}`;
      }
    }).then(result => { published = result.path; });
    await assert.rejects(promise, cancel ? abort : /upload .* failed: Disk full/);
    assert.equal(published, 'old-manifest.json');
    assert.equal(calls.length, 2);
    assert(calls.every(filename => !filename.includes('-manifest.json')));
  }
});

test('manifest upload failure and invalid upload paths fail explicitly', async () => {
  const catalogue = await buildFiles(['assets/a.png']);
  await assert.rejects(saveCatalogue(catalogue, {
    upload: async filename => {
      if (filename.includes('-manifest.json')) throw new Error('Manifest failed');
      return filename;
    }
  }), /Manifest failed/);
  for (const value of [undefined, {}, '', 'https://host/file.json', '../file.json', 'old.json']) {
    await assert.rejects(saveCatalogue(catalogue, { upload: async () => value }), /Asset catalogue:/);
  }
  let calls = 0;
  await assert.rejects(saveCatalogue(catalogue, {
    upload: async filename => `${++calls === 1 ? 'first' : 'other'}/${filename}`
  }), /share the manifest directory/);
  const two = await buildFiles(['assets/a.png', 'assets/b.png']);
  calls = 0;
  await assert.rejects(saveCatalogue(two, {
    shardSize: 1, upload: async filename => `${++calls === 1 ? 'first' : 'other'}/${filename}`
  }), /share the manifest directory/);
  assert.equal(calls, 2);
});

test('save validates the entire catalogue before uploading, including duplicates and ID collisions', async () => {
  const original = await buildFiles(['assets/a.png', 'assets/b.png']);
  const cases = [
    catalogue => { catalogue.version = 2; },
    catalogue => { catalogue.root = '../assets'; },
    catalogue => { catalogue.directoryCount = 0; },
    catalogue => { catalogue.entries = null; },
    catalogue => { catalogue.entries.push(catalogue.entries[0]); },
    catalogue => { catalogue.entries[1].id = catalogue.entries[0].id; },
    catalogue => { catalogue.entries[0].id = 'arbitrary'; },
    catalogue => { catalogue.entries[0].label = ''; },
    catalogue => { catalogue.entries[0].width = 2; },
    catalogue => { catalogue.entries[0].width = 0; catalogue.entries[0].height = 1; },
    catalogue => { catalogue.entries[0].width = 1.2; catalogue.entries[0].height = 1; },
    catalogue => { catalogue.entries[0].src = 'elsewhere/a.png'; },
    catalogue => { catalogue.entries[0].extra = {}; }
  ];
  for (const corrupt of cases) {
    const catalogue = structuredClone(original);
    corrupt(catalogue);
    let calls = 0;
    await assert.rejects(saveCatalogue(catalogue, { upload: async () => { calls++; } }), /Asset catalogue:/);
    assert.equal(calls, 0);
  }
  await assert.rejects(saveCatalogue(original, { upload: async () => {}, shardSize: 0 }), /shardSize/);
});

test('manifest validation rejects malformed metadata and unsafe shard paths before fetching shards', async () => {
  const { store, path } = await saved();
  const original = structuredClone(store.objects.get(path));
  const cases = [
    manifest => { manifest.version = 99; },
    manifest => { manifest.root = '/assets'; },
    manifest => { manifest.count = '3'; },
    manifest => { manifest.count = 4; },
    manifest => { manifest.count = 1; },
    manifest => { manifest.directoryCount = -1; },
    manifest => { manifest.shards = {}; },
    manifest => { manifest.shards[0].count = 0; },
    manifest => { manifest.shards[0].count = Number.MAX_SAFE_INTEGER; },
    manifest => { manifest.shards[0].src = 'https://host/a.json'; },
    manifest => { manifest.shards[0].src = 'worlds/demo/other/a.json'; },
    manifest => { manifest.shards[0].src = 'worlds/demo/catalogues/sub/a.json'; },
    manifest => { manifest.shards[0].src = 'worlds/demo/catalogues/%252e%252e/a.json'; },
    manifest => { manifest.shards[0].src = path; },
    manifest => { manifest.shards[1].src = manifest.shards[0].src; },
    manifest => { manifest.shards[0].src = 'worlds/demo/catalogues/a.png'; },
    manifest => { manifest.extra = true; },
    manifest => { manifest.shards[0].extra = true; }
  ];
  for (const corrupt of cases) {
    const manifest = structuredClone(original);
    corrupt(manifest);
    store.objects.set(path, manifest);
    store.reads.length = 0;
    await assert.rejects(loadCatalogue(path, { fetchJson: store.fetchJson }), /Asset catalogue:/);
    assert.deepEqual(store.reads, [path]);
  }
  for (const badPath of ['https://host/manifest.json', '../manifest.json', 'assets/file.png', '']) {
    store.reads.length = 0;
    await assert.rejects(loadCatalogue(badPath, { fetchJson: store.fetchJson }), /Asset catalogue:/);
    assert.deepEqual(store.reads, []);
  }
});

test('shard validation rejects corruption, unsafe entries, duplicate paths and IDs across shards', async () => {
  const { catalogue, store, manifest, path } = await saved();
  const shardPath = manifest.shards[0].src, original = structuredClone(store.objects.get(shardPath));
  const cases = [
    shard => { shard.version = 2; },
    shard => { shard.root = 'other'; },
    shard => { shard.entries = null; },
    shard => { shard.entries.pop(); },
    shard => { shard.entries[0].src = 'other/a.png'; },
    shard => { shard.entries[0].src = `${root}-other/a.png`; },
    shard => { shard.entries[0].src = 'assets/%252e%252e/a.png'; },
    shard => { shard.entries[0].src = 'https://host/a.png'; },
    shard => { shard.entries[0].src = 'assets/not-image.svg'; },
    shard => { shard.entries[0].id = '__proto__'; },
    shard => { shard.entries[0].id = 'catalogue-0000000000000000'; },
    shard => { shard.entries[0].label = 10; },
    shard => { shard.entries[0].width = 0; shard.entries[0].height = 1; },
    shard => { shard.entries[0].width = 1; },
    shard => { shard.entries[1] = structuredClone(shard.entries[0]); },
    shard => { shard.entries[1].id = shard.entries[0].id; },
    shard => { shard.extra = true; }
  ];
  for (const corrupt of cases) {
    const shard = structuredClone(original);
    corrupt(shard);
    store.objects.set(shardPath, shard);
    await assert.rejects(loadCatalogue(path, { fetchJson: store.fetchJson }), /Asset catalogue:/);
  }
  store.objects.set(shardPath, original);
  store.objects.get(manifest.shards[1].src).entries[0] = structuredClone(catalogue.entries[0]);
  await assert.rejects(loadCatalogue(path, { fetchJson: store.fetchJson }), /duplicate asset path/);
  const last = store.objects.get(manifest.shards[1].src);
  last.entries[0] = structuredClone(catalogue.entries[2]);
  last.entries[0].id = catalogue.entries[0].id;
  await assert.rejects(loadCatalogue(path, { fetchJson: store.fetchJson }), /duplicate asset ID or hash collision/);
});

test('encoded and decoded duplicate persisted paths are rejected', async () => {
  const { store, manifest, path } = await saved(['assets/café chair.png', 'assets/z.png']);
  const shard = store.objects.get(manifest.shards[0].src);
  shard.entries[1] = { ...shard.entries[0], src: 'assets/café chair.png' };
  await assert.rejects(loadCatalogue(path, { fetchJson: store.fetchJson }), /duplicate asset path/);
});

test('dangerous object keys and non-JSON objects are rejected without prototype pollution', async () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const { store, manifest, path } = await saved();
    const locations = [
      [path, value => value],
      [path, value => value.shards[0]],
      [manifest.shards[0].src, value => value],
      [manifest.shards[0].src, value => value.entries[0]]
    ];
    for (const [target, select] of locations) {
      const original = structuredClone(store.objects.get(target));
      Object.defineProperty(select(store.objects.get(target)), key, { value: { polluted: true }, enumerable: true });
      await assert.rejects(loadCatalogue(path, { fetchJson: store.fetchJson }), /dangerous key/);
      store.objects.set(target, original);
    }
  }
  assert.equal({}.polluted, undefined);
  await assert.rejects(loadCatalogue('manifest.json', { fetchJson: async () => new Date() }), /plain JSON object/);
  const object = {};
  Object.defineProperty(object, 'version', { get() { throw new Error('must not execute'); } });
  await assert.rejects(loadCatalogue('manifest.json', { fetchJson: async () => object }), /must not contain accessors/);
});

test('load returns no partial catalogue on missing/corrupt data, provider errors or cancellation', async () => {
  const { store, manifest, path } = await saved();
  store.objects.delete(manifest.shards[1].src);
  let published = 'previous-catalogue';
  await assert.rejects(loadCatalogue(path, { fetchJson: store.fetchJson }).then(value => { published = value; }), /fetch .* failed: Missing/);
  assert.equal(published, 'previous-catalogue');
  await assert.rejects(loadCatalogue(path, { fetchJson: async () => { throw new SyntaxError('Invalid JSON'); } }), /Invalid JSON/);
  const controller = new AbortController();
  const pending = loadCatalogue(path, { signal: controller.signal, fetchJson: () => new Promise(() => {}) });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, abort);
  const during = new AbortController(), reads = [];
  await assert.rejects(loadCatalogue(path, {
    signal: during.signal,
    fetchJson: async src => {
      reads.push(src);
      if (src !== path) during.abort();
      return store.fetchJson(src);
    }
  }), abort);
  assert.equal(reads.length, 2);
});

test('progress callback cancellation prevents final publication and option errors are explicit', async () => {
  const catalogue = await buildFiles(['assets/a.png']), controller = new AbortController(), uploads = [];
  await assert.rejects(saveCatalogue(catalogue, {
    signal: controller.signal,
    upload: async filename => { uploads.push(filename); return filename; },
    onProgress: progress => { if (progress.count === 1) controller.abort(); }
  }), abort);
  assert.equal(uploads.length, 1);
  assert(!uploads[0].includes('-manifest.json'));
  await assert.rejects(buildCatalogue(root), /browse must be a function/);
  await assert.rejects(saveCatalogue(catalogue), /upload must be a function/);
  await assert.rejects(loadCatalogue('manifest.json'), /fetchJson must be a function/);
  await assert.rejects(buildFiles([], { onProgress: null }), /onProgress must be a function/);
  await assert.rejects(buildFiles([], { signal: {} }), /AbortSignal/);
  await assert.rejects(buildFiles([], { onProgress: () => { throw new Error('Progress failed'); } }), /Progress failed/);
});
