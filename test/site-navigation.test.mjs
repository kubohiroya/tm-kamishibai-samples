import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('keeps the Urashima site symbol transparent and free of decorative borders', async () => {
  const css = await readFile(path.join(projectRoot, 'site/site-shell.css'), 'utf8');

  assert.match(
    css,
    /\.site-brand__symbol\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;/u,
  );
});

test('records the source of the Urashima site symbol', async () => {
  const metadata = JSON.parse(
    await readFile(path.join(projectRoot, 'site/favicon.source.json'), 'utf8'),
  );

  assert.equal(metadata.sourceName, 'Urashima-walk-1');
  assert.equal(metadata.sourceRepository, 'kubohiroya/tmpose-kamishibai-samples');
  assert.equal(
    metadata.sourcePath,
    'stories/urashima/assets/images/963e926995791fde1b335fd4ba60d6d7.png',
  );
  assert.equal(
    metadata.sourceSha256,
    'f66c89b710324a7ca0809ab8cdc5acdfff83e988828a199403b7104ade6ec2df',
  );
  assert.equal(metadata.license, 'MPL-2.0');
  assert.equal(metadata.derivedAsset, 'favicon.png');
});
