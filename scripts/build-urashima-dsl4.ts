import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  createDeterministicSb3,
  importSb3,
} from '@kubohiroya/sb3-toolchain';
import {strFromU8, unzipSync} from 'fflate';
import {parse} from 'yaml';

import type {Dsl4ArtifactLock, Dsl4Story} from './dsl4.ts';
import type {ScratchProject} from './scratch.ts';
import type {Dsl4BuildConfig, Dsl4Limits} from './story-config.ts';
import {ensureUrashimaDsl4Inputs} from './update-urashima-dsl4-inputs.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/urashima');
const configPath = path.join(storyDirectory, 'dsl4-build.config.json');
const artifactLockPath = path.join(storyDirectory, 'dsl4-artifacts.lock.json');
const defaultKamishibaiRoot = path.resolve(projectRoot, '../tm-kamishibai');
const kamishibaiRootEnvironmentName = 'TM_KAMISHIBAI_DSL4_ROOT';

function sha256(contents: Uint8Array | string): string {
  return createHash('sha256').update(contents).digest('hex');
}

function commandResult(
  command: string,
  arguments_: readonly string[],
  options: {cwd?: string} = {},
): string {
  const result = spawnSync(command, [...arguments_], {encoding: 'utf8', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${command} ${arguments_.join(' ')}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

export interface BuildUrashimaDsl4Options {
  kamishibaiRoot?: string;
  publishedOutputPath?: string;
  verifyCommittedOutput?: boolean;
  writeLock?: boolean;
}

function parseArguments(arguments_: readonly string[]): BuildUrashimaDsl4Options {
  let kamishibaiRoot = path.resolve(
    process.env[kamishibaiRootEnvironmentName] ?? defaultKamishibaiRoot,
  );
  let writeLock = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--write-lock') writeLock = true;
    else if (argument === '--kamishibai-root') {
      index += 1;
      const value = arguments_[index];
      assert(value, '--kamishibai-root requires a directory.');
      kamishibaiRoot = path.resolve(value);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return {kamishibaiRoot, writeLock};
}

async function writeAtomically(outputPath: string, contents: Uint8Array): Promise<void> {
  await mkdir(path.dirname(outputPath), {recursive: true});
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, outputPath);
}

function inspectStory(source: string): {assetCount: number; remoteAssetCount: number} {
  const document = parse(source, {uniqueKeys: true}) as Dsl4Story;
  const assets = Object.values(document.assets ?? {});
  assert(assets.length > 0, 'urashima.k4.yml must declare assets.');
  assert(
    assets.every((asset) => typeof asset === 'object' && asset !== null && !Array.isArray(asset)),
    'Every DSL 4.0 Urashima asset must use an explicit file-backed declaration.',
  );
  const remoteAssets = assets.filter(
    (asset) => asset.delivery === 'remote' || asset.source !== undefined,
  );
  assert.equal(remoteAssets.length, 0, 'The offline story must not declare remote assets.');
  assert(assets.every((asset) => typeof asset.file === 'string' && asset.file.length > 0));
  return {assetCount: assets.length, remoteAssetCount: remoteAssets.length};
}

function inspectProject(sb3Bytes: Uint8Array): {
  archiveEntryCount: number;
  targetNames: string[];
} {
  const archive = unzipSync(new Uint8Array(sb3Bytes));
  const project = JSON.parse(strFromU8(archive['project.json'] as Uint8Array)) as ScratchProject;
  const requiredTargets = ['Stage', 'Urashima', 'Turtle', 'Princess', 'Fish', 'Narration'];
  for (const name of requiredTargets) {
    assert.equal(
      project.targets.filter((target) => target.name === name).length,
      1,
      `Generated project must contain one ${name} target.`,
    );
  }
  assert(project.extensions?.includes('kubohiroyakamishibai4'));
  const runtimeUrl = project.extensionURLs?.kubohiroyakamishibai4;
  assert.equal(typeof runtimeUrl, 'string');
  assert(runtimeUrl?.startsWith('data:'));
  const components = project.extensionStorage?.kubohiroyakamishibai4?.components;
  assert(components?.kubohiroyakamishibairuntime4, 'DSL 4.0 runtime component is missing.');
  return {
    archiveEntryCount: Object.keys(archive).length,
    targetNames: project.targets.map((target) => target.name),
  };
}

async function canonicalizeSb3(inputPath: string, sourceDirectory: string): Promise<Buffer> {
  await importSb3({inputPath, outputDirectory: sourceDirectory});
  const first = await createDeterministicSb3(sourceDirectory);
  const second = await createDeterministicSb3(sourceDirectory);
  assert.deepEqual(Buffer.from(first.archive), Buffer.from(second.archive));
  return Buffer.from(first.archive);
}

export interface BuildUrashimaDsl4Result {
  archive: Buffer;
  artifactLock: Dsl4ArtifactLock;
  outputPath: string;
}

export async function buildUrashimaDsl4({
  kamishibaiRoot = path.resolve(
    process.env[kamishibaiRootEnvironmentName] ?? defaultKamishibaiRoot,
  ),
  publishedOutputPath,
  verifyCommittedOutput = true,
  writeLock = false,
}: BuildUrashimaDsl4Options = {}): Promise<BuildUrashimaDsl4Result> {
  const config = JSON.parse(await readFile(configPath, 'utf8')) as Dsl4BuildConfig;
  assert.equal(config.formatVersion, 1);
  await ensureUrashimaDsl4Inputs();

  const runtimeCommit = commandResult('git', ['rev-parse', 'HEAD'], {cwd: kamishibaiRoot});
  assert.equal(
    runtimeCommit,
    config.runtime.commit,
    'TM Kamishibai checkout differs from dsl4-build.config.json.',
  );
  assert.equal(
    commandResult('git', ['status', '--porcelain'], {cwd: kamishibaiRoot}),
    '',
    'TM Kamishibai checkout must be clean.',
  );
  const basePath = path.join(storyDirectory, config.runtime.basePath as string);
  const baseBytes = await readFile(basePath);
  assert.equal(baseBytes.length, config.runtime.baseSize);
  assert.equal(sha256(baseBytes), config.runtime.baseSha256);

  const sourcePath = path.join(storyDirectory, 'urashima.k4.yml');
  const sourceBytes = await readFile(sourcePath);
  const story = inspectStory(sourceBytes.toString('utf8'));
  const outputPath = path.join(storyDirectory, config.output);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'urashima-dsl4-'));
  try {
    const baseSourceDirectory = path.join(temporaryDirectory, 'base-source');
    await importSb3({inputPath: basePath, outputDirectory: baseSourceDirectory});
    const baseWithActors = await createDeterministicSb3(baseSourceDirectory, {
      allowedAssetRoots: [storyDirectory],
      projectAssetsPath: path.join(storyDirectory, config.projectAssets),
    });
    const actorBasePath = path.join(temporaryDirectory, 'actor-base.sb3');
    const builtPath = path.join(temporaryDirectory, 'runtime-built.sb3');
    await writeFile(actorBasePath, baseWithActors.archive);

    const builderCli = path.join(kamishibaiRoot, 'bin/tmpose-kamishibai.mjs');
    const limits = config.limits as Dsl4Limits;
    commandResult(
      process.execPath,
      [
        builderCli,
        'build-dsl4',
        '--base',
        actorBasePath,
        '--project-root',
        storyDirectory,
        '--source-manifest',
        path.join(storyDirectory, config.sourceManifest as string),
        '--output',
        builtPath,
        '--control-profile',
        'production',
        '--channel',
        'bundled',
        '--max-source-bytes',
        String(limits.maxSourceBytes),
        '--max-asset-file-bytes',
        String(limits.maxAssetFileBytes),
        '--max-asset-files',
        String(limits.maxAssetFiles),
        '--max-total-asset-bytes',
        String(limits.maxTotalAssetBytes),
        '--replace-existing',
      ],
      {cwd: kamishibaiRoot},
    );

    const canonicalBytes = await canonicalizeSb3(
      builtPath,
      path.join(temporaryDirectory, 'final-source'),
    );
    const project = inspectProject(canonicalBytes);
    const toolchainPackage = JSON.parse(
      await readFile(
        path.join(projectRoot, 'node_modules/@kubohiroya/sb3-toolchain/package.json'),
        'utf8',
      ),
    ) as {version: string};
    const artifactLock: Dsl4ArtifactLock = {
      formatVersion: 1,
      runtime: config.runtime,
      sb3Toolchain: {
        package: '@kubohiroya/sb3-toolchain',
        version: toolchainPackage.version,
      },
      source: {
        path: 'urashima.k4.yml',
        size: sourceBytes.length,
        sha256: sha256(sourceBytes),
        assetCount: story.assetCount,
        remoteAssetCount: story.remoteAssetCount,
      },
      output: {
        path: config.output,
        size: canonicalBytes.length,
        sha256: sha256(canonicalBytes),
        archiveEntryCount: project.archiveEntryCount,
        targetNames: project.targetNames,
      },
    };
    if (writeLock) {
      await writeAtomically(outputPath, canonicalBytes);
      await writeAtomically(
        artifactLockPath,
        Buffer.from(`${JSON.stringify(artifactLock, null, 2)}\n`),
      );
    } else {
      assert.deepEqual(
        artifactLock,
        JSON.parse(await readFile(artifactLockPath, 'utf8')),
        'dsl4-artifacts.lock.json is stale; run pnpm update:urashima-dsl4.',
      );
      if (verifyCommittedOutput) {
        assert.deepEqual(
          await readFile(outputPath),
          canonicalBytes,
          'urashima-4.0.sb3 is stale; run pnpm update:urashima-dsl4.',
        );
      }
    }
    if (publishedOutputPath) await writeAtomically(publishedOutputPath, canonicalBytes);
    return {
      archive: canonicalBytes,
      artifactLock,
      outputPath: publishedOutputPath ?? outputPath,
    };
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildUrashimaDsl4(parseArguments(process.argv.slice(2)));
  process.stdout.write(
    `Built ${path.relative(projectRoot, result.outputPath)} (${result.artifactLock.output.size} bytes, sha256 ${result.artifactLock.output.sha256}).\n`,
  );
}
