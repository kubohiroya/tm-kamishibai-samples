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

interface AssetMetadata {
  bitmapResolution?: number;
  rotationCenterX: number;
  rotationCenterY: number;
  [key: string]: unknown;
}

/** assets.lock.json の 1 エントリ。この変換で書き換える項目のみを明示する。 */
interface ActorAsset {
  name: string;
  kind: string;
  target?: string;
  uri: string;
  size: number;
  sha256: string;
  dataFormat?: string;
  contentType?: string;
  metadata: AssetMetadata;
  [key: string]: unknown;
}

interface ActorAssetManifest {
  assets: ActorAsset[];
  [key: string]: unknown;
}

interface CompactMetadata {
  bitmapResolution: 1;
  rotationCenterX: number;
  rotationCenterY: number;
  [key: string]: unknown;
}

export interface AssetUpdate {
  metadata: CompactMetadata;
  name: string;
  newRelativePath: string;
  oldRelativePath: string;
  sha256: string;
  size: number;
}

interface Dimensions {
  height: number;
  width: number;
}

function digest(algorithm: string, contents: Uint8Array | string): string {
  return createHash(algorithm).update(contents).digest('hex');
}

function run(command: string, arguments_: readonly string[]): string {
  const result = spawnSync(command, [...arguments_], {encoding: 'utf8'});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${command} ${arguments_.join(' ')}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

async function writeAtomically(filePath: string, contents: Uint8Array | string): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, filePath);
}

function pngDimensions(filePath: string): Dimensions {
  const output = run('magick', ['identify', '-format', '%w %h', filePath]);
  const [width, height] = output.split(' ').map(Number) as [number, number];
  assert(Number.isInteger(width) && width > 0);
  assert(Number.isInteger(height) && height > 0);
  return {height, width};
}

function svgRasterSource(contents: Buffer): {
  contents: Buffer;
  height: number;
  mirrorHorizontally: boolean;
  width: number;
} {
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

function compactMetadata(asset: ActorAsset): CompactMetadata {
  const sourceResolution = asset.metadata.bitmapResolution ?? 1;
  const scale = 1 / sourceResolution;
  return {
    bitmapResolution: 1,
    rotationCenterX: asset.metadata.rotationCenterX * scale,
    rotationCenterY: asset.metadata.rotationCenterY * scale,
  };
}

function updateAssetBlock(
  section: string,
  name: string,
  update: AssetUpdate,
  {skipUnexpectedFile = false}: {skipUnexpectedFile?: boolean} = {},
): string {
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
  const fileLine = block[fileIndex] as string;
  if (skipUnexpectedFile && !fileLine.endsWith(update.oldRelativePath))
    return section;
  block[fileIndex] = fileLine.replace(
    update.oldRelativePath,
    update.newRelativePath,
  );

  const resolutionIndex = block.findIndex((line) =>
    /^    bitmapResolution: /u.test(line),
  );
  if (resolutionIndex === -1)
    block.splice(fileIndex + 1, 0, '    bitmapResolution: 1');
  else block[resolutionIndex] = '    bitmapResolution: 1';

  for (const key of ['rotationCenterX', 'rotationCenterY'] as const) {
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
  source: string,
  updates: readonly AssetUpdate[],
  {
    endMarker,
    pathPrefix,
    skipUnexpectedFile = false,
  }: {endMarker?: string; pathPrefix: string; skipUnexpectedFile?: boolean},
): string {
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

async function updateTextFile(
  filePath: string,
  transform: (source: string) => string,
): Promise<void> {
  const source = await readFile(filePath, 'utf8');
  const updated = transform(source);
  assert.notEqual(
    updated,
    source,
    `${path.relative(projectRoot, filePath)} did not change.`,
  );
  await writeAtomically(filePath, updated);
}

async function compactAsset(
  asset: ActorAsset,
  temporaryDirectory: string,
): Promise<AssetUpdate> {
  const oldRelativePath = asset.uri.slice('file:'.length);
  const sourcePath = path.join(storyDirectory, oldRelativePath);
  const sourceContents = await readFile(sourcePath);
  const sourceExtension = path.extname(sourcePath).toLowerCase();
  const rasterSourcePath = path.join(
    temporaryDirectory,
    `${asset.name}-source.png`,
  );
  let mirrorHorizontally = false;
  let targetDimensions: Dimensions;
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

export async function compactUrashimaActorAssets(): Promise<AssetUpdate[]> {
  run('magick', ['-version']);
  const manifest = JSON.parse(
    await readFile(assetManifestPath, 'utf8'),
  ) as ActorAssetManifest;
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
    const updates: AssetUpdate[] = [];
    for (const asset of actorAssets)
      updates.push(await compactAsset(asset, temporaryDirectory));
    const updateByName = new Map(
      updates.map((update) => [update.name, update]),
    );
    for (const asset of actorAssets) {
      const update = updateByName.get(asset.name);
      assert(update, `Missing compaction result for ${asset.name}.`);
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

    await updateTextFile(path.join(storyDirectory, 'source.txt'), (source: string) => {
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
      (total: number, asset) =>
        total + (updates.find((update) => update.name === asset.name)?.size ?? 0),
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
