import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {parse} from 'yaml';

import {verifyEndCreditCheerDelay} from './verify-end-credit.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = path.join(projectRoot, 'stories/my-urashima/my-urashima.k4.yml');
const validatorPath = path.resolve(projectRoot, '../tmpose-kamishibai/bin/tmpose-kamishibai.mjs');

function uncommentExactlyOnce(source: string, line: string): string {
  const replacement = line.slice(1);
  const parts = source.split(line);
  assert.equal(parts.length, 2, `Workshop candidate must occur exactly once: ${line}`);
  return `${parts[0]}${replacement}${parts[1]}`;
}

function createVariant(source: string, poseCount: number, poseCandidate: string): string {
  let variant = source;
  for (let pose = 1; pose <= poseCount; pose += 1) {
    variant = uncommentExactlyOnce(variant, `#  p${pose}: costume:Princess`);
  }
  variant = uncommentExactlyOnce(variant, poseCandidate);
  assert.equal(
    (variant.match(/^  p[1-4]: costume:Princess$/gmu) ?? []).length,
    poseCount,
    `The ${poseCount}-pose variant must enable exactly ${poseCount} costume assets.`,
  );
  assert.equal(
    (variant.match(/^      - Princess\.pose:/gmu) ?? []).length,
    1,
    `The ${poseCount}-pose variant must enable exactly one pose action.`,
  );
  return variant;
}

export async function validateMyUrashimaDsl4Workshop() {
  const source = await readFile(sourcePath, 'utf8');
  verifyEndCreditCheerDelay(parse(source, {uniqueKeys: true}));
  const poseCandidates = source.match(/^#      - Princess\.pose:.*$/gmu) ?? [];
  assert.equal(poseCandidates.length, 3, 'Exactly three workshop pose candidates are required.');
  assert.equal(
    (source.match(/^      - Princess\.pose:/gmu) ?? []).length,
    0,
    'The initial workshop source must not enable a pose action.',
  );
  const variants: [name: string, contents: string][] = [
    ['initial', source],
    ['two-poses', createVariant(source, 2, poseCandidates[0] as string)],
    ['three-poses', createVariant(source, 3, poseCandidates[1] as string)],
    ['four-poses', createVariant(source, 4, poseCandidates[2] as string)],
  ];
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'my-urashima-dsl4-'));
  try {
    for (const [name, contents] of variants) {
      const variantPath = path.join(temporaryDirectory, `${name}.k4.yml`);
      await writeFile(variantPath, contents, 'utf8');
      const validation = spawnSync(
        process.execPath,
        [
          validatorPath,
          'validate-dsl4',
          '--input',
          variantPath,
          '--max-source-bytes',
          '262144',
          '--format',
          'pretty',
        ],
        {encoding: 'utf8'},
      );
      if (validation.error) throw validation.error;
      if (validation.status !== 0) {
        throw new Error(
          `DSL 4.0 workshop variant failed validation: ${name}\n${validation.stdout}${validation.stderr}`,
        );
      }
      process.stdout.write(`${name}: valid\n`);
    }
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await validateMyUrashimaDsl4Workshop();
}
