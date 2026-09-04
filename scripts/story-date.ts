import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const DATE_LINE_PATTERN = /^# date: (\d{4}-\d{2}-\d{2})$/gmu;
const NORMALIZED_DATE_LINE = '# date: <content-date>';

export interface StoryDateMetadata {
  value: string;
  contentSha256: string;
}

export interface StoryDatePlan {
  contentChanged: boolean;
  date: string;
  metadata: StoryDateMetadata;
  script: string;
  scriptChanged: boolean;
}

interface DateLineMatch {
  index: number;
  length: number;
  value: string;
}

function dateMatch(script: string): DateLineMatch {
  const matches = [...script.matchAll(DATE_LINE_PATTERN)];
  assert.equal(matches.length, 1, 'Story script must contain exactly one # date: line.');
  const [match] = matches;
  assert.ok(match, 'Story script must contain exactly one # date: line.');
  assert.equal(typeof match.index, 'number', 'Story date match must expose an index.');
  return {index: match.index, length: match[0].length, value: match[1] as string};
}

export function formatLocalDate(clock: Date = new Date()): string {
  const year = clock.getFullYear();
  const month = clock.getMonth() + 1;
  const day = clock.getDate();
  for (const [name, value] of Object.entries({year, month, day})) {
    assert.equal(Number.isInteger(value), true, `Local ${name} must be an integer.`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function readStoryDate(script: string): string {
  return dateMatch(script).value;
}

export function replaceStoryDate(script: string, date: string): string {
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/u, 'Story date must use YYYY-MM-DD.');
  const match = dateMatch(script);
  return `${script.slice(0, match.index)}# date: ${date}${script.slice(match.index + match.length)}`;
}

export function storyDateMetadata(script: string): StoryDateMetadata {
  const match = dateMatch(script);
  const normalized = `${script.slice(0, match.index)}${NORMALIZED_DATE_LINE}${script.slice(match.index + match.length)}`;
  return {
    value: match.value,
    contentSha256: createHash('sha256').update(normalized).digest('hex'),
  };
}

export function planStoryDate(
  script: string,
  previousMetadata: Partial<StoryDateMetadata> | null | undefined,
  clock: Date = new Date(),
): StoryDatePlan {
  const currentMetadata = storyDateMetadata(script);
  const contentChanged =
    previousMetadata?.contentSha256 !== currentMetadata.contentSha256 ||
    !previousMetadata?.value;
  const date = contentChanged ? formatLocalDate(clock) : (previousMetadata.value as string);
  const updatedScript = replaceStoryDate(script, date);
  return {
    contentChanged,
    date,
    metadata: storyDateMetadata(updatedScript),
    script: updatedScript,
    scriptChanged: updatedScript !== script,
  };
}
