import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const DATE_LINE_PATTERN = /^# date: (\d{4}-\d{2}-\d{2})$/gmu;
const NORMALIZED_DATE_LINE = '# date: <content-date>';

function dateMatch(script) {
  const matches = [...script.matchAll(DATE_LINE_PATTERN)];
  assert.equal(matches.length, 1, 'Story script must contain exactly one # date: line.');
  return matches[0];
}

export function formatLocalDate(clock = new Date()) {
  const year = clock.getFullYear();
  const month = clock.getMonth() + 1;
  const day = clock.getDate();
  for (const [name, value] of Object.entries({year, month, day})) {
    assert.equal(Number.isInteger(value), true, `Local ${name} must be an integer.`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function readStoryDate(script) {
  return dateMatch(script)[1];
}

export function replaceStoryDate(script, date) {
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/u, 'Story date must use YYYY-MM-DD.');
  const match = dateMatch(script);
  return `${script.slice(0, match.index)}# date: ${date}${script.slice(match.index + match[0].length)}`;
}

export function storyDateMetadata(script) {
  const match = dateMatch(script);
  const normalized = `${script.slice(0, match.index)}${NORMALIZED_DATE_LINE}${script.slice(match.index + match[0].length)}`;
  return {
    value: match[1],
    contentSha256: createHash('sha256').update(normalized).digest('hex'),
  };
}

export function planStoryDate(script, previousMetadata, clock = new Date()) {
  const currentMetadata = storyDateMetadata(script);
  const contentChanged =
    previousMetadata?.contentSha256 !== currentMetadata.contentSha256 ||
    !previousMetadata?.value;
  const date = contentChanged ? formatLocalDate(clock) : previousMetadata.value;
  const updatedScript = replaceStoryDate(script, date);
  return {
    contentChanged,
    date,
    metadata: storyDateMetadata(updatedScript),
    script: updatedScript,
    scriptChanged: updatedScript !== script,
  };
}
