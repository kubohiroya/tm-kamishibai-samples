import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access, readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {validateBundle} from '@kubohiroya/tmpose-kamishibai/builder';

import {verifyMyUrashimaOutput} from './build-my-urashima.mjs';
import {NAVIGATION_CONTRACT, renderSiteNavigation} from './site-navigation.mjs';
import {validateWorksCatalog} from './works-catalog.mjs';

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.join(prefix, entry.name);
      if (entry.isDirectory()) return listFiles(path.join(directory, entry.name), relativePath);
      return entry.isFile() ? [relativePath] : [];
    }),
  );
  return files.flat().sort();
}

async function listFilesIfPresent(directory) {
  try {
    return await listFiles(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function localLinks(html) {
  return [...html.matchAll(/\bhref="([^"]+)"/gu)]
    .map((match) => match[1])
    .filter((href) => !/^(?:https?:|mailto:|#)/u.test(href));
}

async function verifyLinks(htmlPath) {
  const html = await readFile(htmlPath, 'utf8');
  for (const href of localLinks(html)) {
    const target = path.resolve(path.dirname(htmlPath), decodeURIComponent(href));
    await access(target);
  }
  return html;
}

async function verifyFile(outputSampleDirectory, record, description) {
  const contents = await readFile(path.join(outputSampleDirectory, record.path));
  assert.equal(contents.length, record.size, `${description} size mismatch.`);
  assert.equal(sha256(contents), record.sha256, `${description} SHA-256 mismatch.`);
  return contents;
}

async function verifyProfile(outputSampleDirectory, profile, record) {
  assert.equal(record.profile, profile);
  assert.equal(record.assets, 'embedded');
  assert.equal(record.scriptMode, profile === 'player' ? 'embedded' : 'external');
  const [sb3Contents, scriptContents, builderManifestContents] = await Promise.all([
    verifyFile(outputSampleDirectory, record.sb3, `${profile} SB3`),
    verifyFile(outputSampleDirectory, record.script, `${profile} script`),
    readFile(path.join(outputSampleDirectory, record.builderManifest.path)),
  ]);
  assert.equal(sha256(builderManifestContents), record.builderManifest.sha256);
  const builderManifest = JSON.parse(builderManifestContents.toString('utf8'));
  assert.equal(builderManifest.profile, profile);
  assert.equal(builderManifest.outputName, record.outputName);
  assert.equal(builderManifest.assets.length, 44);
  assert.equal(builderManifest.builder.package, '@kubohiroya/tmpose-kamishibai');
  assert.equal(builderManifest.builder.version, '3.2.2');
  validateBundle({sb3Bytes: sb3Contents, scriptBytes: scriptContents, manifest: builderManifest});
  assert.equal(/^(?:asset=.*,(?:file|https?):)/mu.test(scriptContents.toString('utf8')), false);
  return {builderManifest, sb3Contents, scriptContents};
}

function verifySiteHeader(html, assetPrefix) {
  const destinations = NAVIGATION_CONTRACT.items.map(({href}) => href);

  assert(html.includes('<a class="skip-link" href="#main-content">本文へ移動</a>'));
  assert(html.includes('<header class="site-header">'));
  assert(html.includes(`<link rel="stylesheet" href="${assetPrefix}site-shell.css">`));
  assert(
    html.includes(
      `<img class="site-brand__symbol" src="${assetPrefix}favicon.png" width="40" height="40" alt="">`,
    ),
  );
  assert(html.includes('<main id="main-content">'));
  assert(html.includes(`data-navigation-contract-version="${NAVIGATION_CONTRACT.contractVersion}"`));
  for (const destination of destinations) {
    assert(html.includes(`href="${destination}"`), `Missing site destination: ${destination}`);
  }
  assert.equal((html.match(/aria-current="page"/gu) ?? []).length, 1);
  assert(
    html.includes(
      '<a class="site-nav__link" href="https://kubohiroya.github.io/tmpose-kamishibai-docs/workshops/">ワークショップ</a>',
    ),
  );
  assert(
    html.includes(
      renderSiteNavigation({
        site: 'tmpose-kamishibai-samples',
        pathname: '/tmpose-kamishibai-samples/',
      }),
    ),
  );
  assert(
    html.includes(
      '<a class="site-repository" href="https://github.com/kubohiroya/tmpose-kamishibai-samples" target="_blank" rel="noopener" aria-label="tmpose-kamishibai-samplesをGitHubで開く" title="tmpose-kamishibai-samplesをGitHubで開く">',
    ),
  );
  assert(html.includes('<svg class="site-repository__icon"'));
}

function verifySiteFooter(html, assetPrefix) {
  assert.equal(
    (html.match(/<footer class="site-footer" data-site-footer-version="1">/gu) ?? []).length,
    1,
  );
  const footer = html.match(/<footer class="site-footer"[\s\S]*?<\/footer>/u)?.[0] ?? '';
  assert(footer.includes('© 2026 Hiroya Kubo'));
  assert(footer.includes('各文書・作品・素材には個別の利用条件が適用されます。'));
  assert(
    footer.includes(
      '<a class="site-footer__rights" href="https://kubohiroya.github.io/tmpose-kamishibai-samples/licenses/">ライセンス・権利表示</a>',
    ),
  );
  assert(
    footer.includes(
      `<img class="site-footer__symbol" src="${assetPrefix}favicon.png" width="36" height="36" alt="">`,
    ),
  );
  assert(!footer.includes('github.com'));
}

export async function verifyPublishedSite(options = {}) {
  const projectRoot = options.projectRoot ?? fileURLToPath(new URL('../', import.meta.url));
  const outputDirectory = options.outputDirectory ?? path.join(projectRoot, 'dist');
  const sourceDirectory = options.sourceDirectory ?? path.join(projectRoot, 'stories/urashima');
  const outputSampleDirectory = path.join(outputDirectory, 'stories/urashima');
  const myUrashimaSourceDirectory = path.join(projectRoot, 'stories/my-urashima');
  const myUrashimaOutputDirectory = path.join(outputDirectory, 'stories/my-urashima');

  const [
    sourceFiles,
    publishedFiles,
    webFiles,
    dsl4WebFiles,
    myDsl4WebFiles,
    rootIndex,
    sampleIndex,
    myUrashimaIndex,
    tutorialIndex,
    rightsIndex,
    manifest,
    myDsl4Manifest,
    dsl4Config,
    myDsl4Config,
    packageJson,
    license,
    licenseSummary,
    runtimeLicense,
    packagerNotice,
    worksCatalog,
    worksSchema,
    worksPolicy,
  ] =
    await Promise.all([
      listFiles(sourceDirectory),
      listFiles(outputDirectory),
      listFiles(path.join(outputSampleDirectory, 'web')),
      listFilesIfPresent(path.join(outputSampleDirectory, 'web-4.0')),
      listFilesIfPresent(path.join(myUrashimaOutputDirectory, 'web-4.0')),
      verifyLinks(path.join(outputDirectory, 'index.html')),
      verifyLinks(path.join(outputSampleDirectory, 'index.html')),
      verifyLinks(path.join(myUrashimaOutputDirectory, 'index.html')),
      verifyLinks(path.join(outputDirectory, 'stories/tutorial/index.html')),
      verifyLinks(path.join(outputDirectory, 'licenses/index.html')),
      readFile(path.join(outputSampleDirectory, 'manifest.json'), 'utf8').then(JSON.parse),
      readFile(path.join(myUrashimaOutputDirectory, 'dsl4-manifest.json'), 'utf8').then(
        JSON.parse,
      ),
      readFile(path.join(sourceDirectory, 'dsl4-build.config.json'), 'utf8').then(JSON.parse),
      readFile(path.join(myUrashimaSourceDirectory, 'dsl4-build.config.json'), 'utf8').then(
        JSON.parse,
      ),
      readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
      readFile(path.join(outputDirectory, 'LICENSE'), 'utf8'),
      readFile(path.join(outputSampleDirectory, 'LICENSES.md'), 'utf8'),
      readFile(
        path.join(
          outputSampleDirectory,
          'licenses/tmpose-kamishibai-MPL-2.0.txt',
        ),
        'utf8',
      ),
      readFile(
        path.join(outputSampleDirectory, 'licenses/turbowarp-packager-NOTICE.md'),
        'utf8',
      ),
      readFile(path.join(outputDirectory, 'works.json'), 'utf8').then(JSON.parse),
      readFile(path.join(outputDirectory, 'works.schema.json'), 'utf8').then(JSON.parse),
      readFile(path.join(outputDirectory, 'WORKS_POLICY.md'), 'utf8'),
    ]);

  const dsl4WebEnabled = dsl4Config.web?.enabled === true;
  const myDsl4WebEnabled = myDsl4Config.web?.enabled === true;

  validateWorksCatalog(worksCatalog);
  for (const work of worksCatalog.works.filter(({distribution}) => distribution === 'hosted')) {
    assert(work.thumbnail, `${work.id} is missing its representative scene image.`);
    const thumbnail = await stat(path.join(outputDirectory, work.thumbnail.src));
    assert(thumbnail.isFile(), `${work.id} thumbnail is not a file.`);
    assert(thumbnail.size > 0, `${work.id} thumbnail is empty.`);
    assert(thumbnail.size <= 200_000, `${work.id} animated thumbnail exceeds 200 KB.`);
    assert.equal(path.extname(work.thumbnail.src), '.gif', `${work.id} thumbnail must be a GIF.`);
    for (const [index, slide] of work.thumbnail.slides.entries()) {
      const scene = await stat(path.join(outputDirectory, slide.src));
      assert(scene.isFile(), `${work.id} scene ${index + 1} is not a file.`);
      assert(scene.size > 0, `${work.id} scene ${index + 1} is empty.`);
      assert(scene.size <= 250_000, `${work.id} scene ${index + 1} exceeds 250 KB.`);
      assert.equal(path.extname(slide.src), '.webp', `${work.id} scene ${index + 1} must be WebP.`);
    }
  }
  assert.equal(
    worksSchema.$id,
    'https://kubohiroya.github.io/tmpose-kamishibai-samples/works.schema.json',
  );
  assert(worksPolicy.includes('## 公式サンプル'));
  assert(worksPolicy.includes('## コミュニティ作品'));
  assert(worksPolicy.includes('## 外部作品'));

  for (const relativePath of sourceFiles) {
    const [source, published] = await Promise.all([
      readFile(path.join(sourceDirectory, relativePath)),
      readFile(path.join(outputSampleDirectory, relativePath)),
    ]);
    assert(source.equals(published), `Published file differs from source: ${relativePath}`);
  }
  const [myUrashimaDsl4Source, myUrashimaDsl4Published] = await Promise.all([
    readFile(path.join(myUrashimaSourceDirectory, 'my-urashima.k4.yml')),
    readFile(path.join(myUrashimaOutputDirectory, 'my-urashima.k4.yml')),
  ]);
  assert(
    myUrashimaDsl4Source.equals(myUrashimaDsl4Published),
    'Published my-urashima DSL 4.0 YAML differs from source.',
  );
  assert(myUrashimaDsl4Published.toString('utf8').startsWith('kamishibai: "4.0"\n'));

  assert.equal(manifest.formatVersion, 5);
  assert.equal(manifest.sample, 'urashima');
  assert.equal(
    manifest.publicUrl,
    'https://kubohiroya.github.io/tmpose-kamishibai-samples/stories/urashima/',
  );
  assert.equal(manifest.license, 'MPL-2.0');
  assert.equal(manifest.builder.version, '3.2.2');
  assert.equal(packageJson.devDependencies['@turbowarp/packager'], '3.13.0');
  assert.equal(manifest.baseSb3.profile, 'generic');
  assert.equal(manifest.baseSb3.published, true);
  assert.deepEqual(manifest.assetCounts, {images: 26, sounds: 22, embedded: 44});
  assert.equal(manifest.assets.length, 48);
  assert.deepEqual(manifest.unusedSourceAssets, [
    'assets/images/47282ff0f7047c6fab9c94b531abf721.png',
    'assets/images/b6c18d2f3df8b5d12e2b6a529109fec2.svg',
    'assets/sounds/9d01505050dea4f782cd59635bcbab63.mp3',
    'assets/sounds/ab4760e0c9f0db6d1f5e83e3a0e9bf4f.mp3',
  ]);
  assert.equal(manifest.dsl4Offline.path, 'urashima-4.0.sb3');
  assert.equal(manifest.dsl4Offline.sourceAssetCount, 49);
  assert.equal(manifest.dsl4Offline.embeddedFileCount, 55);
  assert.equal(
    manifest.dsl4Offline.runtimeCommit,
    '29c0deadcb98badf94a0244c479ca896dc71f842',
  );
  assert.deepEqual(manifest.dsl4Offline.sb3Toolchain, {
    package: '@kubohiroya/sb3-toolchain',
    version: '0.6.0',
  });
  assert.equal(
    manifest.assets
      .filter((asset) => asset.path.startsWith('assets/sounds/'))
      .every((asset) => asset.contentType === 'audio/mpeg' && asset.path.endsWith('.mp3')),
    true,
  );
  for (const asset of manifest.assets) {
    await verifyFile(outputSampleDirectory, asset, asset.path);
  }

  const [
    editor,
    player,
    dsl4Offline,
    publicScript,
    baseSb3,
    sourceScript,
    dsl4Script,
    assetManifest,
  ] =
    await Promise.all([
      verifyProfile(outputSampleDirectory, 'editor', manifest.profiles.editor),
      verifyProfile(outputSampleDirectory, 'player', manifest.profiles.player),
      verifyFile(outputSampleDirectory, manifest.dsl4Offline, 'DSL 4.0 offline SB3'),
      verifyFile(outputSampleDirectory, manifest.script, 'public script'),
      verifyFile(outputSampleDirectory, manifest.baseSb3, 'generic base SB3'),
      verifyFile(outputSampleDirectory, manifest.source.script, 'source script'),
      verifyFile(outputSampleDirectory, manifest.source.dsl4Script, 'DSL 4.0 script'),
      verifyFile(outputSampleDirectory, manifest.source.assetManifest, 'asset manifest'),
    ]);
  assert(editor.scriptContents.equals(player.scriptContents));
  assert(player.scriptContents.equals(publicScript));
  assert.equal(editor.builderManifest.script.mode, 'external');
  assert.equal(editor.builderManifest.script.embeddedVariableId, null);
  assert.equal(player.builderManifest.script.mode, 'embedded');
  assert.equal(player.builderManifest.script.embeddedVariableId, 'tmposeEmbeddedScript');
  assert.equal(baseSb3.length, manifest.baseSb3.size);
  assert(dsl4Offline.length > baseSb3.length);
  assert(sourceScript.includes(Buffer.from('file:assets/')));
  assert(dsl4Script.toString('utf8').startsWith('kamishibai: "4.0"\n'));
  assert.equal(JSON.parse(assetManifest.toString('utf8')).assets.length, 44);

  assert.equal(manifest.web.enabled, true);
  assert.equal(manifest.web.publicPath, 'web/');
  assert.equal(manifest.web.packager.package, '@turbowarp/packager');
  assert.equal(manifest.web.packager.version, '3.13.0');
  assert.deepEqual(manifest.web.packager.options, {
    target: 'html',
    autoplay: true,
    app: {windowTitle: '浦島太郎 | TMPose紙芝居'},
    cloudVariables: {mode: 'disabled'},
    bakeExtensions: true,
  });
  assert.deepEqual(manifest.web.audioUnlock, {
    enabled: true,
    events: ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'click', 'keydown'],
    lifecycleEvents: ['visibilitychange', 'pageshow'],
    verification: {
      strategy: 'state-and-clock',
      clockCheckDelayMs: 250,
      primesOutput: true,
    },
  });
  assert.equal(manifest.web.packager.projectExtensions.length, 12);
  assert(
    manifest.web.packager.projectExtensions.some(({id}) => id === 'tmposebundle'),
    'TMPose extension bundle is missing from the Packager manifest.',
  );
  assert.equal(manifest.web.scriptMode, 'embedded');
  assert.equal(manifest.web.assets, 'embedded');
  assert.deepEqual(manifest.web.reproducibility, {runs: 2, identical: true});
  assert.deepEqual(manifest.web.input, {
    profile: 'player',
    path: manifest.profiles.player.sb3.path,
    size: manifest.profiles.player.sb3.size,
    sha256: manifest.profiles.player.sb3.sha256,
  });
  const webHtml = await verifyFile(outputSampleDirectory, manifest.web.output, 'Packager HTML');
  assert.deepEqual(webFiles, ['index.html']);
  assert(webHtml.length > 0);
  assert(webHtml.length <= 104857600);
  assert(webHtml.toString('utf8', 0, 128).startsWith('<!DOCTYPE html>'));
  assert(webHtml.includes(Buffer.from('<title>浦島太郎 | TMPose紙芝居</title>')));
  assert(!webHtml.includes(Buffer.from('class="site-footer"')));
  assert.deepEqual(
    manifest.web.allowedOnlineDependencies.map(({urlPrefix}) => urlPrefix),
    [
      'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/',
      'https://cdn.jsdelivr.net/npm/@teachablemachine/pose@0.8.3/',
      'https://sqs.prof.cuc.ac.jp/kamishibai/20260630/',
    ],
  );
  assert.deepEqual(
    manifest.web.runtimeCapabilities.map(({capability}) => capability),
    ['camera', 'audio'],
  );

  assert.equal(manifest.dsl4Web.enabled, dsl4WebEnabled);
  if (dsl4WebEnabled) {
    assert.equal(manifest.dsl4Web.publicPath, 'web-4.0/');
    assert.equal(manifest.dsl4Web.input.profile, 'dsl4-offline');
    assert.equal(manifest.dsl4Web.input.path, 'urashima-4.0.sb3');
    assert.equal(manifest.dsl4Web.input.sha256, manifest.dsl4Offline.sha256);
    assert.equal(manifest.dsl4Web.scriptMode, 'embedded');
    assert.equal(manifest.dsl4Web.assets, 'embedded');
    assert.deepEqual(manifest.dsl4Web.allowedOnlineDependencies, []);
    assert.deepEqual(
      manifest.dsl4Web.runtimeCapabilities.map(({capability}) => capability),
      ['camera', 'audio'],
    );
    assert.deepEqual(manifest.dsl4Web.reproducibility, {runs: 2, identical: true});
    const dsl4WebHtml = await verifyFile(
      outputSampleDirectory,
      manifest.dsl4Web.output,
      'DSL 4.0 Packager HTML',
    );
    assert.deepEqual(dsl4WebFiles, ['index.html']);
    assert(dsl4WebHtml.includes(Buffer.from('<title>浦島太郎 DSL 4.0 | TMPose紙芝居</title>')));
  } else {
    assert.deepEqual(manifest.dsl4Web, {enabled: false});
    assert.deepEqual(dsl4WebFiles, []);
  }

  assert.equal(myDsl4Manifest.sample, 'my-urashima');
  assert.equal(
    myDsl4Manifest.publicUrl,
    'https://kubohiroya.github.io/tmpose-kamishibai-samples/stories/my-urashima/',
  );
  assert.equal(myDsl4Manifest.output.path, 'my-urashima-4.0.sb3');
  assert.deepEqual(myDsl4Manifest.output.princessCostumes, ['Princess']);
  assert.equal(myDsl4Manifest.web.enabled, myDsl4WebEnabled);
  await verifyFile(
    myUrashimaOutputDirectory,
    myDsl4Manifest.output,
    'my-urashima DSL 4.0 workshop SB3',
  );
  if (myDsl4WebEnabled) {
    assert.equal(myDsl4Manifest.web.publicPath, 'web-4.0/');
    assert.equal(myDsl4Manifest.web.input.profile, 'dsl4-workshop');
    assert.equal(myDsl4Manifest.web.input.path, 'my-urashima-4.0.sb3');
    assert.equal(myDsl4Manifest.web.input.sha256, myDsl4Manifest.output.sha256);
    assert.equal(myDsl4Manifest.web.scriptMode, 'external');
    assert.equal(myDsl4Manifest.web.assets, 'embedded-project');
    assert.deepEqual(
      myDsl4Manifest.web.runtimeCapabilities.map(({capability}) => capability),
      ['file-picker', 'camera', 'audio'],
    );
    assert.deepEqual(myDsl4Manifest.web.reproducibility, {runs: 2, identical: true});
    const myDsl4WebHtml = await verifyFile(
      myUrashimaOutputDirectory,
      myDsl4Manifest.web.output,
      'my-urashima DSL 4.0 Packager HTML',
    );
    assert.deepEqual(myDsl4WebFiles, ['index.html']);
    assert(
      myDsl4WebHtml.includes(
        Buffer.from('<title>my-urashima DSL 4.0 | TMPose紙芝居</title>'),
      ),
    );
  } else {
    assert.deepEqual(myDsl4Manifest.web, {enabled: false});
    assert.deepEqual(myDsl4WebFiles, []);
  }

  assert(license.startsWith('Mozilla Public License Version 2.0'));
  assert(runtimeLicense.startsWith('Mozilla Public License Version 2.0'));
  assert.equal(runtimeLicense, license);
  assert(licenseSummary.includes('MPL-2.0'));
  assert(licenseSummary.includes('tmpose-kamishibai-MPL-2.0.txt'));
  assert(!licenseSummary.includes('tmpose-kamishibai-MIT.txt'));
  assert(licenseSummary.includes('turbowarp-packager-NOTICE.md'));
  assert(licenseSummary.includes('3.2 Web版'));
  assert(licenseSummary.includes('urashima-4.0.sb3'));
  assert(licenseSummary.includes('実行時のモデル取得は不要'));
  assert(packagerNotice.includes('Copyright (C) 2021-2024 Thomas Weber'));
  assert(packagerNotice.includes('MPL-2.0'));
  verifySiteHeader(rootIndex, '');
  verifySiteHeader(sampleIndex, '../../');
  verifySiteHeader(tutorialIndex, '../../');
  verifySiteHeader(rightsIndex, '../');
  verifySiteFooter(rootIndex, '');
  verifySiteFooter(sampleIndex, '../../');
  verifySiteFooter(tutorialIndex, '../../');
  verifySiteFooter(rightsIndex, '../');
  assert(rootIndex.includes('<title>TMPose紙芝居 作品ライブラリ</title>'));
  assert(rootIndex.includes('<h1>TMPose紙芝居 作品ライブラリ</h1>'));
  assert(rootIndex.includes('.work-list { display: grid; grid-template-columns: 1fr;'));
  assert(!rootIndex.includes('repeat(auto-fit'));
  assert(rightsIndex.includes('<h1>ライセンス・権利表示</h1>'));
  assert(rightsIndex.includes('外部作品'));
  assert(rightsIndex.includes('Urashima-walk-1'));
  assert(rightsIndex.includes('Mozilla Public License 2.0'));
  assert(rightsIndex.includes('CC BY-SA 2.0'));
  assert(sampleIndex.includes('<title>浦島太郎 | TMPose紙芝居 作品ライブラリ</title>'));
  assert(sampleIndex.includes('aria-label="作品内ナビゲーション"'));
  assert(sampleIndex.includes('>作品一覧へ戻る</a>'));
  assert(sampleIndex.includes('<dt>対応DSL</dt><dd>3.2／4.0</dd>'));
  assert(sampleIndex.includes('<dt>掲載形態</dt><dd>当サイトで配布</dd>'));
  assert(sampleIndex.includes('<dt>ライセンス・利用条件</dt>'));
  assert(sampleIndex.includes('src="card-scenes.gif"'));
  assert(sampleIndex.includes('data-work-carousel="urashima"'));
  assert(sampleIndex.includes('src="card-scenes/04.webp"'));
  assert(sampleIndex.includes('href="../../CARD_SCENES.md"'));
  assert(
    myUrashimaIndex.includes(
      '<title>my-urashima（ワークショップにおける作業用） | TMPose紙芝居 作品ライブラリ</title>',
    ),
  );
  assert(myUrashimaIndex.includes('<dt>対応DSL</dt><dd>3.2／4.0</dd>'));
  assert(myUrashimaIndex.includes('<dt>掲載形態</dt><dd>当サイトで配布</dd>'));
  assert(myUrashimaIndex.includes('<dt>ライセンス・利用条件</dt>'));
  assert(myUrashimaIndex.includes('src="card-scenes.gif"'));
  assert(myUrashimaIndex.includes('data-work-carousel="my-urashima"'));
  assert(myUrashimaIndex.includes('src="card-scenes/04.webp"'));
  assert(myUrashimaIndex.includes('href="../../CARD_SCENES.md"'));
  assert(tutorialIndex.includes('src="card-scenes.gif"'));
  assert(tutorialIndex.includes('data-work-carousel="tutorial-earthquake-safety"'));
  assert(tutorialIndex.includes('src="card-scenes/05.webp"'));
  assert(tutorialIndex.includes('href="../../CARD_SCENES.md"'));
  for (const detailIndex of [sampleIndex, myUrashimaIndex, tutorialIndex]) {
    assert(detailIndex.includes('>作品の場面紹介</h2>'));
    assert(detailIndex.includes('data-work-carousel-previous'));
    assert(detailIndex.includes('data-work-carousel-next'));
    assert(detailIndex.includes('role="status" aria-live="polite"'));
    assert(detailIndex.includes('ArrowLeft'));
    assert(detailIndex.includes('ArrowRight'));
  }
  assert(myUrashimaIndex.includes('data-dsl-series="3.2"'));
  assert(myUrashimaIndex.includes('data-dsl-series="4.0"'));
  assert(myUrashimaIndex.includes('my-urashima.k4.yml'));
  assert(!rootIndex.includes('>GitHubリポジトリ</a>'));
  assert(!rootIndex.includes('https://kubohiroya.github.io/tmpose-kamishibai/stories/'));
  assert(sampleIndex.includes(manifest.profiles.player.sb3.sha256));
  assert(sampleIndex.includes(manifest.profiles.editor.sb3.sha256));
  assert(sampleIndex.includes(manifest.web.output.sha256));
  assert.equal(
    dsl4WebEnabled
      ? sampleIndex.includes(manifest.dsl4Web.output.sha256)
      : sampleIndex.includes('Web版（準備中）') && !sampleIndex.includes('href="web-4.0/"'),
    true,
  );
  assert(myUrashimaIndex.includes(myDsl4Manifest.output.sha256));
  assert.equal(
    myDsl4WebEnabled
      ? myUrashimaIndex.includes(myDsl4Manifest.web.output.sha256)
      : myUrashimaIndex.includes('Web版（準備中）') &&
          !myUrashimaIndex.includes('href="web-4.0/"'),
    true,
  );
  const urashimaCard = rootIndex.slice(
    rootIndex.indexOf('data-work-id="urashima"'),
    rootIndex.indexOf('data-work-id="my-urashima"'),
  );
  const rootDsl32Actions = urashimaCard.slice(
    urashimaCard.indexOf('data-action-group="DSL 3.2 実行版"'),
    urashimaCard.indexOf('data-action-group="DSL 4.0 オフライン実行版"'),
  );
  const rootDsl40Actions = urashimaCard.slice(
    urashimaCard.indexOf('data-action-group="DSL 4.0 オフライン実行版"'),
  );
  assert(
    urashimaCard.includes(
      '<h3><a class="work-card__title-link" href="stories/urashima/">浦島太郎</a></h3>',
    ),
  );
  assert(urashimaCard.includes('src="stories/urashima/card-scenes.gif"'));
  assert(
    urashimaCard.includes(
      'srcset="stories/urashima/card-scenes/01.webp"',
    ),
  );
  assert(urashimaCard.includes('data-scene-gallery="urashima"'));
  assert(urashimaCard.includes('aria-haspopup="dialog"'));
  assert(urashimaCard.includes('loading="lazy" decoding="async"'));
  assert(urashimaCard.includes('4場面のループ画像：Hiroya Kuboおよび個別素材の権利者'));
  assert(rootDsl32Actions.includes('<h4>DSL 3.2 実行版</h4>'));
  assert(rootDsl32Actions.includes('Web版を開く'));
  assert(rootDsl32Actions.includes('DSL 3.2台本を表示'));
  assert(rootDsl32Actions.includes('再生用SB3をダウンロード'));
  assert(!rootDsl32Actions.includes('urashima.k4.yml'));
  assert(rootDsl40Actions.includes('<h4>DSL 4.0 オフライン実行版</h4>'));
  assert(rootDsl40Actions.includes('urashima.k4.yml'));
  assert(rootDsl40Actions.includes('urashima-4.0.sb3'));
  assert.equal(
    dsl4WebEnabled
      ? rootDsl40Actions.includes('href="stories/urashima/web-4.0/"')
      : rootDsl40Actions.includes('disabled aria-disabled="true">Web版（準備中）</button>') &&
          !rootDsl40Actions.includes('href="stories/urashima/web-4.0/"'),
    true,
  );
  assert(rootDsl40Actions.includes('オフラインSB3をダウンロード'));
  assert(!urashimaCard.includes('data-action-group="作品情報"'));
  assert(!urashimaCard.includes('>manifest</a>'));
  assert(!urashimaCard.includes('>詳細を見る</a>'));
  const myUrashimaCard = rootIndex.slice(
    rootIndex.indexOf('data-work-id="my-urashima"'),
    rootIndex.indexOf('<h2 id="category-community">コミュニティ作品</h2>'),
  );
  assert(
    myUrashimaCard.includes(
      '<h3><a class="work-card__title-link" href="stories/my-urashima/">my-urashima（ワークショップにおける作業用）</a></h3>',
    ),
  );
  assert(myUrashimaCard.includes('src="stories/my-urashima/card-scenes.gif"'));
  assert(myUrashimaCard.includes('data-scene-gallery="my-urashima"'));
  assert(rootIndex.includes('src="stories/tutorial/card-scenes.gif"'));
  assert(rootIndex.includes('data-scene-gallery="tutorial-earthquake-safety"'));
  assert.equal((rootIndex.match(/loading="lazy" decoding="async"/gu) ?? []).length, 3);
  assert(rootIndex.includes('id="scene-gallery-dialog"'));
  assert(rootIndex.includes('data-scene-gallery-previous'));
  assert(rootIndex.includes('data-scene-gallery-next'));
  assert(rootIndex.includes("event.key === 'ArrowLeft'"));
  assert(rootIndex.includes("event.key === 'ArrowRight'"));
  assert(rootIndex.includes("event.key === 'Escape'"));
  assert(rootIndex.includes('dialog.showModal()'));
  assert.equal((rootIndex.match(/class="work-card__scene-button"/gu) ?? []).length, 3);
  const myUrashimaDsl32Actions = myUrashimaCard.slice(
    myUrashimaCard.indexOf('data-action-group="DSL 3.2 作業版"'),
    myUrashimaCard.indexOf('data-action-group="DSL 4.0 作業版"'),
  );
  const myUrashimaDsl40Actions = myUrashimaCard.slice(
    myUrashimaCard.indexOf('data-action-group="DSL 4.0 作業版"'),
  );
  assert(myUrashimaDsl32Actions.includes('<h4>DSL 3.2 作業版</h4>'));
  assert(myUrashimaDsl32Actions.includes('my-urashima.sb3'));
  assert(myUrashimaDsl32Actions.includes('my-urashima.txt'));
  assert(!myUrashimaDsl32Actions.includes('my-urashima.k4.yml'));
  assert(myUrashimaDsl40Actions.includes('<h4>DSL 4.0 作業版</h4>'));
  assert(myUrashimaDsl40Actions.includes('my-urashima.k4.yml'));
  assert(!myUrashimaDsl40Actions.includes('href="stories/my-urashima/my-urashima.sb3"'));
  assert.equal(
    myDsl4WebEnabled
      ? myUrashimaDsl40Actions.includes('href="stories/my-urashima/web-4.0/"')
      : myUrashimaDsl40Actions.includes(
          'disabled aria-disabled="true">Web版（準備中）</button>',
        ) && !myUrashimaDsl40Actions.includes('href="stories/my-urashima/web-4.0/"'),
    true,
  );
  assert(
    myUrashimaDsl40Actions.includes(
      'href="stories/my-urashima/my-urashima-4.0.sb3"',
    ),
  );
  assert.equal(rootIndex.includes('準備中'), !dsl4WebEnabled || !myDsl4WebEnabled);
  assert(!myUrashimaCard.includes('data-action-group="作品情報"'));
  assert(!myUrashimaCard.includes('>説明を見る</a>'));
  assert(
    rootIndex.indexOf('>浦島太郎</a></h3>')
      < rootIndex.indexOf('>my-urashima（ワークショップにおける作業用）</a></h3>'),
  );
  assert(
    rootIndex.indexOf('<h2 id="category-official">公式サンプル</h2>')
      < rootIndex.indexOf('<h2 id="category-community">コミュニティ作品</h2>') &&
      rootIndex.indexOf('<h2 id="category-community">コミュニティ作品</h2>')
        < rootIndex.indexOf('<h2 id="category-external">外部作品</h2>'),
  );
  assert(rootIndex.includes('現在掲載中のコミュニティ作品はありません。'));
  assert(rootIndex.includes('現在掲載中の外部作品はありません。'));
  assert(rootIndex.includes('<dt>著作権者</dt>'));
  assert(!rootIndex.includes('<dt>対応DSL</dt>'));
  assert(!rootIndex.includes('<dt>掲載形態</dt>'));
  assert(!rootIndex.includes('<dt>ライセンス・利用条件</dt>'));
  assert(rootIndex.includes('<a href="WORKS_POLICY.md">作品掲載方針</a>'));
  const sampleDsl32Actions = sampleIndex.slice(
    sampleIndex.indexOf('data-dsl-series="3.2"'),
    sampleIndex.indexOf('data-dsl-series="4.0"'),
  );
  const sampleDsl40Actions = sampleIndex.slice(
    sampleIndex.indexOf('data-dsl-series="4.0"'),
    sampleIndex.indexOf('aria-labelledby="work-info-heading"'),
  );
  assert(sampleDsl32Actions.includes('<h2 id="dsl-32-heading">DSL 3.2 実行版</h2>'));
  assert(sampleDsl32Actions.includes('Web版を開く'));
  assert(sampleDsl32Actions.includes('再生用SB3をダウンロード'));
  assert(!sampleDsl32Actions.includes('urashima.k4.yml'));
  assert(sampleDsl40Actions.includes('<h2 id="dsl-40-heading">DSL 4.0 オフライン実行版</h2>'));
  assert(sampleDsl40Actions.includes('urashima.k4.yml'));
  assert(sampleDsl40Actions.includes('urashima-4.0.sb3'));
  assert.equal(
    dsl4WebEnabled
      ? sampleDsl40Actions.includes('href="web-4.0/"')
      : sampleDsl40Actions.includes('disabled aria-disabled="true">Web版（準備中）</button>') &&
          !sampleDsl40Actions.includes('href="web-4.0/"'),
    true,
  );
  assert(sampleDsl40Actions.includes('オフラインSB3をダウンロード'));
  assert(publishedFiles.includes('.nojekyll'));
  assert(publishedFiles.includes('favicon.png'));
  assert(publishedFiles.includes('favicon.source.json'));
  assert(publishedFiles.includes('site-shell.css'));
  assert(publishedFiles.includes('works.json'));
  assert(publishedFiles.includes('works.schema.json'));
  assert(publishedFiles.includes('CARD_SCENES.md'));
  assert(publishedFiles.includes('WORKS_POLICY.md'));
  assert(publishedFiles.includes('licenses/index.html'));
  assert(publishedFiles.includes('stories/my-urashima/my-urashima.sb3'));
  assert(publishedFiles.includes('stories/my-urashima/my-urashima.txt'));
  assert(publishedFiles.includes('stories/my-urashima/my-urashima.k4.yml'));
  assert(publishedFiles.includes('stories/my-urashima/my-urashima-4.0.sb3'));
  assert(publishedFiles.includes('stories/my-urashima/card-scenes.gif'));
  assert(publishedFiles.includes('stories/my-urashima/card-scenes/04.webp'));
  assert(!publishedFiles.includes('stories/my-urashima/card-scenes/05.webp'));
  assert(publishedFiles.includes('stories/my-urashima/dsl4-manifest.json'));
  assert.equal(
    publishedFiles.includes('stories/my-urashima/web-4.0/index.html'),
    myDsl4WebEnabled,
  );
  assert(publishedFiles.includes('stories/my-urashima/index.html'));
  assert(publishedFiles.includes('stories/urashima/urashima.k4.yml'));
  assert(publishedFiles.includes('stories/urashima/urashima-4.0.sb3'));
  assert(publishedFiles.includes('stories/urashima/card-scenes.gif'));
  assert(publishedFiles.includes('stories/urashima/card-scenes/04.webp'));
  assert(!publishedFiles.includes('stories/urashima/card-scenes/05.webp'));
  assert(publishedFiles.includes('stories/tutorial/card-scenes.gif'));
  assert(publishedFiles.includes('stories/tutorial/card-scenes/05.webp'));
  assert.equal(publishedFiles.includes('stories/urashima/web-4.0/index.html'), dsl4WebEnabled);
  assert(
    publishedFiles.includes(
      'stories/urashima/licenses/tmpose-kamishibai-MPL-2.0.txt',
    ),
  );
  assert(
    !publishedFiles.includes('stories/urashima/licenses/tmpose-kamishibai-MIT.txt'),
  );
  await verifyMyUrashimaOutput(path.join(outputDirectory, 'stories/my-urashima'));

  const [siteCss, faviconMetadata, favicon] = await Promise.all([
    readFile(path.join(outputDirectory, 'site-shell.css'), 'utf8'),
    readFile(path.join(outputDirectory, 'favicon.source.json'), 'utf8').then(JSON.parse),
    readFile(path.join(outputDirectory, 'favicon.png')),
  ]);
  assert.match(
    siteCss,
    /\.site-brand__symbol\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;/u,
  );
  assert.match(siteCss, /\.site-footer\s*\{[\s\S]*?border-top:/u);
  assert.match(siteCss, /\.site-footer__rights\s*\{[\s\S]*?min-height:\s*44px;/u);
  assert.match(siteCss, /@media print[\s\S]*?\.site-footer\s*\{[\s\S]*?display:\s*none/u);
  assert.equal(faviconMetadata.sourceName, 'Urashima-walk-1');
  assert.equal(
    faviconMetadata.sourcePath,
    'stories/urashima/assets/images/9a8cf053f6169ea9b530a852ab62c5a0.png',
  );
  assert.equal(
    sha256(favicon),
    'd60f222ed9bb0f52377810b4345e4817c81f90758c167af7084c0c3d3b51782c',
  );

  const noJekyll = await stat(path.join(outputDirectory, '.nojekyll'));
  assert(noJekyll.isFile());
  return {assetCount: manifest.assets.length, fileCount: publishedFiles.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await verifyPublishedSite();
  console.log(`Verified ${results.fileCount} published files and ${results.assetCount} assets.`);
}
