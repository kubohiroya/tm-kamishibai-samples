import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  copyFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/urashima');
const assetManifestPath = path.join(storyDirectory, 'assets.lock.json');
const actorTarget = 'Actor';
const paletteSize = 64;

function digest(algorithm, contents) {
  return createHash(algorithm).update(contents).digest('hex');
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {encoding: 'utf8'});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${command} ${arguments_.join(' ')}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

async function writeAtomically(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, filePath);
}

function pngDimensions(filePath) {
  const output = run('magick', ['identify', '-format', '%w %h', filePath]);
  const [width, height] = output.split(' ').map(Number);
  assert(Number.isInteger(width) && width > 0);
  assert(Number.isInteger(height) && height > 0);
  return {height, width};
}

function svgRasterSource(contents) {
  const source = contents.toString('utf8');
  const width = Number(source.match(/<svg\b[^>]*\bwidth="([0-9.]+)"/u)?.[1]);
  const height = Number(source.match(/<svg\b[^>]*\bheight="([0-9.]+)"/u)?.[1]);
  const encoded = source.match(
    /(?:xlink:)?href="data:image\/png;base64,([^"]+)"/u,
  )?.[1];
  assert(
    Number.isInteger(width) && width > 0,
    'SVG width must be a positive integer.',
  );
  assert(
    Number.isInteger(height) && height > 0,
    'SVG height must be a positive integer.',
  );
  assert(encoded, 'SVG must contain one embedded PNG data URI.');
  return {
    contents: Buffer.from(encoded, 'base64'),
    height,
    mirrorHorizontally: /transform="rotate\(-180\) scale\(0\.5,-0\.5\)"/u.test(
      source,
    ),
    width,
  };
}

function compactMetadata(asset) {
  const sourceResolution = asset.metadata.bitmapResolution ?? 1;
  const scale = 1 / sourceResolution;
  return {
    bitmapResolution: 1,
    rotationCenterX: asset.metadata.rotationCenterX * scale,
    rotationCenterY: asset.metadata.rotationCenterY * scale,
  };
}

function updateAssetBlock(
  section,
  name,
  update,
  {skipUnexpectedFile = false} = {},
) {
  const lines = section.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) return section;
  let end = lines.findIndex(
    (line, index) => index > start && /^  \S/u.test(line),
  );
  if (end === -1) end = lines.length;
  const block = lines.slice(start, end);
  const fileIndex = block.findIndex((line) => /^    file: /u.test(line));
  assert(fileIndex !== -1, `Asset ${name} must have a file declaration.`);
  if (skipUnexpectedFile && !block[fileIndex].endsWith(update.oldRelativePath))
    return section;
  block[fileIndex] = block[fileIndex].replace(
    update.oldRelativePath,
    update.newRelativePath,
  );

  const resolutionIndex = block.findIndex((line) =>
    /^    bitmapResolution: /u.test(line),
  );
  if (resolutionIndex === -1)
    block.splice(fileIndex + 1, 0, '    bitmapResolution: 1');
  else block[resolutionIndex] = '    bitmapResolution: 1';

  for (const key of ['rotationCenterX', 'rotationCenterY']) {
    const metadataIndex = block.findIndex((line) =>
      line.startsWith(`    ${key}: `),
    );
    if (metadataIndex !== -1)
      block[metadataIndex] = `    ${key}: ${update.metadata[key]}`;
  }
  lines.splice(start, end - start, ...block);
  return lines.join('\n');
}

function updateYamlAssets(
  source,
  updates,
  {endMarker, pathPrefix, skipUnexpectedFile = false},
) {
  const sectionStart = source.indexOf('assets:\n');
  assert(sectionStart !== -1, 'YAML assets section is missing.');
  const contentStart = sectionStart + 'assets:\n'.length;
  const sectionEnd = endMarker
    ? source.indexOf(endMarker, contentStart)
    : source.length;
  assert(sectionEnd !== -1, `YAML end marker is missing: ${endMarker}`);
  let section = source.slice(contentStart, sectionEnd);
  for (const update of updates) {
    section = updateAssetBlock(
      section,
      update.name,
      {
        ...update,
        newRelativePath: `${pathPrefix}${update.newRelativePath}`,
        oldRelativePath: `${pathPrefix}${update.oldRelativePath}`,
      },
      {skipUnexpectedFile},
    );
  }
  return `${source.slice(0, contentStart)}${section}${source.slice(sectionEnd)}`;
}

async function updateTextFile(filePath, transform) {
  const source = await readFile(filePath, 'utf8');
  const updated = transform(source);
  assert.notEqual(
    updated,
    source,
    `${path.relative(projectRoot, filePath)} did not change.`,
  );
  await writeAtomically(filePath, updated);
}

async function compactAsset(asset, temporaryDirectory) {
  const oldRelativePath = asset.uri.slice('file:'.length);
  const sourcePath = path.join(storyDirectory, oldRelativePath);
  const sourceContents = await readFile(sourcePath);
  const sourceExtension = path.extname(sourcePath).toLowerCase();
  const rasterSourcePath = path.join(
    temporaryDirectory,
    `${asset.name}-source.png`,
  );
  let mirrorHorizontally = false;
  let targetDimensions;
  if (sourceExtension === '.svg') {
    const raster = svgRasterSource(sourceContents);
    await writeFile(rasterSourcePath, raster.contents);
    mirrorHorizontally = raster.mirrorHorizontally;
    targetDimensions = {height: raster.height, width: raster.width};
  } else {
    assert.equal(
      sourceExtension,
      '.png',
      `${asset.name} must be a PNG or embedded-PNG SVG.`,
    );
    await copyFile(sourcePath, rasterSourcePath);
    const sourceDimensions = pngDimensions(rasterSourcePath);
    const sourceResolution = asset.metadata.bitmapResolution ?? 1;
    targetDimensions = {
      height: Math.round(sourceDimensions.height / sourceResolution),
      width: Math.round(sourceDimensions.width / sourceResolution),
    };
  }

  const sourceDimensions = pngDimensions(rasterSourcePath);
  const pixelDimensions = {
    height: Math.max(1, Math.round(sourceDimensions.height / 6)),
    width: Math.max(1, Math.round(sourceDimensions.width / 6)),
  };
  const compactPath = path.join(
    temporaryDirectory,
    `${asset.name}-compact.png`,
  );
  run('magick', [
    rasterSourcePath,
    ...(mirrorHorizontally ? ['-flop'] : []),
    '-filter',
    'box',
    '-resize',
    `${pixelDimensions.width}x${pixelDimensions.height}!`,
    '-channel',
    'A',
    '-threshold',
    '50%',
    '+channel',
    '-dither',
    'None',
    '-colors',
    String(paletteSize),
    '-filter',
    'point',
    '-resize',
    `${targetDimensions.width}x${targetDimensions.height}!`,
    '-strip',
    '-define',
    'png:compression-level=9',
    `PNG8:${compactPath}`,
  ]);
  assert.deepEqual(pngDimensions(compactPath), targetDimensions);
  const colors = Number(
    run('magick', ['identify', '-format', '%k', compactPath]),
  );
  const channels = run('magick', [
    'identify',
    '-format',
    '%[channels]',
    compactPath,
  ]);
  assert(colors <= paletteSize, `${asset.name} contains ${colors} colors.`);
  assert(channels.includes('a'), `${asset.name} lost its alpha channel.`);

  const compactContents = await readFile(compactPath);
  const assetId = digest('md5', compactContents);
  const newRelativePath = `assets/images/${assetId}.png`;
  await writeFile(path.join(storyDirectory, newRelativePath), compactContents);
  return {
    metadata: compactMetadata(asset),
    name: asset.name,
    newRelativePath,
    oldRelativePath,
    sha256: digest('sha256', compactContents),
    size: compactContents.length,
  };
}

export async function compactUrashimaActorAssets() {
  run('magick', ['-version']);
  const manifest = JSON.parse(await readFile(assetManifestPath, 'utf8'));
  const actorAssets = manifest.assets.filter(
    (asset) => asset.kind === 'costume' && asset.target === actorTarget,
  );
  assert.equal(actorAssets.length, 18, 'Expected 18 Urashima actor costumes.');
  if (
    actorAssets.every(
      (asset) =>
        asset.dataFormat === 'png' &&
        asset.contentType === 'image/png' &&
        asset.metadata.bitmapResolution === 1,
    )
  ) {
    process.stdout.write('Urashima actor assets are already compact.\n');
    return [];
  }
  assert(
    actorAssets.every(
      (asset) =>
        (asset.metadata.bitmapResolution ?? 1) !== 1 || asset.name === 'Turtle',
    ),
    'Refusing to mix original and compact actor assets.',
  );

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'urashima-compact-'),
  );
  try {
    const updates = [];
    for (const asset of actorAssets)
      updates.push(await compactAsset(asset, temporaryDirectory));
    const updateByName = new Map(
      updates.map((update) => [update.name, update]),
    );
    for (const asset of actorAssets) {
      const update = updateByName.get(asset.name);
      asset.uri = `file:${update.newRelativePath}`;
      asset.contentType = 'image/png';
      asset.dataFormat = 'png';
      asset.size = update.size;
      asset.sha256 = update.sha256;
      asset.metadata = update.metadata;
    }
    await writeAtomically(
      assetManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    await updateTextFile(path.join(storyDirectory, 'source.txt'), (source) => {
      let updated = source;
      for (const update of updates) {
        updated = updated.replaceAll(
          update.oldRelativePath,
          update.newRelativePath,
        );
      }
      return updated;
    });
    await updateTextFile(
      path.join(storyDirectory, 'urashima.k4.yml'),
      (source) =>
        updateYamlAssets(source, updates, {
          endMarker: '\nactors:',
          pathPrefix: '',
        }),
    );
    await updateTextFile(
      path.join(storyDirectory, 'project-assets-dsl4.yml'),
      (source) =>
        updateYamlAssets(source, updates, {
          pathPrefix: '',
          skipUnexpectedFile: true,
        }),
    );
    await updateTextFile(
      path.join(projectRoot, 'stories/my-urashima/project-assets-dsl4.yml'),
      (source) =>
        updateYamlAssets(source, updates, {
          pathPrefix: '../urashima/',
          skipUnexpectedFile: true,
        }),
    );

    await Promise.all(
      [...new Set(updates.map(({oldRelativePath}) => oldRelativePath))].map(
        (relativePath) => rm(path.join(storyDirectory, relativePath)),
      ),
    );
    const compactBytes = actorAssets.reduce(
      (total, asset) =>
        total + updates.find((update) => update.name === asset.name).size,
      0,
    );
    process.stdout.write(
      `Compacted ${updates.length} Urashima actor assets to ${compactBytes} bytes.\n`,
    );
    return updates;
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await compactUrashimaActorAssets();
}
