import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';

import {strFromU8, unzipSync} from 'fflate';
import {parse} from 'yaml';

import {createTutorialPublicSurfaces} from './build-tutorial-dsl4.mjs';

const defaultProjectRoot = fileURLToPath(new URL('../', import.meta.url));

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function verifyRecord(root, record, description) {
  const contents = await readFile(path.join(root, record.path));
  assert.equal(contents.length, record.size, `${description} size differs from its lock.`);
  assert.equal(sha256(contents), record.sha256, `${description} SHA-256 differs from its lock.`);
  return contents;
}

export async function verifyTutorialCandidate(options = {}) {
  const projectRoot = options.projectRoot ?? defaultProjectRoot;
  const storyDirectory = path.join(projectRoot, 'stories/tutorial');
  const candidateOutputDirectory =
    options.candidateOutputDirectory ?? path.join(projectRoot, 'tmp/tutorial-candidate');
  const outputDirectory = options.outputDirectory ?? path.join(projectRoot, 'dist');
  const [config, artifactLock, webLock, publicSurfaces, finalSource, starterSource, addition] =
    await Promise.all([
      readJson(path.join(storyDirectory, 'dsl4-build.config.json')),
      readJson(path.join(storyDirectory, 'dsl4-artifacts.lock.json')),
      readJson(path.join(storyDirectory, 'dsl4-web-artifacts.lock.json')),
      readJson(path.join(storyDirectory, 'public-surfaces.json')),
      readFile(path.join(storyDirectory, 'story.kamishibai.yaml'), 'utf8').then((source) =>
        parse(source, {uniqueKeys: true}),
      ),
      readFile(path.join(storyDirectory, 'starter.kamishibai.yaml'), 'utf8').then((source) =>
        parse(source, {uniqueKeys: true}),
      ),
      readFile(path.join(storyDirectory, 'addition-kit/add-pose-scene.yml.txt'), 'utf8').then(
        (source) => parse(source, {uniqueKeys: true}),
      ),
    ]);

  assert.equal(config.status, config.publication.enabled ? 'published' : 'candidate');
  assert.equal(publicSurfaces.published, config.publication.enabled);
  assert.deepEqual(
    publicSurfaces,
    createTutorialPublicSurfaces(config, artifactLock, webLock),
  );
  assert.equal(publicSurfaces.sourceIdentity, artifactLock.sourceIdentity);
  assert.equal(publicSurfaces.releaseDependency, config.releaseDependency);
  assert.match(config.releaseDependency, /tmpose-kamishibai\/releases\/tag\/v4\.0\.0-rc\.7$/u);
  assert.doesNotMatch(
    config.publication.reason,
    /docs|capture/iu,
    'Tutorial publication must not depend on docs capture.',
  );
  assert.equal(publicSurfaces.license.spdx, 'MPL-2.0');

  const composed = {...starterSource, ...addition};
  assert.deepEqual(composed, finalSource, 'Starter plus addition kit must equal the final story.');
  assert.deepEqual(Object.keys(finalSource.scenes), [
    'earthquake',
    'instruction',
    'protect',
    'success',
  ]);
  assert.equal(finalSource.scenes.protect.poseModel, 'SafetyPose');
  assert.equal(
    finalSource.scenes.instruction[1]['Student.say'].text,
    '自分の身を守るため、丈夫な机の下に入り、両手で頭を守ろう！',
  );
  assert.equal(
    finalSource.scenes.protect.actions[2]['Student.pose'].steps[0].pose,
    '頭を守る',
  );
  assert.deepEqual(finalSource.scenes.protect.actions[1]['Student.show'], {
    skin: 'ProtectHead',
    x: 0,
    y: -60,
    scale: 65,
  });
  assert.equal(
    finalSource.scenes.success[2]['Student.say'].text,
    'できた！ 頭を守れたね。揺れがおさまるまで、そのまま待とう。',
  );

  const [sb3, starterArchive, additionArchive, web] = await Promise.all([
    verifyRecord(candidateOutputDirectory, artifactLock.outputs.sb3, 'Tutorial SB3'),
    verifyRecord(candidateOutputDirectory, artifactLock.outputs.starter, 'Tutorial starter'),
    verifyRecord(
      candidateOutputDirectory,
      artifactLock.outputs.additionKit,
      'Tutorial addition kit',
    ),
    verifyRecord(candidateOutputDirectory, webLock.output, 'Tutorial Web application'),
  ]);
  const project = JSON.parse(strFromU8(unzipSync(new Uint8Array(sb3))['project.json']));
  assert.deepEqual(
    project.targets.map(({name}) => name),
    artifactLock.outputs.sb3.targetNames,
  );
  assert.equal(
    project.extensionStorage.kubohiroyakamishibai4.components
      .kubohiroyakamishibairuntime4.application.mode,
    'story',
  );
  assert.match(web.toString('utf8', 0, 256), /^<!DOCTYPE html>/u);
  assert(
    web.includes(Buffer.from('<title>地震だ！頭を守ろう DSL 4.0 | TMPose紙芝居</title>')),
  );

  const starterEntries = Object.keys(unzipSync(new Uint8Array(starterArchive))).sort();
  const additionEntries = Object.keys(unzipSync(new Uint8Array(additionArchive))).sort();
  assert.deepEqual(starterEntries, artifactLock.outputs.starter.entries);
  assert.deepEqual(additionEntries, artifactLock.outputs.additionKit.entries);
  for (const required of [
    'tutorial-story/project.source.json',
    'tutorial-story/story.kamishibai.yaml',
    'tutorial-story/classroom.svg',
    'tutorial-story/student-ready.svg',
    'tutorial-story/success.mp3',
    'tutorial-story/safety-pose/model.json',
    'tutorial-story/safety-pose/metadata.json',
    'tutorial-story/safety-pose/weights.bin',
    'tutorial-story/addition-kit/earthquake-classroom.svg',
    'tutorial-story/addition-kit/protect-head.svg',
    'tutorial-story/addition-kit/add-background-and-actor.yml.txt',
    'tutorial-story/addition-kit/add-pose-scene.yml.txt',
    'tutorial-story/addition-kit/intentional-diagnostic.kamishibai.yaml.txt',
  ]) {
    assert(starterEntries.includes(required), `Tutorial starter is missing ${required}.`);
  }

  const publishedTutorialPath = path.join(outputDirectory, 'stories/tutorial');
  const rootIndex = await readFile(path.join(outputDirectory, 'index.html'), 'utf8');
  if (config.publication.enabled) {
    assert((await stat(publishedTutorialPath)).isDirectory());
    assert(rootIndex.includes('data-work-id="tutorial-earthquake-safety"'));
  } else {
    await assert.rejects(stat(publishedTutorialPath), {code: 'ENOENT'});
    assert(!rootIndex.includes('data-work-id="tutorial-earthquake-safety"'));
    assert(!rootIndex.includes('stories/tutorial/'));
  }

  return {
    published: config.publication.enabled,
    sourceIdentity: artifactLock.sourceIdentity,
    sb3Sha256: artifactLock.outputs.sb3.sha256,
    starterSha256: artifactLock.outputs.starter.sha256,
    webSha256: webLock.output.sha256,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await verifyTutorialCandidate();
  process.stdout.write(
    `Verified tutorial release ${result.sourceIdentity} (${result.published ? 'published' : 'publication disabled'}).\n`,
  );
}
