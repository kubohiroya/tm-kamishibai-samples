import assert from 'node:assert/strict';

import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';

const fixedZipTimestamp = new Date(1980, 0, 1, 0, 0, 0, 0);

export const promptPositionPatch = Object.freeze({
  id: 'urashima-prompt-text-position',
  issue: 'https://github.com/kubohiroya/tmpose-kamishibai-samples/issues/43',
  outputName: 'kamishibai-prompt-text-position.sb3',
  x: -8,
  fromY: 167,
  toY: 150,
  size: 100,
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

export function patchPromptPosition(baseSb3) {
  const archive = unzipSync(new Uint8Array(baseSb3));
  const project = JSON.parse(strFromU8(archive['project.json']));
  const promptTargets = project.targets.filter((target) => target.name === 'prompt');
  assert.equal(
    promptTargets.length,
    1,
    'Base SB3 must contain exactly one prompt target.',
  );
  const [prompt] = promptTargets;
  assert.deepEqual(
    {x: prompt.x, y: prompt.y, size: prompt.size},
    {
      x: promptPositionPatch.x,
      y: promptPositionPatch.fromY,
      size: promptPositionPatch.size,
    },
    'prompt target position or size differs from the expected source state.',
  );
  prompt.y = promptPositionPatch.toY;
  archive['project.json'] = strToU8(`${JSON.stringify(project)}\n`);

  return Buffer.from(
    zipSync(orderedArchive(archive), {
      level: 6,
      mtime: fixedZipTimestamp,
    }),
  );
}
