import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {createDeterministicSb3, importSb3} from '@kubohiroya/sb3-toolchain';
import {strFromU8, unzipSync, zipSync} from 'fflate';
import {parse} from 'yaml';

import type {PackagedWebResult} from './build-packaged-web.ts';
import type {Dsl4Story} from './dsl4.ts';
import type {ScratchProject} from './scratch.ts';
import type {DependencyRecord, Dsl4BuildConfig, Dsl4Limits} from './story-config.ts';

interface SourceStructure {
  assetIds: string[];
  sceneIds: string[];
}

interface ProjectInspection {
  archiveEntryCount: number;
  targetNames: string[];
}

interface ArchiveRecord extends DependencyRecord {
  entries: string[];
}

interface BuiltArchive {
  bytes: Buffer;
  record: ArchiveRecord;
}

export interface TutorialArchives {
  starter: BuiltArchive;
  additionKit: BuiltArchive;
}

export interface TutorialArtifactLock {
  formatVersion: number;
  status: string;
  version: string;
  releaseDependency: string;
  sourceIdentity: string;
  runtime: Record<string, unknown>;
  sb3Toolchain: {package: string; version: string};
  sources: {
    complete: DependencyRecord;
    starter: DependencyRecord;
    completeStructure: SourceStructure;
    starterStructure: SourceStructure;
    inputs: DependencyRecord[];
  };
  outputs: {
    sb3: DependencyRecord & ProjectInspection;
    starter: ArchiveRecord;
    additionKit: ArchiveRecord;
  };
  license: {spdx: string; path: string};
  publication: Record<string, unknown>;
}

/** stories/tutorial/public-surfaces.json */
export interface TutorialPublicSurfaces {
  formatVersion: number;
  status: string;
  version: string;
  published: boolean;
  releaseDependency: string;
  sourceIdentity: string;
  runtime: Record<string, unknown>;
  license: {spdx: string; url: string};
  surfaces: {
    detailUrl: string;
    webUrl: string;
    sourceUrl: string;
    sb3Url: string;
    starterUrl: string;
    additionKitUrl: string;
    manifestUrl: string;
  };
  artifacts: {
    source: DependencyRecord;
    sb3: DependencyRecord;
    web: {path: string; size: number; sha256: string};
    starter: ArchiveRecord;
    additionKit: ArchiveRecord;
  };
}

export interface BuildTutorialDsl4Options {
  kamishibaiRoot?: string;
  publishedOutputDirectory?: string;
  verifyCommittedOutput?: boolean;
  writeLock?: boolean;
}

export interface BuildTutorialDsl4Result {
  archive: Buffer;
  archives: TutorialArchives;
  artifactLock: TutorialArtifactLock;
  config: Dsl4BuildConfig;
  outputPath: string;
}

/** ZIP に入れる [アーカイブ内パス, stories/tutorial からの相対パス] の組。 */
type ZipEntrySpecification = [archivePath: string, sourcePath: string];

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/tutorial');
const configPath = path.join(storyDirectory, 'dsl4-build.config.json');
const defaultKamishibaiRoot = path.resolve(projectRoot, '../tmpose-kamishibai');
const kamishibaiRootEnvironmentName = 'TMPOSE_KAMISHIBAI_DSL4_ROOT';
const zipTimestamp = new Date('2026-08-12T00:00:00.000Z');

const starterSharedFiles = [
  'classroom.svg',
  'student-ready.svg',
  'success.mp3',
  'safety-pose/metadata.json',
  'safety-pose/model.json',
  'safety-pose/weights.bin',
];
const additionKitFiles = [
  'README.md',
  'add-background-and-actor.yml.txt',
  'add-pose-scene.yml.txt',
  'protect-head.svg',
  'intentional-diagnostic.kamishibai.yaml.txt',
  'earthquake-classroom.svg',
];

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

function parseArguments(arguments_: readonly string[]): BuildTutorialDsl4Options {
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

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function writeAtomically(outputPath: string, contents: Uint8Array): Promise<void> {
  await mkdir(path.dirname(outputPath), {recursive: true});
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, outputPath);
}

async function fileRecord(relativePath: string): Promise<DependencyRecord> {
  const contents = await readFile(path.join(storyDirectory, relativePath));
  return {path: relativePath, size: contents.length, sha256: sha256(contents)};
}

function inspectSource(source: string, label: string): SourceStructure {
  const document = parse(source, {uniqueKeys: true}) as Dsl4Story;
  assert.equal(document.kamishibai, '4.0', `${label} must use DSL 4.0.`);
  assert(document.scenes, `${label} has no scenes.`);
  assert.equal(Object.keys(document.scenes).length >= 1, true, `${label} has no scenes.`);
  const localAssets = Object.entries(document.assets ?? {}).filter(
    ([, asset]) => typeof asset === 'object' && asset !== null && typeof asset.file === 'string',
  );
  assert.equal(
    localAssets.length,
    Object.keys(document.assets ?? {}).length,
    `${label} must use only explicit local assets.`,
  );
  return {
    assetIds: localAssets.map(([id]) => id),
    sceneIds: Object.keys(document.scenes),
  };
}

function inspectProject(sb3Bytes: Uint8Array): ProjectInspection {
  const archive = unzipSync(new Uint8Array(sb3Bytes));
  const project = JSON.parse(strFromU8(archive['project.json'] as Uint8Array)) as ScratchProject;
  for (const name of ['Stage', 'Student']) {
    assert.equal(
      project.targets.filter((target) => target.name === name).length,
      1,
      `Generated tutorial project must contain one ${name} target.`,
    );
  }
  assert(project.extensions?.includes('kubohiroyakamishibai4'));
  assert.match(project.extensionURLs?.kubohiroyakamishibai4 ?? '', /^data:/u);
  assert.equal(
    project.extensionStorage?.kubohiroyakamishibai4?.components
      ?.kubohiroyakamishibairuntime4?.application?.mode,
    'story',
  );
  return {
    archiveEntryCount: Object.keys(archive).length,
    targetNames: project.targets.map(({name}) => name),
  };
}

async function canonicalizeSb3(inputPath: string, sourceDirectory: string): Promise<Buffer> {
  await importSb3({inputPath, outputDirectory: sourceDirectory});
  const first = await createDeterministicSb3(sourceDirectory);
  const second = await createDeterministicSb3(sourceDirectory);
  assert.deepEqual(Buffer.from(first.archive), Buffer.from(second.archive));
  return Buffer.from(first.archive);
}

async function zipEntries(fileEntries: readonly ZipEntrySpecification[]): Promise<Buffer> {
  const entries: Record<string, [Uint8Array, {level: 0 | 9; mtime: Date}]> = {};
  for (const [archivePath, sourcePath] of fileEntries) {
    entries[archivePath] = [
      new Uint8Array(await readFile(path.join(storyDirectory, sourcePath))),
      {level: /\.(?:mp3|bin)$/iu.test(sourcePath) ? 0 : 9, mtime: zipTimestamp},
    ];
  }
  return Buffer.from(zipSync(entries, {level: 9, mtime: zipTimestamp}));
}

function archiveRecord(filename: string, contents: Buffer): ArchiveRecord {
  const entries = Object.keys(unzipSync(new Uint8Array(contents))).sort();
  return {path: filename, size: contents.length, sha256: sha256(contents), entries};
}

async function buildArchives(config: Dsl4BuildConfig): Promise<TutorialArchives> {
  const starterRoot = 'tutorial-story';
  const additionRoot = 'tutorial-story-addition-kit';
  const archives = config.archives as Record<string, string>;
  const starterEntries: ZipEntrySpecification[] = [
    [`${starterRoot}/README.md`, 'starter/README.md'],
    [`${starterRoot}/LICENSES.md`, 'LICENSES.md'],
    [`${starterRoot}/project.source.json`, config.starterManifest as string],
    [`${starterRoot}/story.kamishibai.yaml`, config.starterSource as string],
    ...starterSharedFiles.map(
      (filename): ZipEntrySpecification => [`${starterRoot}/${filename}`, filename],
    ),
    ...additionKitFiles.map((filename): ZipEntrySpecification => [
      `${starterRoot}/addition-kit/${filename}`,
      `addition-kit/${filename}`,
    ]),
    [`${starterRoot}/addition-kit/LICENSES.md`, 'LICENSES.md'],
  ];
  const additionEntries: ZipEntrySpecification[] = [
    ...additionKitFiles.map((filename): ZipEntrySpecification => [
      `${additionRoot}/${filename}`,
      `addition-kit/${filename}`,
    ]),
    [`${additionRoot}/LICENSES.md`, 'LICENSES.md'],
  ];
  const [starter, additionKit] = await Promise.all([
    zipEntries(starterEntries),
    zipEntries(additionEntries),
  ]);
  return {
    starter: {
      bytes: starter,
      record: archiveRecord(archives.starter as string, starter),
    },
    additionKit: {
      bytes: additionKit,
      record: archiveRecord(archives.additionKit as string, additionKit),
    },
  };
}

export function createTutorialPublicSurfaces(
  config: Dsl4BuildConfig,
  artifactLock: TutorialArtifactLock,
  webLock: PackagedWebResult,
): TutorialPublicSurfaces {
  const root = 'https://kubohiroya.github.io/tm-kamishibai-samples/stories/tutorial/';
  return {
    formatVersion: 1,
    status: config.status as string,
    version: config.version as string,
    published: config.publication?.enabled ?? false,
    releaseDependency: config.releaseDependency as string,
    sourceIdentity: artifactLock.sourceIdentity,
    runtime: artifactLock.runtime,
    license: {
      spdx: 'MPL-2.0',
      url: `${root}LICENSES.md`,
    },
    surfaces: {
      detailUrl: root,
      webUrl: `${root}${webLock.publicPath}`,
      sourceUrl: `${root}story.kamishibai.yaml`,
      sb3Url: `${root}${artifactLock.outputs.sb3.path}`,
      starterUrl: `${root}${artifactLock.outputs.starter.path}`,
      additionKitUrl: `${root}${artifactLock.outputs.additionKit.path}`,
      manifestUrl: `${root}${config.publicSurfaces as string}`,
    },
    artifacts: {
      source: artifactLock.sources.complete,
      sb3: artifactLock.outputs.sb3,
      web: webLock.output,
      starter: artifactLock.outputs.starter,
      additionKit: artifactLock.outputs.additionKit,
    },
  };
}

export async function buildTutorialDsl4({
  kamishibaiRoot = path.resolve(
    process.env[kamishibaiRootEnvironmentName] ?? defaultKamishibaiRoot,
  ),
  publishedOutputDirectory,
  verifyCommittedOutput = true,
  writeLock = false,
}: BuildTutorialDsl4Options = {}): Promise<BuildTutorialDsl4Result> {
  const config = await readJson<Dsl4BuildConfig>(configPath);
  assert.equal(config.formatVersion, 1);
  assert.equal(config.status, config.publication?.enabled ? 'published' : 'candidate');
  const limits = config.limits as Dsl4Limits;
  const archiveNames = config.archives as Record<string, string>;
  const runtimeConfigPath = path.resolve(storyDirectory, config.runtime.config as string);
  const runtimeConfig = await readJson<Dsl4BuildConfig>(runtimeConfigPath);
  const runtimeCommit = commandResult('git', ['rev-parse', 'HEAD'], {cwd: kamishibaiRoot});
  assert.equal(
    runtimeCommit,
    runtimeConfig.runtime.commit,
    'tmpose-kamishibai checkout differs from the tutorial runtime configuration.',
  );
  assert.equal(
    commandResult('git', ['status', '--porcelain'], {cwd: kamishibaiRoot}),
    '',
    'tmpose-kamishibai checkout must be clean.',
  );

  const basePath = path.resolve(
    path.dirname(runtimeConfigPath),
    runtimeConfig.runtime.basePath as string,
  );
  const baseBytes = await readFile(basePath);
  assert.equal(baseBytes.length, runtimeConfig.runtime.baseSize);
  assert.equal(sha256(baseBytes), runtimeConfig.runtime.baseSha256);

  const sourceName = config.source as string;
  const starterSourceName = config.starterSource as string;
  const sourceBytes = await readFile(path.join(storyDirectory, sourceName));
  const starterBytes = await readFile(path.join(storyDirectory, starterSourceName));
  const complete = inspectSource(sourceBytes.toString('utf8'), sourceName);
  const starter = inspectSource(starterBytes.toString('utf8'), starterSourceName);
  const builderCli = path.join(kamishibaiRoot, 'bin/tmpose-kamishibai.mjs');
  for (const source of [sourceName, starterSourceName]) {
    commandResult(
      process.execPath,
      [
        builderCli,
        'validate-dsl4',
        '--input',
        path.join(storyDirectory, source),
        '--max-source-bytes',
        String(limits.maxSourceBytes),
        '--format',
        'pretty',
      ],
      {cwd: kamishibaiRoot},
    );
  }

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'tutorial-dsl4-'));
  try {
    const importedBase = path.join(temporaryDirectory, 'base-source');
    await importSb3({inputPath: basePath, outputDirectory: importedBase});
    const withActors = await createDeterministicSb3(importedBase, {
      allowedAssetRoots: [storyDirectory],
      projectAssetsPath: path.join(storyDirectory, config.projectAssets),
    });
    const actorBasePath = path.join(temporaryDirectory, 'actor-base.sb3');
    const builtPath = path.join(temporaryDirectory, 'runtime-built.sb3');
    await writeFile(actorBasePath, withActors.archive);
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
      path.join(temporaryDirectory, 'canonical-source'),
    );
    const project = inspectProject(canonicalBytes);
    const archives = await buildArchives(config);
    const inputPaths = [
      sourceName,
      starterSourceName,
      config.sourceManifest as string,
      config.starterManifest as string,
      config.projectAssets,
      'README.md',
      'LICENSES.md',
      'classroom.svg',
      'student-ready.svg',
      'earthquake-classroom.svg',
      'protect-head.svg',
      'success.mp3',
      'safety-pose/metadata.json',
      'safety-pose/model.json',
      'safety-pose/weights.bin',
      ...additionKitFiles.map((filename) => `addition-kit/${filename}`),
      'starter/README.md',
    ];
    const inputs = await Promise.all([...new Set(inputPaths)].sort().map(fileRecord));
    const sourceIdentity = sha256(Buffer.from(JSON.stringify(inputs)));
    const toolchainPackage = await readJson<{version: string}>(
      path.join(projectRoot, 'node_modules/@kubohiroya/sb3-toolchain/package.json'),
    );
    const artifactLock: TutorialArtifactLock = {
      formatVersion: 1,
      status: config.status as string,
      version: config.version as string,
      releaseDependency: config.releaseDependency as string,
      sourceIdentity,
      runtime: runtimeConfig.runtime,
      sb3Toolchain: {
        package: '@kubohiroya/sb3-toolchain',
        version: toolchainPackage.version,
      },
      sources: {
        complete: await fileRecord(sourceName),
        starter: await fileRecord(starterSourceName),
        completeStructure: complete,
        starterStructure: starter,
        inputs,
      },
      outputs: {
        sb3: {
          path: config.output,
          size: canonicalBytes.length,
          sha256: sha256(canonicalBytes),
          ...project,
        },
        starter: archives.starter.record,
        additionKit: archives.additionKit.record,
      },
      license: {spdx: 'MPL-2.0', path: 'LICENSES.md'},
      publication: config.publication as unknown as Record<string, unknown>,
    };
    const committed = {
      sb3: path.join(storyDirectory, config.output),
      starter: path.join(storyDirectory, archiveNames.starter as string),
      additionKit: path.join(storyDirectory, archiveNames.additionKit as string),
      lock: path.join(storyDirectory, config.artifactsLock as string),
    };
    if (writeLock) {
      await Promise.all([
        writeAtomically(committed.sb3, canonicalBytes),
        writeAtomically(committed.starter, archives.starter.bytes),
        writeAtomically(committed.additionKit, archives.additionKit.bytes),
        writeAtomically(
          committed.lock,
          Buffer.from(`${JSON.stringify(artifactLock, null, 2)}\n`),
        ),
      ]);
    } else {
      assert.deepEqual(
        artifactLock,
        await readJson<TutorialArtifactLock>(committed.lock),
        'Tutorial artifact lock is stale; run pnpm update:tutorial-dsl4.',
      );
      if (verifyCommittedOutput) {
        const [sb3, starterArchive, additionArchive] = await Promise.all([
          readFile(committed.sb3),
          readFile(committed.starter),
          readFile(committed.additionKit),
        ]);
        assert.deepEqual(sb3, canonicalBytes, 'Tutorial SB3 is stale.');
        assert.deepEqual(starterArchive, archives.starter.bytes, 'Tutorial starter ZIP is stale.');
        assert.deepEqual(
          additionArchive,
          archives.additionKit.bytes,
          'Tutorial addition kit ZIP is stale.',
        );
      }
    }
    if (publishedOutputDirectory) {
      await Promise.all([
        writeAtomically(path.join(publishedOutputDirectory, config.output), canonicalBytes),
        writeAtomically(
          path.join(publishedOutputDirectory, archiveNames.starter as string),
          archives.starter.bytes,
        ),
        writeAtomically(
          path.join(publishedOutputDirectory, archiveNames.additionKit as string),
          archives.additionKit.bytes,
        ),
      ]);
    }
    return {
      archive: canonicalBytes,
      archives,
      artifactLock,
      config,
      outputPath: publishedOutputDirectory
        ? path.join(publishedOutputDirectory, config.output)
        : committed.sb3,
    };
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildTutorialDsl4(parseArguments(process.argv.slice(2)));
  process.stdout.write(
    `Built ${path.relative(projectRoot, result.outputPath)} (${result.artifactLock.outputs.sb3.size} bytes, sha256 ${result.artifactLock.outputs.sb3.sha256}).\n`,
  );
}
