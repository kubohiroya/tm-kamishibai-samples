import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {chromium} from 'playwright';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const fixtures = new Map([
  [
    '/urashima',
    await readFile(path.join(projectRoot, 'dist/stories/urashima/web-4.0/index.html')),
  ],
  [
    '/my-urashima',
    await readFile(path.join(projectRoot, 'dist/stories/my-urashima/web-4.0/index.html')),
  ],
]);
const workshopSourcePath = path.join(
  projectRoot,
  'stories/my-urashima/my-urashima.k4.yml',
);

const server = createServer((request, response) => {
  const contents = fixtures.get(request.url);
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
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

async function openDsl4Page(browser, origin, pathname) {
  const page = await browser.newPage({locale: 'ja-JP', viewport: {width: 960, height: 720}});
  const failures = [];
  const externalRequests = [];
  page.on('pageerror', (error) => failures.push(String(error.stack ?? error)));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });
  await page.route('**/*', async (route) => {
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
    () => document.querySelector('[data-dsl4-title-controls=true]')?.style.display === 'block',
    undefined,
    {timeout: 120_000},
  );
  assert.equal(
    await page.evaluate(
      () => document.querySelector('[data-dsl4-runtime-error=true]')?.style.display === 'flex',
    ),
    false,
  );
  return {externalRequests, failures, page};
}

let browser;
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless: true});

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
          .filter(({name}) => /^(?:Title|Menu)/u.test(name))
          .map(({skinId}) => skinId);
        return (
          document.querySelector('[data-dsl4-title-controls=true]')?.style.display === 'none' &&
          document.querySelector('[data-dsl4-application-menu=true]')?.style.display !== 'block' &&
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
        titleDisplay: document.querySelector('[data-dsl4-title-controls=true]')?.style.display,
        menuDisplay: document.querySelector('[data-dsl4-application-menu=true]')?.style.display,
        errorDisplay: document.querySelector('[data-dsl4-runtime-error=true]')?.style.display,
        errorText: document.querySelector('[data-dsl4-runtime-error=true]')?.textContent,
        stageCostume: stage?.getCostumes()[stage.currentCostume]?.name,
        drawableSkinId:
          vm?.runtime?.renderer?._allDrawables?.[stage?.drawableID]?._skin?._id,
        shellSkinIds: stage
          ?.getCostumes()
          .filter(({name}) => /^(?:Title|Menu)/u.test(name))
          .map(({name, skinId}) => ({name, skinId})),
      };
    });
    throw new Error(
      `${error.message}\n${JSON.stringify({state, failures: urashima.failures}, null, 2)}`,
    );
  }
  assert.deepEqual(urashima.externalRequests, []);
  assert.deepEqual(urashima.failures, []);
  await urashima.page.close();

  const workshop = await openDsl4Page(browser, origin, '/my-urashima');
  const workshopProject = await workshop.page.evaluate(() => {
    const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
    const project = JSON.parse(vm.toJSON());
    const princess = project.targets.filter((target) => target.name === 'Princess');
    return {
      applicationMode:
        project.extensionStorage.kubohiroyakamishibai4.components
          .kubohiroyakamishibairuntime4.application.mode,
      princessCostumes: princess.flatMap((target) => target.costumes.map(({name}) => name)),
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
    () => document.querySelector('[data-dsl4-application-menu=true]')?.style.display === 'block',
    undefined,
    {timeout: 120_000},
  );
  const reload = workshop.page.locator('[data-dsl4-menu-action=reload]');
  assert.equal(await reload.isDisabled(), true);
  assert.equal(await reload.getAttribute('aria-disabled'), 'true');
  const chooserPromise = workshop.page.waitForEvent('filechooser');
  await workshop.page.locator('[data-dsl4-menu-action=open]').click();
  const chooser = await chooserPromise;
  assert.match(await chooser.element().getAttribute('accept'), /\.ya?ml/u);
  await chooser.setFiles(workshopSourcePath);
  await workshop.page.waitForFunction(
    () => {
      const vm = globalThis.Scratch?.vm ?? globalThis.scaffolding?.vm;
      const stage = vm.runtime.getTargetForStage();
      const drawableSkinId = vm.runtime.renderer._allDrawables[stage.drawableID]?._skin?._id;
      const shellSkinIds = stage
        .getCostumes()
        .filter(({name}) => /^(?:Title|Menu)/u.test(name))
        .map(({skinId}) => skinId);
      const errorVisible =
        document.querySelector('[data-dsl4-runtime-error=true]')?.style.display === 'flex';
      return (
        !errorVisible &&
        document.querySelector('[data-dsl4-application-menu=true]')?.style.display === 'none' &&
        Number.isInteger(drawableSkinId) &&
        !shellSkinIds.includes(drawableSkinId)
      );
    },
    undefined,
    {timeout: 120_000},
  );
  assert.deepEqual(workshop.externalRequests, []);
  assert.deepEqual(workshop.failures, []);
  await workshop.page.close();

  process.stdout.write('Verified DSL 4.0 packaged Urashima and workshop Web applications.\n');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
