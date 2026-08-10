import test from 'node:test';

import {verifyUrashimaDsl4} from '../scripts/verify-urashima-dsl4.mjs';

test('DSL 4.0 Urashima SB3 is fully embedded and canonical', async () => {
  await verifyUrashimaDsl4();
});
