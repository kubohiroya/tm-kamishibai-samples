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

test('styles the shared rights footer for narrow screens and print', async () => {
  const css = await readFile(path.join(projectRoot, 'site/site-shell.css'), 'utf8');

  assert.match(css, /\.site-footer\s*\{[\s\S]*?border-top:/u);
  assert.match(css, /\.site-footer__brand\s*\{[\s\S]*?min-height:\s*44px;/u);
  assert.match(css, /\.site-footer__rights\s*\{[\s\S]*?min-height:\s*44px;/u);
  assert.match(
    css,
    /@media \(max-width:\s*760px\)[\s\S]*?\.site-footer__legal\s*\{[\s\S]*?text-align:\s*left;/u,
  );
  assert.match(css, /@media print[\s\S]*?\.site-footer\s*\{[\s\S]*?display:\s*none/u);
});

test('records the source of the Urashima site symbol', async () => {
  const metadata = JSON.parse(
    await readFile(path.join(projectRoot, 'site/favicon.source.json'), 'utf8'),
  );

  assert.equal(metadata.sourceName, 'Urashima-walk-1');
  assert.equal(metadata.sourceRepository, 'kubohiroya/tm-kamishibai-samples');
  assert.equal(
    metadata.sourcePath,
    'stories/urashima/assets/images/9a8cf053f6169ea9b530a852ab62c5a0.png',
  );
  assert.equal(
    metadata.sourceSha256,
    '617bdabd94e214551ce06b32acc67e5fb3eeb77b84e1c56b9a445f79e79f2919',
  );
  assert.equal(metadata.license, 'MPL-2.0');
  assert.equal(metadata.derivedAsset, 'favicon.png');
});
