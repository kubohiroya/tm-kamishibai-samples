import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {readWorksCatalog, validateWorksCatalog} from '../scripts/works-catalog.mjs';
import {verifyExternalWorkLinks} from '../scripts/verify-external-works.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('publishes the approved works-library categories and rights metadata', async () => {
  const catalog = await readWorksCatalog(path.join(projectRoot, 'site/works.json'));

  assert.deepEqual(
    catalog.categories.map(({id, title}) => [id, title]),
    [
      ['official', '公式サンプル'],
      ['community', 'コミュニティ作品'],
      ['external', '外部作品'],
    ],
  );
  assert(catalog.works.length >= 2);
  for (const work of catalog.works) {
    assert(work.creator);
    assert(work.rightsHolder);
    assert(work.license.label);
    assert(work.license.href);
    assert(work.dslSeries.length > 0);
    assert.match(work.updatedAt, /^\d{4}-\d{2}-\d{2}$/u);
    assert(work.thumbnail);
    assert.match(work.thumbnail.src, /^stories\/.+\/card-scene\.webp$/u);
    assert(work.thumbnail.alt);
    assert(work.thumbnail.rightsHolder);
    assert(work.thumbnail.licenseHref);
  }

  const urashima = catalog.works.find(({id}) => id === 'urashima');
  assert.equal(urashima.updatedAt, '2026-08-15');
  assert.equal(urashima.detailHref, 'stories/urashima/');
  assert.equal(urashima.thumbnail.src, 'stories/urashima/card-scene.webp');
  assert.deepEqual(
    [...new Set(urashima.actions.map(({group}) => group))],
    ['DSL 3.2 実行版', 'DSL 4.0 オフライン実行版'],
  );
  assert(
    urashima.actions.some(
      ({href, download}) => href === 'stories/urashima/urashima-4.0.sb3' && download,
    ),
  );
  assert(
    urashima.actions.some(({href}) => href === 'stories/urashima/web-4.0/'),
  );
  assert.equal(
    urashima.actions.find(({href}) => href === 'stories/urashima/web-4.0/').requires,
    'urashimaDsl4Web',
  );
  assert.equal(urashima.actions.some(({group}) => group === '作品情報'), false);
  const myUrashima = catalog.works.find(({id}) => id === 'my-urashima');
  assert.equal(myUrashima.detailHref, 'stories/my-urashima/');
  assert.equal(myUrashima.thumbnail.src, 'stories/my-urashima/card-scene.webp');
  assert.deepEqual(myUrashima.dslSeries, ['3.2', '4.0']);
  assert.deepEqual(
    [...new Set(myUrashima.actions.map(({group}) => group))],
    ['DSL 3.2 作業版', 'DSL 4.0 作業版'],
  );
  assert.equal(
    myUrashima.actions.find(({href}) => href === 'stories/my-urashima/web-4.0/').requires,
    'myUrashimaDsl4Web',
  );
  assert.equal(myUrashima.actions.some(({group}) => group === '作品情報'), false);
  assert.deepEqual(
    myUrashima.actions
      .filter(({group}) => group === 'DSL 4.0 作業版')
      .map(({label, disabled = false}) => [label, disabled]),
    [
      ['Web版を開く', false],
      ['DSL 4.0 YAMLをダウンロード', false],
      ['作業用SB3をダウンロード', false],
    ],
  );
  const partiallyGrouped = structuredClone(catalog);
  delete partiallyGrouped.works.find(({id}) => id === 'urashima').actions[0].group;
  assert.throws(
    () => validateWorksCatalog(partiallyGrouped),
    /must either all define group or all omit it/u,
  );
  const absoluteDetailHref = structuredClone(catalog);
  absoluteDetailHref.works.find(({id}) => id === 'urashima').detailHref =
    'https://example.com/urashima';
  assert.throws(
    () => validateWorksCatalog(absoluteDetailHref),
    /detailHref must be site-relative/u,
  );
});

test('allows external works only as one HTTPS link with rights and terms', () => {
  const catalog = {
    $schema: './works.schema.json',
    formatVersion: 1,
    categories: [
      {id: 'official', title: '公式', description: '公式作品', emptyMessage: 'なし'},
      {id: 'community', title: 'コミュニティ', description: '投稿作品', emptyMessage: 'なし'},
      {id: 'external', title: '外部', description: '外部作品', emptyMessage: 'なし'},
    ],
    works: [
      {
        id: 'linked-work',
        category: 'external',
        title: '外部作品',
        updatedAt: '2026-08-13',
        summary: '権利者のサイトで公開されている作品です。',
        creator: 'Example Creator',
        rightsHolder: 'Example Rights Holder',
        dslSeries: ['4.0'],
        distribution: 'link-only',
        license: {label: '利用条件', href: 'https://example.com/terms'},
        actions: [
          {
            label: '作品を開く',
            href: 'https://example.com/work',
            style: 'primary',
            external: true,
          },
        ],
      },
    ],
  };

  assert.doesNotThrow(() => validateWorksCatalog(structuredClone(catalog)));

  const downloadable = structuredClone(catalog);
  downloadable.works[0].actions[0].download = true;
  assert.throws(() => validateWorksCatalog(downloadable), /must not offer a download/u);

  const hosted = structuredClone(catalog);
  hosted.works[0].distribution = 'hosted';
  assert.throws(() => validateWorksCatalog(hosted), /must be link-only/u);

  const missingRights = structuredClone(catalog);
  missingRights.works[0].rightsHolder = '';
  assert.throws(() => validateWorksCatalog(missingRights), /rightsHolder/u);
});

test('detects unavailable external work and terms links', async () => {
  const catalog = await readWorksCatalog(path.join(projectRoot, 'site/works.json'));
  const externalCatalog = structuredClone(catalog);
  externalCatalog.works.push({
    id: 'linked-work',
    category: 'external',
    title: '外部作品',
    updatedAt: '2026-08-13',
    summary: '外部サイトで公開されている作品です。',
    creator: 'Example Creator',
    rightsHolder: 'Example Rights Holder',
    dslSeries: ['4.0'],
    distribution: 'link-only',
    license: {label: '利用条件', href: 'https://example.com/terms'},
    actions: [
      {
        label: '作品を開く',
        href: 'https://example.com/work',
        style: 'primary',
        external: true,
      },
    ],
  });

  const requests = [];
  const fetchOk = async (url) => {
    requests.push(url);
    return {ok: true, status: 200};
  };
  assert.equal(await verifyExternalWorkLinks(externalCatalog, fetchOk), 2);
  assert.deepEqual(requests.sort(), ['https://example.com/terms', 'https://example.com/work']);

  const fetchBroken = async (url) => ({ok: !url.endsWith('/work'), status: 404});
  await assert.rejects(
    verifyExternalWorkLinks(externalCatalog, fetchBroken),
    /https:\/\/example\.com\/work: HTTP 404/u,
  );
});
