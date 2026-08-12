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

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/tutorial');
const configPath = path.join(storyDirectory, 'dsl4-build.config.json');
const defaultKamishibaiRoot = path.resolve(projectRoot, '../tmpose-kamishibai');
const kamishibaiRootEnvironmentName = 'TMPOSE_KAMISHIBAI_DSL4_ROOT';
const zipTimestamp = new Date('2026-08-12T00:00:00.000Z');

const starterSharedFiles = [
  'beach.svg',
  'turtle.svg',
  'opening.mp3',
  'rescue-pose/metadata.json',
  'rescue-pose/model.json',
  'rescue-pose/weights.bin',
];
const additionKitFiles = [
  'README.md',
  'add-background-and-actor.yml.txt',
  'add-pose-scene.yml.txt',
  'friend.svg',
  'intentional-diagnostic.kamishibai.yaml.txt',
  'new-beach.svg',
];

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function commandResult(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {encoding: 'utf8', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${command} ${arguments_.join(' ')}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function parseArguments(arguments_) {
  let kamishibaiRoot = path.resolve(
    process.env[kamishibaiRootEnvironmentName] ?? defaultKamishibaiRoot,
  );
  let writeLock = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--write-lock') writeLock = true;
    else if (argument === '--kamishibai-root') {
      index += 1;
      assert(arguments_[index], '--kamishibai-root requires a directory.');
      kamishibaiRoot = path.resolve(arguments_[index]);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return {kamishibaiRoot, writeLock};
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeAtomically(outputPath, contents) {
  await mkdir(path.dirname(outputPath), {recursive: true});
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, outputPath);
}

async function fileRecord(relativePath) {
  const contents = await readFile(path.join(storyDirectory, relativePath));
  return {path: relativePath, size: contents.length, sha256: sha256(contents)};
}

function inspectSource(source, label) {
  const document = parse(source, {uniqueKeys: true});
  assert.equal(document.kamishibai, '4.0', `${label} must use DSL 4.0.`);
  assert.equal(Object.keys(document.scenes ?? {}).length >= 1, true, `${label} has no scenes.`);
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

function inspectProject(sb3Bytes) {
  const archive = unzipSync(new Uint8Array(sb3Bytes));
  const project = JSON.parse(strFromU8(archive['project.json']));
  for (const name of ['Stage', 'Turtle', 'Friend']) {
    assert.equal(
      project.targets.filter((target) => target.name === name).length,
      1,
      `Generated tutorial project must contain one ${name} target.`,
    );
  }
  assert(project.extensions.includes('kubohiroyakamishibai4'));
  assert.match(project.extensionURLs.kubohiroyakamishibai4, /^data:/u);
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

async function canonicalizeSb3(inputPath, sourceDirectory) {
  await importSb3({inputPath, outputDirectory: sourceDirectory});
  const first = await createDeterministicSb3(sourceDirectory);
  const second = await createDeterministicSb3(sourceDirectory);
  assert.deepEqual(Buffer.from(first.archive), Buffer.from(second.archive));
  return Buffer.from(first.archive);
}

async function zipEntries(fileEntries) {
  const entries = {};
  for (const [archivePath, sourcePath] of fileEntries) {
    entries[archivePath] = [
      new Uint8Array(await readFile(path.join(storyDirectory, sourcePath))),
      {level: /\.(?:mp3|bin)$/iu.test(sourcePath) ? 0 : 9, mtime: zipTimestamp},
    ];
  }
  return Buffer.from(zipSync(entries, {level: 9, mtime: zipTimestamp}));
}

function archiveRecord(filename, contents) {
  const entries = Object.keys(unzipSync(new Uint8Array(contents))).sort();
  return {path: filename, size: contents.length, sha256: sha256(contents), entries};
}

async function buildArchives(config) {
  const starterRoot = 'tutorial-story';
  const additionRoot = 'tutorial-story-addition-kit';
  const starterEntries = [
    [`${starterRoot}/README.md`, 'starter/README.md'],
    [`${starterRoot}/LICENSES.md`, 'LICENSES.md'],
    [`${starterRoot}/project.source.json`, config.starterManifest],
    [`${starterRoot}/story.kamishibai.yaml`, config.starterSource],
    ...starterSharedFiles.map((filename) => [`${starterRoot}/${filename}`, filename]),
    ...additionKitFiles.map((filename) => [
      `${starterRoot}/addition-kit/${filename}`,
      `addition-kit/${filename}`,
    ]),
    [`${starterRoot}/addition-kit/LICENSES.md`, 'LICENSES.md'],
  ];
  const additionEntries = [
    ...additionKitFiles.map((filename) => [
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
      record: archiveRecord(config.archives.starter, starter),
    },
    additionKit: {
      bytes: additionKit,
      record: archiveRecord(config.archives.additionKit, additionKit),
    },
  };
}

export function createTutorialPublicSurfaces(config, artifactLock, webLock) {
  const root = 'https://kubohiroya.github.io/tmpose-kamishibai-samples/stories/tutorial/';
  return {
    formatVersion: 1,
    status: config.status,
    version: config.version,
    published: config.publication.enabled,
    releaseDependency: config.releaseDependency,
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
      manifestUrl: `${root}${config.publicSurfaces}`,
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
} = {}) {
  const config = await readJson(configPath);
  assert.equal(config.formatVersion, 1);
  assert.equal(config.status, config.publication.enabled ? 'published' : 'candidate');
  const runtimeConfigPath = path.resolve(storyDirectory, config.runtime.config);
  const runtimeConfig = await readJson(runtimeConfigPath);
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
    runtimeConfig.runtime.basePath,
  );
  const baseBytes = await readFile(basePath);
  assert.equal(baseBytes.length, runtimeConfig.runtime.baseSize);
  assert.equal(sha256(baseBytes), runtimeConfig.runtime.baseSha256);

  const sourceBytes = await readFile(path.join(storyDirectory, config.source));
  const starterBytes = await readFile(path.join(storyDirectory, config.starterSource));
  const complete = inspectSource(sourceBytes.toString('utf8'), config.source);
  const starter = inspectSource(starterBytes.toString('utf8'), config.starterSource);
  const builderCli = path.join(kamishibaiRoot, 'bin/tmpose-kamishibai.mjs');
  for (const source of [config.source, config.starterSource]) {
    commandResult(
      process.execPath,
      [
        builderCli,
        'validate-dsl4',
        '--input',
        path.join(storyDirectory, source),
        '--max-source-bytes',
        String(config.limits.maxSourceBytes),
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
        path.join(storyDirectory, config.sourceManifest),
        '--output',
        builtPath,
        '--control-profile',
        'production',
        '--channel',
        'bundled',
        '--max-source-bytes',
        String(config.limits.maxSourceBytes),
        '--max-asset-file-bytes',
        String(config.limits.maxAssetFileBytes),
        '--max-asset-files',
        String(config.limits.maxAssetFiles),
        '--max-total-asset-bytes',
        String(config.limits.maxTotalAssetBytes),
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
      config.source,
      config.starterSource,
      config.sourceManifest,
      config.starterManifest,
      config.projectAssets,
      'README.md',
      'LICENSES.md',
      'beach.svg',
      'turtle.svg',
      'new-beach.svg',
      'friend.svg',
      'opening.mp3',
      'rescue-pose/metadata.json',
      'rescue-pose/model.json',
      'rescue-pose/weights.bin',
      ...additionKitFiles.map((filename) => `addition-kit/${filename}`),
      'starter/README.md',
    ];
    const inputs = await Promise.all([...new Set(inputPaths)].sort().map(fileRecord));
    const sourceIdentity = sha256(Buffer.from(JSON.stringify(inputs)));
    const toolchainPackage = await readJson(
      path.join(projectRoot, 'node_modules/@kubohiroya/sb3-toolchain/package.json'),
    );
    const artifactLock = {
      formatVersion: 1,
      status: config.status,
      version: config.version,
      releaseDependency: config.releaseDependency,
      sourceIdentity,
      runtime: runtimeConfig.runtime,
      sb3Toolchain: {
        package: '@kubohiroya/sb3-toolchain',
        version: toolchainPackage.version,
      },
      sources: {
        complete: await fileRecord(config.source),
        starter: await fileRecord(config.starterSource),
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
      publication: config.publication,
    };
    const committed = {
      sb3: path.join(storyDirectory, config.output),
      starter: path.join(storyDirectory, config.archives.starter),
      additionKit: path.join(storyDirectory, config.archives.additionKit),
      lock: path.join(storyDirectory, config.artifactsLock),
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
        await readJson(committed.lock),
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
          path.join(publishedOutputDirectory, config.archives.starter),
          archives.starter.bytes,
        ),
        writeAtomically(
          path.join(publishedOutputDirectory, config.archives.additionKit),
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
