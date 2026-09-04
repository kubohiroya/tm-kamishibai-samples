import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildSb3Bundle, type Sb3BundleResult} from '@kubohiroya/tmpose-kamishibai/builder';
import {
  createDeterministicSb3,
  importSb3,
  packageVersion as sb3ToolchainVersion,
} from '@kubohiroya/sb3-toolchain';
import {strFromU8, unzipSync} from 'fflate';
import {parse as parseYaml} from 'yaml';

import type {ScratchProject} from './scratch.ts';
import type {
  ArtifactsLock,
  AssetManifest,
  DependencyRecord,
  DerivedStoryConfig,
  ProjectAssetSpecification,
  ProjectAssetsManifest,
  StoryConfig,
} from './story-config.ts';
import {replaceStoryDate, storyDateMetadata, type StoryDateMetadata} from './story-date.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/my-urashima');

function hash(algorithm: string, contents: Uint8Array | string): string {
  return createHash(algorithm).update(contents).digest('hex');
}

function sha256(contents: Uint8Array | string): string {
  return hash('sha256', contents);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

function resolveProjectFile(baseDirectory: string, sourcePath: string): string {
  assert.equal(path.isAbsolute(sourcePath), false, `Source path must be relative: ${sourcePath}`);
  const resolved = path.resolve(baseDirectory, sourcePath);
  const relative = path.relative(projectRoot, resolved);
  assert.equal(
    relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..',
    true,
    `Source asset escapes the project root: ${sourcePath}`,
  );
  return resolved;
}

async function readProjectAssets(manifestPath: string): Promise<ProjectAssetsManifest> {
  const source = await readFile(manifestPath, 'utf8');
  return (
    path.extname(manifestPath).toLowerCase() === '.json' ? JSON.parse(source) : parseYaml(source)
  ) as ProjectAssetsManifest;
}

function replaceExactlyOnce(
  source: string,
  before: string,
  after: string,
  description: string,
): string {
  const parts = source.split(before);
  assert.equal(parts.length, 2, `${description} must occur exactly once.`);
  return `${parts[0]}${after}${parts[1]}`;
}

function embeddedProjectAssetReference(
  assetId: string,
  specification: ProjectAssetSpecification,
): string {
  const name = specification.name ?? assetId;
  if (specification.kind === 'costume') {
    if (specification.target === assetId && name === assetId) return 'costume';
    return name === assetId
      ? `costume:${specification.target}`
      : `costume:${specification.target}:${name}`;
  }
  if (specification.kind === 'backdrop') return `backdrop:${name}`;
  return specification.target ? `sound:${specification.target}:${name}` : `sound:@stage:${name}`;
}

async function createDerivedBase(
  baseSb3Path: string,
  projectAssetsPath: string,
  allowedAssetRoots: readonly string[],
): Promise<Buffer> {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'my-urashima-base-source-'));
  const sourceDirectory = path.join(temporaryDirectory, 'source');
  try {
    await importSb3({inputPath: baseSb3Path, outputDirectory: sourceDirectory});
    return Buffer.from(
      (
        await createDeterministicSb3(sourceDirectory, {
          allowedAssetRoots,
          projectAssetsPath,
        })
      ).archive,
    );
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
}

async function dependencyRecord(filePath: string, relativeTo: string): Promise<DependencyRecord> {
  const contents = await readFile(filePath);
  return {
    path: path.relative(relativeTo, filePath),
    size: contents.length,
    sha256: sha256(contents),
  };
}

async function assertToolchainCanonicalSb3(sb3Path: string): Promise<void> {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'my-urashima-final-source-'));
  const sourceDirectory = path.join(temporaryDirectory, 'source');
  try {
    await importSb3({inputPath: sb3Path, outputDirectory: sourceDirectory});
    const [actual, rebuilt] = await Promise.all([
      readFile(sb3Path),
      createDeterministicSb3(sourceDirectory).then(({archive}) => Buffer.from(archive)),
    ]);
    assert.equal(
      actual.equals(rebuilt),
      true,
      'my-urashima.sb3 must be the canonical sb3-toolchain output.',
    );
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
}

interface CreateArtifactLockOptions {
  config: DerivedStoryConfig;
  configPath: string;
  parentConfig: StoryConfig;
  parentConfigPath: string;
  parentDirectory: string;
  projectAssets: ProjectAssetsManifest;
  projectAssetsPath: string;
  result: Sb3BundleResult;
  storyDate: StoryDateMetadata;
}

async function createArtifactLock({
  config,
  configPath,
  parentConfig,
  parentConfigPath,
  parentDirectory,
  projectAssets,
  projectAssetsPath,
  result,
  storyDate,
}: CreateArtifactLockOptions): Promise<ArtifactsLock> {
  const packageConfiguration = await readJson<{devDependencies: Record<string, string>}>(
    path.join(projectRoot, 'package.json'),
  );
  const manifestPath = result.outputPaths[result.manifest.outputs.manifest.filename] as string;
  const manifestContents = await readFile(manifestPath);
  return {
    formatVersion: 1,
    builder: parentConfig.builder,
    sb3Toolchain: {
      package: '@kubohiroya/sb3-toolchain',
      version: sb3ToolchainVersion,
      source: packageConfiguration.devDependencies['@kubohiroya/sb3-toolchain'],
    },
    storyDate,
    parentStory: {
      name: parentConfig.sample,
      config: await dependencyRecord(parentConfigPath, storyDirectory),
      sourceScript: await dependencyRecord(
        path.join(parentDirectory, parentConfig.sourceScript),
        storyDirectory,
      ),
      assetManifest: await dependencyRecord(
        path.join(parentDirectory, parentConfig.assetManifest),
        storyDirectory,
      ),
      baseSb3: await dependencyRecord(
        path.join(parentDirectory, parentConfig.baseSb3.path),
        storyDirectory,
      ),
    },
    configuration: await dependencyRecord(configPath, storyDirectory),
    projectAssets: {
      manifest: await dependencyRecord(projectAssetsPath, storyDirectory),
      files: await Promise.all(
        Object.entries(projectAssets.assets).map(async ([assetId, specification]) => ({
          id: assetId,
          kind: specification.kind,
          ...(specification.target ? {target: specification.target} : {}),
          ...(specification.name ? {name: specification.name} : {}),
          ...(specification.license ? {license: specification.license} : {}),
          source: await dependencyRecord(
            resolveProjectFile(path.dirname(projectAssetsPath), specification.file),
            storyDirectory,
          ),
        })),
      ),
    },
    output: {
      outputName: config.profile.outputName,
      sb3: result.manifest.outputs.sb3,
      script: result.manifest.outputs.script,
      manifest: {
        filename: result.manifest.outputs.manifest.filename,
        size: manifestContents.length,
        sha256: sha256(manifestContents),
      },
    },
  };
}

async function deriveMyUrashimaSourceContext() {
  const configPath = path.join(storyDirectory, 'sample.config.json');
  const config = await readJson<DerivedStoryConfig>(configPath);
  assert.equal(config.formatVersion, 1);
  assert.equal(config.sample, 'my-urashima');
  assert.equal(config.profile.outputName, 'my-urashima');
  assert.equal(config.profile.script, 'external');
  assert.equal(config.profile.assets, 'embedded');

  const parentConfigPath = path.resolve(storyDirectory, config.parentStory.config);
  const parentDirectory = path.dirname(parentConfigPath);
  const parentConfig = await readJson<StoryConfig>(parentConfigPath);
  const parentManifest = await readJson<AssetManifest>(
    path.join(parentDirectory, parentConfig.assetManifest),
  );
  const projectAssetsPath = resolveProjectFile(storyDirectory, config.projectAssets.manifest);
  const projectAssets = await readProjectAssets(projectAssetsPath);
  const allowedAssetRoots = config.projectAssets.allowedRoots.map((root: string) =>
    resolveProjectFile(storyDirectory, root),
  );
  assert.equal(parentConfig.sample, config.parentStory.name);
  assert.equal(projectAssets.formatVersion, 1);

  let source = await readFile(path.join(parentDirectory, parentConfig.sourceScript), 'utf8');
  const derivedAssetNames = new Set(Object.keys(projectAssets.assets));
  for (const [assetId, specification] of Object.entries(projectAssets.assets)) {
    const entry = parentManifest.assets.find(({name}) => name === assetId);
    if (!entry) continue;
    source = replaceExactlyOnce(
      source,
      `asset=${entry.name},${entry.uri}`,
      `asset=${entry.name},${embeddedProjectAssetReference(assetId, specification)}`,
      `${entry.name} source asset`,
    );
  }
  for (const replacement of config.scriptReplacements) {
    source = replaceExactlyOnce(source, replacement.from, replacement.to, replacement.description);
  }

  return {
    config,
    configPath,
    derivedAssetNames,
    parentConfig,
    parentConfigPath,
    parentDirectory,
    parentManifest,
    projectAssets,
    projectAssetsPath,
    allowedAssetRoots,
    source,
  };
}

export async function deriveMyUrashimaSource(): Promise<string> {
  return (await deriveMyUrashimaSourceContext()).source;
}

export interface MyUrashimaInspection {
  archive: Record<string, Uint8Array>;
  project: ScratchProject;
}

export function inspectMyUrashima(sb3Bytes: Uint8Array, script: string): MyUrashimaInspection {
  const archive = unzipSync(new Uint8Array(sb3Bytes));
  const project = JSON.parse(strFromU8(archive['project.json'] as Uint8Array)) as ScratchProject;
  const stage = project.targets.find((target) => target.isStage);
  const actor = project.targets.find((target) => target.name === 'Actor');
  const princesses = project.targets.filter((target) => target.name === 'Princess');
  assert.equal(princesses.length, 1, 'Princess target must exist exactly once.');
  assert.ok(stage, 'The SB3 must contain a stage target.');
  assert.ok(actor, 'The SB3 must contain an Actor target.');
  assert.deepEqual(
    (princesses[0] as (typeof princesses)[number]).costumes.map(({name, dataFormat}) => ({
      name,
      dataFormat,
    })),
    [{name: 'Princess', dataFormat: 'png'}],
  );
  assert.equal(
    actor.costumes.some(({name}) => name === 'Princess'),
    false,
  );
  assert.deepEqual(stage.variables.tmposeEmbeddedScript, ['__tmpose_embedded_script', '']);
  assert.equal(
    Object.values(stage.lists).every(([, values]) => values.length === 0),
    true,
  );
  assert.deepEqual(
    Object.keys(archive).filter((filename) => filename.endsWith('.txt')),
    [],
  );
  assert.equal(script.includes('asset=Princess,costume\n'), true);
  assert.equal(script.includes('asset=Princess,costume:'), false);
  return {archive, project};
}

export interface BuildMyUrashimaResult {
  artifactLock: ArtifactsLock;
  config: DerivedStoryConfig;
  result: Sb3BundleResult;
}

export async function buildMyUrashima(
  outputDirectory: string,
  {scriptDate, verifyArtifacts = true}: {scriptDate?: string; verifyArtifacts?: boolean} = {},
): Promise<BuildMyUrashimaResult> {
  const {
    allowedAssetRoots,
    config,
    configPath,
    derivedAssetNames,
    parentConfig,
    parentConfigPath,
    parentDirectory,
    parentManifest,
    projectAssets,
    projectAssetsPath,
    source: rawSource,
  } = await deriveMyUrashimaSourceContext();
  const expectedLock = verifyArtifacts
    ? await readJson<ArtifactsLock>(path.join(storyDirectory, config.artifactsLock))
    : undefined;
  const effectiveDate = scriptDate ?? expectedLock?.storyDate?.value;
  const source = effectiveDate ? replaceStoryDate(rawSource, effectiveDate) : rawSource;
  const storyDate = storyDateMetadata(source);

  const derivedManifest = {
    ...parentManifest,
    assets: parentManifest.assets.filter(({name}) => !derivedAssetNames.has(name)),
  };
  const baseSb3Path = path.join(parentDirectory, parentConfig.baseSb3.path);
  const derivedBase = await createDerivedBase(
    baseSb3Path,
    projectAssetsPath,
    allowedAssetRoots,
  );

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'my-urashima-build-'));
  try {
    const sourcePath = path.join(temporaryDirectory, 'source.txt');
    const basePath = path.join(temporaryDirectory, 'base.sb3');
    await Promise.all([writeFile(sourcePath, source), writeFile(basePath, derivedBase)]);
    const result = await buildSb3Bundle({
      baseSb3: basePath,
      sourceScript: sourcePath,
      assetManifest: derivedManifest,
      manifestBaseDirectory: parentDirectory,
      outputDirectory,
      outputName: config.profile.outputName,
      profile: 'editor',
    });
    await assertToolchainCanonicalSb3(
      result.outputPaths[result.manifest.outputs.sb3.filename] as string,
    );
    const artifactLock = await createArtifactLock({
      config,
      configPath,
      parentConfig,
      parentConfigPath,
      parentDirectory,
      projectAssets,
      projectAssetsPath,
      result,
      storyDate,
    });
    const [sb3Bytes, script] = await Promise.all([
      readFile(result.outputPaths[result.manifest.outputs.sb3.filename] as string),
      readFile(result.outputPaths[result.manifest.outputs.script.filename] as string, 'utf8'),
    ]);
    inspectMyUrashima(sb3Bytes, script);

    if (verifyArtifacts) {
      assert.deepEqual(artifactLock, expectedLock, 'my-urashima artifacts differ from lock.');
      const [checkedSb3, checkedScript] = await Promise.all([
        readFile(path.join(storyDirectory, result.manifest.outputs.sb3.filename)),
        readFile(path.join(storyDirectory, result.manifest.outputs.script.filename), 'utf8'),
      ]);
      assert.equal(sb3Bytes.equals(checkedSb3), true, 'Checked-in my-urashima.sb3 is stale.');
      assert.equal(script, checkedScript, 'Checked-in my-urashima.txt is stale.');
    }
    return {artifactLock, config, result};
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
}

interface BundleManifestFile {
  profile: string;
  script: {mode: string; [key: string]: unknown};
  assets: {name: string}[];
  [key: string]: unknown;
}

export interface MyUrashimaOutputVerification {
  artifactLock: ArtifactsLock;
  manifest: BundleManifestFile;
  sb3Bytes: Buffer;
  script: string;
}

export async function verifyMyUrashimaOutput(
  outputDirectory: string,
): Promise<MyUrashimaOutputVerification> {
  const config = await readJson<DerivedStoryConfig>(
    path.join(storyDirectory, 'sample.config.json'),
  );
  const artifactLock = await readJson<
    ArtifactsLock & {output: Record<string, {filename: string; size: number; sha256: string}>}
  >(path.join(storyDirectory, config.artifactsLock));
  const [sb3Bytes, script, manifestContents, checkedSb3, checkedScript] = await Promise.all([
    readFile(path.join(outputDirectory, artifactLock.output.sb3.filename)),
    readFile(path.join(outputDirectory, artifactLock.output.script.filename), 'utf8'),
    readFile(path.join(outputDirectory, artifactLock.output.manifest.filename)),
    readFile(path.join(storyDirectory, artifactLock.output.sb3.filename)),
    readFile(path.join(storyDirectory, artifactLock.output.script.filename), 'utf8'),
  ]);
  assert.equal(sb3Bytes.length, artifactLock.output.sb3.size);
  assert.equal(sha256(sb3Bytes), artifactLock.output.sb3.sha256);
  assert.equal(Buffer.byteLength(script), artifactLock.output.script.size);
  assert.equal(sha256(script), artifactLock.output.script.sha256);
  assert.equal(manifestContents.length, artifactLock.output.manifest.size);
  assert.equal(sha256(manifestContents), artifactLock.output.manifest.sha256);
  assert.equal(sb3Bytes.equals(checkedSb3), true);
  assert.equal(script, checkedScript);
  const manifest = JSON.parse(manifestContents.toString('utf8')) as BundleManifestFile;
  assert.equal(manifest.profile, 'editor');
  assert.equal(manifest.script.mode, 'external');
  assert.equal(manifest.assets.length, 43);
  assert.equal(
    manifest.assets.some(({name}) => name === 'Princess'),
    false,
  );
  inspectMyUrashima(sb3Bytes, script);
  return {artifactLock, manifest, sb3Bytes, script};
}
