import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const categoryOrder = ['official', 'community', 'external'];

function assertRecord(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
}

function assertString(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string.`);
}

function assertKeys(value, allowedKeys, requiredKeys, label) {
  assertRecord(value, label);
  for (const key of Object.keys(value)) {
    assert(allowedKeys.includes(key), `${label}.${key} is not allowed.`);
  }
  for (const key of requiredKeys) {
    assert(Object.hasOwn(value, key), `${label}.${key} is required.`);
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function validateAction(action, label) {
  assertKeys(
    action,
    ['label', 'href', 'style', 'download', 'external', 'requires'],
    ['label', 'href', 'style'],
    label,
  );
  assertString(action.label, `${label}.label`);
  assertString(action.href, `${label}.href`);
  assert(['primary', 'secondary'].includes(action.style), `${label}.style is invalid.`);
  if (Object.hasOwn(action, 'download')) assert.equal(typeof action.download, 'boolean');
  if (Object.hasOwn(action, 'external')) assert.equal(typeof action.external, 'boolean');
  if (Object.hasOwn(action, 'requires')) {
    assert.equal(action.requires, 'urashimaWeb', `${label}.requires is invalid.`);
  }
}

function validateThumbnail(thumbnail, label) {
  assertKeys(
    thumbnail,
    ['src', 'alt', 'rightsHolder', 'licenseHref'],
    ['src', 'alt', 'rightsHolder', 'licenseHref'],
    label,
  );
  assertString(thumbnail.src, `${label}.src`);
  assert.equal(typeof thumbnail.alt, 'string', `${label}.alt must be a string.`);
  assertString(thumbnail.rightsHolder, `${label}.rightsHolder`);
  assertString(thumbnail.licenseHref, `${label}.licenseHref`);
}

export function validateWorksCatalog(catalog) {
  assertKeys(
    catalog,
    ['$schema', 'formatVersion', 'categories', 'works'],
    ['$schema', 'formatVersion', 'categories', 'works'],
    'catalog',
  );
  assert.equal(catalog.$schema, './works.schema.json');
  assert.equal(catalog.formatVersion, 1);
  assert(Array.isArray(catalog.categories), 'catalog.categories must be an array.');
  assert(Array.isArray(catalog.works), 'catalog.works must be an array.');
  assert.deepEqual(
    catalog.categories.map(({id}) => id),
    categoryOrder,
    'Categories must be ordered as official, community, and external.',
  );

  for (const [index, category] of catalog.categories.entries()) {
    const label = `catalog.categories[${index}]`;
    assertKeys(
      category,
      ['id', 'title', 'description', 'emptyMessage'],
      ['id', 'title', 'description', 'emptyMessage'],
      label,
    );
    for (const key of ['id', 'title', 'description', 'emptyMessage']) {
      assertString(category[key], `${label}.${key}`);
    }
  }

  const workIds = new Set();
  for (const [index, work] of catalog.works.entries()) {
    const label = `catalog.works[${index}]`;
    assertKeys(
      work,
      [
        'id',
        'category',
        'title',
        'summary',
        'creator',
        'rightsHolder',
        'dslSeries',
        'distribution',
        'license',
        'actions',
        'thumbnail',
      ],
      [
        'id',
        'category',
        'title',
        'summary',
        'creator',
        'rightsHolder',
        'dslSeries',
        'distribution',
        'license',
        'actions',
      ],
      label,
    );
    assert.match(work.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, `${label}.id is invalid.`);
    assert(!workIds.has(work.id), `${label}.id must be unique.`);
    workIds.add(work.id);
    assert(categoryOrder.includes(work.category), `${label}.category is invalid.`);
    for (const key of ['title', 'summary', 'creator', 'rightsHolder']) {
      assertString(work[key], `${label}.${key}`);
    }
    assert(Array.isArray(work.dslSeries) && work.dslSeries.length > 0, `${label}.dslSeries is empty.`);
    for (const [seriesIndex, series] of work.dslSeries.entries()) {
      assertString(series, `${label}.dslSeries[${seriesIndex}]`);
    }
    assert(['hosted', 'link-only'].includes(work.distribution), `${label}.distribution is invalid.`);
    assertKeys(work.license, ['label', 'href'], ['label', 'href'], `${label}.license`);
    assertString(work.license.label, `${label}.license.label`);
    assertString(work.license.href, `${label}.license.href`);
    assert(Array.isArray(work.actions) && work.actions.length > 0, `${label}.actions is empty.`);
    work.actions.forEach((action, actionIndex) =>
      validateAction(action, `${label}.actions[${actionIndex}]`),
    );
    if (work.thumbnail) validateThumbnail(work.thumbnail, `${label}.thumbnail`);

    if (work.category === 'external') {
      assert.equal(work.distribution, 'link-only', `${label} must be link-only.`);
      assert(work.license.href.startsWith('https://'), `${label}.license.href must use HTTPS.`);
      assert.equal(work.actions.length, 1, `${label} must expose exactly one external action.`);
      const [action] = work.actions;
      assert(action.href.startsWith('https://'), `${label} action must use HTTPS.`);
      assert.equal(action.external, true, `${label} action must be marked external.`);
      assert.notEqual(action.download, true, `${label} must not offer a download.`);
      assert(!action.requires, `${label} must not depend on a local build feature.`);
    } else {
      assert.equal(work.distribution, 'hosted', `${label} must be hosted.`);
      for (const action of work.actions) {
        assert(!action.external, `${label} must not mark a hosted action as external.`);
        assert(!/^(?:[a-z]+:|\/|\.\.)/iu.test(action.href), `${label} action must be site-relative.`);
      }
    }
  }

  return deepFreeze(catalog);
}

export async function readWorksCatalog(catalogPath) {
  return validateWorksCatalog(JSON.parse(await readFile(catalogPath, 'utf8')));
}
