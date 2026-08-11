import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {unzipSync} from 'fflate';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/urashima');
const lockPath = path.join(storyDirectory, 'dsl4-inputs.lock.json');

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function resolveStoryPath(relativePath) {
  assert.equal(typeof relativePath, 'string');
  assert(!relativePath.includes('\\'));
  assert(!path.posix.isAbsolute(relativePath));
  assert.equal(path.posix.normalize(relativePath), relativePath);
  assert(!relativePath.split('/').includes('..'));
  return path.join(storyDirectory, ...relativePath.split('/'));
}

function verifyContents(contents, record, label) {
  assert.equal(contents.length, record.size, `${label} size differs from dsl4-inputs.lock.json.`);
  assert.equal(sha256(contents), record.sha256, `${label} SHA-256 differs from lock.`);
}

async function readVerifiedIfPresent(outputPath, record, label) {
  try {
    const contents = await readFile(outputPath);
    verifyContents(contents, record, label);
    return contents;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeAtomically(outputPath, contents) {
  await mkdir(path.dirname(outputPath), {recursive: true});
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, outputPath);
}

async function materializeArchiveAsset(record, {writeMissing}) {
  const outputPath = resolveStoryPath(record.output);
  const existing = await readVerifiedIfPresent(outputPath, record, record.name);
  if (existing) return {path: outputPath, written: false};
  assert(writeMissing, `${record.name} is missing; run pnpm update:urashima-dsl4-inputs.`);
  const archive = unzipSync(new Uint8Array(await readFile(resolveStoryPath(record.source))));
  const contents = archive[record.entry];
  assert(contents, `${record.name} source archive entry is missing: ${record.entry}`);
  verifyContents(contents, record, record.name);
  await writeAtomically(outputPath, contents);
  return {path: outputPath, written: true};
}

async function materializePoseModel(model, {downloadMissing, fetchImplementation}) {
  const results = [];
  for (const file of model.files) {
    const outputPath = resolveStoryPath(`${model.output}/${file.path}`);
    const existing = await readVerifiedIfPresent(outputPath, file, `${model.name}/${file.path}`);
    if (existing) {
      results.push({path: outputPath, written: false});
      continue;
    }
    assert(
      downloadMissing,
      `${model.name}/${file.path} is missing; run pnpm update:urashima-dsl4-inputs.`,
    );
    const url = new URL(file.path, model.source);
    const response = await fetchImplementation(url, {signal: AbortSignal.timeout(60_000)});
    assert(response.ok, `Cannot download ${url}: HTTP ${response.status}`);
    const contents = Buffer.from(await response.arrayBuffer());
    verifyContents(contents, file, `${model.name}/${file.path}`);
    await writeAtomically(outputPath, contents);
    results.push({path: outputPath, written: true});
  }
  return results;
}

export async function ensureUrashimaDsl4Inputs({
  downloadMissing = false,
  writeMissingArchiveAssets = false,
  fetchImplementation = globalThis.fetch,
} = {}) {
  assert.equal(typeof fetchImplementation, 'function');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(lock.formatVersion, 1);
  const archiveAssets = [];
  for (const record of lock.archiveAssets) {
    archiveAssets.push(
      await materializeArchiveAsset(record, {writeMissing: writeMissingArchiveAssets}),
    );
  }
  const poseModels = [];
  for (const model of lock.poseModels) {
    poseModels.push(
      ...(await materializePoseModel(model, {downloadMissing, fetchImplementation})),
    );
  }
  return {archiveAssets, lock, poseModels};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const update = process.argv.includes('--download');
  const result = await ensureUrashimaDsl4Inputs({
    downloadMissing: update,
    writeMissingArchiveAssets: update,
  });
  const written = [...result.archiveAssets, ...result.poseModels].filter((file) => file.written);
  process.stdout.write(
    `${written.length === 0 ? 'Verified' : 'Updated'} ${result.archiveAssets.length} archive assets and ${result.poseModels.length} pose model files.\n`,
  );
}
