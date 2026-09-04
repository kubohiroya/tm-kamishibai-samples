import {test} from 'vitest';

import {buildMyUrashimaDsl4} from '../scripts/build-my-urashima-dsl4.ts';

test('DSL 4.0 my-urashima SB3 is non-embedded, complete, and canonical', async () => {
  await buildMyUrashimaDsl4();
});
