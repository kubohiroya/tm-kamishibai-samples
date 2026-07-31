import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {webkit} from 'playwright';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(
  path.join(projectRoot, 'dist/stories/urashima/web/index.html'),
);
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
  browser = await webkit.launch({headless: true});
  const page = await browser.newPage({
    viewport: {width: 820, height: 1180},
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/151.0.7922.25 Mobile/15E148 Safari/604.1',
  });
  page.on('pageerror', (error) => {
    console.error(`[webkit page error] ${error.stack ?? error}`);
  });

  const origin = `http://127.0.0.1:${server.address().port}`;
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
      return (
        costume === 'TitleRuntime'
        && runtime.ext_lmsTempVars2?.runtimeVariables?.skipMode === 'title'
      );
    },
    undefined,
    {timeout: 120000},
  );

  const initialState = await page.evaluate(() => {
    const runtime = window.scaffolding.vm.runtime;
    const stage = runtime.getTargetForStage();
    return {
      costume: stage.getCostumes()[stage.currentCostume]?.name,
      contextState: runtime.audioEngine.audioContext.state,
      unlock: window.__tmposeAudioUnlockState,
    };
  });
  assert.equal(initialState.costume, 'TitleRuntime');
  assert(
    ['suspended', 'interrupted'].includes(initialState.contextState),
    `Unexpected initial WebKit audio state: ${initialState.contextState}`,
  );
  assert.equal(initialState.unlock.installed, true);
  assert.equal(initialState.unlock.attempts, 0);
  assert.equal(initialState.unlock.listenersInstalled, true);

  await page.locator('canvas.sc-canvas').tap({position: {x: 240, y: 180}});
  await page.waitForFunction(
    () => {
      const context = window.scaffolding?.vm?.runtime?.audioEngine?.audioContext;
      const unlock = window.__tmposeAudioUnlockState;
      return (
        context?.state === 'running'
        && unlock?.completed === true
        && unlock?.clockAdvanced === true
        && unlock?.primeCompletions >= 1
      );
    },
    undefined,
    {timeout: 120000},
  );
  const activatedState = await page.evaluate(() => ({
    contextState: window.scaffolding.vm.runtime.audioEngine.audioContext.state,
    unlock: window.__tmposeAudioUnlockState,
  }));
  assert.equal(activatedState.contextState, 'running');
  assert.equal(activatedState.unlock.attempts, 1);
  assert.equal(activatedState.unlock.lastEvent, 'pointerup');
  assert.equal(activatedState.unlock.lastPointerType, 'touch');
  assert(activatedState.unlock.primeAttempts >= 2);
  assert(activatedState.unlock.primeCompletions >= 1);
  assert(activatedState.unlock.lastClockDelta > 0);
  assert.equal(activatedState.unlock.listenersInstalled, false);
  assert.equal(activatedState.unlock.lastError, undefined);

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
    () => {
      const context = window.scaffolding?.vm?.runtime?.audioEngine?.audioContext;
      const unlock = window.__tmposeAudioUnlockState;
      return (
        context?.state === 'running'
        && unlock?.lifecycleEvents >= 1
        && unlock?.completed === true
        && unlock?.clockAdvanced === true
      );
    },
    undefined,
    {timeout: 120000},
  );

  console.log(
    'Verified webkit audio: interrupted/suspended start, one-touch unlock, rendered silent prime, advancing audio clock, and pageshow recovery.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
