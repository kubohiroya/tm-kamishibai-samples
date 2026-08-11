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

async function buildWebLock(storyName) {
  const storyDirectory = path.join(projectRoot, 'stories', storyName);
  const config = await readJson(path.join(storyDirectory, 'dsl4-build.config.json'));
  assert.equal(config.formatVersion, 1);
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

const urashima = await buildWebLock('urashima');
const myUrashima = await buildWebLock('my-urashima');
process.stdout.write(
  `Locked DSL 4.0 Web artifacts: urashima ${urashima.output.sha256}, my-urashima ${myUrashima.output.sha256}.\n`,
);
