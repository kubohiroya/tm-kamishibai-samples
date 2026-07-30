import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildSb3Bundle} from '@kubohiroya/tmpose-kamishibai/builder';
import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';

import {patchActorCloneRuntime} from './patch-actor-clone-runtime.mjs';
import {patchPromptPosition} from './patch-prompt-position.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/my-urashima');
const fixedZipTimestamp = new Date(1980, 0, 1, 0, 0, 0, 0);

function hash(algorithm, contents) {
  return createHash(algorithm).update(contents).digest('hex');
}

function sha256(contents) {
  return hash('sha256', contents);
}

function orderedArchive(archive) {
  return Object.fromEntries(
    Object.entries(archive)
      .filter(([entryName]) => !entryName.endsWith('/'))
      .sort(([left], [right]) => {
        if (left === 'project.json') return -1;
        if (right === 'project.json') return 1;
        return left.localeCompare(right, 'en');
      }),
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function resolveContainedFile(directory, uri) {
  assert.match(uri, /^file:/u, `Derived target assets must use file: URIs: ${uri}`);
  const resolved = path.resolve(directory, uri.slice('file:'.length));
  const relative = path.relative(directory, resolved);
  assert.equal(
    relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..',
    true,
    `Derived target asset escapes its parent story: ${uri}`,
  );
  return resolved;
}

function replaceExactlyOnce(source, before, after, description) {
  const parts = source.split(before);
  assert.equal(parts.length, 2, `${description} must occur exactly once.`);
  return `${parts[0]}${after}${parts[1]}`;
}

async function createDerivedBase(baseSb3, parentDirectory, parentManifest, targets) {
  const archive = unzipSync(new Uint8Array(baseSb3));
  const project = JSON.parse(strFromU8(archive['project.json']));
  const assetsByName = new Map(parentManifest.assets.map((asset) => [asset.name, asset]));

  for (const specification of targets) {
    assert.equal(
      project.targets.some((target) => target.name === specification.name),
      false,
      `Derived target already exists: ${specification.name}`,
    );
    const target = {
      isStage: false,
      name: specification.name,
      variables: {},
      lists: {},
      broadcasts: {},
      blocks: {},
      comments: {},
      currentCostume: 0,
      costumes: [],
      sounds: [],
      volume: 100,
      layerOrder: specification.layerOrder,
      visible: specification.visible,
      x: specification.x,
      y: specification.y,
      size: specification.size,
      direction: specification.direction,
      draggable: specification.draggable,
      rotationStyle: specification.rotationStyle,
    };

    for (const costume of specification.costumes) {
      assert.equal(costume.reference, 'costume');
      assert.equal(costume.asset, specification.name);
      const entry = assetsByName.get(costume.asset);
      assert.ok(entry, `Derived target asset is missing: ${costume.asset}`);
      assert.equal(entry.kind, 'costume');
      assert.equal(entry.name, specification.name);
      assert.equal(entry.sb3Name, specification.name);
      const contents = await readFile(resolveContainedFile(parentDirectory, entry.uri));
      assert.equal(contents.length, entry.size, `${entry.name} size differs from its lock.`);
      assert.equal(sha256(contents), entry.sha256, `${entry.name} SHA-256 differs from its lock.`);
      const assetId = hash('md5', contents);
      const filename = `${assetId}.${entry.dataFormat}`;
      assert.equal(entry.uri.endsWith(filename), true);
      archive[filename] = new Uint8Array(contents);
      target.costumes.push({
        name: entry.name,
        bitmapResolution: entry.metadata.bitmapResolution,
        dataFormat: entry.dataFormat,
        assetId,
        md5ext: filename,
        rotationCenterX: entry.metadata.rotationCenterX,
        rotationCenterY: entry.metadata.rotationCenterY,
      });
    }
    project.targets.push(target);
  }

  archive['project.json'] = strToU8(`${JSON.stringify(project)}\n`);
  return Buffer.from(zipSync(orderedArchive(archive), {level: 6, mtime: fixedZipTimestamp}));
}

async function dependencyRecord(filePath, relativeTo) {
  const contents = await readFile(filePath);
  return {
    path: path.relative(relativeTo, filePath),
    size: contents.length,
    sha256: sha256(contents),
  };
}

async function createArtifactLock({
  config,
  configPath,
  parentConfig,
  parentConfigPath,
  parentDirectory,
  result,
}) {
  const manifestPath = result.outputPaths[result.manifest.outputs.manifest.filename];
  const manifestContents = await readFile(manifestPath);
  return {
    formatVersion: 1,
    builder: parentConfig.builder,
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

export function inspectMyUrashima(sb3Bytes, script) {
  const archive = unzipSync(new Uint8Array(sb3Bytes));
  const project = JSON.parse(strFromU8(archive['project.json']));
  const stage = project.targets.find((target) => target.isStage);
  const actor = project.targets.find((target) => target.name === 'Actor');
  const princesses = project.targets.filter((target) => target.name === 'Princess');
  assert.equal(princesses.length, 1, 'Princess target must exist exactly once.');
  assert.deepEqual(
    princesses[0].costumes.map(({name, dataFormat}) => ({
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

export async function buildMyUrashima(outputDirectory, {verifyArtifacts = true} = {}) {
  const configPath = path.join(storyDirectory, 'sample.config.json');
  const config = await readJson(configPath);
  assert.equal(config.formatVersion, 1);
  assert.equal(config.sample, 'my-urashima');
  assert.equal(config.profile.outputName, 'my-urashima');
  assert.equal(config.profile.script, 'external');
  assert.equal(config.profile.assets, 'embedded');

  const parentConfigPath = path.resolve(storyDirectory, config.parentStory.config);
  const parentDirectory = path.dirname(parentConfigPath);
  const parentConfig = await readJson(parentConfigPath);
  const parentManifest = await readJson(path.join(parentDirectory, parentConfig.assetManifest));
  assert.equal(parentConfig.sample, config.parentStory.name);

  let source = await readFile(path.join(parentDirectory, parentConfig.sourceScript), 'utf8');
  const derivedAssetNames = new Set(
    config.targets.flatMap((target) => target.costumes.map(({asset}) => asset)),
  );
  for (const target of config.targets) {
    for (const costume of target.costumes) {
      const entry = parentManifest.assets.find(({name}) => name === costume.asset);
      assert.ok(entry, `Parent asset is missing: ${costume.asset}`);
      source = replaceExactlyOnce(
        source,
        `asset=${entry.name},${entry.uri}`,
        `asset=${entry.name},${costume.reference}`,
        `${entry.name} source asset`,
      );
    }
  }
  for (const replacement of config.scriptReplacements) {
    source = replaceExactlyOnce(source, replacement.from, replacement.to, replacement.description);
  }

  const derivedManifest = {
    ...parentManifest,
    assets: parentManifest.assets.filter(({name}) => !derivedAssetNames.has(name)),
  };
  const baseSb3 = await readFile(path.join(parentDirectory, parentConfig.baseSb3.path));
  const runtimePatchedBase = patchActorCloneRuntime(baseSb3);
  const patchedBase = patchPromptPosition(runtimePatchedBase);
  const derivedBase = await createDerivedBase(
    patchedBase,
    parentDirectory,
    parentManifest,
    config.targets,
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
    const artifactLock = await createArtifactLock({
      config,
      configPath,
      parentConfig,
      parentConfigPath,
      parentDirectory,
      result,
    });
    const [sb3Bytes, script] = await Promise.all([
      readFile(result.outputPaths[result.manifest.outputs.sb3.filename]),
      readFile(result.outputPaths[result.manifest.outputs.script.filename], 'utf8'),
    ]);
    inspectMyUrashima(sb3Bytes, script);

    if (verifyArtifacts) {
      const expectedLock = await readJson(path.join(storyDirectory, config.artifactsLock));
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

export async function verifyMyUrashimaOutput(outputDirectory) {
  const config = await readJson(path.join(storyDirectory, 'sample.config.json'));
  const artifactLock = await readJson(path.join(storyDirectory, config.artifactsLock));
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
  const manifest = JSON.parse(manifestContents.toString('utf8'));
  assert.equal(manifest.profile, 'editor');
  assert.equal(manifest.script.mode, 'external');
  assert.equal(manifest.assets.length, 41);
  assert.equal(
    manifest.assets.some(({name}) => name === 'Princess'),
    false,
  );
  inspectMyUrashima(sb3Bytes, script);
  return {artifactLock, manifest, sb3Bytes, script};
}
