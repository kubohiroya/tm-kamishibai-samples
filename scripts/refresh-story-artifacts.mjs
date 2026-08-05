import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {deriveMyUrashimaSource} from './build-my-urashima.mjs';
import {planStoryDate} from './story-date.mjs';
import {updateMyUrashimaArtifacts} from './update-my-urashima-artifacts.mjs';
import {updateUrashimaArtifactsLock} from './update-urashima-artifacts-lock.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const urashimaDirectory = path.join(projectRoot, 'stories/urashima');
const myUrashimaDirectory = path.join(projectRoot, 'stories/my-urashima');

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function prepareStoryDates({clock = new Date()} = {}) {
  const sourcePath = path.join(urashimaDirectory, 'source.txt');
  const [source, urashimaLock, myUrashimaLock] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readJson(path.join(urashimaDirectory, 'artifacts.lock.json')),
    readJson(path.join(myUrashimaDirectory, 'artifacts.lock.json')),
  ]);
  const urashima = planStoryDate(source, urashimaLock.storyDate, clock);
  if (urashima.scriptChanged) {
    await writeFile(sourcePath, urashima.script, 'utf8');
  }

  const derivedSource = await deriveMyUrashimaSource();
  const myUrashima = planStoryDate(derivedSource, myUrashimaLock.storyDate, clock);
  return {myUrashima, urashima};
}

export async function refreshChangedStoryArtifacts({
  clock = new Date(),
  forceMyUrashima = false,
  forceUrashima = false,
} = {}) {
  const plan = await prepareStoryDates({clock});
  const refreshUrashima =
    forceUrashima || plan.urashima.contentChanged || plan.urashima.scriptChanged;
  const refreshMyUrashima =
    forceMyUrashima ||
    refreshUrashima ||
    plan.myUrashima.contentChanged ||
    plan.myUrashima.scriptChanged;

  if (refreshUrashima) {
    await updateUrashimaArtifactsLock();
  }
  if (refreshMyUrashima) {
    await updateMyUrashimaArtifacts({scriptDate: plan.myUrashima.date});
  }
  return {plan, refreshed: {myUrashima: refreshMyUrashima, urashima: refreshUrashima}};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await refreshChangedStoryArtifacts({
    forceMyUrashima: process.argv.includes('--force-my'),
    forceUrashima: process.argv.includes('--force'),
  });
}
