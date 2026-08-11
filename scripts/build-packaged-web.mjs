import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

import {strFromU8, unzipSync} from 'fflate';

const require = createRequire(import.meta.url);
const Packager = require('@turbowarp/packager');
const installedPackager = require('@turbowarp/packager/package.json');

export const DEFAULT_WEB_CONFIGURATION = Object.freeze({
  enabled: false,
  audioUnlock: Object.freeze({enabled: false}),
});
export const AUDIO_UNLOCK_EVENTS = Object.freeze([
  'pointerdown',
  'pointerup',
  'touchend',
  'mousedown',
  'click',
  'keydown',
]);
export const AUDIO_UNLOCK_LIFECYCLE_EVENTS = Object.freeze([
  'visibilitychange',
  'pageshow',
]);
export const AUDIO_UNLOCK_CLOCK_CHECK_DELAY_MS = 250;

export const AUDIO_UNLOCK_SCRIPT = `
(() => {
  const eventNames = ${JSON.stringify(AUDIO_UNLOCK_EVENTS)};
  const lifecycleEventNames = ${JSON.stringify(AUDIO_UNLOCK_LIFECYCLE_EVENTS)};
  const clockCheckDelayMs = ${AUDIO_UNLOCK_CLOCK_CHECK_DELAY_MS};
  const state = {
    installed: true,
    attempts: 0,
    primeAttempts: 0,
    primeCompletions: 0,
    verifications: 0,
    ignoredEvents: 0,
    lifecycleEvents: 0,
    completed: false,
    clockAdvanced: false,
    hasActivated: false,
    listenersInstalled: false,
    unlocking: false,
  };
  window.__tmposeAudioUnlockState = state;
  let verificationToken = 0;

  function installUnlockListeners() {
    if (state.listenersInstalled) return;
    for (const eventName of eventNames) {
      document.addEventListener(eventName, unlockAudio, {capture: true, passive: true});
    }
    state.listenersInstalled = true;
  }

  function removeUnlockListeners() {
    if (!state.listenersInstalled) return;
    for (const eventName of eventNames) {
      document.removeEventListener(eventName, unlockAudio, true);
    }
    state.listenersInstalled = false;
  }

  function audioContext() {
    return window.scaffolding?.vm?.runtime?.audioEngine?.audioContext;
  }

  function recordError(error) {
    state.lastError = String(error);
    state.unlocking = false;
    installUnlockListeners();
    console.warn('Unable to unlock Web Audio from user activation.', error);
  }

  function isWebKitActivation(event) {
    if (event.type === 'pointerdown') return event.pointerType === 'mouse';
    if (event.type === 'pointerup') return event.pointerType !== 'mouse';
    return true;
  }

  function primeOutput(context) {
    try {
      const buffer = context.createBuffer(1, 1, context.sampleRate || 44100);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        state.primeCompletions += 1;
        source.disconnect();
      };
      source.start(0);
      state.primeAttempts += 1;
    } catch (error) {
      state.lastPrimeError = String(error);
    }
  }

  function verifyClock(context) {
    const startTime = Number(context.currentTime);
    const token = ++verificationToken;
    state.verifications += 1;
    window.setTimeout(() => {
      if (token !== verificationToken) return;
      const endTime = Number(context.currentTime);
      state.lastContextState = context.state;
      state.lastClockDelta = endTime - startTime;
      state.clockAdvanced =
        context.state === 'running'
        && Number.isFinite(state.lastClockDelta)
        && state.lastClockDelta > 0;
      state.completed = state.clockAdvanced;
      state.unlocking = false;
      if (state.completed) {
        delete state.lastError;
        removeUnlockListeners();
      } else {
        installUnlockListeners();
      }
    }, clockCheckDelayMs);
  }

  async function recoverAudio(context, resetRunningContext) {
    try {
      if (context.state === 'closed') throw new Error('AudioContext is closed.');
      primeOutput(context);
      if (resetRunningContext && context.state === 'running') {
        await context.suspend();
      }
      if (context.state !== 'running') {
        await context.resume();
      }
      primeOutput(context);
      verifyClock(context);
    } catch (error) {
      recordError(error);
    }
  }

  function unlockAudio(event) {
    if (!isWebKitActivation(event)) {
      state.ignoredEvents += 1;
      return;
    }
    const context = audioContext();
    if (!context || state.unlocking) return;
    state.attempts += 1;
    state.lastEvent = event.type;
    state.lastPointerType = event.pointerType || '';
    state.hasActivated = true;
    state.completed = false;
    state.clockAdvanced = false;
    state.unlocking = true;
    delete state.lastError;
    verificationToken += 1;
    void recoverAudio(context, context.state === 'running');
  }

  function recoverAfterLifecycle(event) {
    if (event.type === 'visibilitychange' && document.visibilityState !== 'visible') return;
    installUnlockListeners();
    if (!state.hasActivated) return;
    const context = audioContext();
    if (!context || state.unlocking) return;
    state.lifecycleEvents += 1;
    state.lastLifecycleEvent = event.type;
    state.completed = false;
    state.clockAdvanced = false;
    state.unlocking = true;
    verificationToken += 1;
    void recoverAudio(context, false);
  }

  installUnlockListeners();
  for (const eventName of lifecycleEventNames) {
    const target = eventName === 'visibilitychange' ? document : window;
    target.addEventListener(eventName, recoverAfterLifecycle, true);
  }
})();
`;

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function projectExtensions(sb3Bytes) {
  const archive = unzipSync(new Uint8Array(sb3Bytes));
  const project = JSON.parse(strFromU8(archive['project.json']));
  const entries = Object.entries(project.extensionURLs ?? {}).sort(([left], [right]) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return {
    urls: [...new Set(entries.map(([, url]) => url))],
    records: entries.map(([id, url]) =>
      url.startsWith('data:')
        ? {id, source: 'input-sb3-data-url', sha256: sha256(url)}
        : {id, source: 'packager-baked-url', url},
    ),
  };
}

function configurePackager(loadedProject, webConfig, extensionUrls) {
  const packager = new Packager.Packager();
  packager.project = loadedProject;
  packager.options.target = webConfig.packager.options.target;
  packager.options.autoplay = webConfig.packager.options.autoplay;
  packager.options.app.windowTitle = webConfig.packager.options.app.windowTitle;
  packager.options.cloudVariables.mode = webConfig.packager.options.cloudVariables.mode;
  packager.options.bakeExtensions = true;
  packager.options.extensions = extensionUrls;
  if (webConfig.audioUnlock?.enabled === true) {
    packager.options.custom.js = AUDIO_UNLOCK_SCRIPT;
  }
  return packager;
}

function verifyPackagerResult(result, webConfig) {
  assert.equal(result.type, 'text/html', 'Packager must generate Plain HTML.');
  assert.equal(path.basename(result.filename), result.filename, 'Unsafe Packager filename.');
  assert.equal(/[\\/]/u.test(result.filename), false, 'Unsafe Packager filename separator.');
  assert(result.data.length > 0, 'Packager generated an empty HTML file.');
  assert(
    result.data.length <= webConfig.maxOutputBytes,
    `Packager HTML exceeds configured limit: ${result.data.length} bytes.`,
  );
  const prefix = Buffer.from(result.data.subarray(0, 256)).toString('utf8');
  assert.match(prefix, /^<!DOCTYPE html>/u, 'Packager output is not HTML.');
}

async function packageOnce(loadedProject, webConfig, extensionUrls) {
  const packager = configurePackager(loadedProject, webConfig, extensionUrls);
  const result = await packager.package();
  verifyPackagerResult(result, webConfig);
  return result;
}

export async function buildPackagedWeb({
  inputSb3Path,
  outputSampleDirectory,
  rawWebConfig,
  expectedInput,
  expectedOutput,
}) {
  const webConfig = {...DEFAULT_WEB_CONFIGURATION, ...rawWebConfig};
  if (!webConfig.enabled) return {enabled: false};

  assert(
    ['player', 'dsl4-offline', 'dsl4-workshop'].includes(webConfig.inputProfile),
    `Unsupported Web input profile: ${webConfig.inputProfile}`,
  );
  assert(
    ['embedded', 'external'].includes(webConfig.scriptMode),
    `Unsupported Web script mode: ${webConfig.scriptMode}`,
  );
  assert(
    ['embedded', 'embedded-project'].includes(webConfig.assets),
    `Unsupported Web asset mode: ${webConfig.assets}`,
  );
  assert.equal(webConfig.packager.package, '@turbowarp/packager');
  assert.equal(webConfig.packager.version, installedPackager.version);
  assert.equal(webConfig.packager.version, '3.13.0');
  assert.equal(webConfig.packager.options.target, 'html');
  assert.equal(webConfig.packager.options.autoplay, true);
  assert.equal(webConfig.packager.options.cloudVariables.mode, 'disabled');
  assert.equal(typeof (webConfig.audioUnlock?.enabled ?? false), 'boolean');
  assert.equal(path.basename(webConfig.outputDirectory), webConfig.outputDirectory);
  assert.equal(path.basename(webConfig.outputFilename), webConfig.outputFilename);
  assert.equal(webConfig.outputFilename, 'index.html');

  const input = await readFile(inputSb3Path);
  const inputRecord = {
    profile: webConfig.inputProfile,
    path: path.basename(inputSb3Path),
    size: input.length,
    sha256: sha256(input),
  };
  if (expectedInput !== undefined) {
    assert.deepEqual(inputRecord, expectedInput, 'Packager input differs from the locked player SB3.');
  }

  const extensions = projectExtensions(input);
  const loadedProject = await Packager.loadProject(input);
  const [first, second] = await Promise.all([
    packageOnce(loadedProject, webConfig, extensions.urls),
    packageOnce(loadedProject, webConfig, extensions.urls),
  ]);
  const firstBytes = Buffer.from(first.data);
  const secondBytes = Buffer.from(second.data);
  assert(firstBytes.equals(secondBytes), 'Two Packager runs produced different Plain HTML.');

  const outputRecord = {
    path: `${webConfig.outputDirectory}/${webConfig.outputFilename}`,
    contentType: first.type,
    size: firstBytes.length,
    sha256: sha256(firstBytes),
  };
  if (expectedOutput !== undefined) {
    assert.deepEqual(outputRecord, expectedOutput, 'Packager HTML differs from its artifact lock.');
  }

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'tmpose-kamishibai-web-'));
  try {
    const temporaryOutput = path.join(temporaryDirectory, webConfig.outputFilename);
    await writeFile(temporaryOutput, firstBytes);
    const finalDirectory = path.join(outputSampleDirectory, webConfig.outputDirectory);
    await mkdir(finalDirectory, {recursive: true});
    await copyFile(temporaryOutput, path.join(finalDirectory, webConfig.outputFilename));
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }

  return {
    enabled: true,
    publicPath: `${webConfig.outputDirectory}/`,
    input: inputRecord,
    output: outputRecord,
    packager: {
      package: webConfig.packager.package,
      version: webConfig.packager.version,
      options: {
        target: webConfig.packager.options.target,
        autoplay: webConfig.packager.options.autoplay,
        app: {windowTitle: webConfig.packager.options.app.windowTitle},
        cloudVariables: {mode: webConfig.packager.options.cloudVariables.mode},
        bakeExtensions: true,
      },
      projectExtensions: extensions.records,
    },
    scriptMode: webConfig.scriptMode,
    assets: webConfig.assets,
    audioUnlock: {
      enabled: webConfig.audioUnlock?.enabled === true,
      events: webConfig.audioUnlock?.enabled === true ? [...AUDIO_UNLOCK_EVENTS] : [],
      lifecycleEvents:
        webConfig.audioUnlock?.enabled === true ? [...AUDIO_UNLOCK_LIFECYCLE_EVENTS] : [],
      verification:
        webConfig.audioUnlock?.enabled === true
          ? {
              strategy: 'state-and-clock',
              clockCheckDelayMs: AUDIO_UNLOCK_CLOCK_CHECK_DELAY_MS,
              primesOutput: true,
            }
          : null,
    },
    allowedOnlineDependencies: webConfig.allowedOnlineDependencies,
    runtimeCapabilities: webConfig.runtimeCapabilities,
    reproducibility: {runs: 2, identical: true},
  };
}
