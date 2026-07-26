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
  let fileChooserCount = 0;

  browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 960, height: 720}});
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
      return costume === 'Title' && runtime.ext_lmsTempVars2?.runtimeVariables?.skipMode === 'title';
    },
    undefined,
    {timeout: 120000},
  );
  const titleState = await page.evaluate(() => {
    const runtime = window.scaffolding.vm.runtime;
    const stage = runtime.getTargetForStage();
    return {
      costume: stage.getCostumes()[stage.currentCostume]?.name,
      embeddedScript: String(stage.variables.tmposeEmbeddedScript?.value ?? ''),
      skipMode: runtime.ext_lmsTempVars2?.runtimeVariables?.skipMode,
    };
  });
  assert.equal(titleState.costume, 'Title');
  assert(titleState.embeddedScript.startsWith('kamishibai=3.1'));
  assert.equal(titleState.skipMode, 'title');

  await page.locator('canvas.sc-canvas').click({position: {x: 480, y: 360}});
  await page.waitForFunction(
    () => {
      const variables = window.scaffolding?.vm?.runtime?.ext_lmsTempVars2?.runtimeVariables;
      return variables?.message === '44 / 44' && variables?.sceneIndex !== undefined;
    },
    undefined,
    {timeout: 120000},
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
      unexpectedFilePicker: window.__tmposeUnexpectedFilePicker,
    };
  });
  assert.equal(startedState.runtimeScript, startedState.embeddedScript);
  assert.equal(startedState.sceneCount, 11);
  assert.equal(startedState.assetCount, 44);
  assert.equal(startedState.sceneIndex, 1);
  assert.equal(startedState.skipModePresent, false);
  assert.equal(startedState.unexpectedFilePicker, 0);
  assert.equal(fileChooserCount, 0);
  assert.deepEqual(rejectedRequests, []);

  const audioState = await page.evaluate(async () => {
    const runtime = window.scaffolding.vm.runtime;
    const stage = runtime.getTargetForStage();
    const sounds = stage.getSounds();
    const soundBank = stage.sprite.soundBank;
    const testSound = sounds.find((sound) => sound.name === 'Jump');
    await runtime.audioEngine.audioContext.resume();
    runtime.ext_scratch3_sound.playSound({SOUND_MENU: testSound.name}, {target: stage});
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      contextState: runtime.audioEngine.audioContext.state,
      soundCount: sounds.length,
      mp3SoundCount: sounds.filter((sound) => sound.dataFormat === 'mp3').length,
      decodedSoundCount: Object.keys(soundBank.soundPlayers).length,
      testSoundPlaying: soundBank.soundPlayers[testSound.soundId].isPlaying,
    };
  });
  assert.deepEqual(audioState, {
    contextState: 'running',
    soundCount: 18,
    mp3SoundCount: 18,
    decodedSoundCount: 18,
    testSoundPlaying: true,
  });

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

  console.log(
    `Verified ${browserName}: title, one-click embedded start, 18 decoded MP3 sounds with playback, no file picker, and ${uniqueRequests.length} allowed requests.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
