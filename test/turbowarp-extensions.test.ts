import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {test} from 'vitest';

import {
  bakedExtensionDataUrl,
  bakeVendoredExtensionUrls,
  readLicenseHeader,
  readVendoredExtension,
  readVendoredExtensionsLock,
  vendoredPathForUrl,
} from '../scripts/turbowarp-extensions.ts';

const require = createRequire(import.meta.url);

test('verifies every vendored TurboWarp extension against its lock', async () => {
  const lock = await readVendoredExtensionsLock();
  assert(lock.extensions.length > 0);
  for (const entry of lock.extensions) {
    const source = await readVendoredExtension(lock, entry.url);
    assert.equal(readLicenseHeader(source), entry.license);
  }
});

test('bakes network extensions from the vendored copies in Packager order', async () => {
  const lock = await readVendoredExtensionsLock();
  const [first, second] = lock.extensions;
  assert(first && second);
  const dataUrl = 'data:text/javascript;,embedded';
  const baked = await bakeVendoredExtensionUrls([first.url, dataUrl, second.url], lock);

  // Packager も非ネットワーク URL を先に、bake した URL を後に並べる。
  assert.equal(baked[0], dataUrl);
  assert.equal(baked[1], bakedExtensionDataUrl(await readVendoredExtension(lock, first.url)));
  assert.equal(baked[2], bakedExtensionDataUrl(await readVendoredExtension(lock, second.url)));
  assert(
    baked.every((url) => url.startsWith('data:')),
    'No network URL may reach the Packager.',
  );
});

test('matches the data URL the pinned Packager produces when it bakes', async () => {
  const packagerSource = await readFile(require.resolve('@turbowarp/packager'), 'utf8');
  // Packager 3.13.0 の generateExtensionURLs と同じ包み方であることを、配布物の本文で確かめる。
  assert(
    packagerSource.includes(
      'const e=`(function(Scratch) { ${await O.fetchExtensionScript(n)} })(Scratch);`,t=`data:text/javascript;,${encodeURIComponent(e)}`',
    ),
    'The Packager changed how it bakes extensions; update bakedExtensionDataUrl.',
  );
  assert.equal(
    bakedExtensionDataUrl('x()'),
    `data:text/javascript;,${encodeURIComponent('(function(Scratch) { x() })(Scratch);')}`,
  );
});

test('refuses extensions that are not vendored or do not match the lock', async () => {
  const lock = await readVendoredExtensionsLock();
  const [entry] = lock.extensions;
  assert(entry);
  await assert.rejects(
    bakeVendoredExtensionUrls(['https://extensions.turbowarp.org/not-vendored.js'], lock),
    /is not vendored/u,
  );
  await assert.rejects(
    readVendoredExtension({...lock, extensions: [{...entry, sha256: '0'.repeat(64)}]}, entry.url),
    /SHA-256 mismatch/u,
  );
});

test('maps only extensions.turbowarp.org URLs to safe vendored paths', () => {
  assert.equal(
    vendoredPathForUrl('https://extensions.turbowarp.org/Lily/MoreTimers.js'),
    'extensions.turbowarp.org/Lily/MoreTimers.js',
  );
  assert.throws(
    () => vendoredPathForUrl('https://example.com/text.js'),
    /Unsupported extension origin/u,
  );
  assert.throws(
    () => vendoredPathForUrl('https://extensions.turbowarp.org/text.js?v=1'),
    /must not have a query/u,
  );
  assert.throws(
    () => vendoredPathForUrl('https://extensions.turbowarp.org/a%20b.js'),
    /Unsupported extension path/u,
  );
});
