import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'vitest';
import {fileURLToPath} from 'node:url';

import {
  renderMyUrashimaIndex,
  renderRootIndex,
  renderSampleIndex,
  verifyConfiguredWebBuild,
} from '../scripts/build-site.ts';
import type {
  MyUrashimaDsl4Manifest,
  SiteManifest,
} from '../scripts/site-manifest.ts';
import type {ArtifactsLock} from '../scripts/story-config.ts';
import {readWorksCatalog} from '../scripts/works-catalog.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('keeps disabled DSL 4.0 Web locks reusable without publishing active links', async () => {
  const worksCatalog = await readWorksCatalog(path.join(projectRoot, 'site/works.json'));
  const manifest = {
    updatedAt: '2026-08-13',
    web: {
      enabled: true,
      output: {size: 14_951_564, sha256: 'dsl3-web'},
      packager: {version: '3.13.0'},
    },
    dsl4Web: {enabled: false},
    script: {size: 8_729},
    source: {dsl4Script: {size: 16_589}},
    profiles: {
      player: {sb3: {size: 9_593_830, sha256: 'player'}},
      editor: {sb3: {size: 9_591_520, sha256: 'editor'}},
    },
    dsl4Offline: {size: 35_024_283, sha256: 'dsl4-sb3'},
    assetCounts: {images: 0, sounds: 0, embedded: 0},
    assets: [],
    // レンダラが読む項目だけを持つ部分フィクスチャ。
  } as unknown as SiteManifest;
  const myDsl4Manifest = {
    source: {size: 13_426},
    output: {size: 16_987_940, sha256: 'my-dsl4-sb3'},
    web: {enabled: false},
  } as unknown as MyUrashimaDsl4Manifest;
  const myDsl32Artifacts = {
    output: {sb3: {size: 9_806_584}, script: {size: 8_522}},
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
  assert(rootIndex.includes('<time datetime="2026-08-16">2026年8月16日</time>'));
  assert(rootIndex.includes('href="stories/urashima/web/"'));
  assert(!rootIndex.includes('href="stories/urashima/web-4.0/"'));
  assert(!rootIndex.includes('href="stories/my-urashima/web-4.0/"'));
  assert.equal(
    (rootIndex.match(/disabled aria-disabled="true">Web版（準備中）<\/button>/gu) ?? [])
      .length,
    2,
  );

  const urashima = worksCatalog.works.find(({id}) => id === 'urashima');
  assert.ok(urashima, 'urashima must exist in the works catalog');
  const sampleIndex = renderSampleIndex(manifest, urashima);
  assert(sampleIndex.includes('15 MB（14,951,564 bytes）'));
  assert(sampleIndex.includes('8.7 KB（8,729 bytes）'));
  assert(!sampleIndex.includes('href="web-4.0/"'));
  assert(sampleIndex.includes('disabled aria-disabled="true">Web版（準備中）</button>'));
  assert(!sampleIndex.includes('preserved-enabled-lock'));
  assert(sampleIndex.includes('src="card-scenes.gif"'));
  assert(sampleIndex.includes('data-work-carousel="urashima"'));

  const myUrashima = worksCatalog.works.find(({id}) => id === 'my-urashima');
  assert.ok(myUrashima, 'my-urashima must exist in the works catalog');
  const myIndex = renderMyUrashimaIndex(
    myUrashima,
    myDsl4Manifest,
    myDsl32Artifacts as unknown as ArtifactsLock,
  );
  assert(myIndex.includes('9.8 MB（9,806,584 bytes）'));
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
