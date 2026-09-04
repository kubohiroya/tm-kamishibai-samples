import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {test} from 'vitest';

import {
  packagerScratchRenderContract,
  patchPackagerScratchRenderReadbackContext,
} from '../scripts/patch-packager-scratch-render.ts';

const require = createRequire(import.meta.url);
const packagerEntry = require.resolve('@turbowarp/packager');
const scaffoldingDirectory = path.resolve(path.dirname(packagerEntry), 'scaffolding');
const readbackContext = 'getContext("2d")';
const optimizedReadbackContext = 'getContext("2d",{willReadFrequently:!0})';

function count(source: string, token: string): number {
  return source.split(token).length - 1;
}

test('pins the reviewed Packager and scratch-render contract', () => {
  assert.equal(packagerScratchRenderContract.packagerVersion, '3.13.0');
  assert.equal(
    packagerScratchRenderContract.fixedCommit,
    '1fa6cc7d23e12aabf8db16e8e3ce400538f44165',
  );
  assert.equal(packagerScratchRenderContract.upstreamPullRequest, 21);
});

for (const filename of ['scaffolding-min.js', 'scaffolding-full.js']) {
  test(`patches only the silhouette readback context in ${filename}`, async () => {
    const sourceBytes = new Uint8Array(await readFile(path.join(scaffoldingDirectory, filename)));
    const source = new TextDecoder().decode(sourceBytes);
    const patched = new TextDecoder().decode(
      patchPackagerScratchRenderReadbackContext(sourceBytes),
    );

    assert.equal(count(patched, optimizedReadbackContext), 2);
    assert.equal(count(patched, readbackContext), count(source, readbackContext) - 2);
    assert.equal(patched.replaceAll(optimizedReadbackContext, readbackContext), source);
  });
}

test('fails closed when the pinned Packager template drifts', () => {
  const unrelated = new TextEncoder().encode(
    '<script>document.createElement("canvas").getContext("2d")</script>',
  );
  assert.throws(
    () => patchPackagerScratchRenderReadbackContext(unrelated),
    /PACKAGER_READBACK_TEMPLATE_DRIFT/u,
  );
});
