import assert from 'node:assert/strict';

export function verifyEndCreditCheerDelay(story) {
  const actions = story?.scenes?.['end credit'];
  assert(Array.isArray(actions), 'The end credit scene must be an action list.');
  const endingTextIndex = actions.findIndex(
    (action) => action?.['Narration.setText']?.text === 'お し ま い',
  );
  assert.notEqual(endingTextIndex, -1, 'The end credit scene must show 「お し ま い」.');
  assert.deepEqual(
    actions.slice(endingTextIndex, endingTextIndex + 4),
    [
      {'Narration.setText': {text: 'お し ま い', style: 'ending'}},
      {wait: 0.5},
      {sound: 'Goal Cheer'},
      {wait: 4},
    ],
    'The cheer must start 0.5 seconds after the ending text appears.',
  );
}
