import test from 'node:test';

import {buildMyUrashimaDsl4} from '../scripts/build-my-urashima-dsl4.mjs';

test('DSL 4.0 my-urashima SB3 is non-embedded, complete, and canonical', async () => {
  await buildMyUrashimaDsl4();
});
