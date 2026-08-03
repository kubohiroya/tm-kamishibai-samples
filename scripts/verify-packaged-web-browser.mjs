import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {chromium} from 'playwright';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputSampleDirectory = path.join(projectRoot, 'dist/stories/urashima');
const browserName = 'chromium';

const [html, manifest] = await Promise.all([
  readFile(path.join(outputSampleDirectory, 'web/index.html')),
  readFile(path.join(outputSampleDirectory, 'manifest.json'), 'utf8').then(JSON.parse),
]);
const server = createServer((request, response) => {
  if (request.url !== '/' && request.url !== '/index.html') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': html.length,
  });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const allowedPrefixes = manifest.web.allowedOnlineDependencies.map(
    (dependency) => dependency.urlPrefix,
  );
  const requests = [];
  const rejectedRequests = [];
  const assetRegistrationErrors = [];
  let fileChooserCount = 0;

  browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=user-gesture-required'],
  });
  const page = await browser.newPage({
    viewport: {width: 820, height: 1180},
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/151.0.7922.25 Mobile/15E148 Safari/604.1',
  });
  page.on('pageerror', (error) => {
    console.error(`[${browserName} page error] ${error.stack ?? error}`);
    if (/AssetRegistrationError|Costume not found:/u.test(String(error))) {
      assetRegistrationErrors.push(String(error));
    }
  });
  page.on('console', (message) => {
    const text = message.text();
    if (/AssetRegistrationError|Costume not found:/u.test(text)) {
      assetRegistrationErrors.push(text);
    }
  });
  await page.addInitScript(() => {
    window.__tmposeUnexpectedFilePicker = 0;
    window.showOpenFilePicker = async () => {
      window.__tmposeUnexpectedFilePicker += 1;
      throw new Error('Unexpected file picker');
    };
  });
  page.on('filechooser', () => {
    fileChooserCount += 1;
  });
  page.on('request', (request) => requests.push(request.url()));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (
      url.startsWith(origin) ||
      url.startsWith('blob:') ||
      url.startsWith('data:') ||
      allowedPrefixes.some((prefix) => url.startsWith(prefix))
    ) {
      await route.continue();
      return;
    }
    rejectedRequests.push(url);
    await route.abort('blockedbyclient');
  });

  await page.goto(`${origin}/`, {waitUntil: 'domcontentloaded', timeout: 120000});
  await page.waitForFunction(
    () => window.scaffolding?.vm?.runtime?.getTargetForStage(),
    undefined,
    {timeout: 120000},
  );
  await page.waitForFunction(
    () => {
      const runtime = window.scaffolding?.vm?.runtime;
      const stage = runtime?.getTargetForStage();
      const costume = stage?.getCostumes()[stage.currentCostume]?.name;
      const uiItemIds = runtime?.targets
        .filter((target) => !target.isOriginal && target.sprite?.name === 'UiItem')
        .map(
          (target) =>
            target.lookupVariableByNameAndType?.('uiId', '')?.value,
        );
      return (
        costume === 'TitleRuntime' &&
        runtime.ext_lmsTempVars2?.runtimeVariables?.skipMode === 'title' &&
        [
          'officialWebsiteLabel',
          'titleAuthorName',
          'titleAuthorOrganization',
          'titleHeading',
          'titleLicenseApp',
          'titleLicenseStory',
          'titleVersion',
        ].every((id) => uiItemIds?.includes(id))
      );
    },
    undefined,
    {timeout: 120000},
  );
  await page.evaluate(() => {
    const context = window.scaffolding.vm.runtime.audioEngine.audioContext;
    if (context.state === 'running') void context.suspend();
  });
  await page.waitForFunction(
    () => {
      const state = window.scaffolding?.vm?.runtime?.audioEngine?.audioContext?.state;
      return state === 'suspended' || state === 'interrupted';
    },
    undefined,
    {timeout: 120000},
  );
  const titleState = await page.evaluate(() => {
    const runtime = window.scaffolding.vm.runtime;
    const stage = runtime.getTargetForStage();
    const uiItems = runtime.targets.filter(
      (target) => !target.isOriginal && target.sprite?.name === 'UiItem',
    );
    window.__tmposeTitleUiTargetIds = uiItems.map((target) => target.id);
    window.__tmposeTitleUiDrawableIds = uiItems.map((target) => target.drawableID);
    return {
      costume: stage.getCostumes()[stage.currentCostume]?.name,
      embeddedScript: String(stage.variables.tmposeEmbeddedScript?.value ?? ''),
      skipMode: runtime.ext_lmsTempVars2?.runtimeVariables?.skipMode,
      audioContextState: runtime.audioEngine.audioContext.state,
      audioUnlockState: window.__tmposeAudioUnlockState,
      uiItemIds: uiItems
        .map(
          (target) =>
            target.lookupVariableByNameAndType?.('uiId', '')?.value,
        )
        .toSorted(),
    };
  });
  assert.equal(titleState.costume, 'TitleRuntime');
  assert(titleState.embeddedScript.startsWith('kamishibai=3.1'));
  assert.equal(titleState.skipMode, 'title');
  assert(
    ['suspended', 'interrupted'].includes(titleState.audioContextState),
    `Unexpected initial audio state: ${titleState.audioContextState}`,
  );
  assert.equal(titleState.audioUnlockState.installed, true);
  assert.equal(titleState.audioUnlockState.attempts, 0);
  assert.equal(titleState.audioUnlockState.completed, false);
  assert.equal(titleState.audioUnlockState.clockAdvanced, false);
  assert.equal(titleState.audioUnlockState.listenersInstalled, true);
  assert.deepEqual(titleState.uiItemIds, [
    'officialWebsiteLabel',
    'titleAuthorName',
    'titleAuthorOrganization',
    'titleHeading',
    'titleLicenseApp',
    'titleLicenseStory',
    'titleVersion',
  ]);

  await page.evaluate(() => {
    const runtime = window.scaffolding.vm.runtime;
    const stage = runtime.getTargetForStage();
    const loading = runtime.targets.find(
      (target) => target.isOriginal && target.sprite?.name === 'Loading',
    );
    window.__tmposeLoadingBackdropSamples = [];
    window.__tmposeLoadingBackdropTimer = window.setInterval(() => {
      const drawable = runtime.renderer._allDrawables[stage.drawableID];
      const skinId = drawable?._skin?._id;
      const costume = stage
        .getCostumes()
        .find((candidate) => candidate.skinId === skinId)?.name;
      window.__tmposeLoadingBackdropSamples.push({
        costume,
        loadingVisible: loading?.visible === true,
      });
    }, 5);
  });
  await page.locator('canvas.sc-canvas').tap({position: {x: 240, y: 180}});
  await page.waitForFunction(
    () =>
      window.scaffolding?.vm?.runtime?.audioEngine?.audioContext?.state === 'running' &&
      window.__tmposeAudioUnlockState?.completed === true,
    undefined,
    {timeout: 120000},
  );
  try {
    await page.waitForFunction(
      () => {
        const variables = window.scaffolding?.vm?.runtime?.ext_lmsTempVars2?.runtimeVariables;
        return variables?.message === '44 / 44' && variables?.sceneIndex !== undefined;
      },
      undefined,
      {timeout: 120000},
    );
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const runtime = window.scaffolding?.vm?.runtime;
      const variables = runtime?.ext_lmsTempVars2?.runtimeVariables;
      return {
        message: variables?.message,
        sceneIndex: variables?.sceneIndex,
        skipMode: variables?.skipMode,
        audioContextState: runtime?.audioEngine?.audioContext?.state,
        audioUnlockState: window.__tmposeAudioUnlockState,
      };
    });
    console.error(`[${browserName} startup diagnostics] ${JSON.stringify(diagnostics)}`);
    throw error;
  }
  const loadingBackdropState = await page.evaluate(() => {
    window.clearInterval(window.__tmposeLoadingBackdropTimer);
    return {
      displayedStarsWhileLoading: window.__tmposeLoadingBackdropSamples.some(
        ({costume, loadingVisible}) => costume === 'Stars' && loadingVisible,
      ),
      sampledCostumes: [
        ...new Set(
          window.__tmposeLoadingBackdropSamples
            .map(({costume}) => costume)
            .filter(Boolean),
        ),
      ],
    };
  });
  assert.equal(
    loadingBackdropState.displayedStarsWhileLoading,
    true,
    `Stars was not displayed while Loading was visible: ${loadingBackdropState.sampledCostumes.join(', ')}`,
  );
  const startedState = await page.evaluate(() => {
    const runtime = window.scaffolding.vm.runtime;
    const stage = runtime.getTargetForStage();
    const variables = runtime.ext_lmsTempVars2.runtimeVariables;
    const stageVariable = (name) =>
      Object.values(stage.variables).find((variable) => variable.name === name)?.value;
    return {
      runtimeScript: String(variables.script ?? ''),
      embeddedScript: String(stage.variables.tmposeEmbeddedScript?.value ?? ''),
      sceneCount: stageVariable('sceneList')?.length,
      assetCount: stageVariable('assetList')?.length,
      sceneIndex: Number(variables.sceneIndex),
      skipModePresent: Object.hasOwn(variables, 'skipMode'),
      poseRecognitionSound: variables.poseRecognitionSound,
      poseRecognitionSound2: variables.poseRecognitionSound2,
      audioContextState: runtime.audioEngine.audioContext.state,
      audioUnlockState: window.__tmposeAudioUnlockState,
      uiText: {
        prompt: variables['text:ui.prompt'],
      },
      unexpectedFilePicker: window.__tmposeUnexpectedFilePicker,
    };
  });
  assert.equal(startedState.runtimeScript, startedState.embeddedScript);
  assert.equal(startedState.sceneCount, 11);
  assert.equal(startedState.assetCount, 47);
  assert.equal(startedState.sceneIndex, 1);
  assert.equal(startedState.skipModePresent, false);
  assert.equal(startedState.poseRecognitionSound, 'Clock Ticking');
  assert.equal(startedState.poseRecognitionSound2, 'Sewing Machine');
  assert.equal(startedState.audioContextState, 'running');
  assert.equal(startedState.audioUnlockState.installed, true);
  assert(startedState.audioUnlockState.attempts >= 1);
  assert.equal(startedState.audioUnlockState.completed, true);
  assert.equal(startedState.audioUnlockState.clockAdvanced, true);
  assert(startedState.audioUnlockState.lastClockDelta > 0);
  assert.equal(startedState.audioUnlockState.listenersInstalled, false);
  assert.equal(startedState.audioUnlockState.lastError, undefined);
  assert.deepEqual(startedState.uiText, {
    prompt: 'ポーズをとろう！',
  });
  assert.equal(startedState.unexpectedFilePicker, 0);
  assert.equal(fileChooserCount, 0);
  assert.deepEqual(rejectedRequests, []);

  await page.waitForFunction(
    () => {
      const runtime = window.scaffolding?.vm?.runtime;
      const variables = runtime?.ext_lmsTempVars2?.runtimeVariables;
      const narration = runtime?.targets.find((target) => {
        const actorName = target.lookupVariableByNameAndType?.('actorName', '')?.value;
        return !target.isStage && actorName === 'Narration';
      });
      return variables?.['text:Narration'] === 'むかし' && narration?.visible;
    },
    undefined,
    {timeout: 120000},
  );
  const narrationState = await page.evaluate(() => {
    const runtime = window.scaffolding.vm.runtime;
    const narration = runtime.targets.find((target) => {
      const actorName = target.lookupVariableByNameAndType?.('actorName', '')?.value;
      return !target.isStage && actorName === 'Narration';
    });
    return {
      text: runtime.ext_lmsTempVars2.runtimeVariables['text:Narration'],
      visible: narration.visible,
      x: narration.x,
      y: narration.y,
      size: narration.size,
    };
  });
  const {size: narrationSize, ...narrationDisplayState} = narrationState;
  assert.deepEqual(narrationDisplayState, {
    text: 'むかし',
    visible: true,
    x: 0,
    y: 0,
  });
  assert(Number.isFinite(narrationSize) && narrationSize > 0);

  for (const expectedText of [
    'むかし　むかし、',
    'むかし　むかし、あるところに...',
  ]) {
    await page.waitForFunction(
      (text) => {
        const runtime = window.scaffolding?.vm?.runtime;
        const variables = runtime?.ext_lmsTempVars2?.runtimeVariables;
        const narration = runtime?.targets.find((target) => {
          const actorName = target.lookupVariableByNameAndType?.('actorName', '')?.value;
          return !target.isStage && actorName === 'Narration';
        });
        return variables?.['text:Narration'] === text && narration?.visible;
      },
      expectedText,
      {timeout: 120000},
    );
  }

  const uiAssetState = await page.evaluate(async () => {
    const runtime = window.scaffolding.vm.runtime;
    runtime.startHats('event_whenbroadcastreceived', {
      BROADCAST_OPTION: 'showMenu',
    });
    runtime.startHats('event_whenbroadcastreceived', {
      BROADCAST_OPTION: 'showPrompt',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const originalTarget = (name) =>
      runtime.targets.find(
        (candidate) => candidate.isOriginal && candidate.sprite?.name === name,
      );
    const uiItemTarget = (name) =>
      runtime.targets.find(
        (candidate) =>
          !candidate.isOriginal &&
          candidate.sprite?.name === 'UiItem' &&
          candidate.lookupVariableByNameAndType?.('uiId', '')?.value === name,
      );
    const displayedUiItem = (name) => uiItemTarget(name)?.visible === true;
    const prompt = originalTarget('prompt');
    const promptBounds =
      runtime.renderer._allDrawables[prompt.drawableID].getFastBounds();
    const currentTargetIds = new Set(runtime.targets.map((target) => target.id));
    return {
      prompt: {
        visible: prompt.visible,
        x: prompt.x,
        y: prompt.y,
        size: prompt.size,
        top: promptBounds.top,
        stageTop: runtime.stageHeight / 2,
      },
      open: displayedUiItem('openButton'),
      reload: displayedUiItem('reloadButton'),
      about: displayedUiItem('showTitleButton'),
      language: displayedUiItem('languageButton'),
      staleTitleTargets: window.__tmposeTitleUiTargetIds.filter((id) =>
        currentTargetIds.has(id),
      ),
      staleTitleDrawables: window.__tmposeTitleUiDrawableIds.filter(
        (drawableId) => {
          const drawable = runtime.renderer._allDrawables[drawableId];
          return drawable !== null && drawable !== undefined;
        },
      ),
    };
  });
  const {top: promptTop, ...promptLayout} = uiAssetState.prompt;
  assert.deepEqual(
    {...uiAssetState, prompt: promptLayout},
    {
      prompt: {
        visible: true,
        x: -8,
        y: 150,
        size: 100,
        stageTop: 180,
      },
      open: true,
      reload: true,
      about: true,
      language: true,
      staleTitleTargets: [],
      staleTitleDrawables: [],
    },
  );
  assert(
    promptTop <= promptLayout.stageTop,
    `prompt top ${promptTop} exceeds stage top`,
  );
  assert.deepEqual(assetRegistrationErrors, []);

  const audioState = await page.evaluate(async () => {
    const runtime = window.scaffolding.vm.runtime;
    const stage = runtime.getTargetForStage();
    const sounds = stage.getSounds();
    const soundBank = stage.sprite.soundBank;
    const testSound = sounds.find((sound) => sound.name === 'Sewing Machine');
    const clockStart = runtime.audioEngine.audioContext.currentTime;
    runtime.ext_scratch3_sound.playSound({SOUND_MENU: testSound.name}, {target: stage});
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      contextState: runtime.audioEngine.audioContext.state,
      clockAdvanced: runtime.audioEngine.audioContext.currentTime > clockStart,
      soundCount: sounds.length,
      mp3SoundCount: sounds.filter((sound) => sound.dataFormat === 'mp3').length,
      decodedSoundCount: Object.keys(soundBank.soundPlayers).length,
      testSoundPlaying: soundBank.soundPlayers[testSound.soundId].isPlaying,
    };
  });
  assert.deepEqual(audioState, {
    contextState: 'running',
    clockAdvanced: true,
    soundCount: 20,
    mp3SoundCount: 20,
    decodedSoundCount: 20,
    testSoundPlaying: true,
  });

  await page.evaluate(() => {
    const context = window.scaffolding.vm.runtime.audioEngine.audioContext;
    if (context.state === 'running') void context.suspend();
  });
  await page.waitForFunction(
    () => {
      const state = window.scaffolding?.vm?.runtime?.audioEngine?.audioContext?.state;
      return state === 'suspended' || state === 'interrupted';
    },
    undefined,
    {timeout: 120000},
  );
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
  });
  await page.waitForFunction(
    () =>
      window.scaffolding?.vm?.runtime?.audioEngine?.audioContext?.state === 'running'
      && window.__tmposeAudioUnlockState?.completed === true
      && window.__tmposeAudioUnlockState?.clockAdvanced === true,
    undefined,
    {timeout: 120000},
  );
  const foregroundAudioState = await page.evaluate(() => ({
    contextState: window.scaffolding.vm.runtime.audioEngine.audioContext.state,
    lifecycleEvents: window.__tmposeAudioUnlockState.lifecycleEvents,
    lastLifecycleEvent: window.__tmposeAudioUnlockState.lastLifecycleEvent,
    completed: window.__tmposeAudioUnlockState.completed,
    clockAdvanced: window.__tmposeAudioUnlockState.clockAdvanced,
  }));
  assert.equal(foregroundAudioState.contextState, 'running');
  assert(foregroundAudioState.lifecycleEvents >= 1);
  assert.equal(foregroundAudioState.lastLifecycleEvent, 'pageshow');
  assert.equal(foregroundAudioState.completed, true);
  assert.equal(foregroundAudioState.clockAdvanced, true);

  const uniqueRequests = [...new Set(requests)];
  const storyResourceRequests = uniqueRequests.filter((url) =>
    /(?:urashima\.txt|urashima\.sb3|\/assets\/|\.(?:mp3|png|svg|wav))(?:[?#]|$)/iu.test(url),
  );
  assert.deepEqual(storyResourceRequests, []);
  for (const url of uniqueRequests.filter((value) => /^https?:/u.test(value))) {
    assert(
      url.startsWith(origin) || allowedPrefixes.some((prefix) => url.startsWith(prefix)),
      `Undeclared online dependency: ${url}`,
    );
  }

  await page.reload({waitUntil: 'domcontentloaded', timeout: 120000});
  await page.waitForFunction(
    () => {
      const runtime = window.scaffolding?.vm?.runtime;
      const stage = runtime?.getTargetForStage();
      const costume = stage?.getCostumes()[stage.currentCostume]?.name;
      return (
        costume === 'TitleRuntime' &&
        runtime?.ext_lmsTempVars2?.runtimeVariables?.skipMode === 'title'
      );
    },
    undefined,
    {timeout: 120000},
  );
  await page.evaluate(() => {
    const runtime = window.scaffolding.vm.runtime;
    const stage = runtime.getTargetForStage();
    const scriptVariable = stage.variables.tmposeEmbeddedScript;
    const sections = String(scriptVariable.value).split(/\r?\n---\r?\n/u);
    const header = sections[0];
    const danceScene = sections.find((section) =>
      section.includes('sceneLabel=welcome to dragon castle'),
    );
    if (!danceScene) throw new Error('Dance scene is missing from the embedded script.');
    scriptVariable.value = [
      header,
      '---',
      danceScene
        .replace(/^TMPoseURL=.*(?:\r?\n)?/mu, '')
        .replace(/^action=Urashima:pose:.*$/mu, 'action=wait:30'),
    ].join('\n');
  });
  await page.locator('canvas.sc-canvas').tap({position: {x: 240, y: 180}});
  await page.waitForFunction(
    () => {
      const runtime = window.scaffolding?.vm?.runtime;
      const actor = (name) =>
        runtime?.targets.find((target) => {
          const actorName = target.lookupVariableByNameAndType?.('actorName', '')?.value;
          return !target.isStage && actorName === name;
        });
      const fish = actor('Fish');
      const princess = actor('Princess');
      const drawList = runtime?.renderer?._drawList ?? [];
      return (
        fish?.visible
        && princess?.visible
        && drawList.indexOf(fish.drawableID) < drawList.indexOf(princess.drawableID)
      );
    },
    undefined,
    {timeout: 120000},
  );
  const danceState = await page.evaluate(async () => {
    const runtime = window.scaffolding.vm.runtime;
    const actor = (name) =>
      runtime.targets.find((target) => {
        const actorName = target.lookupVariableByNameAndType?.('actorName', '')?.value;
        return !target.isStage && actorName === name;
      });
    const fish = actor('Fish');
    const princess = actor('Princess');
    const fishSkinNames = [];
    for (let index = 0; index < 12; index += 1) {
      const drawable = runtime.renderer._allDrawables[fish.drawableID];
      const skinId = drawable?._skin?._id;
      fishSkinNames.push(fish.getCostumes().find((costume) => costume.skinId === skinId)?.name);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const drawList = runtime.renderer._drawList;
    return {
      fish: {visible: fish.visible, x: fish.x, y: fish.y, size: fish.size},
      princess: {
        visible: princess.visible,
        x: princess.x,
        y: princess.y,
        size: princess.size,
      },
      fishBehindPrincess:
        drawList.indexOf(fish.drawableID) < drawList.indexOf(princess.drawableID),
      fishSkinNames: [...new Set(fishSkinNames)].filter(Boolean).toSorted(),
    };
  });
  assert.deepEqual(danceState, {
    fish: {visible: true, x: -130, y: -27, size: 70},
    princess: {visible: true, x: -130, y: -27, size: 70},
    fishBehindPrincess: true,
    fishSkinNames: ['Fish1', 'Fish2'],
  });

  await page.reload({waitUntil: 'domcontentloaded', timeout: 120000});
  await page.waitForFunction(
    () => {
      const runtime = window.scaffolding?.vm?.runtime;
      const stage = runtime?.getTargetForStage();
      const costume = stage?.getCostumes()[stage.currentCostume]?.name;
      return (
        costume === 'TitleRuntime'
        && runtime?.ext_lmsTempVars2?.runtimeVariables?.skipMode === 'title'
      );
    },
    undefined,
    {timeout: 120000},
  );
  await page.evaluate(() => {
    const runtime = window.scaffolding.vm.runtime;
    const stage = runtime.getTargetForStage();
    const scriptVariable = stage.variables.tmposeEmbeddedScript;
    const header = String(scriptVariable.value).split(/\r?\n---\r?\n/u)[0];
    scriptVariable.value = [
      header,
      '---',
      'sceneLabel=white transition',
      'action=stage:Beach2',
      'action=transition:fadeToWhite',
      'action=stage:Smoke',
      'action=transition:fadeFromWhite',
      'action=wait:30',
    ].join('\n');
    window.__tmposeWhiteTransitionSamples = [];
    window.__tmposeWhiteTransitionTimer = window.setInterval(() => {
      const drawable = runtime.renderer._allDrawables[stage.drawableID];
      const skinId = drawable?._skin?._id;
      const costume = stage
        .getCostumes()
        .find((candidate) => candidate.skinId === skinId)?.name;
      window.__tmposeWhiteTransitionSamples.push({
        brightness: Number(stage.effects.brightness),
        costume,
      });
    }, 10);
  });
  await page.locator('canvas.sc-canvas').tap({position: {x: 240, y: 180}});
  await page.waitForFunction(
    () => {
      const runtime = window.scaffolding?.vm?.runtime;
      const stage = runtime?.getTargetForStage();
      const drawable = runtime?.renderer?._allDrawables?.[stage?.drawableID];
      const skinId = drawable?._skin?._id;
      const costume = stage
        ?.getCostumes()
        .find((candidate) => candidate.skinId === skinId)?.name;
      return costume === 'Smoke' && stage.effects.brightness === 0;
    },
    undefined,
    {timeout: 120000},
  );
  const whiteTransitionState = await page.evaluate(() => {
    window.clearInterval(window.__tmposeWhiteTransitionTimer);
    const runtime = window.scaffolding.vm.runtime;
    const stage = runtime.getTargetForStage();
    const samples = window.__tmposeWhiteTransitionSamples;
    const drawable = runtime.renderer._allDrawables[stage.drawableID];
    const skinId = drawable?._skin?._id;
    return {
      costume: stage
        .getCostumes()
        .find((candidate) => candidate.skinId === skinId)?.name,
      finalBrightness: stage.effects.brightness,
      maximumBrightness: Math.max(...samples.map((sample) => sample.brightness)),
      maximumSmokeBrightness: Math.max(
        ...samples
          .filter((sample) => sample.costume === 'Smoke')
          .map((sample) => sample.brightness),
      ),
    };
  });
  assert.equal(whiteTransitionState.costume, 'Smoke');
  assert.equal(whiteTransitionState.finalBrightness, 0);
  assert.equal(whiteTransitionState.maximumBrightness, 100);
  assert(
    whiteTransitionState.maximumSmokeBrightness >= 95
      && whiteTransitionState.maximumSmokeBrightness <= 100,
  );

  await page.reload({waitUntil: 'domcontentloaded', timeout: 120000});
  await page.waitForFunction(
    () => {
      const runtime = window.scaffolding?.vm?.runtime;
      const stage = runtime?.getTargetForStage();
      const costume = stage?.getCostumes()[stage.currentCostume]?.name;
      return (
        costume === 'TitleRuntime'
        && runtime?.ext_lmsTempVars2?.runtimeVariables?.skipMode === 'title'
      );
    },
    undefined,
    {timeout: 120000},
  );
  await page.evaluate(() => {
    const runtime = window.scaffolding.vm.runtime;
    const stage = runtime.getTargetForStage();
    const scriptVariable = stage.variables.tmposeEmbeddedScript;
    const header = String(scriptVariable.value).split(/\r?\n---\r?\n/u)[0];
    scriptVariable.value = [
      header,
      '---',
      'sceneLabel=end credit',
      'action=stage:End',
      'action=Narration:show:EndingText:0,0,100',
      'action=wait:30',
    ].join('\n');
  });
  await page.locator('canvas.sc-canvas').tap({position: {x: 240, y: 180}});
  await page.waitForFunction(
    () => {
      const runtime = window.scaffolding?.vm?.runtime;
      const stage = runtime?.getTargetForStage();
      const endCostume = stage?.getCostumes().find((costume) => costume.name === 'End');
      const drawable = runtime?.renderer?._allDrawables?.[stage?.drawableID];
      const narration = runtime?.targets.find((target) => {
        const actorName = target.lookupVariableByNameAndType?.('actorName', '')?.value;
        return !target.isStage && actorName === 'Narration';
      });
      return (
        drawable?._skin?._id === endCostume?.skinId
        && runtime.ext_lmsTempVars2?.runtimeVariables?.['text:EndingText']
          === 'お し ま い'
        && narration?.visible
      );
    },
    undefined,
    {timeout: 120000},
  );

  console.log(
    `Verified ${browserName}: clone-only title/menu UI and cleanup, scene-0 UI text assets, scene-3 Fish loop behind Princess, scene-7 white transition to Smoke, visible Narration and EndingText, 20 decoded MP3 sounds including Sewing Machine with playback, no asset registration errors, no file picker, and ${uniqueRequests.length} allowed requests.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
