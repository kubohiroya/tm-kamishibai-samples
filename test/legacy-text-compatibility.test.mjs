import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {buildSb3Bundle} from '@kubohiroya/tmpose-kamishibai/builder';
import {strFromU8, unzipSync} from 'fflate';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sampleDirectory = path.join(projectRoot, 'stories/urashima');
const fixturePath = fileURLToPath(new URL('./fixtures/legacy-text-3.2.txt', import.meta.url));

test('keeps the deprecated Text Asset fixture buildable with 3.1 and 3.2 headers', async () => {
  const [fixture, assetManifest] = await Promise.all([
    readFile(fixturePath, 'utf8'),
    readFile(path.join(sampleDirectory, 'assets.lock.json'), 'utf8').then(JSON.parse),
  ]);
  const turtleAsset = assetManifest.assets.find(({name}) => name === 'Turtle');
  assert.ok(turtleAsset);
  assert.match(fixture, /^asset=Narration,text$/mu);
  assert.match(fixture, /^action=text:Narration:互換表示$/mu);

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'urashima-legacy-text-'));
  try {
    for (const version of ['3.1', '3.2']) {
      const script = fixture.replace(/^kamishibai=3\.2$/mu, `kamishibai=${version}`);
      const sourceScript = path.join(temporaryDirectory, `legacy-${version}.txt`);
      const outputDirectory = path.join(temporaryDirectory, `output-${version}`);
      const outputName = `legacy${version.replace('.', '')}`;
      await writeFile(sourceScript, script);

      await buildSb3Bundle({
        assetManifest: {formatVersion: 1, assets: [turtleAsset]},
        baseSb3: path.join(sampleDirectory, 'base/kamishibai.sb3'),
        manifestBaseDirectory: sampleDirectory,
        outputDirectory,
        outputName,
        profile: 'player',
        sourceScript,
      });

      const [publishedScript, sb3] = await Promise.all([
        readFile(path.join(outputDirectory, `${outputName}.txt`), 'utf8'),
        readFile(path.join(outputDirectory, `${outputName}.sb3`)),
      ]);
      assert(publishedScript.startsWith(`kamishibai=${version}\n`));
      assert.match(publishedScript, /^asset=Turtle,costume:Actor$/mu);
      assert.match(publishedScript, /^asset=Narration,text$/mu);
      assert.match(publishedScript, /^action=text:Narration:互換表示$/mu);
      const project = JSON.parse(strFromU8(unzipSync(sb3)['project.json']));
      const stage = project.targets.find((target) => target.isStage);
      assert.deepEqual(stage.variables.tmposeEmbeddedScript, [
        '__tmpose_embedded_script',
        publishedScript,
      ]);
    }
  } finally {
    await rm(temporaryDirectory, {recursive: true});
  }
});
