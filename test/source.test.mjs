import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {validateAssetManifest} from '@kubohiroya/tmpose-kamishibai/builder';
import {strFromU8, unzipSync} from 'fflate';

import {
  buildPackagedWeb,
  DEFAULT_WEB_CONFIGURATION,
} from '../scripts/build-packaged-web.mjs';
import {
  actorCloneRuntimePatch,
  patchActorCloneRuntime,
} from '../scripts/patch-actor-clone-runtime.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sampleDirectory = path.join(projectRoot, 'stories/urashima');

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function readSb3Project(contents) {
  const archive = unzipSync(new Uint8Array(contents));
  return JSON.parse(strFromU8(archive['project.json']));
}

function assertLoadingBubbleAnchor(project, description) {
  const loading = project.targets.find((target) => target.name === 'Loading');
  const anchor = project.targets.find((target) => target.name === 'LoadingBubbleAnchor');
  assert.ok(loading, `${description}: Loading target is missing`);
  assert.ok(anchor, `${description}: LoadingBubbleAnchor target is missing`);
  assert.equal(
    Object.values(loading.blocks).some((block) => block.opcode === 'looks_say'),
    false,
    `${description}: Loading still contains looks_say`,
  );
  assert.equal(
    Object.values(anchor.blocks).some((block) => block.opcode === 'looks_say'),
    true,
    `${description}: LoadingBubbleAnchor does not contain looks_say`,
  );
  assert.deepEqual([anchor.x, anchor.y], [1, -20]);
}

test('licenses the repository, Urashima content, and Packager notices', async () => {
  const [packageJson, license, licenseSummary, runtimeLicense, packagerNotice] = await Promise.all([
    readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'LICENSE'), 'utf8'),
    readFile(path.join(sampleDirectory, 'LICENSES.md'), 'utf8'),
    readFile(path.join(sampleDirectory, 'licenses/tmpose-kamishibai-MIT.txt'), 'utf8'),
    readFile(path.join(sampleDirectory, 'licenses/turbowarp-packager-NOTICE.md'), 'utf8'),
  ]);
  assert.equal(packageJson.license, 'MPL-2.0');
  assert(license.startsWith('Mozilla Public License Version 2.0'));
  assert(licenseSummary.includes('MPL-2.0'));
  assert(licenseSummary.includes('tmpose-kamishibai-MIT.txt'));
  assert(runtimeLicense.startsWith('MIT License'));
  assert(licenseSummary.includes('turbowarp-packager-NOTICE.md'));
  assert(packagerNotice.includes('TurboWarp Packager 3.13.0'));
  assert(packagerNotice.includes('MPL-2.0'));
});

test('keeps the migrated Scratch assets complete and content-addressed', async () => {
  const directories = [
    ['images', 24],
    ['sounds', 21],
  ];
  for (const [directory, expectedCount] of directories) {
    const assetDirectory = path.join(sampleDirectory, 'assets', directory);
    const filenames = await readdir(assetDirectory);
    assert.equal(filenames.length, expectedCount);
    for (const filename of filenames) {
      const contents = await readFile(path.join(assetDirectory, filename));
      const md5 = createHash('md5').update(contents).digest('hex');
      assert.equal(md5, path.parse(filename).name, filename);
      if (directory === 'sounds') {
        assert.equal(path.extname(filename), '.mp3');
        assert.equal(contents.subarray(0, 3).toString('ascii'), 'ID3');
      }
    }
  }
});

test('pins the generic, editor, and player profile contract', async () => {
  const [packageJson, config, artifactsLock, baseSb3] = await Promise.all([
    readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(sampleDirectory, 'sample.config.json'), 'utf8').then(JSON.parse),
    readFile(path.join(sampleDirectory, 'artifacts.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(sampleDirectory, 'base/kamishibai.sb3')),
  ]);
  assert.equal(
    packageJson.dependencies['@kubohiroya/tmpose-kamishibai'],
    'github:kubohiroya/tmpose-kamishibai#v3.1.0',
  );
  assert.equal(config.builder.version, '3.1.0');
  assert.equal(config.builder.commit, 'c92c310159c88ff03ed3cae65dbe21f1991fcf16');
  assert.equal(config.baseSb3.profile, 'generic');
  assert.equal(
    config.baseSb3.source,
    'github:kubohiroya/tmpose-kamishibai#17246c6d2a7e3b357d55112af766f68743a37ba9',
  );
  assert.equal(
    config.baseSb3.commit,
    '17246c6d2a7e3b357d55112af766f68743a37ba9',
  );
  assert.equal(config.baseSb3.size, baseSb3.length);
  assert.equal(config.baseSb3.sha256, sha256(baseSb3));
  assert.equal(config.baseSb3.runtimePatch.id, actorCloneRuntimePatch.id);
  assert.equal(
    config.baseSb3.runtimePatch.outputName,
    actorCloneRuntimePatch.outputName,
  );
  const patchedBaseSb3 = patchActorCloneRuntime(baseSb3);
  assert.equal(config.baseSb3.runtimePatch.size, patchedBaseSb3.length);
  assert.equal(config.baseSb3.runtimePatch.sha256, sha256(patchedBaseSb3));
  const patchedArchive = unzipSync(new Uint8Array(patchedBaseSb3));
  const patchedProject = JSON.parse(strFromU8(patchedArchive['project.json']));
  const assetManagerSource = Buffer.from(
    patchedProject.extensionURLs.twAssetManager.split(',')[1],
    'base64',
  ).toString('utf8');
  assert(assetManagerSource.includes(actorCloneRuntimePatch.extensionVersion));
  assert(assetManagerSource.includes('this.actorNameOf(target2) === actor'));
  assert(assetManagerSource.includes('&& target.isOriginal'));
  assert.equal(artifactsLock.formatVersion, 2);
  assert.deepEqual(config.profiles, {
    editor: {outputName: '_urashima', script: 'external', assets: 'embedded'},
    player: {outputName: 'urashima', script: 'embedded', assets: 'embedded'},
  });
  assert.deepEqual(Object.keys(artifactsLock.profiles).sort(), ['editor', 'player']);
  assert.deepEqual(DEFAULT_WEB_CONFIGURATION, {enabled: false});
  assert.equal(packageJson.devDependencies['@turbowarp/packager'], '3.13.0');
  assert.equal(config.web.enabled, true);
  assert.equal(config.web.inputProfile, 'player');
  assert.equal(config.web.scriptMode, 'embedded');
  assert.equal(config.web.assets, 'embedded');
  assert.equal(config.web.packager.version, '3.13.0');
  assert.equal(config.web.packager.options.target, 'html');
  assert.equal(config.web.packager.options.autoplay, true);
  assert.equal(config.web.packager.options.app.windowTitle, '浦島太郎 | TMPose紙芝居');
  assert.equal(config.web.packager.options.cloudVariables.mode, 'disabled');
  assert.deepEqual(artifactsLock.web.input, {
    profile: 'player',
    path: 'urashima.sb3',
    ...artifactsLock.profiles.player.sb3,
  });

  const project = readSb3Project(baseSb3);
  const stage = project.targets.find((target) => target.isStage);
  assert.deepEqual(stage.variables.tmposeEmbeddedScript, ['__tmpose_embedded_script', '']);
  assert.deepEqual(
    project.targets.map((target) => target.name),
    [
      'Stage',
      'Actor',
      'prompt',
      'openButton',
      'reloadButton',
      'showTitleButton',
      'Loading',
      'LoadingBubbleAnchor',
    ],
  );
  assertLoadingBubbleAnchor(project, 'Urashima base');
});

test('uses the fixed Loading bubble anchor in my-urashima', async () => {
  const myUrashima = await readFile(
    path.join(projectRoot, 'stories/my-urashima/my-urashima.sb3'),
  );
  assertLoadingBubbleAnchor(readSb3Project(myUrashima), 'my-urashima');
});

test('keeps shared Packager output disabled unless a sample enables it', async () => {
  assert.deepEqual(await buildPackagedWeb({}), {enabled: false});
});

test('locks every external script asset and publishes one transformed script', async () => {
  const [source, published, rawAssetManifest] = await Promise.all([
    readFile(path.join(sampleDirectory, 'source.txt'), 'utf8'),
    readFile(path.join(sampleDirectory, 'urashima.txt'), 'utf8'),
    readFile(path.join(sampleDirectory, 'assets.lock.json'), 'utf8').then(JSON.parse),
  ]);
  const assetManifest = validateAssetManifest(rawAssetManifest);
  const externalLines = source
    .split(/\r?\n/u)
    .filter((line) => /^asset=.*,(?:file|https?):/u.test(line));
  assert.equal(externalLines.length, 42);
  assert.equal(assetManifest.assets.length, 42);
  assert.equal(
    assetManifest.assets
      .filter((asset) => asset.kind === 'stageSound')
      .every((asset) => asset.contentType === 'audio/mpeg' && asset.dataFormat === 'mp3'),
    true,
  );
  assert.deepEqual(
    new Set(externalLines.map((line) => line.slice('asset='.length, line.indexOf(',')))),
    new Set(assetManifest.assets.map((asset) => asset.name)),
  );
  assert.equal(/^(?:asset=.*,(?:file|https?):)/mu.test(published), false);
  assert.equal(published.includes('asset=Stars,backdrop'), true);
  assert.equal(published.includes('asset=Narration,text'), true);
  assert.equal(published.includes('asset=EndingText,text'), true);
  assert.equal(source.includes('setLoadingCostume=Fish1,Fish2'), true);
  assert.equal(published.includes('setLoadingCostume=Fish1,Fish2'), true);
  for (const definition of [
    'text=ui.prompt:ポーズをとろう！',
    'text=ui.invalidScript:エラー：不正な台本ファイル',
    'text=ui.open:ファイルをひらく',
    'text=ui.reload:もういちど',
    'text=ui.about:このアプリについて',
    'text=EndingText:お し ま い',
  ]) {
    assert.equal(published.includes(definition), true, definition);
  }
  assert.equal(published.includes('action=text:Narration:むかし'), true);
  assert.equal(
    published.includes('action=text:Narration:むかし　むかし、あるところに...'),
    true,
  );
  assert.equal(/^action=text:Narration:$/mu.test(published), true);
  assert.equal(
    published.includes('action=Narration:show:Narration:0,0,100'),
    true,
  );
  assert.equal(
    published.includes('action=Narration:show:EndingText:0,0,100'),
    true,
  );
  const danceScene = published.slice(
    published.indexOf('sceneLabel=welcome to dragon castle'),
    published.indexOf('sceneLabel=goodbye dragon castle'),
  );
  const danceFishActions = [
    'action=bgm:Jump',
    'action=Fish:show:Fish1:-130,-27,70',
    'action=Fish:setLayer:back',
    'action=Fish:loop:Fish1,Fish2:1,1',
    'action=Urashima:setSkin:Urashima-dance-1:45',
  ];
  assert.equal(danceFishActions.every((action) => danceScene.includes(action)), true);
  assert.deepEqual(
    danceFishActions.map((action) => danceScene.indexOf(action)),
    danceFishActions.map((action) => danceScene.indexOf(action)).toSorted((a, b) => a - b),
  );
  assert.equal(danceScene.includes('action=Fish:show:-130,-27,70'), false);
  assert.equal(/^setRuntimeVariable=Narration:/mu.test(published), false);
  assert.equal(/^action=Prompt:show:Narration:/mu.test(published), false);
});
