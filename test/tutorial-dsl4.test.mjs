import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {unzipSync} from 'fflate';
import {parse} from 'yaml';

import {
  buildTutorialDsl4,
  createTutorialPublicSurfaces,
} from '../scripts/build-tutorial-dsl4.mjs';
import {renderTutorialIndex} from '../scripts/build-site.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/tutorial');

test('builds a deterministic published SB3 and tutorial distribution archives', async () => {
  const build = await buildTutorialDsl4();
  const [config, webLock, publicSurfaces] = await Promise.all([
    readFile(path.join(storyDirectory, 'dsl4-build.config.json'), 'utf8').then(JSON.parse),
    readFile(path.join(storyDirectory, 'dsl4-web-artifacts.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(storyDirectory, 'public-surfaces.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(build.artifactLock.status, 'published');
  assert.equal(build.artifactLock.version, '4.0.0-rc.1');
  assert.equal(build.artifactLock.publication.enabled, true);
  assert.equal(build.artifactLock.publication.reason, config.publication.reason);
  assert.doesNotMatch(config.publication.reason, /docs|capture/iu);
  assert.deepEqual(
    createTutorialPublicSurfaces(config, build.artifactLock, webLock),
    publicSurfaces,
  );
  assert.equal(publicSurfaces.published, true);
  assert.deepEqual(build.artifactLock.outputs.sb3.targetNames, ['Stage', 'Turtle', 'Friend']);
  assert.deepEqual(
    Object.keys(unzipSync(new Uint8Array(build.archives.starter.bytes))).sort(),
    build.artifactLock.outputs.starter.entries,
  );
  assert.deepEqual(
    Object.keys(unzipSync(new Uint8Array(build.archives.additionKit.bytes))).sort(),
    build.artifactLock.outputs.additionKit.entries,
  );
});

test('turns the starter into the final three-scene story with the addition kit', async () => {
  const [starter, addition, complete] = await Promise.all([
    readFile(path.join(storyDirectory, 'starter.kamishibai.yaml'), 'utf8').then((source) =>
      parse(source, {uniqueKeys: true}),
    ),
    readFile(path.join(storyDirectory, 'addition-kit/add-pose-scene.yml.txt'), 'utf8').then(
      (source) => parse(source, {uniqueKeys: true}),
    ),
    readFile(path.join(storyDirectory, 'story.kamishibai.yaml'), 'utf8').then((source) =>
      parse(source, {uniqueKeys: true}),
    ),
  ]);
  assert.deepEqual({...starter, ...addition}, complete);
  assert.equal(starter.scenes.opening[2]['Turtle.say'].text, '助けて！');
  assert.equal(complete.scenes.opening[2]['Turtle.say'].text, 'こんにちは！');
  assert.deepEqual(Object.keys(complete.scenes), ['opening', 'meeting', 'rescue']);
  assert.equal(complete.scenes.rescue.poseModel, 'RescuePose');
});

test('provides one intentional CLI diagnostic with an exact starter fix', async () => {
  const [diagnosticExercise, starter] = await Promise.all([
    readFile(
      path.join(storyDirectory, 'addition-kit/intentional-diagnostic.kamishibai.yaml.txt'),
      'utf8',
    ),
    readFile(path.join(storyDirectory, 'starter.kamishibai.yaml'), 'utf8'),
  ]);
  assert.equal(diagnosticExercise.replace('Turtle.sya:', 'Turtle.say:'), starter);

  const kamishibaiRoot = path.resolve(
    process.env.TMPOSE_KAMISHIBAI_DSL4_ROOT ?? path.join(projectRoot, '../tmpose-kamishibai'),
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(kamishibaiRoot, 'bin/tmpose-kamishibai.mjs'),
      'validate-dsl4',
      '--input',
      path.join(storyDirectory, 'addition-kit/intentional-diagnostic.kamishibai.yaml.txt'),
      '--max-source-bytes',
      '262144',
      '--format',
      'pretty',
    ],
    {encoding: 'utf8'},
  );
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /K4-SCHEMA-(?:001|UNKNOWN-KEY)/u);
});

test('renders every fixed tutorial download on the published detail page', async () => {
  const [config, manifest] = await Promise.all([
    readFile(path.join(storyDirectory, 'dsl4-build.config.json'), 'utf8').then(JSON.parse),
    readFile(path.join(storyDirectory, 'public-surfaces.json'), 'utf8').then(JSON.parse),
  ]);
  const html = renderTutorialIndex(config.work, manifest);
  for (const href of [
    'web-4.0/',
    manifest.artifacts.starter.path,
    manifest.artifacts.additionKit.path,
    manifest.artifacts.sb3.path,
    'story.kamishibai.yaml',
  ]) {
    assert(html.includes(`href="${href}"`), `Tutorial detail page is missing ${href}.`);
  }
  assert(html.includes(manifest.sourceIdentity));
  assert(html.includes(manifest.artifacts.web.sha256));
});
