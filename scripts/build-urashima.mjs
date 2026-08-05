import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

import {buildSb3Bundle} from '@kubohiroya/tmpose-kamishibai/builder';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sampleDirectory = path.join(projectRoot, 'stories/urashima');
const require = createRequire(import.meta.url);
const installedPackage = JSON.parse(
  await readFile(require.resolve('@kubohiroya/tmpose-kamishibai/package.json'), 'utf8'),
);

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

async function readJson(filename) {
  return JSON.parse(await readFile(path.join(sampleDirectory, filename), 'utf8'));
}

async function readArtifactsLock(filename) {
  try {
    return await readJson(filename);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Artifact lock not found: ${filename}. Run "pnpm update:artifacts-lock" to regenerate it.`,
        {cause: error},
      );
    }
    throw error;
  }
}

async function verifyLockedFile(filePath, lock, description) {
  const contents = await readFile(filePath);
  assert.equal(contents.length, lock.size, `${description} size differs from its lock.`);
  assert.equal(sha256(contents), lock.sha256, `${description} SHA-256 differs from its lock.`);
  return contents;
}

function verifyConfiguration(config) {
  assert.equal(config.formatVersion, 1);
  assert.equal(config.sample, 'urashima');
  assert.equal(config.builder.package, '@kubohiroya/tmpose-kamishibai');
  assert.equal(config.builder.version, installedPackage.version);
  assert.deepEqual(Object.keys(config.profiles).sort(), ['editor', 'player']);
  assert.equal(config.baseSb3.profile, 'generic');
  assert.equal(config.profiles.editor.outputName, '_urashima');
  assert.equal(config.profiles.editor.script, 'external');
  assert.equal(config.profiles.player.outputName, 'urashima');
  assert.equal(config.profiles.player.script, 'embedded');
  assert.equal(config.profiles.editor.assets, 'embedded');
  assert.equal(config.profiles.player.assets, 'embedded');
}

function verifyArtifactResult(result, profile, profileConfig) {
  const {manifest} = result;
  assert.equal(manifest.profile, profile);
  assert.equal(manifest.outputName, profileConfig.outputName);
  assert.equal(manifest.outputs.sb3.filename, `${profileConfig.outputName}.sb3`);
  assert.equal(manifest.script.mode, profile === 'player' ? 'embedded' : 'external');
}

async function createProfileLock(result) {
  const {manifest} = result;
  const manifestFilename = manifest.outputs.manifest.filename;
  const manifestContents = await readFile(result.outputPaths[manifestFilename]);
  return {
    outputName: manifest.outputName,
    sb3: {
      size: manifest.outputs.sb3.size,
      sha256: manifest.outputs.sb3.sha256,
    },
    script: {
      size: manifest.outputs.script.size,
      sha256: manifest.outputs.script.sha256,
    },
    manifest: {
      sha256: sha256(manifestContents),
    },
  };
}

export async function buildUrashima(outputDirectory, {verifyArtifacts = true} = {}) {
  const config = await readJson('sample.config.json');
  verifyConfiguration(config);
  const artifactsLock = verifyArtifacts
    ? await readArtifactsLock(config.artifactsLock)
    : undefined;
  if (artifactsLock) {
    assert.equal(config.builder.version, artifactsLock.builder.version);
    assert.equal(config.builder.commit, artifactsLock.builder.commit);
  }
  const baseSb3Path = path.join(sampleDirectory, config.baseSb3.path);
  await verifyLockedFile(baseSb3Path, config.baseSb3, 'generic base SB3');
  const results = Object.fromEntries(
    await Promise.all(
      Object.entries(config.profiles).map(async ([profile, profileConfig]) => [
        profile,
        await buildSb3Bundle({
          baseSb3: baseSb3Path,
          sourceScript: path.join(sampleDirectory, config.sourceScript),
          assetManifest: path.join(sampleDirectory, config.assetManifest),
          outputDirectory,
          outputName: profileConfig.outputName,
          profile,
        }),
      ]),
    ),
  );

  const profileLocks = Object.fromEntries(
    await Promise.all(
      Object.entries(results).map(async ([profile, result]) => {
        verifyArtifactResult(result, profile, config.profiles[profile]);
        return [profile, await createProfileLock(result)];
      }),
    ),
  );
  if (artifactsLock) {
    assert.deepEqual(
      profileLocks,
      artifactsLock.profiles,
      'Generated Urashima artifacts differ from their lock.',
    );
  }

  const [editorScript, playerScript] = await Promise.all([
    readFile(results.editor.outputPaths[results.editor.manifest.outputs.script.filename]),
    readFile(results.player.outputPaths[results.player.manifest.outputs.script.filename]),
  ]);
  assert(editorScript.equals(playerScript), 'editor and player transformed scripts differ.');
  if (verifyArtifacts) {
    const publishedScript = await readFile(path.join(sampleDirectory, 'urashima.txt'));
    assert(playerScript.equals(publishedScript), 'urashima.txt differs from the generated script.');
  }
  assert.equal(editorScript.toString('utf8').includes('file:'), false);

  return {artifactsLock, config, profileLocks, results};
}
