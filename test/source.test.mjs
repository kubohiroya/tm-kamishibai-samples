import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

import {validateAssetManifest} from '@kubohiroya/tmpose-kamishibai/builder';
import {strFromU8, unzipSync} from 'fflate';

import {
  AUDIO_UNLOCK_CLOCK_CHECK_DELAY_MS,
  AUDIO_UNLOCK_EVENTS,
  AUDIO_UNLOCK_LIFECYCLE_EVENTS,
  AUDIO_UNLOCK_SCRIPT,
  buildPackagedWeb,
  DEFAULT_WEB_CONFIGURATION,
} from '../scripts/build-packaged-web.mjs';
import {
  actorCloneRuntimePatch,
  patchActorCloneRuntime,
} from '../scripts/patch-actor-clone-runtime.mjs';
import {
  loadingSkinPositionPatch,
  patchLoadingSkinPosition,
} from '../scripts/patch-loading-skin-position.mjs';
import {
  patchPromptPosition,
  promptPositionPatch,
} from '../scripts/patch-prompt-position.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sampleDirectory = path.join(projectRoot, 'stories/urashima');
const require = createRequire(import.meta.url);

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

function assertPromptPosition(project, description) {
  const prompt = project.targets.find((target) => target.name === 'prompt');
  assert.ok(prompt, `${description}: prompt target is missing`);
  assert.deepEqual(
    {x: prompt.x, y: prompt.y, size: prompt.size},
    {
      x: promptPositionPatch.x,
      y: promptPositionPatch.toY,
      size: promptPositionPatch.size,
    },
    `${description}: prompt target layout differs`,
  );
}

function assertLoadingSkinPosition(project, description) {
  const loading = project.targets.find((target) => target.name === 'Loading');
  assert.ok(loading, `${description}: Loading target is missing`);
  assert.deepEqual(
    [loading.x, loading.y],
    [1, loadingSkinPositionPatch.toY],
    `${description}: Loading target position differs`,
  );
}

test('licenses the repository, runtime, Urashima content, and Packager notices', async () => {
  const runtimePackagePath = require.resolve('@kubohiroya/tmpose-kamishibai/package.json');
  const runtimePackageLicensePath = path.join(path.dirname(runtimePackagePath), 'LICENSE');
  const [
    packageJson,
    runtimePackageJson,
    license,
    runtimePackageLicense,
    licenseSummary,
    runtimeLicense,
    packagerNotice,
  ] = await Promise.all([
    readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(runtimePackagePath, 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'LICENSE'), 'utf8'),
    readFile(runtimePackageLicensePath, 'utf8'),
    readFile(path.join(sampleDirectory, 'LICENSES.md'), 'utf8'),
    readFile(
      path.join(sampleDirectory, 'licenses/tmpose-kamishibai-MPL-2.0.txt'),
      'utf8',
    ),
    readFile(path.join(sampleDirectory, 'licenses/turbowarp-packager-NOTICE.md'), 'utf8'),
  ]);
  assert.equal(packageJson.license, 'MPL-2.0');
  assert.equal(runtimePackageJson.license, 'MPL-2.0');
  assert(license.startsWith('Mozilla Public License Version 2.0'));
  assert(runtimePackageLicense.startsWith('Mozilla Public License Version 2.0'));
  assert(licenseSummary.includes('MPL-2.0'));
  assert(licenseSummary.includes('CC BY-SA 2.0'));
  assert(licenseSummary.includes('7bd800cb66d6fb18886a4c5cea1b76a6'));
  assert(licenseSummary.includes('tmpose-kamishibai-MPL-2.0.txt'));
  assert(licenseSummary.includes('1aae65f5af986320b5078c9e560e7945ee1b4fde'));
  assert(runtimeLicense.startsWith('Mozilla Public License Version 2.0'));
  assert.equal(runtimeLicense, runtimePackageLicense);
  assert.equal(runtimeLicense, license);
  assert(licenseSummary.includes('turbowarp-packager-NOTICE.md'));
  assert(packagerNotice.includes('TurboWarp Packager 3.13.0'));
  assert(packagerNotice.includes('MPL-2.0'));
});

test('keeps the migrated Scratch assets complete and content-addressed', async () => {
  const directories = [
    ['images', 24],
    ['sounds', 22],
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
    '3.1.7',
  );
  assert.equal(config.builder.version, '3.1.7');
  assert.equal(config.builder.commit, '91ca1dadbfdd037e6f0e0f45e80941c777ab242e');
  assert.equal(config.baseSb3.profile, 'generic');
  assert.equal(
    config.baseSb3.source,
    'github:kubohiroya/tmpose-kamishibai#1aae65f5af986320b5078c9e560e7945ee1b4fde',
  );
  assert.equal(
    config.baseSb3.commit,
    '1aae65f5af986320b5078c9e560e7945ee1b4fde',
  );
  assert.equal(config.baseSb3.size, baseSb3.length);
  assert.equal(config.baseSb3.sha256, sha256(baseSb3));
  assert.equal(config.baseSb3.runtimePatch.id, actorCloneRuntimePatch.id);
  assert.equal(
    config.baseSb3.runtimePatch.outputName,
    actorCloneRuntimePatch.outputName,
  );
  assert.deepEqual(
    {
      id: config.baseSb3.promptPositionPatch.id,
      issue: config.baseSb3.promptPositionPatch.issue,
      outputName: config.baseSb3.promptPositionPatch.outputName,
      x: config.baseSb3.promptPositionPatch.x,
      fromY: config.baseSb3.promptPositionPatch.fromY,
      toY: config.baseSb3.promptPositionPatch.toY,
      size: config.baseSb3.promptPositionPatch.size,
    },
    promptPositionPatch,
  );
  assert.deepEqual(
    {
      id: config.baseSb3.loadingSkinPositionPatch.id,
      issue: config.baseSb3.loadingSkinPositionPatch.issue,
      outputName: config.baseSb3.loadingSkinPositionPatch.outputName,
      fromY: config.baseSb3.loadingSkinPositionPatch.fromY,
      toY: config.baseSb3.loadingSkinPositionPatch.toY,
    },
    loadingSkinPositionPatch,
  );
  const runtimePatchedBaseSb3 = patchActorCloneRuntime(baseSb3);
  assert.equal(config.baseSb3.runtimePatch.size, runtimePatchedBaseSb3.length);
  assert.equal(config.baseSb3.runtimePatch.sha256, sha256(runtimePatchedBaseSb3));
  const promptPatchedBaseSb3 = patchPromptPosition(runtimePatchedBaseSb3);
  assert.equal(
    config.baseSb3.promptPositionPatch.outputSize,
    promptPatchedBaseSb3.length,
  );
  assert.equal(
    config.baseSb3.promptPositionPatch.sha256,
    sha256(promptPatchedBaseSb3),
  );
  const patchedBaseSb3 = patchLoadingSkinPosition(promptPatchedBaseSb3);
  assert.equal(config.baseSb3.loadingSkinPositionPatch.size, patchedBaseSb3.length);
  assert.equal(config.baseSb3.loadingSkinPositionPatch.sha256, sha256(patchedBaseSb3));
  const patchedArchive = unzipSync(new Uint8Array(runtimePatchedBaseSb3));
  const patchedProject = JSON.parse(strFromU8(patchedArchive['project.json']));
  const assetManagerSource = Buffer.from(
    patchedProject.extensionURLs.kubohiroyaassetmanager.split(',')[1],
    'base64',
  ).toString('utf8');
  assert(assetManagerSource.includes(actorCloneRuntimePatch.extensionVersion));
  assert(assetManagerSource.includes('this.actorNameOf(target2) === actor'));
  assert(assetManagerSource.includes('&& target.isOriginal'));
  assert(assetManagerSource.includes('this.displayedAssets.delete(target.id)'));
  assert(assetManagerSource.includes('findProjectTargetByName(runtime, name)'));
  const patchedStage = patchedProject.targets.find((target) => target.isStage);
  const patchedBlocks = Object.values(patchedStage.blocks);
  const transitionProcedures = new Set(
    patchedBlocks
      .filter((block) => block.opcode === 'procedures_prototype')
      .map((block) => block.mutation?.proccode),
  );
  const transitionDispatchNames = new Set(
    patchedBlocks
      .filter((block) => block.opcode === 'operator_equals')
      .map((block) => block.inputs.OPERAND2?.[1]?.[1]),
  );
  for (const transitionAction of ['fadeToWhite', 'fadeFromWhite']) {
    assert(transitionProcedures.has(`exec transition ${transitionAction}`));
    assert(transitionDispatchNames.has(transitionAction));
  }
  const finalBrightnessByTransition = Object.fromEntries(
    ['fadeOut', 'fadeUp', 'fadeToWhite', 'fadeFromWhite'].map((transitionAction) => {
      const prototypeEntry = Object.entries(patchedStage.blocks).find(
        ([, block]) =>
          block.opcode === 'procedures_prototype' &&
          block.mutation?.proccode === `exec transition ${transitionAction}`,
      );
      assert.ok(prototypeEntry, `${transitionAction} prototype is missing`);
      const definition = patchedStage.blocks[prototypeEntry[1].parent];
      const repeat = patchedStage.blocks[definition.next];
      const finalBrightness = patchedStage.blocks[repeat.next];
      assert.equal(finalBrightness.opcode, 'looks_seteffectto');
      return [transitionAction, Number(finalBrightness.inputs.VALUE[1][1])];
    }),
  );
  assert.deepEqual(finalBrightnessByTransition, {
    fadeOut: -100,
    fadeUp: 0,
    fadeToWhite: 100,
    fadeFromWhite: 0,
  });
  assert.equal(artifactsLock.formatVersion, 2);
  assert.deepEqual(config.profiles, {
    editor: {outputName: '_urashima', script: 'external', assets: 'embedded'},
    player: {outputName: 'urashima', script: 'embedded', assets: 'embedded'},
  });
  assert.deepEqual(Object.keys(artifactsLock.profiles).sort(), ['editor', 'player']);
  assert.deepEqual(DEFAULT_WEB_CONFIGURATION, {
    enabled: false,
    audioUnlock: {enabled: false},
  });
  assert.equal(packageJson.devDependencies['@turbowarp/packager'], '3.13.0');
  assert.equal(config.web.enabled, true);
  assert.equal(config.web.inputProfile, 'player');
  assert.equal(config.web.scriptMode, 'embedded');
  assert.equal(config.web.assets, 'embedded');
  assert.deepEqual(config.web.audioUnlock, {enabled: true});
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
  const baseArchive = unzipSync(new Uint8Array(baseSb3));
  const titleCostume = stage.costumes.find(({name}) => name === 'Title');
  const runtimeTitleCostume = stage.costumes.find(({name}) => name === 'TitleRuntime');
  assert.ok(titleCostume, 'Urashima base: Title costume is missing');
  assert.ok(runtimeTitleCostume, 'Urashima base: TitleRuntime costume is missing');
  assert.equal(
    stage.costumes.some(({name}) => name === 'Title-en'),
    false,
    'Urashima base: retired Title-en costume remains',
  );
  assert.match(
    strFromU8(baseArchive[titleCostume.md5ext]),
    /Version 3\.1\.7 \(2026\/08\/03\)/,
    'Urashima base: Title has an unexpected fallback version label',
  );
  assert.doesNotMatch(
    strFromU8(baseArchive[runtimeTitleCostume.md5ext]),
    /<text\b/u,
    'Urashima base: TitleRuntime must remain blank',
  );
  assert.deepEqual(stage.variables.tmposeEmbeddedScript, ['__tmpose_embedded_script', '']);
  assert.deepEqual(
    project.targets.map((target) => target.name),
    [
      'Stage',
      'Actor',
      'prompt',
      'UiItem',
      'officialWebsiteButton',
      'closeTitleButton',
      'Loading',
      'LoadingBubbleAnchor',
    ],
  );
  assert.equal(
    Object.values(stage.variables).some(([name]) => name === 'featureCloneUiItems'),
    false,
  );
  assert.deepEqual(stage.variables.cloneUiItemsEnabled, ['cloneUiItemsEnabled', true]);
  assertLoadingBubbleAnchor(project, 'Urashima base');
  assertPromptPosition(readSb3Project(patchedBaseSb3), 'patched Urashima base');
  assertLoadingSkinPosition(readSb3Project(patchedBaseSb3), 'patched Urashima base');
});

test('keeps my-urashima external-script-only with Princess assets isolated by sprite', async () => {
  const [myUrashima, script, config, artifactsLock] = await Promise.all([
    readFile(path.join(projectRoot, 'stories/my-urashima/my-urashima.sb3')),
    readFile(path.join(projectRoot, 'stories/my-urashima/my-urashima.txt'), 'utf8'),
    readFile(path.join(projectRoot, 'stories/my-urashima/sample.config.json'), 'utf8').then(
      JSON.parse,
    ),
    readFile(path.join(projectRoot, 'stories/my-urashima/artifacts.lock.json'), 'utf8').then(
      JSON.parse,
    ),
  ]);
  const archive = unzipSync(new Uint8Array(myUrashima));
  const project = JSON.parse(strFromU8(archive['project.json']));
  const stage = project.targets.find((target) => target.isStage);
  const actor = project.targets.find((target) => target.name === 'Actor');
  const princess = project.targets.find((target) => target.name === 'Princess');

  assertLoadingBubbleAnchor(project, 'my-urashima');
  assertPromptPosition(project, 'my-urashima');
  assertLoadingSkinPosition(project, 'my-urashima');
  assert.ok(princess, 'my-urashima: Princess target is missing');
  assert.deepEqual(
    princess.costumes.map(({name, dataFormat}) => ({name, dataFormat})),
    [{name: 'Princess', dataFormat: 'png'}],
  );
  assert.equal(princess.size, 70);
  assert.equal(
    actor.costumes.some(({name}) => name === 'Princess'),
    false,
  );
  assert.deepEqual(stage.variables.tmposeEmbeddedScript, ['__tmpose_embedded_script', '']);
  assert.equal(
    Object.values(stage.lists).every(([, values]) => values.length === 0),
    true,
  );
  assert.deepEqual(
    Object.keys(archive).filter((filename) => filename.endsWith('.txt')),
    [],
  );
  assert.equal(script.includes('asset=Princess,costume\n'), true);
  assert.equal(script.includes('asset=Princess,costume:Actor'), false);
  assert.equal(script.includes('asset=Sewing Machine,sound:@stage:Sewing Machine'), true);
  assert.equal(
    script.includes('setPoseRecognitionSound=Clock Ticking,Sewing Machine'),
    true,
  );
  assert.equal(script.includes('action=Princess:show:Princess:-130,-27,70'), true);
  assert.equal(script.includes('action=Princess:setSkin:p1:70'), true);
  assert.equal(script.includes('action=Urashima:pose:Urashima-dance-1'), false);
  assert.deepEqual(config.parentStory, {
    name: 'urashima',
    config: '../urashima/sample.config.json',
  });
  assert.deepEqual(config.profile, {
    outputName: 'my-urashima',
    script: 'external',
    assets: 'embedded',
  });
  assert.deepEqual(config.targets[0].costumes, [{asset: 'Princess', reference: 'costume'}]);
  assert.equal(artifactsLock.parentStory.name, 'urashima');
  assert.equal(artifactsLock.parentStory.sourceScript.path, '../urashima/source.txt');
  assert.equal(artifactsLock.parentStory.assetManifest.path, '../urashima/assets.lock.json');
  assert.equal(artifactsLock.output.sb3.sha256, sha256(myUrashima));
  assert.equal(artifactsLock.output.script.sha256, sha256(script));
});

test('keeps shared Packager output disabled unless a sample enables it', async () => {
  assert.deepEqual(await buildPackagedWeb({}), {enabled: false});
});

test('recovers interrupted or stalled-running WebKit audio after touch completion', async () => {
  const createEventTarget = () => {
    const listeners = new Map();
    return {
      listeners,
      addEventListener(eventName, listener) {
        if (!listeners.has(eventName)) listeners.set(eventName, new Set());
        listeners.get(eventName).add(listener);
      },
      removeEventListener(eventName, listener) {
        listeners.get(eventName)?.delete(listener);
      },
      dispatch(eventName, properties = {}) {
        for (const listener of [...(listeners.get(eventName) ?? [])]) {
          listener({type: eventName, ...properties});
        }
      },
    };
  };

  let currentTime = 4;
  let resumeCalls = 0;
  let suspendCalls = 0;
  let primeStarts = 0;
  const timers = [];
  const audioContext = {
    state: 'interrupted',
    sampleRate: 44100,
    destination: {},
    get currentTime() {
      return currentTime;
    },
    createBuffer() {
      return {};
    },
    createBufferSource() {
      return {
        buffer: null,
        onended: null,
        connect() {},
        disconnect() {},
        start() {
          primeStarts += 1;
          this.onended?.();
        },
      };
    },
    async resume() {
      resumeCalls += 1;
      this.state = 'running';
    },
    async suspend() {
      suspendCalls += 1;
      this.state = 'suspended';
    },
  };
  const documentTarget = createEventTarget();
  const windowTarget = createEventTarget();
  const document = Object.assign(documentTarget, {visibilityState: 'visible'});
  const window = Object.assign(windowTarget, {
    scaffolding: {vm: {runtime: {audioEngine: {audioContext}}}},
    setTimeout(callback, delay) {
      timers.push({callback, delay});
    },
  });
  runInNewContext(AUDIO_UNLOCK_SCRIPT, {
    console: {warn() {}},
    document,
    window,
  });

  assert.deepEqual(AUDIO_UNLOCK_EVENTS, [
    'pointerdown',
    'pointerup',
    'touchend',
    'mousedown',
    'click',
    'keydown',
  ]);
  assert.deepEqual(AUDIO_UNLOCK_LIFECYCLE_EVENTS, ['visibilitychange', 'pageshow']);
  assert.equal(window.__tmposeAudioUnlockState.listenersInstalled, true);

  document.dispatch('pointerdown', {pointerType: 'touch'});
  assert.equal(window.__tmposeAudioUnlockState.ignoredEvents, 1);
  assert.equal(resumeCalls, 0);

  document.dispatch('pointerup', {pointerType: 'touch'});
  await new Promise(setImmediate);
  assert.equal(resumeCalls, 1);
  assert.equal(suspendCalls, 0);
  assert.equal(primeStarts, 2);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, AUDIO_UNLOCK_CLOCK_CHECK_DELAY_MS);
  currentTime += 0.5;
  timers.shift().callback();
  assert.equal(window.__tmposeAudioUnlockState.lastEvent, 'pointerup');
  assert.equal(window.__tmposeAudioUnlockState.lastPointerType, 'touch');
  assert.equal(window.__tmposeAudioUnlockState.completed, true);
  assert.equal(window.__tmposeAudioUnlockState.clockAdvanced, true);
  assert.equal(window.__tmposeAudioUnlockState.primeCompletions, 2);
  assert.equal(window.__tmposeAudioUnlockState.listenersInstalled, false);

  window.__tmposeAudioUnlockState.hasActivated = false;
  window.dispatch('pageshow', {persisted: true});
  audioContext.state = 'running';
  document.dispatch('pointerup', {pointerType: 'touch'});
  await new Promise(setImmediate);
  assert.equal(resumeCalls, 2);
  assert.equal(suspendCalls, 1);
  assert.equal(timers.length, 1);
  currentTime += 0.5;
  timers.shift().callback();
  assert.equal(window.__tmposeAudioUnlockState.completed, true);
  assert.equal(window.__tmposeAudioUnlockState.clockAdvanced, true);
  assert.equal(window.__tmposeAudioUnlockState.primeCompletions, 4);

  audioContext.state = 'suspended';
  window.dispatch('pageshow', {persisted: true});
  await new Promise(setImmediate);
  assert.equal(resumeCalls, 3);
  assert.equal(timers.length, 1);
  currentTime += 0.5;
  timers.shift().callback();
  assert.equal(window.__tmposeAudioUnlockState.lifecycleEvents, 1);
  assert.equal(window.__tmposeAudioUnlockState.lastLifecycleEvent, 'pageshow');
  assert.equal(window.__tmposeAudioUnlockState.completed, true);
  assert.equal(window.__tmposeAudioUnlockState.clockAdvanced, true);
  assert.equal(window.__tmposeAudioUnlockState.primeCompletions, 6);
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
  assert.equal(externalLines.length, 44);
  assert.equal(assetManifest.assets.length, 44);
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
  assert.equal(source.includes('setLoadingBackdrop=Stars'), true);
  assert.equal(published.includes('setLoadingBackdrop=Stars'), true);
  assert.equal(source.includes('setLoadingCostume=Fish1,Fish2'), true);
  assert.equal(published.includes('setLoadingCostume=Fish1,Fish2'), true);
  assert.equal(
    source.includes('asset=Sewing Machine,file:assets/sounds/cfc75b8ec10d522a49e754cee372fcb9.mp3'),
    true,
  );
  assert.equal(
    published.includes('asset=Sewing Machine,sound:@stage:Sewing Machine'),
    true,
  );
  assert.equal(
    source.includes('setPoseRecognitionSound=Clock Ticking,Sewing Machine'),
    true,
  );
  assert.equal(
    published.includes('setPoseRecognitionSound=Clock Ticking,Sewing Machine'),
    true,
  );
  for (const definition of [
    'text=ui.prompt:ポーズをとろう！',
    'text=EndingText:お し ま い',
  ]) {
    assert.equal(published.includes(definition), true, definition);
  }
  for (const obsoleteDefinition of [
    'text=ui.invalidScript:',
    'text=ui.open:',
    'text=ui.reload:',
    'text=ui.about:',
  ]) {
    assert.equal(source.includes(obsoleteDefinition), false, obsoleteDefinition);
    assert.equal(published.includes(obsoleteDefinition), false, obsoleteDefinition);
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
    'action=Fish:loop:Fish1,Fish2:0.3,0.3',
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
