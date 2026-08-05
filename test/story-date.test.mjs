import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {deriveMyUrashimaSource} from '../scripts/build-my-urashima.mjs';
import {prepareStoryDates} from '../scripts/refresh-story-artifacts.mjs';
import {
  formatLocalDate,
  planStoryDate,
  readStoryDate,
  storyDateMetadata,
} from '../scripts/story-date.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

const source = `kamishibai=3.2
# title: 浦島太郎
# date: 2026-07-14
action=wait:1
`;

function localClock(year, monthIndex, day) {
  return {
    getDate: () => day,
    getFullYear: () => year,
    getMonth: () => monthIndex,
    toISOString: () => {
      throw new Error('UTC conversion must not be used');
    },
  };
}

test('formats the build date from local calendar fields without UTC conversion', () => {
  assert.equal(formatLocalDate(localClock(2026, 7, 5)), '2026-08-05');
});

test('advances a story date only when non-date content changes', () => {
  const initial = planStoryDate(source, undefined, localClock(2026, 7, 5));
  assert.equal(initial.contentChanged, true);
  assert.equal(initial.date, '2026-08-05');

  const unchanged = planStoryDate(initial.script, initial.metadata, localClock(2026, 7, 6));
  assert.equal(unchanged.contentChanged, false);
  assert.equal(unchanged.scriptChanged, false);
  assert.equal(unchanged.date, '2026-08-05');

  const changed = planStoryDate(
    initial.script.replace('action=wait:1', 'action=wait:2'),
    initial.metadata,
    localClock(2026, 7, 6),
  );
  assert.equal(changed.contentChanged, true);
  assert.equal(changed.date, '2026-08-06');
});

test('restores the recorded date when only the date line was edited', () => {
  const initial = planStoryDate(source, undefined, localClock(2026, 7, 5));
  const dateOnlyEdit = initial.script.replace('# date: 2026-08-05', '# date: 2099-12-31');
  const restored = planStoryDate(dateOnlyEdit, initial.metadata, localClock(2099, 11, 31));
  assert.equal(restored.contentChanged, false);
  assert.equal(restored.date, '2026-08-05');
  assert.equal(restored.script, initial.script);
});

test('keeps checked-in story dates and content fingerprints aligned', async () => {
  const [
    urashimaSource,
    urashimaScript,
    myUrashimaScript,
    urashimaLock,
    myUrashimaLock,
    ciWorkflow,
    deployWorkflow,
  ] = await Promise.all([
      readFile(path.join(projectRoot, 'stories/urashima/source.txt'), 'utf8'),
      readFile(path.join(projectRoot, 'stories/urashima/urashima.txt'), 'utf8'),
      readFile(path.join(projectRoot, 'stories/my-urashima/my-urashima.txt'), 'utf8'),
      readFile(path.join(projectRoot, 'stories/urashima/artifacts.lock.json'), 'utf8').then(
        JSON.parse,
      ),
      readFile(path.join(projectRoot, 'stories/my-urashima/artifacts.lock.json'), 'utf8').then(
        JSON.parse,
      ),
      readFile(path.join(projectRoot, '.github/workflows/ci.yml'), 'utf8'),
      readFile(path.join(projectRoot, '.github/workflows/deploy.yml'), 'utf8'),
    ]);
  assert.deepEqual(storyDateMetadata(urashimaSource), urashimaLock.storyDate);
  assert.equal(readStoryDate(urashimaScript), urashimaLock.storyDate.value);
  assert.equal(readStoryDate(myUrashimaScript), myUrashimaLock.storyDate.value);
  assert.equal(
    storyDateMetadata(await deriveMyUrashimaSource()).contentSha256,
    myUrashimaLock.storyDate.contentSha256,
  );
  assert.match(ciWorkflow, /^\s+TZ: Asia\/Tokyo$/mu);
  assert.match(deployWorkflow, /^\s+TZ: Asia\/Tokyo$/mu);

  const nextDayPlan = await prepareStoryDates({clock: localClock(2026, 7, 6)});
  assert.equal(nextDayPlan.urashima.contentChanged, false);
  assert.equal(nextDayPlan.urashima.scriptChanged, false);
  assert.equal(nextDayPlan.myUrashima.contentChanged, false);
  assert.equal(nextDayPlan.myUrashima.scriptChanged, false);
});
