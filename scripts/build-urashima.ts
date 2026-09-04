import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

import {buildSb3Bundle, type Sb3BundleResult} from '@kubohiroya/tmpose-kamishibai/builder';

import type {
  ArtifactsLock,
  BaseSb3Identity,
  ProfileLock,
  StoryConfig,
  StoryProfileConfig,
} from './story-config.ts';

export type {ProfileLock};

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sampleDirectory = path.join(projectRoot, 'stories/urashima');
const require = createRequire(import.meta.url);
const installedPackage = JSON.parse(
  await readFile(require.resolve('@kubohiroya/tmpose-kamishibai/package.json'), 'utf8'),
) as {version: string};

export interface BuildUrashimaResult {
  artifactsLock: ArtifactsLock | undefined;
  config: StoryConfig;
  profileLocks: Record<string, ProfileLock>;
  results: Record<string, Sb3BundleResult>;
}

function sha256(contents: Uint8Array | string): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(path.join(sampleDirectory, filename), 'utf8')) as T;
}

async function readArtifactsLock(filename: string): Promise<ArtifactsLock> {
  try {
    return await readJson<ArtifactsLock>(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Artifact lock not found: ${filename}. Run "pnpm update:artifacts-lock" to regenerate it.`,
        {cause: error},
      );
    }
    throw error;
  }
}

async function verifyLockedFile(
  filePath: string,
  lock: Pick<BaseSb3Identity, 'size' | 'sha256'>,
  description: string,
): Promise<Buffer> {
  const contents = await readFile(filePath);
  assert.equal(contents.length, lock.size, `${description} size differs from its lock.`);
  assert.equal(sha256(contents), lock.sha256, `${description} SHA-256 differs from its lock.`);
  return contents;
}

function verifyConfiguration(config: StoryConfig): void {
  assert.equal(config.formatVersion, 1);
  assert.equal(config.sample, 'urashima');
  assert.equal(config.builder.package, '@kubohiroya/tmpose-kamishibai');
  assert.equal(config.builder.version, installedPackage.version);
  assert.deepEqual(Object.keys(config.profiles).sort(), ['editor', 'player']);
  assert.equal(config.baseSb3.profile, 'generic');
  assert.equal(config.profiles.editor?.outputName, '_urashima');
  assert.equal(config.profiles.editor?.script, 'external');
  assert.equal(config.profiles.player?.outputName, 'urashima');
  assert.equal(config.profiles.player?.script, 'embedded');
  assert.equal(config.profiles.editor?.assets, 'embedded');
  assert.equal(config.profiles.player?.assets, 'embedded');
}

function verifyArtifactResult(
  result: Sb3BundleResult,
  profile: string,
  profileConfig: StoryProfileConfig,
): void {
  const {manifest} = result;
  assert.equal(manifest.profile, profile);
  assert.equal(manifest.outputName, profileConfig.outputName);
  assert.equal(manifest.outputs.sb3.filename, `${profileConfig.outputName}.sb3`);
  assert.equal(manifest.script.mode, profile === 'player' ? 'embedded' : 'external');
}

async function createProfileLock(result: Sb3BundleResult): Promise<ProfileLock> {
  const {manifest} = result;
  const manifestFilename = manifest.outputs.manifest.filename;
  const manifestContents = await readFile(result.outputPaths[manifestFilename] as string);
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

export async function buildUrashima(
  outputDirectory: string,
  {verifyArtifacts = true}: {verifyArtifacts?: boolean} = {},
): Promise<BuildUrashimaResult> {
  const config = await readJson<StoryConfig>('sample.config.json');
  verifyConfiguration(config);
  const artifactsLock = verifyArtifacts
    ? await readArtifactsLock(config.artifactsLock)
    : undefined;
  if (artifactsLock) {
    assert.equal(config.builder.version, artifactsLock.builder?.version);
    assert.equal(config.builder.commit, artifactsLock.builder?.commit);
  }
  const baseSb3Path = path.join(sampleDirectory, config.baseSb3.path);
  await verifyLockedFile(baseSb3Path, config.baseSb3, 'generic base SB3');
  const results: Record<string, Sb3BundleResult> = Object.fromEntries(
    await Promise.all(
      Object.entries(config.profiles).map(
        async ([profile, profileConfig]): Promise<[string, Sb3BundleResult]> => [
          profile,
          await buildSb3Bundle({
            baseSb3: baseSb3Path,
            sourceScript: path.join(sampleDirectory, config.sourceScript),
            assetManifest: path.join(sampleDirectory, config.assetManifest),
            outputDirectory,
            outputName: profileConfig.outputName,
            profile,
          }),
        ],
      ),
    ),
  );

  const profileLocks: Record<string, ProfileLock> = Object.fromEntries(
    await Promise.all(
      Object.entries(results).map(
        async ([profile, result]): Promise<[string, ProfileLock]> => {
          verifyArtifactResult(result, profile, config.profiles[profile] as StoryProfileConfig);
          return [profile, await createProfileLock(result)];
        },
      ),
    ),
  );
  if (artifactsLock) {
    assert.deepEqual(
      profileLocks,
      artifactsLock.profiles,
      'Generated Urashima artifacts differ from their lock.',
    );
  }

  const editor = results.editor as Sb3BundleResult;
  const player = results.player as Sb3BundleResult;
  const [editorScript, playerScript] = await Promise.all([
    readFile(editor.outputPaths[editor.manifest.outputs.script.filename] as string),
    readFile(player.outputPaths[player.manifest.outputs.script.filename] as string),
  ]);
  assert(editorScript.equals(playerScript), 'editor and player transformed scripts differ.');
  if (verifyArtifacts) {
    const publishedScript = await readFile(path.join(sampleDirectory, 'urashima.txt'));
    assert(playerScript.equals(publishedScript), 'urashima.txt differs from the generated script.');
  }
  assert.equal(editorScript.toString('utf8').includes('file:'), false);

  return {artifactsLock, config, profileLocks, results};
}
