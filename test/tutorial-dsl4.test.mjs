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
  assert.equal(build.artifactLock.version, '4.0.0-rc.6');
  assert.equal(build.artifactLock.publication.enabled, true);
  assert.equal(build.artifactLock.publication.reason, config.publication.reason);
  assert.equal(config.work.thumbnail.src, 'stories/tutorial/card-scenes.gif');
  assert(config.work.thumbnail.alt);
  assert(config.work.thumbnail.rightsHolder);
  assert.equal(config.work.thumbnail.licenseHref, 'CARD_SCENES.md');
  assert.equal(config.work.thumbnail.slides.length, 5);
  assert.doesNotMatch(config.publication.reason, /docs|capture/iu);
  assert.deepEqual(
    createTutorialPublicSurfaces(config, build.artifactLock, webLock),
    publicSurfaces,
  );
  assert.equal(publicSurfaces.published, true);
  assert.deepEqual(build.artifactLock.outputs.sb3.targetNames, ['Stage', 'Student']);
  assert.deepEqual(
    Object.keys(unzipSync(new Uint8Array(build.archives.starter.bytes))).sort(),
    build.artifactLock.outputs.starter.entries,
  );
  assert.deepEqual(
    Object.keys(unzipSync(new Uint8Array(build.archives.additionKit.bytes))).sort(),
    build.artifactLock.outputs.additionKit.entries,
  );
});

test('turns the starter into the final four-scene story with visible pose feedback', async () => {
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
  assert.equal(starter.scenes.earthquake[2]['Student.say'].text, 'なにがおきたの？');
  assert.equal(complete.scenes.earthquake[2]['Student.say'].text, '地震だ！');
  assert.deepEqual(Object.keys(complete.scenes), [
    'earthquake',
    'instruction',
    'protect',
    'success',
  ]);
  assert.equal(complete.scenes.protect.poseModel, 'SafetyPose');
  assert.equal(complete.poseRecognition.preview.mirroring, 'mirrored');
  assert.deepEqual(complete.poseRecognition.preview.overlay, {
    visible: true,
    jointStyles: {
      leftWrist: {color: '#ff00aa', opacity: 0.8, radius: 6},
      rightWrist: {color: '#ff00aa', opacity: 0.8, radius: 6},
    },
    boneStyle: {color: '#00e5ff', opacity: 0.9, width: 3},
    minimumConfidence: 0.5,
    confidenceScaling: {jointOpacity: true, boneOpacity: true},
  });
  assert.equal(
    complete.scenes.instruction[1]['Student.say'].text,
    '自分の身を守るため、丈夫な机の下に入り、両手で頭を守ろう！',
  );
  assert.deepEqual(complete.scenes.protect.actions[1]['Student.show'], {
    skin: 'ProtectHead',
    x: 0,
    y: -60,
    scale: 65,
  });
  assert.equal(complete.scenes.protect.actions[2]['Student.pose'].steps[0].pose, '頭を守る');
  assert.deepEqual(complete.scenes.success[1]['Student.show'], {
    skin: 'ProtectHead',
    x: 0,
    y: -60,
    scale: 65,
  });
  assert.equal(
    complete.scenes.success[2]['Student.say'].text,
    'できた！ 頭を守れたね。揺れがおさまるまで、そのまま待とう。',
  );
  assert.equal(complete.scenes.success[2]['Student.say'].seconds, 5);
});

test('reuses the kneeling hands-on-head pose model with an explicit safety label', async () => {
  const sourceModelDirectory = path.join(storyDirectory, '../urashima/pose-models/6and7');
  const tutorialModelDirectory = path.join(storyDirectory, 'safety-pose');
  const [sourceMetadata, tutorialMetadata, sourceModel, tutorialModel, sourceWeights, tutorialWeights] =
    await Promise.all([
      readFile(path.join(sourceModelDirectory, 'metadata.json'), 'utf8').then(JSON.parse),
      readFile(path.join(tutorialModelDirectory, 'metadata.json'), 'utf8').then(JSON.parse),
      readFile(path.join(sourceModelDirectory, 'model.json')),
      readFile(path.join(tutorialModelDirectory, 'model.json')),
      readFile(path.join(sourceModelDirectory, 'weights.bin')),
      readFile(path.join(tutorialModelDirectory, 'weights.bin')),
    ]);
  assert.equal(sourceMetadata.labels[3], 'despair');
  assert.deepEqual(tutorialMetadata.labels, ['open1', 'open2', 'open3', '頭を守る']);
  assert.deepEqual(tutorialModel, sourceModel);
  assert.deepEqual(tutorialWeights, sourceWeights);
});

test('provides one intentional CLI diagnostic with an exact starter fix', async () => {
  const [diagnosticExercise, starter] = await Promise.all([
    readFile(
      path.join(storyDirectory, 'addition-kit/intentional-diagnostic.kamishibai.yaml.txt'),
      'utf8',
    ),
    readFile(path.join(storyDirectory, 'starter.kamishibai.yaml'), 'utf8'),
  ]);
  assert.equal(diagnosticExercise.replace('Student.sya:', 'Student.say:'), starter);

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
  assert(html.includes('<time datetime="2026-08-16">2026年8月16日</time>'));
  assert(html.includes('21.9 MB（21,927,767 bytes）'));
  assert(html.includes('2.2 KB（2,174 bytes）'));
});
