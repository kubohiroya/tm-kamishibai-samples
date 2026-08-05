import {createHash} from 'node:crypto';
import {copyFile, cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildMyUrashima} from './build-my-urashima.mjs';
import {buildUrashima} from './build-urashima.mjs';
import {buildPackagedWeb} from './build-packaged-web.mjs';
import {refreshChangedStoryArtifacts} from './refresh-story-artifacts.mjs';
import {verifyPublishedSite} from './verify-site.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectory = path.join(projectRoot, 'stories/urashima');
const mySourceDirectory = path.join(projectRoot, 'stories/my-urashima');
const siteDirectory = path.join(projectRoot, 'site');
const outputDirectory = path.join(projectRoot, 'dist');
const outputSampleDirectory = path.join(outputDirectory, 'stories/urashima');
const myOutputSampleDirectory = path.join(outputDirectory, 'stories/my-urashima');
const publicUrl = 'https://kubohiroya.github.io/tmpose-kamishibai-samples/';

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderSiteHeader(assetPrefix) {
  return `<a class="skip-link" href="#main-content">本文へ移動</a>
<header class="site-header">
  <div class="site-header__inner">
    <a class="site-brand" href="https://kubohiroya.github.io/tmpose-kamishibai/">
      <img class="site-brand__symbol" src="${assetPrefix}favicon.png" width="40" height="40" alt="">
      <span>TMPose紙芝居</span>
    </a>
    <nav class="site-nav" aria-label="サイトナビゲーション">
      <a class="site-nav__link" href="https://kubohiroya.github.io/tmpose-kamishibai/">トップ</a>
      <a class="site-nav__link" href="https://kubohiroya.github.io/tmpose-kamishibai-docs/">ドキュメント</a>
      <a class="site-nav__link" href="https://kubohiroya.github.io/tmpose-kamishibai-samples/" aria-current="page">サンプル</a>
      <a class="site-nav__link" href="https://kubohiroya.github.io/tmpose-kamishibai/downloads/">ダウンロード</a>
    </nav>
    <a class="site-repository" href="https://github.com/kubohiroya/tmpose-kamishibai-samples" target="_blank" rel="noopener" aria-label="tmpose-kamishibai-samplesをGitHubで開く" title="tmpose-kamishibai-samplesをGitHubで開く">
      <svg class="site-repository__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943"/>
      </svg>
    </a>
  </div>
</header>`;
}

function contentType(filename) {
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.svg')) return 'image/svg+xml';
  if (filename.endsWith('.mp3')) return 'audio/mpeg';
  throw new Error(`Unsupported asset format: ${filename}`);
}

async function fileRecord(filePath, publishedPath) {
  const contents = await readFile(filePath);
  return {path: publishedPath, size: contents.length, sha256: sha256(contents)};
}

async function assetRecords(directory, kind) {
  const filenames = (await readdir(directory)).sort();
  return Promise.all(
    filenames.map(async (filename) => {
      const filePath = path.join(directory, filename);
      const contents = await readFile(filePath);
      const expectedMd5 = path.parse(filename).name;
      const actualMd5 = createHash('md5').update(contents).digest('hex');
      if (actualMd5 !== expectedMd5) {
        throw new Error(`Scratch md5ext mismatch: ${filename}`);
      }
      return {
        path: `assets/${kind}/${filename}`,
        contentType: contentType(filename),
        size: contents.length,
        sha256: sha256(contents),
      };
    }),
  );
}

function renderRootIndex(manifest) {
  const webDescription = manifest.web.enabled
    ? '<p>Web版には画像・音声・台本を組み込み済みです。TMPoseのライブラリ・モデル取得とカメラ利用にはネットワーク接続が必要です。</p>'
    : '';
  const webAction = manifest.web.enabled
    ? '      <a class="button" href="stories/urashima/web/">Web版を開く</a>\n'
    : '';
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="TMPose紙芝居の公開サンプル">
  <title>TMPose紙芝居サンプル</title>
  <link rel="icon" href="favicon.png" type="image/png">
  <link rel="stylesheet" href="site-shell.css">
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; --ink: #3f302b; --muted: #756960; --paper: #fffdf8; --canvas: #fff8ee; --accent: #963f2f; --line: #dbc9bb; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--canvas); color: var(--ink); }
    main { max-width: 920px; margin: auto; padding: 48px 24px 72px; }
    h1 { font-size: clamp(2rem, 6vw, 3.5rem); margin-bottom: .35rem; }
    .lead { color: var(--muted); font-size: 1.15rem; }
    article { margin-top: 32px; padding: 24px; border: 1px solid var(--line); border-radius: 14px; background: var(--paper); box-shadow: 0 8px 24px rgb(89 61 43 / 10%); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 1.25rem; }
    .button { display: inline-block; padding: 10px 14px; border-radius: 8px; background: var(--accent); color: white; text-decoration: none; font-weight: 700; }
    .button.secondary { border: 1px solid var(--accent); background: white; color: var(--accent); }
    footer { margin-top: 40px; color: var(--muted); }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
${renderSiteHeader('')}
<main id="main-content">
  <h1>TMPose紙芝居サンプル</h1>
  <p class="lead">台本、画像・音声、用途別のSB3を配布しています。</p>
  <article>
    <h2>浦島太郎</h2>
    <p>紙芝居DSL 3.2の台本と、画像${manifest.assetCounts.images}件・音声${manifest.assetCounts.sounds}件から生成したサンプルです。</p>
    ${webDescription}
    <div class="actions">
${webAction}      <a class="button secondary" href="stories/urashima/urashima.txt">台本を表示</a>
      <a class="button secondary" href="stories/urashima/urashima.sb3" download>再生用SB3をダウンロード</a>
      <a class="button secondary" href="stories/urashima/manifest.json">manifest</a>
      <a class="button secondary" href="stories/urashima/LICENSES.md">ライセンス</a>
      <a class="button secondary" href="stories/urashima/">詳細を見る</a>
    </div>
  </article>
  <article>
    <h2>my-urashima（ワークショップにおける作業用）</h2>
    <p>2026年8月1日のワークショップで、ポーズと物語を変更するためのサンプルです。SB3を開いたあと、外部台本の<code>my-urashima.txt</code>を読み込んで使用します。</p>
    <div class="actions">
      <a class="button" href="stories/my-urashima/my-urashima.sb3" download>作業用SB3をダウンロード</a>
      <a class="button secondary" href="stories/my-urashima/my-urashima.txt" download>作業用台本をダウンロード</a>
      <a class="button secondary" href="stories/my-urashima/README.md">説明を見る</a>
    </div>
  </article>
  <footer>
    <p>サンプルコンテンツは <a href="LICENSE">Mozilla Public License 2.0</a> で提供します。</p>
  </footer>
</main>
</body>
</html>
`;
}

function renderSampleIndex(manifest) {
  const webDescription = manifest.web.enabled
    ? '<p>Web版には画像・音声・台本を組み込み済みです。TMPoseのライブラリ・モデル取得とカメラ利用にはネットワーク接続が必要です。</p>'
    : '';
  const webAction = manifest.web.enabled
    ? '    <a class="button" href="web/">Web版を開く</a>\n'
    : '';
  const webHash = manifest.web.enabled
    ? `  <p>Web版 SHA-256: <code>${manifest.web.output.sha256}</code></p>\n`
    : '';
  const webCredits = manifest.web.enabled
    ? `  <h2>Web版のクレジット</h2>
  <p>Web版は <a href="https://packager.turbowarp.org/">TurboWarp Packager</a> ${escapeHtml(manifest.web.packager.version)} で生成しています。PackagerはMPL-2.0で提供され、ライセンスと同梱ランタイムのクレジットは<a href="LICENSES.md">ライセンス情報</a>および生成HTML内で確認できます。</p>\n`
    : '';
  const assetItems = manifest.assets
    .map(
      (asset) =>
        `      <li><a href="${escapeHtml(asset.path)}"><code>${escapeHtml(asset.path)}</code></a> <small>${asset.size.toLocaleString('ja-JP')} bytes</small></li>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="TMPose紙芝居 浦島太郎サンプル">
  <title>浦島太郎 | TMPose紙芝居サンプル</title>
  <link rel="icon" href="../../favicon.png" type="image/png">
  <link rel="stylesheet" href="../../site-shell.css">
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; --ink: #3f302b; --muted: #756960; --canvas: #fff8ee; --accent: #963f2f; }
    body { margin: 0; background: var(--canvas); color: var(--ink); }
    main { max-width: 920px; margin: auto; padding: 40px 24px 72px; }
    .local-nav { margin-bottom: 32px; }
    a { color: var(--accent); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 24px 0; }
    .button { display: inline-block; padding: 10px 14px; border-radius: 8px; background: var(--accent); color: white; text-decoration: none; font-weight: 700; }
    .button.secondary { border: 1px solid var(--accent); background: white; color: var(--accent); }
    li { margin: .45rem 0; }
    small { color: var(--muted); }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
${renderSiteHeader('../../')}
<main id="main-content">
  <nav class="local-nav" aria-label="サンプル内ナビゲーション"><a href="../../">サンプル一覧へ戻る</a></nav>
  <h1>浦島太郎</h1>
  <p>同じ台本とアセットロックから、編集用と再生用の2種類のSB3を生成しています。</p>
  ${webDescription}
  <div class="actions">
${webAction}    <a class="button secondary" href="urashima.txt">台本を表示</a>
    <a class="button secondary" href="urashima.sb3" download>再生用SB3をダウンロード</a>
    <a class="button secondary" href="_urashima.sb3" download>編集用SB3をダウンロード</a>
    <a class="button secondary" href="manifest.json">manifest</a>
    <a class="button secondary" href="LICENSES.md">ライセンス</a>
  </div>
  <p>再生用SB3 SHA-256: <code>${manifest.profiles.player.sb3.sha256}</code></p>
  <p>編集用SB3 SHA-256: <code>${manifest.profiles.editor.sb3.sha256}</code></p>
${webHash}  <h2>成果物プロファイル</h2>
  <ul>
    <li><code>generic</code>: <code>base/kamishibai.sb3</code> — 台本・物語固有アセット非埋め込みの汎用雛形</li>
    <li><code>editor</code>: <code>_urashima.sb3</code> — 台本非埋め込み・アセット埋め込みの編集用</li>
    <li><code>player</code>: <code>urashima.sb3</code> — 台本・アセット埋め込みの再生用</li>
  </ul>
  <h2>元アセット</h2>
  <p>画像${manifest.assetCounts.images}件、音声${manifest.assetCounts.sounds}件（組み込み対象${manifest.assetCounts.embedded}件）。ファイル名はScratchの <code>md5ext</code> 名です。</p>
  <ul>
${assetItems}
  </ul>
${webCredits}</main>
</body>
</html>
`;
}

function profileRecord(profile, build, lock) {
  const {manifest} = build;
  return {
    profile,
    outputName: manifest.outputName,
    scriptMode: manifest.script.mode,
    assets: 'embedded',
    sb3: {
      path: manifest.outputs.sb3.filename,
      size: manifest.outputs.sb3.size,
      sha256: manifest.outputs.sb3.sha256,
    },
    script: {
      path: manifest.outputs.script.filename,
      size: manifest.outputs.script.size,
      sha256: manifest.outputs.script.sha256,
    },
    builderManifest: {
      path: manifest.outputs.manifest.filename,
      sha256: lock.manifest.sha256,
    },
  };
}

export async function buildSite() {
  await refreshChangedStoryArtifacts();
  const images = await assetRecords(path.join(sourceDirectory, 'assets/images'), 'images');
  const sounds = await assetRecords(path.join(sourceDirectory, 'assets/sounds'), 'sounds');
  if (images.length !== 24 || sounds.length !== 22) {
    throw new Error(`Unexpected Urashima asset counts: ${images.length} images, ${sounds.length} sounds.`);
  }

  await rm(outputDirectory, {recursive: true, force: true});
  await mkdir(path.dirname(outputSampleDirectory), {recursive: true});
  await Promise.all([
    copyFile(path.join(siteDirectory, 'favicon.png'), path.join(outputDirectory, 'favicon.png')),
    copyFile(
      path.join(siteDirectory, 'favicon.source.json'),
      path.join(outputDirectory, 'favicon.source.json'),
    ),
    copyFile(
      path.join(siteDirectory, 'site-shell.css'),
      path.join(outputDirectory, 'site-shell.css'),
    ),
  ]);
  await cp(sourceDirectory, outputSampleDirectory, {recursive: true});
  await cp(mySourceDirectory, myOutputSampleDirectory, {recursive: true});
  const {artifactsLock, config, results} = await buildUrashima(outputSampleDirectory);
  await buildMyUrashima(myOutputSampleDirectory);
  const [sourceScript, assetManifest, assetManifestRecord, sourceScriptRecord] = await Promise.all([
    readFile(path.join(sourceDirectory, config.sourceScript)),
    readFile(path.join(sourceDirectory, config.assetManifest), 'utf8').then(JSON.parse),
    fileRecord(path.join(sourceDirectory, config.assetManifest), config.assetManifest),
    fileRecord(path.join(sourceDirectory, config.sourceScript), config.sourceScript),
  ]);
  const embeddedPaths = new Set(
    assetManifest.assets.map((asset) => asset.uri.replace(/^file:/u, '')),
  );
  const playerSb3Path =
    results.player.outputPaths[results.player.manifest.outputs.sb3.filename];
  const web = await buildPackagedWeb({
    inputSb3Path: playerSb3Path,
    outputSampleDirectory,
    rawWebConfig: config.web,
    expectedInput: artifactsLock.web.input,
    expectedOutput: artifactsLock.web.output,
  });
  const assets = [...images, ...sounds];
  const manifest = {
    formatVersion: 3,
    sample: 'urashima',
    publicUrl: `${publicUrl}stories/urashima/`,
    license: 'MPL-2.0',
    builder: config.builder,
    baseSb3: {...config.baseSb3, published: true},
    source: {
      script: sourceScriptRecord,
      assetManifest: assetManifestRecord,
    },
    script: {
      path: results.player.manifest.outputs.script.filename,
      size: results.player.manifest.outputs.script.size,
      sha256: results.player.manifest.outputs.script.sha256,
    },
    profiles: {
      editor: profileRecord('editor', results.editor, artifactsLock.profiles.editor),
      player: profileRecord('player', results.player, artifactsLock.profiles.player),
    },
    web,
    assetCounts: {images: images.length, sounds: sounds.length, embedded: assetManifest.assets.length},
    unusedSourceAssets: assets
      .filter((asset) => !embeddedPaths.has(asset.path))
      .map((asset) => asset.path),
    assets,
  };
  if (sha256(sourceScript) !== sourceScriptRecord.sha256) {
    throw new Error('Source script changed while building the site.');
  }

  await copyFile(path.join(projectRoot, 'LICENSE'), path.join(outputDirectory, 'LICENSE'));
  await writeFile(path.join(outputDirectory, '.nojekyll'), '');
  await writeFile(path.join(outputDirectory, 'index.html'), renderRootIndex(manifest), 'utf8');
  await writeFile(
    path.join(outputSampleDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(outputSampleDirectory, 'index.html'), renderSampleIndex(manifest), 'utf8');

  const verification = await verifyPublishedSite({
    projectRoot,
    outputDirectory,
    sourceDirectory,
  });
  console.log(
    `Built ${verification.fileCount} published files with ${verification.assetCount} source assets in dist/.`,
  );
  return verification;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildSite();
}
