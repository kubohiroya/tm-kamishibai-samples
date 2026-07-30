import assert from 'node:assert/strict';

import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';

const fixedZipTimestamp = new Date(1980, 0, 1, 0, 0, 0, 0);

export const loadingSkinPositionPatch = Object.freeze({
  id: 'urashima-loading-skin-position',
  issue: 'https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/42',
  outputName: 'kamishibai-loading-skin-position.sb3',
  fromY: -92,
  toY: -62,
});

function orderedArchive(archive) {
  return Object.fromEntries(
    Object.entries(archive)
      .filter(([entryName]) => !entryName.endsWith('/'))
      .sort(([left], [right]) => {
        if (left === 'project.json') return -1;
        if (right === 'project.json') return 1;
        return left.localeCompare(right, 'en');
      }),
  );
}

export function patchLoadingSkinPosition(baseSb3) {
  const archive = unzipSync(new Uint8Array(baseSb3));
  const project = JSON.parse(strFromU8(archive['project.json']));
  const loadingTargets = project.targets.filter(
    (target) => target.name === 'Loading',
  );
  assert.equal(
    loadingTargets.length,
    1,
    'Base SB3 must contain exactly one Loading target.',
  );
  assert.equal(
    loadingTargets[0].y,
    loadingSkinPositionPatch.fromY,
    'Loading target Y position differs from the expected source position.',
  );
  loadingTargets[0].y = loadingSkinPositionPatch.toY;
  archive['project.json'] = strToU8(`${JSON.stringify(project)}\n`);

  return Buffer.from(
    zipSync(orderedArchive(archive), {
      level: 6,
      mtime: fixedZipTimestamp,
    }),
  );
}
