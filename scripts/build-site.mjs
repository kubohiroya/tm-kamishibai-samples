import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile, cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildMyUrashima} from './build-my-urashima.mjs';
import {buildMyUrashimaDsl4} from './build-my-urashima-dsl4.mjs';
import {buildUrashima} from './build-urashima.mjs';
import {buildUrashimaDsl4} from './build-urashima-dsl4.mjs';
import {buildPackagedWeb} from './build-packaged-web.mjs';
import {renderSiteHeader as renderContractSiteHeader} from './site-navigation.mjs';
import {refreshChangedStoryArtifacts} from './refresh-story-artifacts.mjs';
import {verifyPublishedSite} from './verify-site.mjs';
import {readWorksCatalog} from './works-catalog.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectory = path.join(projectRoot, 'stories/urashima');
const mySourceDirectory = path.join(projectRoot, 'stories/my-urashima');
const siteDirectory = path.join(projectRoot, 'site');
const outputDirectory = path.join(projectRoot, 'dist');
const outputSampleDirectory = path.join(outputDirectory, 'stories/urashima');
const myOutputSampleDirectory = path.join(outputDirectory, 'stories/my-urashima');
const publicUrl = 'https://kubohiroya.github.io/tmpose-kamishibai-samples/';
const worksCatalogPath = path.join(siteDirectory, 'works.json');
const worksSchemaPath = path.join(siteDirectory, 'works.schema.json');

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

function renderSiteHeader(assetPrefix, pathname = '/tmpose-kamishibai-samples/') {
  return renderContractSiteHeader({
    assetBase: assetPrefix,
    site: 'tmpose-kamishibai-samples',
    pathname,
  });
}

function renderSiteFooter(assetPrefix) {
  return `<footer class="site-footer" data-site-footer-version="1">
  <div class="site-footer__inner">
    <a class="site-footer__brand" href="https://kubohiroya.github.io/tmpose-kamishibai/">
      <img class="site-footer__symbol" src="${assetPrefix}favicon.png" width="36" height="36" alt="">
      <span>TMPose紙芝居</span>
    </a>
    <div class="site-footer__legal">
      <p>© 2026 Hiroya Kubo</p>
      <p class="site-footer__notice">各文書・作品・素材には個別の利用条件が適用されます。</p>
      <a class="site-footer__rights" href="https://kubohiroya.github.io/tmpose-kamishibai-samples/licenses/">ライセンス・権利表示</a>
    </div>
  </div>
</footer>`;
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

function renderWorkAction(action, manifest) {
  const className = action.style === 'secondary' ? 'button secondary' : 'button';
  if (action.disabled) {
    return `        <button class="${className}" type="button" disabled aria-disabled="true">${escapeHtml(action.label)}</button>`;
  }
  if (action.requires === 'urashimaWeb' && !manifest.web.enabled) return '';
  const download = action.download ? ' download' : '';
  const external = action.external ? ' target="_blank" rel="noopener external"' : '';
  const externalLabel = action.external ? '（外部サイト）' : '';
  return `        <a class="${className}" href="${escapeHtml(action.href)}"${download}${external}>${escapeHtml(action.label)}${externalLabel}</a>`;
}

function renderWorkActions(work, manifest) {
  const renderedActions = work.actions
    .map((action) => ({action, html: renderWorkAction(action, manifest)}))
    .filter(({html}) => html);
  if (!renderedActions.some(({action}) => action.group)) {
    return `        <div class="actions">
${renderedActions.map(({html}) => html).join('\n')}
        </div>`;
  }

  const groups = new Map();
  for (const renderedAction of renderedActions) {
    const group = renderedAction.action.group;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(renderedAction.html);
  }
  return `        <div class="action-groups">
${[...groups.entries()]
  .map(
    ([group, actions]) => `          <section class="action-group" data-action-group="${escapeHtml(group)}">
            <h4>${escapeHtml(group)}</h4>
            <div class="actions">
${actions.join('\n')}
            </div>
          </section>`,
  )
  .join('\n')}
        </div>`;
}

function renderWorkCard(work, manifest) {
  const actions = renderWorkActions(work, manifest);
  const title = work.detailHref
    ? `<a class="work-card__title-link" href="${escapeHtml(work.detailHref)}">${escapeHtml(work.title)}</a>`
    : escapeHtml(work.title);
  return `      <article data-work-id="${escapeHtml(work.id)}" data-distribution="${escapeHtml(work.distribution)}">
        <h3>${title}</h3>
        <p>${escapeHtml(work.summary)}</p>
        <dl class="work-meta">
          <div><dt>作者</dt><dd>${escapeHtml(work.creator)}</dd></div>
          <div><dt>著作権者</dt><dd>${escapeHtml(work.rightsHolder)}</dd></div>
        </dl>
${actions}
      </article>`;
}

function renderWorkCategory(category, works, manifest) {
  const categoryWorks = works.filter((work) => work.category === category.id);
  const contents = categoryWorks.length
    ? `<div class="work-list">\n${categoryWorks.map((work) => renderWorkCard(work, manifest)).join('\n')}\n      </div>`
    : `<p class="empty-state">${escapeHtml(category.emptyMessage)}</p>`;
  return `    <section class="work-category" aria-labelledby="category-${escapeHtml(category.id)}">
      <h2 id="category-${escapeHtml(category.id)}">${escapeHtml(category.title)}</h2>
      <p>${escapeHtml(category.description)}</p>
      ${contents}
    </section>`;
}

function renderRootIndex(manifest, worksCatalog) {
  const categories = worksCatalog.categories
    .map((category) => renderWorkCategory(category, worksCatalog.works, manifest))
    .join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="TMPose紙芝居の公式サンプル、コミュニティ作品、外部作品を掲載する作品ライブラリ">
  <title>TMPose紙芝居 作品ライブラリ</title>
  <link rel="icon" href="favicon.png" type="image/png">
  <link rel="stylesheet" href="site-shell.css">
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; --ink: #3f302b; --muted: #756960; --paper: #fffdf8; --canvas: #fff8ee; --accent: #963f2f; --line: #dbc9bb; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--canvas); color: var(--ink); }
    main { max-width: 920px; margin: auto; padding: 48px 24px 72px; }
    h1 { font-size: clamp(2rem, 6vw, 3.5rem); margin-bottom: .35rem; }
    .lead { color: var(--muted); font-size: 1.15rem; }
    .work-category { margin-top: 42px; }
    .work-list { display: grid; grid-template-columns: 1fr; gap: 20px; }
    article { display: flex; min-width: 0; flex-direction: column; padding: 24px; border: 1px solid var(--line); border-radius: 14px; background: var(--paper); box-shadow: 0 8px 24px rgb(89 61 43 / 10%); }
    article h3 { margin-top: 0; }
    .work-card__title-link { color: var(--accent); text-decoration-thickness: .08em; text-underline-offset: .16em; }
    .work-card__title-link:hover { text-decoration-thickness: .12em; }
    .work-meta { display: grid; gap: .65rem; margin: 1rem 0 0; }
    .work-meta div { display: grid; grid-template-columns: minmax(7.5rem, auto) 1fr; gap: .75rem; }
    .work-meta dt { color: var(--muted); font-weight: 700; }
    .work-meta dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
    .empty-state { padding: 18px; border: 1px dashed var(--line); border-radius: 10px; background: var(--paper); color: var(--muted); }
    .action-groups { display: grid; gap: 12px; margin-top: 1.25rem; }
    .action-group { padding: 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--canvas); }
    .action-group h4 { margin: 0; font-size: 1rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: .75rem; }
    article > .actions { margin-top: 1.25rem; }
    .button { display: inline-block; padding: 10px 14px; border-radius: 8px; background: var(--accent); color: white; text-decoration: none; font-weight: 700; }
    .button.secondary { border: 1px solid var(--accent); background: white; color: var(--accent); }
    .button:disabled { cursor: not-allowed; opacity: .55; }
    footer { margin-top: 40px; color: var(--muted); }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
${renderSiteHeader('')}
<main id="main-content">
  <h1>TMPose紙芝居 作品ライブラリ</h1>
  <p class="lead">公式サンプル、コミュニティ作品、外部サイトで公開されている作品を、掲載形態と権利情報を区別して紹介します。</p>
  <p>区分、ライセンス、外部作品の扱いについては<a href="WORKS_POLICY.md">作品掲載方針</a>をご確認ください。</p>
${categories}
  <aside class="catalog-rights">
    <p>作品ごとの対応DSL・掲載形態・ライセンスは、作品タイトルから開く詳細画面で確認できます。サイト生成コードと個別表示のないファイルには<a href="LICENSE">Mozilla Public License 2.0</a>が適用されます。</p>
  </aside>
</main>
${renderSiteFooter('')}
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
  const dsl4WebAction = manifest.dsl4Web.enabled
    ? '        <a class="button" href="web-4.0/">Web版を開く</a>\n'
    : '';
  const dsl4WebHash = manifest.dsl4Web.enabled
    ? `  <p>DSL 4.0 Web版 SHA-256: <code>${manifest.dsl4Web.output.sha256}</code></p>\n`
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
  <meta name="description" content="TMPose紙芝居 公式サンプル 浦島太郎">
  <title>浦島太郎 | TMPose紙芝居 作品ライブラリ</title>
  <link rel="icon" href="../../favicon.png" type="image/png">
  <link rel="stylesheet" href="../../site-shell.css">
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; --ink: #3f302b; --muted: #756960; --canvas: #fff8ee; --accent: #963f2f; }
    body { margin: 0; background: var(--canvas); color: var(--ink); }
    main { max-width: 920px; margin: auto; padding: 40px 24px 72px; }
    .local-nav { margin-bottom: 32px; }
    a { color: var(--accent); }
    .artifact-groups { display: grid; gap: 18px; margin: 28px 0; }
    .artifact-group { padding: 20px; border: 1px solid #dbc9bb; border-radius: 12px; background: #fffdf8; }
    .artifact-group h2 { margin-top: 0; }
    .artifact-group p { line-height: 1.7; }
    .work-meta { display: grid; gap: .65rem; margin: 1.25rem 0; }
    .work-meta div { display: grid; grid-template-columns: minmax(7.5rem, auto) 1fr; gap: .75rem; }
    .work-meta dt { color: var(--muted); font-weight: 700; }
    .work-meta dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    .button { display: inline-block; padding: 10px 14px; border-radius: 8px; background: var(--accent); color: white; text-decoration: none; font-weight: 700; }
    .button.secondary { border: 1px solid var(--accent); background: white; color: var(--accent); }
    .button:disabled { cursor: not-allowed; opacity: .55; }
    li { margin: .45rem 0; }
    small { color: var(--muted); }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
${renderSiteHeader('../../')}
<main id="main-content">
  <nav class="local-nav" aria-label="作品内ナビゲーション"><a href="../../">作品一覧へ戻る</a></nav>
  <h1>浦島太郎</h1>
  <p>DSL 3.2の実行用成果物と、台本・画像・音声・ポーズモデルを組み込んだDSL 4.0オフライン実行版を区別して公開しています。</p>
  <dl class="work-meta">
    <div><dt>対応DSL</dt><dd>3.2／4.0</dd></div>
    <div><dt>掲載形態</dt><dd>当サイトで配布</dd></div>
    <div><dt>ライセンス・利用条件</dt><dd><a href="LICENSES.md">MPL-2.0、CC BY-SA 2.0ほか</a></dd></div>
  </dl>
  <div class="artifact-groups">
    <section class="artifact-group" data-dsl-series="3.2" aria-labelledby="dsl-32-heading">
      <h2 id="dsl-32-heading">DSL 3.2 実行版</h2>
      <p>Web版、台本、SB3はDSL 3.2で実行するための成果物です。同じ台本とアセットロックから、編集用と再生用の2種類のSB3を生成しています。</p>
      ${webDescription}
      <div class="actions">
${webAction}        <a class="button secondary" href="urashima.txt">DSL 3.2台本を表示</a>
        <a class="button secondary" href="urashima.sb3" download>再生用SB3をダウンロード</a>
        <a class="button secondary" href="_urashima.sb3" download>編集用SB3をダウンロード</a>
      </div>
    </section>
    <section class="artifact-group" data-dsl-series="4.0" aria-labelledby="dsl-40-heading">
      <h2 id="dsl-40-heading">DSL 4.0 オフライン実行版</h2>
      <p>DSL 4.0 YAML、49アセット、Urashima／Turtle／Princess／Fish／Narration target、4.0実行基盤を一つのSB3に組み込んでいます。モデル取得にネットワーク接続は不要です。</p>
      <div class="actions">
${dsl4WebAction}        <a class="button" href="urashima.k4.yml" download>DSL 4.0 YAMLをダウンロード</a>
        <a class="button secondary" href="urashima-4.0.sb3" download>オフラインSB3をダウンロード</a>
      </div>
    </section>
    <section class="artifact-group" aria-labelledby="work-info-heading">
      <h2 id="work-info-heading">作品情報</h2>
      <div class="actions">
        <a class="button secondary" href="manifest.json">manifest</a>
        <a class="button secondary" href="LICENSES.md">ライセンス</a>
      </div>
    </section>
  </div>
  <p>再生用SB3 SHA-256: <code>${manifest.profiles.player.sb3.sha256}</code></p>
  <p>編集用SB3 SHA-256: <code>${manifest.profiles.editor.sb3.sha256}</code></p>
  <p>DSL 4.0オフラインSB3 SHA-256: <code>${manifest.dsl4Offline.sha256}</code></p>
${dsl4WebHash}${webHash}  <h2>成果物プロファイル</h2>
  <ul>
    <li><code>generic</code>: <code>base/kamishibai.sb3</code> — 台本・物語固有アセット非埋め込みの汎用雛形</li>
    <li><code>editor</code>: <code>_urashima.sb3</code> — 台本非埋め込み・アセット埋め込みの編集用</li>
    <li><code>player</code>: <code>urashima.sb3</code> — 台本・アセット埋め込みの再生用</li>
    <li><code>dsl4-offline</code>: <code>urashima-4.0.sb3</code> — DSL 4.0台本・49アセット・実行基盤埋め込みのオフライン動作確認用</li>
  </ul>
  <h2>元アセット</h2>
  <p>画像${manifest.assetCounts.images}件、音声${manifest.assetCounts.sounds}件（組み込み対象${manifest.assetCounts.embedded}件）。ファイル名はScratchの <code>md5ext</code> 名です。</p>
  <ul>
${assetItems}
  </ul>
${webCredits}</main>
${renderSiteFooter('../../')}
</body>
</html>
`;
}

function renderMyUrashimaIndex(work, dsl4Manifest) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="TMPose紙芝居 公式サンプル my-urashima">
  <title>${escapeHtml(work.title)} | TMPose紙芝居 作品ライブラリ</title>
  <link rel="icon" href="../../favicon.png" type="image/png">
  <link rel="stylesheet" href="../../site-shell.css">
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; --ink: #3f302b; --muted: #756960; --canvas: #fff8ee; --paper: #fffdf8; --accent: #963f2f; --line: #dbc9bb; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--canvas); color: var(--ink); }
    main { max-width: 920px; margin: auto; padding: 40px 24px 72px; }
    .local-nav { margin-bottom: 32px; }
    a { color: var(--accent); }
    .work-meta { display: grid; gap: .65rem; margin: 1.25rem 0; }
    .work-meta div { display: grid; grid-template-columns: minmax(7.5rem, auto) 1fr; gap: .75rem; }
    .work-meta dt { color: var(--muted); font-weight: 700; }
    .work-meta dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
    .artifact-groups { display: grid; gap: 18px; margin: 28px 0; }
    .artifact-group { padding: 20px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
    .artifact-group h2 { margin-top: 0; }
    .artifact-group p { line-height: 1.7; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    .button { display: inline-block; padding: 10px 14px; border-radius: 8px; background: var(--accent); color: white; text-decoration: none; font-weight: 700; }
    .button.secondary { border: 1px solid var(--accent); background: white; color: var(--accent); }
    .button:disabled { cursor: not-allowed; opacity: .55; }
  </style>
</head>
<body>
${renderSiteHeader('../../')}
<main id="main-content">
  <nav class="local-nav" aria-label="作品内ナビゲーション"><a href="../../">作品一覧へ戻る</a></nav>
  <h1>${escapeHtml(work.title)}</h1>
  <p>${escapeHtml(work.summary)}</p>
  <dl class="work-meta">
    <div><dt>作者</dt><dd>${escapeHtml(work.creator)}</dd></div>
    <div><dt>著作権者</dt><dd>${escapeHtml(work.rightsHolder)}</dd></div>
    <div><dt>対応DSL</dt><dd>${work.dslSeries.map(escapeHtml).join('／')}</dd></div>
    <div><dt>掲載形態</dt><dd>当サイトで配布</dd></div>
    <div><dt>ライセンス・利用条件</dt><dd><a href="../urashima/LICENSES.md">${escapeHtml(work.license.label)}</a></dd></div>
  </dl>
  <div class="artifact-groups">
    <section class="artifact-group" data-dsl-series="3.2" aria-labelledby="my-dsl-32-heading">
      <h2 id="my-dsl-32-heading">DSL 3.2 作業版</h2>
      <p>ワークショップでポーズと物語を編集するための外部台本と作業用SB3です。</p>
      <div class="actions">
        <a class="button" href="my-urashima.sb3" download>作業用SB3をダウンロード</a>
        <a class="button secondary" href="my-urashima.txt" download>作業用台本をダウンロード</a>
      </div>
    </section>
    <section class="artifact-group" data-dsl-series="4.0" aria-labelledby="my-dsl-40-heading">
      <h2 id="my-dsl-40-heading">DSL 4.0 作業版</h2>
      <p>全作品アセットとPrincess.png由来のPrincess costumeを持つ非台本埋め込みSB3です。Web版またはSB3のメニューから、編集したYAMLを開いて実行できます。</p>
      <div class="actions">
        <a class="button" href="web-4.0/">Web版を開く</a>
        <a class="button secondary" href="my-urashima.k4.yml" download>DSL 4.0 YAMLをダウンロード</a>
        <a class="button secondary" href="my-urashima-4.0.sb3" download>作業用SB3をダウンロード</a>
      </div>
    </section>
  </div>
  <p>DSL 4.0作業用SB3 SHA-256: <code>${dsl4Manifest.output.sha256}</code></p>
  <p>DSL 4.0 Web版 SHA-256: <code>${dsl4Manifest.web.output.sha256}</code></p>
  <p><a href="README.md">生成・変換の説明を見る</a></p>
</main>
${renderSiteFooter('../../')}
</body>
</html>
`;
}

function renderRightsIndex() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="TMPose紙芝居 作品ライブラリの作品、素材、サイトに適用されるライセンスと権利表示を案内します">
  <title>ライセンス・権利表示 | TMPose紙芝居 作品ライブラリ</title>
  <link rel="icon" href="../favicon.png" type="image/png">
  <link rel="stylesheet" href="../site-shell.css">
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; --ink: #3f302b; --muted: #756960; --paper: #fffdf8; --canvas: #fff8ee; --accent: #963f2f; --line: #dbc9bb; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--canvas); color: var(--ink); }
    main { max-width: 880px; margin: auto; padding: 48px 24px 72px; }
    h1 { margin-bottom: .35rem; font-size: clamp(2rem, 5vw, 3.4rem); }
    .lead { margin-top: 0; color: var(--muted); font-size: 1.2rem; line-height: 1.7; }
    section { margin-top: 28px; padding: 22px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
    section h2 { margin-top: 0; }
    p, li, dd { line-height: 1.75; }
    dt { margin-top: .8rem; font-weight: 800; }
    dd { margin-left: 0; }
    a { color: var(--accent); }
  </style>
</head>
<body>
${renderSiteHeader('../')}
<main id="main-content">
  <h1>ライセンス・権利表示</h1>
  <p class="lead">作品ライブラリでは、当サイトで配布する作品と、第三者サイトで公開される作品へのリンクを区別しています。作品・素材に個別表示がある場合は、その条件を優先してください。</p>

  <section aria-labelledby="site-license">
    <h2 id="site-license">サイト実装</h2>
    <p>サイト生成コードと個別表示のない本プロジェクトのファイルは、<a href="../LICENSE">Mozilla Public License 2.0（MPL-2.0）</a>で提供します。</p>
  </section>

  <section aria-labelledby="works-license">
    <h2 id="works-license">掲載作品</h2>
    <ul>
      <li><strong>公式サンプル</strong>: 作品カードと作品ディレクトリの個別表示を適用します。「浦島太郎」にはMPL-2.0対象の台本・画像・音声と、CC BY-SA 2.0対象のScratch音声が含まれます。</li>
      <li><strong>コミュニティ作品</strong>: contributorが明示した権利者、再配布可能なライセンス、素材ごとの条件を適用します。</li>
      <li><strong>外部作品</strong>: 権利者のサイトへのリンクだけを掲載し、当サイトでは作品データや画像を再配布しません。</li>
    </ul>
    <p><a href="../WORKS_POLICY.md">作品掲載方針</a>と、<a href="../stories/urashima/LICENSES.md">「浦島太郎」のライセンス情報</a>も参照してください。</p>
  </section>

  <section aria-labelledby="symbol-rights">
    <h2 id="symbol-rights">サイトアイコン</h2>
    <dl>
      <dt>元画像</dt>
      <dd>公式サンプル「浦島太郎」の<code>Urashima-walk-1</code>（権利者: Hiroya Kubo）</dd>
      <dt>派生方法</dt>
      <dd>頭部と上半身を中心とする、背景を透明にした256×256ピクセルの切り抜き</dd>
      <dt>ライセンス</dt>
      <dd><a href="https://www.mozilla.org/MPL/2.0/">Mozilla Public License 2.0</a></dd>
      <dt>出典</dt>
      <dd><a href="../stories/urashima/assets/images/963e926995791fde1b335fd4ba60d6d7.png">作品内の元画像</a></dd>
    </dl>
  </section>
</main>
${renderSiteFooter('../')}
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
  const [
    worksCatalog,
    images,
    sounds,
    dsl4ArtifactLock,
    dsl4Config,
    dsl4WebLock,
    myDsl4ArtifactLock,
    myDsl4Config,
    myDsl4WebLock,
  ] = await Promise.all([
    readWorksCatalog(worksCatalogPath),
    assetRecords(path.join(sourceDirectory, 'assets/images'), 'images'),
    assetRecords(path.join(sourceDirectory, 'assets/sounds'), 'sounds'),
    readFile(path.join(sourceDirectory, 'dsl4-artifacts.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(sourceDirectory, 'dsl4-build.config.json'), 'utf8').then(JSON.parse),
    readFile(path.join(sourceDirectory, 'dsl4-web-artifacts.lock.json'), 'utf8').then(
      JSON.parse,
    ),
    readFile(path.join(mySourceDirectory, 'dsl4-artifacts.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(mySourceDirectory, 'dsl4-build.config.json'), 'utf8').then(JSON.parse),
    readFile(path.join(mySourceDirectory, 'dsl4-web-artifacts.lock.json'), 'utf8').then(
      JSON.parse,
    ),
  ]);
  if (images.length !== 26 || sounds.length !== 22) {
    throw new Error(`Unexpected Urashima asset counts: ${images.length} images, ${sounds.length} sounds.`);
  }
  const myUrashimaWork = worksCatalog.works.find(({id}) => id === 'my-urashima');
  if (!myUrashimaWork) throw new Error('my-urashima is missing from the works catalog.');

  await rm(outputDirectory, {recursive: true, force: true});
  await mkdir(path.dirname(outputSampleDirectory), {recursive: true});
  await mkdir(path.join(outputDirectory, 'licenses'), {recursive: true});
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
    copyFile(worksCatalogPath, path.join(outputDirectory, 'works.json')),
    copyFile(worksSchemaPath, path.join(outputDirectory, 'works.schema.json')),
    copyFile(path.join(projectRoot, 'WORKS_POLICY.md'), path.join(outputDirectory, 'WORKS_POLICY.md')),
  ]);
  await cp(sourceDirectory, outputSampleDirectory, {recursive: true});
  await cp(mySourceDirectory, myOutputSampleDirectory, {recursive: true});
  const {artifactsLock, config, results} = await buildUrashima(outputSampleDirectory);
  await buildMyUrashima(myOutputSampleDirectory);
  const dsl4Build = await buildUrashimaDsl4({
    publishedOutputPath: path.join(outputSampleDirectory, dsl4Config.output),
    verifyCommittedOutput: false,
  });
  const myDsl4Build = await buildMyUrashimaDsl4({
    publishedOutputPath: path.join(myOutputSampleDirectory, myDsl4Config.output),
    verifyCommittedOutput: false,
  });
  const [
    sourceScript,
    assetManifest,
    assetManifestRecord,
    sourceScriptRecord,
    dsl4ScriptRecord,
  ] = await Promise.all([
    readFile(path.join(sourceDirectory, config.sourceScript)),
    readFile(path.join(sourceDirectory, config.assetManifest), 'utf8').then(JSON.parse),
    fileRecord(path.join(sourceDirectory, config.assetManifest), config.assetManifest),
    fileRecord(path.join(sourceDirectory, config.sourceScript), config.sourceScript),
    fileRecord(path.join(sourceDirectory, 'urashima.k4.yml'), 'urashima.k4.yml'),
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
  const dsl4Web = await buildPackagedWeb({
    inputSb3Path: dsl4Build.outputPath,
    outputSampleDirectory,
    rawWebConfig: dsl4Config.web,
    expectedInput: dsl4WebLock.input,
    expectedOutput: dsl4WebLock.output,
  });
  assert.deepEqual(dsl4Web, dsl4WebLock, 'Urashima DSL 4.0 Web lock is stale.');
  const myDsl4Web = await buildPackagedWeb({
    inputSb3Path: myDsl4Build.outputPath,
    outputSampleDirectory: myOutputSampleDirectory,
    rawWebConfig: myDsl4Config.web,
    expectedInput: myDsl4WebLock.input,
    expectedOutput: myDsl4WebLock.output,
  });
  assert.deepEqual(myDsl4Web, myDsl4WebLock, 'my-urashima DSL 4.0 Web lock is stale.');
  const assets = [...images, ...sounds];
  const manifest = {
    formatVersion: 5,
    sample: 'urashima',
    publicUrl: `${publicUrl}stories/urashima/`,
    license: 'MPL-2.0',
    builder: config.builder,
    baseSb3: {...config.baseSb3, published: true},
    source: {
      script: sourceScriptRecord,
      dsl4Script: dsl4ScriptRecord,
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
    dsl4Offline: {
      path: dsl4Build.artifactLock.output.path,
      size: dsl4Build.artifactLock.output.size,
      sha256: dsl4Build.artifactLock.output.sha256,
      sourceAssetCount: dsl4Build.artifactLock.source.assetCount,
      embeddedFileCount: 55,
      runtimeCommit: dsl4Build.artifactLock.runtime.commit,
      sb3Toolchain: dsl4Build.artifactLock.sb3Toolchain,
    },
    dsl4Web,
    web,
    assetCounts: {images: images.length, sounds: sounds.length, embedded: assetManifest.assets.length},
    unusedSourceAssets: assets
      .filter((asset) => !embeddedPaths.has(asset.path))
      .map((asset) => asset.path),
    assets,
  };
  assert.deepEqual(dsl4Build.artifactLock, dsl4ArtifactLock);
  assert.deepEqual(myDsl4Build.artifactLock, myDsl4ArtifactLock);
  const myDsl4Manifest = {
    ...myDsl4Build.artifactLock,
    sample: 'my-urashima',
    publicUrl: `${publicUrl}stories/my-urashima/`,
    web: myDsl4Web,
  };
  if (sha256(sourceScript) !== sourceScriptRecord.sha256) {
    throw new Error('Source script changed while building the site.');
  }

  await copyFile(path.join(projectRoot, 'LICENSE'), path.join(outputDirectory, 'LICENSE'));
  await writeFile(path.join(outputDirectory, '.nojekyll'), '');
  await writeFile(
    path.join(outputDirectory, 'index.html'),
    renderRootIndex(manifest, worksCatalog),
    'utf8',
  );
  await writeFile(path.join(outputDirectory, 'licenses/index.html'), renderRightsIndex(), 'utf8');
  await writeFile(
    path.join(outputSampleDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(outputSampleDirectory, 'index.html'), renderSampleIndex(manifest), 'utf8');
  await writeFile(
    path.join(myOutputSampleDirectory, 'dsl4-manifest.json'),
    `${JSON.stringify(myDsl4Manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(myOutputSampleDirectory, 'index.html'),
    renderMyUrashimaIndex(myUrashimaWork, myDsl4Manifest),
    'utf8',
  );

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
