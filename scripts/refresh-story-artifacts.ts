import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {deriveMyUrashimaSource} from './build-my-urashima.ts';
import {planStoryDate, type StoryDatePlan} from './story-date.ts';
import {updateMyUrashimaArtifacts} from './update-my-urashima-artifacts.ts';
import {updateUrashimaArtifactsLock} from './update-urashima-artifacts-lock.ts';
import type {ArtifactsLock} from './story-config.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const urashimaDirectory = path.join(projectRoot, 'stories/urashima');
const myUrashimaDirectory = path.join(projectRoot, 'stories/my-urashima');

export interface StoryDatePlans {
  myUrashima: StoryDatePlan;
  urashima: StoryDatePlan;
}

export interface RefreshResult {
  plan: StoryDatePlans;
  refreshed: {myUrashima: boolean; urashima: boolean};
}

async function readJson(filePath: string): Promise<ArtifactsLock> {
  return JSON.parse(await readFile(filePath, 'utf8')) as ArtifactsLock;
}

export async function prepareStoryDates({
  clock = new Date(),
}: {clock?: Date} = {}): Promise<StoryDatePlans> {
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
}: {clock?: Date; forceMyUrashima?: boolean; forceUrashima?: boolean} = {}): Promise<RefreshResult> {
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
