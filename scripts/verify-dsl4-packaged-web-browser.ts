import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {chromium, type Browser, type ConsoleMessage} from 'playwright';

import type {Dsl4BuildConfig} from './story-config.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const readDsl4Config = (configPath: string): Promise<Dsl4BuildConfig> =>
  readFile(configPath, 'utf8').then((contents) => JSON.parse(contents) as Dsl4BuildConfig);
const [urashimaConfig, myUrashimaConfig, tutorialConfig] = await Promise.all([
  readDsl4Config(path.join(projectRoot, 'stories/urashima/dsl4-build.config.json')),
  readDsl4Config(path.join(projectRoot, 'stories/my-urashima/dsl4-build.config.json')),
  readDsl4Config(path.join(projectRoot, 'stories/tutorial/dsl4-build.config.json')),
]);
const urashimaEnabled = urashimaConfig.web?.enabled === true;
const myUrashimaEnabled = myUrashimaConfig.web?.enabled === true;
const tutorialEnabled = tutorialConfig.web?.enabled === true;
const fixtures = new Map<string, Buffer>(
  await Promise.all(
    ([
      urashimaEnabled
        ? readFile(path.join(projectRoot, 'dist/stories/urashima/web-4.0/index.html')).then(
            (contents): [string, Buffer] => ['/urashima', contents],
          )
        : null,
      myUrashimaEnabled
        ? readFile(path.join(projectRoot, 'dist/stories/my-urashima/web-4.0/index.html')).then(
            (contents): [string, Buffer] => ['/my-urashima', contents],
          )
        : null,
      tutorialEnabled
        ? readFile(
            path.join(projectRoot, 'tmp/tutorial-candidate/web-4.0/index.html'),
          ).then((contents): [string, Buffer] => ['/tutorial', contents])
        : null,
    ].filter((entry) => entry !== null) as Promise<[string, Buffer]>[]),
  ),
);
const workshopSource = await readFile(
  path.join(projectRoot, 'stories/my-urashima/my-urashima.k4.yml'),
  'utf8',
);

function conciseFailure(value: unknown): string {
  return String(value).replace(/data:text\/javascript;base64,[^\s)]+/gu, 'data:<embedded-runtime>');
}

const server = createServer((request, response) => {
  const contents = request.url === undefined ? undefined : fixtures.get(request.url);
  if (!contents) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': contents.length,
  });
  response.end(contents);
});
await new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve());
});

/** listen 済みの HTTP サーバの待受オリジン。address() は string | AddressInfo | null を返す。 */
function listeningOrigin(target: import('node:http').Server): string {
  const address = target.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The verification server is not listening on a TCP port.');
  }
  return `http://127.0.0.1:${address.port}`;
}


async function openDsl4Page(
  browser: Browser,
  origin: string,
  pathname: string,
  {storySource}: {storySource?: string} = {},
) {
  const page = await browser.newPage({locale: 'ja-JP', viewport: {width: 960, height: 720}});
  const failures: string[] = [];
  const externalRequests: string[] = [];
  const canvasReadbackWarnings: string[] = [];
  page.on('pageerror', (error: Error) => failures.push(conciseFailure(error.stack ?? error)));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') failures.push(conciseFailure(message.text()));
    if (message.text().includes('willReadFrequently')) {
      canvasReadbackWarnings.push(conciseFailure(message.text()));
    }
  });
  if (storySource !== undefined) {
    await page.addInitScript((source: any) => {
      globalThis.__tmposeFilePickerCalls = [];
      Object.defineProperty(globalThis, 'showOpenFilePicker', {
        configurable: true,
        value: async (options: any) => {
          globalThis.__tmposeFilePickerCalls.push(options);
          const file = new File([source], 'my-urashima.k4.yml', {type: 'application/yaml'});
          return [
            {
              kind: 'file',
              name: file.name,
              async queryPermission() {
                return 'granted';
              },
              async getFile() {
                return file;
              },
            },
          ];
        },
      });
    }, storySource);
  }
  await page.route('**/*', async (route: any) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:')) {
      await route.continue();
      return;
    }
    externalRequests.push(url);
    await route.abort('blockedbyclient');
  });
  await page.goto(`${origin}${pathname}`, {waitUntil: 'domcontentloaded', timeout: 120_000});
  await page.waitForFunction(
    () => {
      const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
      return Boolean(vm?.runtime?.getTargetForStage());
    },
    undefined,
    {timeout: 120_000},
  );
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('[data-dsl4-title-controls=true]')?.style.display === 'block',
    undefined,
    {timeout: 120_000},
  );
  assert.equal(
    await page.evaluate(
      () => document.querySelector<HTMLElement>('[data-dsl4-runtime-error=true]')?.style.display === 'flex',
    ),
    false,
  );
  return {canvasReadbackWarnings, externalRequests, failures, page};
}

let browser;
try {
  const origin = listeningOrigin(server);
  browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });

  if (urashimaEnabled) {
    const urashima = await openDsl4Page(browser, origin, '/urashima');
    const urashimaApplicationMode = await urashima.page.evaluate(() => {
      const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
      const project = JSON.parse(vm.toJSON());
      return project.extensionStorage.kubohiroyakamishibai4.components
        .kubohiroyakamishibairuntime4.application.mode;
    });
    assert.equal(urashimaApplicationMode, 'story');
    await urashima.page.locator('[data-dsl4-title-action=close]').click();
    try {
      await urashima.page.waitForFunction(
        () => {
          const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
          const stage = vm.runtime.getTargetForStage();
          const drawableSkinId = vm.runtime.renderer._allDrawables[stage.drawableID]?._skin?._id;
          const shellSkinIds = stage
            .getCostumes()
            .filter(({name}: any) => /^(?:Title|Menu)/u.test(name))
            .map(({skinId}: any) => skinId);
          return (
            document.querySelector<HTMLElement>('[data-dsl4-title-controls=true]')?.style.display === 'none' &&
            document.querySelector<HTMLElement>('[data-dsl4-application-menu=true]')?.style.display !==
              'block' &&
            Number.isInteger(drawableSkinId) &&
            !shellSkinIds.includes(drawableSkinId)
          );
        },
        undefined,
        {timeout: 30_000},
      );
    } catch (error) {
      const state = await urashima.page.evaluate(() => {
        const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
        const stage = vm?.runtime?.getTargetForStage();
        return {
          titleDisplay: document.querySelector<HTMLElement>('[data-dsl4-title-controls=true]')?.style.display,
          menuDisplay: document.querySelector<HTMLElement>('[data-dsl4-application-menu=true]')?.style.display,
          errorDisplay: document.querySelector<HTMLElement>('[data-dsl4-runtime-error=true]')?.style.display,
          errorText: document.querySelector<HTMLElement>('[data-dsl4-runtime-error=true]')?.textContent,
          stageCostume: stage?.getCostumes()[stage.currentCostume]?.name,
          drawableSkinId: vm?.runtime?.renderer?._allDrawables?.[stage?.drawableID]?._skin?._id,
          shellSkinIds: stage
            ?.getCostumes()
            .filter(({name}: any) => /^(?:Title|Menu)/u.test(name))
            .map(({name, skinId}: any) => ({name, skinId})),
        };
      });
      throw new Error(
        `${(error as Error).message}\n${JSON.stringify({state, failures: urashima.failures}, null, 2)}`,
      );
    }
    assert.deepEqual(urashima.externalRequests, []);
    assert.deepEqual(urashima.failures, []);
    assert.deepEqual(urashima.canvasReadbackWarnings, []);
    await urashima.page.close();
  }

  if (myUrashimaEnabled) {
    const workshop = await openDsl4Page(browser, origin, '/my-urashima', {storySource: workshopSource});
    const workshopProject = await workshop.page.evaluate(() => {
      const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
      const project = JSON.parse(vm.toJSON());
      const princess = project.targets.filter((target: any) => target.name === 'Princess');
      return {
        applicationMode:
          project.extensionStorage.kubohiroyakamishibai4.components
            .kubohiroyakamishibairuntime4.application.mode,
        princessCostumes: princess.flatMap((target: any) => target.costumes.map(({name}: any) => name)),
        princessTargets: princess.length,
      };
    });
    assert.deepEqual(workshopProject, {
      applicationMode: 'menu',
      princessCostumes: ['Princess'],
      princessTargets: 1,
    });
    await workshop.page.locator('[data-dsl4-title-action=close]').click();
    await workshop.page.waitForFunction(
      () => document.querySelector<HTMLElement>('[data-dsl4-application-menu=true]')?.style.display === 'block',
      undefined,
      {timeout: 120_000},
    );
    const reload = workshop.page.locator('[data-dsl4-menu-action=reload]');
    assert.equal(await reload.isDisabled(), true);
    assert.equal(await reload.getAttribute('aria-disabled'), 'true');
    await workshop.page.locator('[data-dsl4-menu-action=open]').click();
    const sourceChooser = workshop.page.locator('[data-dsl4-source-chooser=true]');
    await sourceChooser.waitFor({state: 'visible', timeout: 30_000});
    const fileChoice = sourceChooser.locator('[data-dsl4-source-choice=file]');
    assert.equal(await fileChoice.isDisabled(), false);
    await fileChoice.click();
    await workshop.page.waitForFunction(
      () => {
        const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
        const stage = vm.runtime.getTargetForStage();
        const drawableSkinId = vm.runtime.renderer._allDrawables[stage.drawableID]?._skin?._id;
        const shellSkinIds = stage
          .getCostumes()
          .filter(({name}: any) => /^(?:Title|Menu)/u.test(name))
          .map(({skinId}: any) => skinId);
        const errorVisible =
          document.querySelector<HTMLElement>('[data-dsl4-runtime-error=true]')?.style.display === 'flex';
        return (
          !errorVisible &&
          document.querySelector<HTMLElement>('[data-dsl4-application-menu=true]')?.style.display === 'none' &&
          Number.isInteger(drawableSkinId) &&
          !shellSkinIds.includes(drawableSkinId)
        );
      },
      undefined,
      {timeout: 120_000},
    );
    assert.deepEqual(await workshop.page.evaluate(() => globalThis.__tmposeFilePickerCalls), [
      {
        multiple: false,
        types: [
          {
            description: 'Kamishibai DSL 4.0 YAML',
            accept: {'application/yaml': ['.yml', '.yaml']},
          },
        ],
      },
    ]);
    assert.deepEqual(workshop.externalRequests, []);
    assert.deepEqual(workshop.failures, []);
    assert.deepEqual(workshop.canvasReadbackWarnings, []);
    await workshop.page.close();
  }

  if (tutorialEnabled) {
    const tutorial = await openDsl4Page(browser, origin, '/tutorial');
    const tutorialProject = await tutorial.page.evaluate(() => {
      const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
      const project = JSON.parse(vm.toJSON());
      return {
        applicationMode:
          project.extensionStorage.kubohiroyakamishibai4.components
            .kubohiroyakamishibairuntime4.application.mode,
        targets: project.targets.map(({name}: any) => name),
      };
    });
    assert.deepEqual(tutorialProject, {
      applicationMode: 'story',
      targets: ['Stage', 'Student'],
    });
    await tutorial.page.locator('[data-dsl4-title-action=close]').click();
    await tutorial.page.waitForFunction(
      () => {
        const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
        const stage = vm.runtime.getTargetForStage();
        const drawableSkinId = vm.runtime.renderer._allDrawables[stage.drawableID]?._skin?._id;
        const shellSkinIds = stage
          .getCostumes()
          .filter(({name}: any) => /^(?:Title|Menu)/u.test(name))
          .map(({skinId}: any) => skinId);
        return (
          document.querySelector<HTMLElement>('[data-dsl4-title-controls=true]')?.style.display === 'none' &&
          document.querySelector<HTMLElement>('[data-dsl4-application-menu=true]')?.style.display !== 'block' &&
          Number.isInteger(drawableSkinId) &&
          !shellSkinIds.includes(drawableSkinId)
        );
      },
      undefined,
      {timeout: 120_000},
    );
    const dispatchTutorialKey = (key: any) =>
      tutorial.page.evaluate((pressedKey: any) => {
        const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
        const canvas = vm?.runtime?.renderer?._gl?.canvas;
        if (!(canvas instanceof EventTarget)) return false;
        const keydown = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: pressedKey,
          key: pressedKey,
        });
        canvas.dispatchEvent(keydown);
        canvas.dispatchEvent(
          new KeyboardEvent('keyup', {
            bubbles: true,
            cancelable: true,
            code: pressedKey,
            key: pressedKey,
          }),
        );
        return keydown.defaultPrevented;
      }, key);

    let acceptedSkips = 0;
    for (let index = 0; index < 12 && acceptedSkips < 2; index += 1) {
      if (await dispatchTutorialKey('ArrowDown')) acceptedSkips += 1;
      await tutorial.page.waitForTimeout(1_000);
    }
    assert.equal(acceptedSkips, 2, 'The tutorial stage must enter the pose scene.');
    await tutorial.page.waitForFunction(
      () => {
        const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
        const student = vm?.runtime?.targets?.find(
          (target: any) => !target.isStage && target.getName() === 'Student',
        );
        return (
          student?.visible === true &&
          (student.getCustomState('Scratch.looks')?.text ?? '') === ''
        );
      },
      undefined,
      {timeout: 120_000},
    );
    const poseFeedbackState = await tutorial.page.evaluate(() => {
      const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
      const student = vm.runtime.targets.find(
        (target: any) => !target.isStage && target.getName() === 'Student',
      );
      return {
        menuVisible:
          document.querySelector<HTMLElement>('[data-dsl4-application-menu=true]')?.style.display === 'block',
        visible: student.visible,
      };
    });
    assert.deepEqual(poseFeedbackState, {
      menuVisible: false,
      visible: true,
    });

    let poseSkipAccepted = false;
    for (let index = 0; index < 60 && !poseSkipAccepted; index += 1) {
      poseSkipAccepted = await dispatchTutorialKey('Space');
      if (!poseSkipAccepted) await tutorial.page.waitForTimeout(1_000);
    }
    assert.equal(poseSkipAccepted, true, 'The active tutorial pose must accept the skip control.');
    try {
      await tutorial.page.waitForFunction(
        () => {
          const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
          const student = vm?.runtime?.targets?.find(
            (target: any) => !target.isStage && target.getName() === 'Student',
          );
          return (
            student?.visible === true &&
            student.getCustomState('Scratch.looks')?.text ===
              'できた！ 頭を守れたね。揺れがおさまるまで、そのまま待とう。' &&
            document.querySelector<HTMLElement>('[data-dsl4-application-menu=true]')?.style.display !== 'block'
          );
        },
        undefined,
        {timeout: 30_000},
      );
    } catch (error) {
      const state = await tutorial.page.evaluate(() => {
        const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
        const student = vm?.runtime?.targets?.find(
          (target: any) => !target.isStage && target.getName() === 'Student',
        );
        return {
          bubble: student?.getCustomState('Scratch.looks')?.text ?? '',
          errorDisplay: document.querySelector<HTMLElement>('[data-dsl4-runtime-error=true]')?.style.display,
          errorText: document.querySelector<HTMLElement>('[data-dsl4-runtime-error=true]')?.textContent,
          menuDisplay: document.querySelector<HTMLElement>('[data-dsl4-application-menu=true]')?.style.display,
          visible: student?.visible ?? null,
        };
      });
      throw new Error(`${(error as Error).message}\n${JSON.stringify({state, failures: tutorial.failures})}`);
    }
    try {
      await tutorial.page.waitForFunction(
        () => document.querySelector<HTMLElement>('[data-dsl4-application-menu=true]')?.style.display === 'block',
        undefined,
        {timeout: 30_000},
      );
    } catch (error) {
      const state = await tutorial.page.evaluate(() => {
        const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
        const stage = vm?.runtime?.getTargetForStage();
        return {
          titleDisplay: document.querySelector<HTMLElement>('[data-dsl4-title-controls=true]')?.style.display,
          menuDisplay: document.querySelector<HTMLElement>('[data-dsl4-application-menu=true]')?.style.display,
          errorDisplay: document.querySelector<HTMLElement>('[data-dsl4-runtime-error=true]')?.style.display,
          errorText: document.querySelector<HTMLElement>('[data-dsl4-runtime-error=true]')?.textContent,
          stageCostume: stage?.getCostumes()[stage.currentCostume]?.name,
          actors: vm?.runtime?.targets
            ?.filter((target: any) => !target.isStage)
            .map((target: any) => ({name: target.getName(), visible: target.visible})),
        };
      });
      throw new Error(
        `${(error as Error).message}\n${JSON.stringify(
          {acceptedSkips, state, failures: tutorial.failures},
          null,
          2,
        )}`,
      );
    }
    assert.deepEqual(tutorial.externalRequests, []);
    assert.deepEqual(tutorial.failures, []);
    // TMPose 1.12.0 retains the normal Canvas2D context after physical-camera
    // benchmarks found no repeatable gain from the readback hint. Chromium may warn once.
    assert(
      tutorial.canvasReadbackWarnings.length <= 1,
      `Tutorial emitted repeated Canvas readback warnings: ${tutorial.canvasReadbackWarnings.join('\n')}`,
    );
    await tutorial.page.close();
  }

  const verified = [
    ...(urashimaEnabled ? ['Urashima'] : []),
    ...(myUrashimaEnabled ? ['workshop'] : []),
    ...(tutorialEnabled ? ['tutorial release'] : []),
  ];
  process.stdout.write(
    verified.length > 0
      ? `Verified DSL 4.0 packaged ${verified.join(' and ')} Web applications.\n`
      : 'Skipped disabled DSL 4.0 packaged Web applications.\n',
  );
} finally {
  await browser?.close();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}
