import assert from 'node:assert/strict';
import {mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildPackagedWeb} from './build-packaged-web.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

export async function buildWebLock(storyName) {
  const storyDirectory = path.join(projectRoot, 'stories', storyName);
  const config = await readJson(path.join(storyDirectory, 'dsl4-build.config.json'));
  assert.equal(config.formatVersion, 1);
  if (config.web?.enabled !== true) return {enabled: false};
  const temporaryOutput = await mkdtemp(path.join(tmpdir(), `${storyName}-dsl4-web-`));
  try {
    const web = await buildPackagedWeb({
      inputSb3Path: path.join(storyDirectory, config.output),
      outputSampleDirectory: temporaryOutput,
      rawWebConfig: config.web,
    });
    assert.equal(web.enabled, true);
    await writeJsonAtomically(path.join(storyDirectory, config.webArtifactsLock), web);
    return web;
  } finally {
    await rm(temporaryOutput, {recursive: true, force: true});
  }
}

function resultSummary(result) {
  return result.enabled ? result.output.sha256 : 'disabled (lock preserved)';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const urashima = await buildWebLock('urashima');
  const myUrashima = await buildWebLock('my-urashima');
  const tutorial = await buildWebLock('tutorial');
  process.stdout.write(
    `Locked DSL 4.0 Web artifacts: urashima ${resultSummary(urashima)}, my-urashima ${resultSummary(myUrashima)}, tutorial ${resultSummary(tutorial)}.\n`,
  );
}
