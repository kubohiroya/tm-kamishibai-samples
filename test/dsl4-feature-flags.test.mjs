import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  renderMyUrashimaIndex,
  renderRootIndex,
  renderSampleIndex,
  verifyConfiguredWebBuild,
} from '../scripts/build-site.mjs';
import {readWorksCatalog} from '../scripts/works-catalog.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('keeps disabled DSL 4.0 Web locks reusable without publishing active links', async () => {
  const worksCatalog = await readWorksCatalog(path.join(projectRoot, 'site/works.json'));
  const manifest = {
    web: {
      enabled: true,
      output: {sha256: 'dsl3-web'},
      packager: {version: '3.13.0'},
    },
    dsl4Web: {enabled: false},
    profiles: {
      player: {sb3: {sha256: 'player'}},
      editor: {sb3: {sha256: 'editor'}},
    },
    dsl4Offline: {sha256: 'dsl4-sb3'},
    assetCounts: {images: 0, sounds: 0, embedded: 0},
    assets: [],
  };
  const myDsl4Manifest = {
    output: {sha256: 'my-dsl4-sb3'},
    web: {enabled: false},
  };
  const enabledLock = {
    enabled: true,
    output: {sha256: 'preserved-enabled-lock'},
  };

  assert.doesNotThrow(() =>
    verifyConfiguredWebBuild(
      {enabled: false},
      {enabled: false},
      enabledLock,
      'disabled fixture',
    ),
  );
  assert.doesNotThrow(() =>
    verifyConfiguredWebBuild({enabled: false}, undefined, enabledLock, 'default fixture'),
  );

  const rootIndex = renderRootIndex(manifest, myDsl4Manifest, worksCatalog);
  assert(rootIndex.includes('href="stories/urashima/web/"'));
  assert(!rootIndex.includes('href="stories/urashima/web-4.0/"'));
  assert(!rootIndex.includes('href="stories/my-urashima/web-4.0/"'));
  assert.equal(
    (rootIndex.match(/disabled aria-disabled="true">Web版（準備中）<\/button>/gu) ?? [])
      .length,
    2,
  );

  const sampleIndex = renderSampleIndex(manifest);
  assert(!sampleIndex.includes('href="web-4.0/"'));
  assert(sampleIndex.includes('disabled aria-disabled="true">Web版（準備中）</button>'));
  assert(!sampleIndex.includes('preserved-enabled-lock'));

  const myUrashima = worksCatalog.works.find(({id}) => id === 'my-urashima');
  const myIndex = renderMyUrashimaIndex(myUrashima, myDsl4Manifest);
  assert(!myIndex.includes('href="web-4.0/"'));
  assert(myIndex.includes('disabled aria-disabled="true">Web版（準備中）</button>'));
  assert(!myIndex.includes('preserved-enabled-lock'));
});

test('requires an enabled DSL 4.0 Web build to match its artifact lock', () => {
  const enabledWeb = {
    enabled: true,
    output: {sha256: 'current'},
  };
  assert.doesNotThrow(() =>
    verifyConfiguredWebBuild(enabledWeb, {enabled: true}, enabledWeb, 'enabled fixture'),
  );
  assert.throws(
    () =>
      verifyConfiguredWebBuild(
        enabledWeb,
        {enabled: true},
        {...enabledWeb, output: {sha256: 'stale'}},
        'enabled fixture',
      ),
    /lock is stale/u,
  );
});
