import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {createDeterministicSb3, importSb3} from '@kubohiroya/sb3-toolchain';
import {strFromU8, unzipSync} from 'fflate';
import {parse} from 'yaml';

import type {ScratchProject, ScratchTarget} from './scratch.ts';
import type {
  DependencyRecord,
  Dsl4BuildConfig,
  ProjectAssetsManifest,
} from './story-config.ts';

interface ProjectInspection {
  archiveEntryCount: number;
  targetNames: string[];
  stageBackdropCount: number;
  stageSoundCount: number;
  princessCostumes: string[];
}

interface InputFileRecord {
  id: string;
  kind: string;
  target?: string;
  name?: string;
  source: DependencyRecord;
}

export interface MyUrashimaDsl4ArtifactLock {
  formatVersion: number;
  runtime: Record<string, unknown>;
  sb3Toolchain: {package: string; version: string};
  source: DependencyRecord;
  projectAssets: {manifest: DependencyRecord; files: InputFileRecord[]};
  output: {path: string; size: number; sha256: string} & ProjectInspection;
}

export interface BuildMyUrashimaDsl4Options {
  publishedOutputPath?: string;
  verifyCommittedOutput?: boolean;
  writeLock?: boolean;
}

export interface BuildMyUrashimaDsl4Result {
  archive: Buffer;
  artifactLock: MyUrashimaDsl4ArtifactLock;
  config: Dsl4BuildConfig;
  outputPath: string;
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/my-urashima');
const configPath = path.join(storyDirectory, 'dsl4-build.config.json');

function sha256(contents: Uint8Array | string): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function writeAtomically(outputPath: string, contents: Uint8Array): Promise<void> {
  await mkdir(path.dirname(outputPath), {recursive: true});
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, outputPath);
}

async function fileRecord(
  filePath: string,
  relativeTo: string = storyDirectory,
): Promise<DependencyRecord> {
  const contents = await readFile(filePath);
  return {
    path: path.relative(relativeTo, filePath).split(path.sep).join('/'),
    size: contents.length,
    sha256: sha256(contents),
  };
}

function inspectProject(
  sb3Bytes: Uint8Array,
  expectedAssetNames: readonly string[],
): ProjectInspection {
  const archive = unzipSync(new Uint8Array(sb3Bytes));
  const project = JSON.parse(strFromU8(archive['project.json'] as Uint8Array)) as ScratchProject;
  const target = (name: string): ScratchTarget => {
    const matches = project.targets.filter((candidate) => candidate.name === name);
    assert.equal(matches.length, 1, `Generated project must contain one ${name} target.`);
    return matches[0] as ScratchTarget;
  };
  const stage = target('Stage');
  const princess = target('Princess');
  for (const name of ['Urashima', 'Turtle', 'Fish', 'Narration']) target(name);
  assert.deepEqual(
    princess.costumes.map(({name, dataFormat}) => ({name, dataFormat})),
    [{name: 'Princess', dataFormat: 'png'}],
    'The workshop Princess target must contain only the Princess.png costume.',
  );
  const princessCostume = princess.costumes[0] as (typeof princess.costumes)[number];
  assert.deepEqual(
    {
      bitmapResolution: princessCostume.bitmapResolution,
      rotationCenterX: princessCostume.rotationCenterX,
      rotationCenterY: princessCostume.rotationCenterY,
    },
    {bitmapResolution: 2, rotationCenterX: 360, rotationCenterY: 360},
    'The workshop Princess costume must have a 360x360 logical canvas.',
  );
  assert.equal(project.extensions?.includes('kubohiroyakamishibai4'), true);
  assert.match(project.extensionURLs?.kubohiroyakamishibai4 ?? '', /^data:/u);
  assert.equal(
    project.extensionStorage?.kubohiroyakamishibai4?.components
      ?.kubohiroyakamishibairuntime4?.application?.mode,
    'menu',
    'The workshop SB3 must start as the non-embedded menu application.',
  );
  const projectAssetNames = new Set([
    ...stage.costumes.map(({name}) => name),
    ...stage.sounds.map(({name}) => name),
    ...project.targets.flatMap((candidate) =>
      candidate.isStage ? [] : candidate.costumes.map(({name}) => name),
    ),
  ]);
  for (const name of expectedAssetNames) {
    const expectedName = name === 'TextPlaceholder' ? 'ui-placeholder' : name;
    assert(projectAssetNames.has(expectedName), `Project asset is missing: ${expectedName}`);
  }
  return {
    archiveEntryCount: Object.keys(archive).length,
    targetNames: project.targets.map(({name}) => name),
    stageBackdropCount: stage.costumes.length,
    stageSoundCount: stage.sounds.length,
    princessCostumes: princess.costumes.map(({name}) => name),
  };
}

async function canonicalizeSb3(inputPath: string, sourceDirectory: string): Promise<Buffer> {
  await importSb3({inputPath, outputDirectory: sourceDirectory});
  const first = await createDeterministicSb3(sourceDirectory);
  const second = await createDeterministicSb3(sourceDirectory);
  assert.deepEqual(Buffer.from(first.archive), Buffer.from(second.archive));
  return Buffer.from(first.archive);
}

export async function buildMyUrashimaDsl4({
  publishedOutputPath,
  verifyCommittedOutput = true,
  writeLock = false,
}: BuildMyUrashimaDsl4Options = {}): Promise<BuildMyUrashimaDsl4Result> {
  const config = await readJson<Dsl4BuildConfig>(configPath);
  assert.equal(config.formatVersion, 1);
  const runtimeConfigPath = path.resolve(storyDirectory, config.runtime.config as string);
  const runtimeConfig = await readJson<Dsl4BuildConfig>(runtimeConfigPath);
  const basePath = path.resolve(
    path.dirname(runtimeConfigPath),
    runtimeConfig.runtime.basePath as string,
  );
  const baseBytes = await readFile(basePath);
  assert.equal(baseBytes.length, runtimeConfig.runtime.baseSize);
  assert.equal(sha256(baseBytes), runtimeConfig.runtime.baseSha256);

  const sourcePath = path.join(storyDirectory, config.source as string);
  const projectAssetsPath = path.join(storyDirectory, config.projectAssets);
  const projectAssetsBytes = await readFile(projectAssetsPath);
  const projectAssets = parse(projectAssetsBytes.toString('utf8'), {
    uniqueKeys: true,
  }) as ProjectAssetsManifest;
  assert.equal(projectAssets.formatVersion, 1);
  const assetEntries = Object.entries(projectAssets.assets ?? {}).sort(([left], [right]) =>
    left.localeCompare(right, 'en'),
  );
  assert(assetEntries.length > 0, 'The DSL 4.0 workshop project asset list is empty.');
  const inputFiles = await Promise.all(
    assetEntries.map(async ([id, specification]) => ({
      id,
      kind: specification.kind,
      ...(specification.target ? {target: specification.target} : {}),
      ...(specification.name ? {name: specification.name} : {}),
      source: await fileRecord(path.resolve(storyDirectory, specification.file)),
    })),
  );

  const committedOutputPath = path.join(storyDirectory, config.output);
  const artifactLockPath = path.join(storyDirectory, config.artifactsLock as string);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'my-urashima-dsl4-'));
  try {
    const importedBase = path.join(temporaryDirectory, 'base-source');
    await importSb3({inputPath: basePath, outputDirectory: importedBase});
    const withAssets = await createDeterministicSb3(importedBase, {
      allowedAssetRoots: [
        path.join(projectRoot, 'stories/urashima'),
        path.join(storyDirectory, 'assets'),
        path.join(projectRoot, 'resources/20260801/master'),
      ],
      projectAssetsPath,
    });
    const intermediatePath = path.join(temporaryDirectory, 'with-assets.sb3');
    await writeFile(intermediatePath, withAssets.archive);
    const canonicalBytes = await canonicalizeSb3(
      intermediatePath,
      path.join(temporaryDirectory, 'canonical-source'),
    );
    const project = inspectProject(
      canonicalBytes,
      assetEntries.map(([id]) => id),
    );
    const toolchainPackage = await readJson<{version: string}>(
      path.join(projectRoot, 'node_modules/@kubohiroya/sb3-toolchain/package.json'),
    );
    const artifactLock: MyUrashimaDsl4ArtifactLock = {
      formatVersion: 1,
      runtime: runtimeConfig.runtime,
      sb3Toolchain: {
        package: '@kubohiroya/sb3-toolchain',
        version: toolchainPackage.version,
      },
      source: await fileRecord(sourcePath),
      projectAssets: {
        manifest: await fileRecord(projectAssetsPath),
        files: inputFiles,
      },
      output: {
        path: config.output,
        size: canonicalBytes.length,
        sha256: sha256(canonicalBytes),
        ...project,
      },
    };
    if (writeLock) {
      await writeAtomically(committedOutputPath, canonicalBytes);
      await writeAtomically(
        artifactLockPath,
        Buffer.from(`${JSON.stringify(artifactLock, null, 2)}\n`),
      );
    } else {
      assert.deepEqual(
        artifactLock,
        await readJson<MyUrashimaDsl4ArtifactLock>(artifactLockPath),
        'dsl4-artifacts.lock.json is stale; run pnpm update:my-urashima-dsl4.',
      );
      if (verifyCommittedOutput) {
        assert.deepEqual(
          await readFile(committedOutputPath),
          canonicalBytes,
          'my-urashima-4.0.sb3 is stale; run pnpm update:my-urashima-dsl4.',
        );
      }
    }
    if (publishedOutputPath) await writeAtomically(publishedOutputPath, canonicalBytes);
    return {
      archive: canonicalBytes,
      artifactLock,
      config,
      outputPath: publishedOutputPath ?? committedOutputPath,
    };
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildMyUrashimaDsl4({writeLock: process.argv.includes('--write-lock')});
  process.stdout.write(
    `Built ${path.relative(projectRoot, result.outputPath)} (${result.artifactLock.output.size} bytes, sha256 ${result.artifactLock.output.sha256}).\n`,
  );
}
