import assert from 'node:assert/strict';
import {test} from 'vitest';

import {webCheckScope} from '../scripts/web-checks-scope.ts';

test('keeps the DSL 3.2 packaged-web checks for anything that can reach their artifacts', () => {
  for (const changed of [
    ['stories/urashima/artifacts.lock.json'],
    ['stories/urashima/base/kamishibai.sb3'],
    ['stories/urashima/assets/images/04b206e9ecf2c990d9f440612578406c.png'],
    ['stories/my-urashima/sample.config.json'],
    ['scripts/build-packaged-web.ts'],
    ['scripts/build-site.ts'],
    ['scripts/verify-packaged-web-webkit-audio.ts'],
    ['scripts/run-web-checks.ts'],
    ['turbowarp-extensions.lock.json'],
    // The packager and the browsers are pinned in the manifests, and the workflows decide what
    // runs at all.
    ['package.json'],
    ['pnpm-lock.yaml'],
    ['.github/workflows/ci.yml'],
    // One unrelated file alongside one that matters still needs them.
    ['README.md', 'stories/urashima/sample.config.json'],
  ]) {
    assert.equal(webCheckScope(changed), 'all', changed.join(', '));
  }
});

test('narrows to the DSL 4.0 check when nothing in the change can reach the 3.2 artifacts', () => {
  assert.equal(
    webCheckScope([
      'stories/tutorial/story.kamishibai.yaml',
      'stories/tutorial/tutorial-4.0.sb3',
      'stories/urashima/dsl4-build.config.json',
      'stories/urashima/urashima-4.0.sb3',
      'stories/my-urashima/my-urashima-4.0.sb3',
      'docs/index.html',
      'README.md',
    ]),
    'dsl4',
  );
});

test('runs everything when the changed files are unknown', () => {
  // An empty list means nobody told us what changed, not that nothing did.
  assert.equal(webCheckScope([]), 'all');
});
