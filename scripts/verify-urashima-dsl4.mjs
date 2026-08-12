import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {createDeterministicSb3, importSb3} from '@kubohiroya/sb3-toolchain';
import {strFromU8, unzipSync} from 'fflate';
import {parse} from 'yaml';

import {ensureUrashimaDsl4Inputs} from './update-urashima-dsl4-inputs.mjs';
import {verifyEndCreditCheerDelay} from './verify-end-credit.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/urashima');

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

export async function verifyUrashimaDsl4() {
  await ensureUrashimaDsl4Inputs();
  const [artifactLock, sourceBytes] = await Promise.all([
    readFile(path.join(storyDirectory, 'dsl4-artifacts.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(storyDirectory, 'urashima.k4.yml')),
  ]);
  assert.equal(artifactLock.formatVersion, 1);
  assert.equal(artifactLock.sb3Toolchain.version, '0.6.0');
  assert.equal(sourceBytes.length, artifactLock.source.size);
  assert.equal(sha256(sourceBytes), artifactLock.source.sha256);

  const story = parse(sourceBytes.toString('utf8'), {uniqueKeys: true});
  verifyEndCreditCheerDelay(story);
  const assets = Object.values(story.assets);
  assert.equal(assets.length, 49);
  assert.equal(
    assets.filter((asset) => asset.delivery === 'remote' || asset.source !== undefined).length,
    0,
  );
  assert(assets.every((asset) => typeof asset.file === 'string' && asset.file.length > 0));

  const outputPath = path.join(storyDirectory, artifactLock.output.path);
  const outputBytes = await readFile(outputPath);
  assert.equal(outputBytes.length, artifactLock.output.size);
  assert.equal(sha256(outputBytes), artifactLock.output.sha256);
  const archive = unzipSync(new Uint8Array(outputBytes));
  assert.equal(Object.keys(archive).length, artifactLock.output.archiveEntryCount);
  const project = JSON.parse(strFromU8(archive['project.json']));
  assert.deepEqual(project.extensions, ['kubohiroyakamishibai4']);
  assert(project.extensionURLs.kubohiroyakamishibai4.startsWith('data:text/javascript'));
  const expectedTargets = [
    'Stage',
    'Urashima',
    'Turtle',
    'Princess',
    'Fish',
    'Narration',
  ];
  assert.deepEqual(
    project.targets.map((target) => target.name),
    expectedTargets,
  );
  const stage = project.targets.find((target) => target.isStage);
  assert.equal(stage?.blocks?.titleFlag?.opcode, 'event_whenflagclicked');
  assert.equal(stage?.blocks?.titleFlag?.next, 'titleFlagShow');
  assert.equal(stage?.blocks?.titleFlagShow?.opcode, 'kubohiroyakamishibai4_showTitle');
  const extensionSource = Buffer.from(
    project.extensionURLs.kubohiroyakamishibai4.slice('data:text/javascript;base64,'.length),
    'base64',
  ).toString('utf8');
  assert(extensionSource.includes('dsl4SpeechAdvanceTypewriter:!0'));
  assert(extensionSource.includes('data-dsl4-runtime-error'));
  assert(extensionSource.includes('@tensorflow/tfjs Copyright 2019 Google'));
  assert(extensionSource.includes('var tmPose='));
  for (const actor of ['Urashima', 'Turtle', 'Princess', 'Fish', 'Narration']) {
    const target = project.targets.find((candidate) => candidate.name === actor);
    assert(target && !target.isStage && target.costumes.length === 1);
  }

  const component =
    project.extensionStorage?.kubohiroyakamishibai4?.components
      ?.kubohiroyakamishibairuntime4;
  assert(component, 'Embedded DSL 4.0 runtime component is missing.');
  assert.equal(component.source.displayName, 'urashima.k4.yml');
  assert.equal(component.source.sourceId, 'main');
  assert.equal(component.artifact.controlProfile, 'production');
  assert.equal(component.assets.manifest.assets.length, 49);
  assert.equal(component.assets.files.length, 55);
  assert(!component.source.text.includes('delivery: remote'));
  assert(!component.source.text.includes('https://sqs.prof.cuc.ac.jp/'));

  const expectedLabels = [
    ['walk', 'help', 'ride1', 'ride2'],
    ['dance1', 'dance2', 'receive', 'goodbye'],
    ['open1', 'open2', 'open3', 'despair'],
  ];
  for (const [index, modelDirectory] of ['1and2', '3and4', '6and7'].entries()) {
    const metadata = JSON.parse(
      await readFile(path.join(storyDirectory, 'pose-models', modelDirectory, 'metadata.json')),
    );
    assert.deepEqual(metadata.labels, expectedLabels[index]);
  }

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'verify-urashima-dsl4-'));
  try {
    const sourceDirectory = path.join(temporaryDirectory, 'source');
    await importSb3({inputPath: outputPath, outputDirectory: sourceDirectory});
    const rebuilt = await createDeterministicSb3(sourceDirectory);
    assert.deepEqual(
      Buffer.from(rebuilt.archive),
      outputBytes,
      'urashima-4.0.sb3 must be the canonical sb3-toolchain output.',
    );
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
  return artifactLock;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lock = await verifyUrashimaDsl4();
  process.stdout.write(
    `Verified ${lock.output.path} (${lock.source.assetCount} local assets, SHA-256 ${lock.output.sha256}).\n`,
  );
}
