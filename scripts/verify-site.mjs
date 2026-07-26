import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access, readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {validateBundle} from '@kubohiroya/tmpose-kamishibai/builder';

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.join(prefix, entry.name);
      if (entry.isDirectory()) return listFiles(path.join(directory, entry.name), relativePath);
      return entry.isFile() ? [relativePath] : [];
    }),
  );
  return files.flat().sort();
}

function localLinks(html) {
  return [...html.matchAll(/\bhref="([^"]+)"/gu)]
    .map((match) => match[1])
    .filter((href) => !/^(?:https?:|mailto:|#)/u.test(href));
}

async function verifyLinks(htmlPath) {
  const html = await readFile(htmlPath, 'utf8');
  for (const href of localLinks(html)) {
    const target = path.resolve(path.dirname(htmlPath), decodeURIComponent(href));
    await access(target);
  }
  return html;
}

async function verifyFile(outputSampleDirectory, record, description) {
  const contents = await readFile(path.join(outputSampleDirectory, record.path));
  assert.equal(contents.length, record.size, `${description} size mismatch.`);
  assert.equal(sha256(contents), record.sha256, `${description} SHA-256 mismatch.`);
  return contents;
}

async function verifyProfile(outputSampleDirectory, profile, record) {
  assert.equal(record.profile, profile);
  assert.equal(record.assets, 'embedded');
  assert.equal(record.scriptMode, profile === 'player' ? 'embedded' : 'external');
  const [sb3Contents, scriptContents, builderManifestContents] = await Promise.all([
    verifyFile(outputSampleDirectory, record.sb3, `${profile} SB3`),
    verifyFile(outputSampleDirectory, record.script, `${profile} script`),
    readFile(path.join(outputSampleDirectory, record.builderManifest.path)),
  ]);
  assert.equal(sha256(builderManifestContents), record.builderManifest.sha256);
  const builderManifest = JSON.parse(builderManifestContents.toString('utf8'));
  assert.equal(builderManifest.profile, profile);
  assert.equal(builderManifest.outputName, record.outputName);
  assert.equal(builderManifest.assets.length, 42);
  assert.equal(builderManifest.builder.package, '@kubohiroya/tmpose-kamishibai');
  assert.equal(builderManifest.builder.version, '3.1.0');
  validateBundle({sb3Bytes: sb3Contents, scriptBytes: scriptContents, manifest: builderManifest});
  assert.equal(/^(?:asset=.*,(?:file|https?):)/mu.test(scriptContents.toString('utf8')), false);
  return {builderManifest, sb3Contents, scriptContents};
}

export async function verifyPublishedSite(options = {}) {
  const projectRoot = options.projectRoot ?? fileURLToPath(new URL('../', import.meta.url));
  const outputDirectory = options.outputDirectory ?? path.join(projectRoot, 'dist');
  const sourceDirectory = options.sourceDirectory ?? path.join(projectRoot, 'stories/urashima');
  const outputSampleDirectory = path.join(outputDirectory, 'stories/urashima');

  const [
    sourceFiles,
    publishedFiles,
    webFiles,
    rootIndex,
    sampleIndex,
    manifest,
    packageJson,
    license,
    licenseSummary,
    packagerNotice,
  ] =
    await Promise.all([
      listFiles(sourceDirectory),
      listFiles(outputDirectory),
      listFiles(path.join(outputSampleDirectory, 'web')),
      verifyLinks(path.join(outputDirectory, 'index.html')),
      verifyLinks(path.join(outputSampleDirectory, 'index.html')),
      readFile(path.join(outputSampleDirectory, 'manifest.json'), 'utf8').then(JSON.parse),
      readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
      readFile(path.join(outputDirectory, 'LICENSE'), 'utf8'),
      readFile(path.join(outputSampleDirectory, 'LICENSES.md'), 'utf8'),
      readFile(
        path.join(outputSampleDirectory, 'licenses/turbowarp-packager-NOTICE.md'),
        'utf8',
      ),
    ]);

  for (const relativePath of sourceFiles) {
    const [source, published] = await Promise.all([
      readFile(path.join(sourceDirectory, relativePath)),
      readFile(path.join(outputSampleDirectory, relativePath)),
    ]);
    assert(source.equals(published), `Published file differs from source: ${relativePath}`);
  }

  assert.equal(manifest.formatVersion, 3);
  assert.equal(manifest.sample, 'urashima');
  assert.equal(
    manifest.publicUrl,
    'https://kubohiroya.github.io/tmpose-kamishibai-samples/stories/urashima/',
  );
  assert.equal(manifest.license, 'MPL-2.0');
  assert.equal(manifest.builder.version, '3.1.0');
  assert.equal(packageJson.devDependencies['@turbowarp/packager'], '3.13.0');
  assert.equal(manifest.baseSb3.profile, 'generic');
  assert.equal(manifest.baseSb3.published, true);
  assert.deepEqual(manifest.assetCounts, {images: 24, sounds: 21, embedded: 42});
  assert.equal(manifest.assets.length, 45);
  assert.deepEqual(manifest.unusedSourceAssets, [
    'assets/sounds/13561fa02a628ea56859f72a90a3bfab.mp3',
    'assets/sounds/9d01505050dea4f782cd59635bcbab63.mp3',
    'assets/sounds/ab4760e0c9f0db6d1f5e83e3a0e9bf4f.mp3',
  ]);
  assert.equal(
    manifest.assets
      .filter((asset) => asset.path.startsWith('assets/sounds/'))
      .every((asset) => asset.contentType === 'audio/mpeg' && asset.path.endsWith('.mp3')),
    true,
  );
  for (const asset of manifest.assets) {
    await verifyFile(outputSampleDirectory, asset, asset.path);
  }

  const [editor, player, publicScript, baseSb3, sourceScript, assetManifest] = await Promise.all([
    verifyProfile(outputSampleDirectory, 'editor', manifest.profiles.editor),
    verifyProfile(outputSampleDirectory, 'player', manifest.profiles.player),
    verifyFile(outputSampleDirectory, manifest.script, 'public script'),
    verifyFile(outputSampleDirectory, manifest.baseSb3, 'generic base SB3'),
    verifyFile(outputSampleDirectory, manifest.source.script, 'source script'),
    verifyFile(outputSampleDirectory, manifest.source.assetManifest, 'asset manifest'),
  ]);
  assert(editor.scriptContents.equals(player.scriptContents));
  assert(player.scriptContents.equals(publicScript));
  assert.equal(editor.builderManifest.script.mode, 'external');
  assert.equal(editor.builderManifest.script.embeddedVariableId, null);
  assert.equal(player.builderManifest.script.mode, 'embedded');
  assert.equal(player.builderManifest.script.embeddedVariableId, 'tmposeEmbeddedScript');
  assert.equal(baseSb3.length, manifest.baseSb3.size);
  assert(sourceScript.includes(Buffer.from('file:assets/')));
  assert.equal(JSON.parse(assetManifest.toString('utf8')).assets.length, 42);

  assert.equal(manifest.web.enabled, true);
  assert.equal(manifest.web.publicPath, 'web/');
  assert.equal(manifest.web.packager.package, '@turbowarp/packager');
  assert.equal(manifest.web.packager.version, '3.13.0');
  assert.deepEqual(manifest.web.packager.options, {
    target: 'html',
    autoplay: true,
    app: {windowTitle: '浦島太郎 | TMPose紙芝居'},
    cloudVariables: {mode: 'disabled'},
    bakeExtensions: true,
  });
  assert.equal(manifest.web.packager.projectExtensions.length, 12);
  assert.equal(manifest.web.scriptMode, 'embedded');
  assert.equal(manifest.web.assets, 'embedded');
  assert.deepEqual(manifest.web.reproducibility, {runs: 2, identical: true});
  assert.deepEqual(manifest.web.input, {
    profile: 'player',
    path: manifest.profiles.player.sb3.path,
    size: manifest.profiles.player.sb3.size,
    sha256: manifest.profiles.player.sb3.sha256,
  });
  const webHtml = await verifyFile(outputSampleDirectory, manifest.web.output, 'Packager HTML');
  assert.deepEqual(webFiles, ['index.html']);
  assert(webHtml.length > 0);
  assert(webHtml.length <= 104857600);
  assert(webHtml.toString('utf8', 0, 128).startsWith('<!DOCTYPE html>'));
  assert(webHtml.includes(Buffer.from('<title>浦島太郎 | TMPose紙芝居</title>')));
  assert.deepEqual(
    manifest.web.allowedOnlineDependencies.map(({urlPrefix}) => urlPrefix),
    [
      'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/',
      'https://cdn.jsdelivr.net/npm/@teachablemachine/pose@0.8.3/',
      'https://sqs.prof.cuc.ac.jp/kamishibai/20260630/',
    ],
  );
  assert.deepEqual(
    manifest.web.runtimeCapabilities.map(({capability}) => capability),
    ['camera', 'audio'],
  );

  assert(license.startsWith('Mozilla Public License Version 2.0'));
  assert(licenseSummary.includes('MPL-2.0'));
  assert(licenseSummary.includes('turbowarp-packager-NOTICE.md'));
  assert(licenseSummary.includes('完全オフライン版ではありません'));
  assert(packagerNotice.includes('Copyright (C) 2021-2024 Thomas Weber'));
  assert(packagerNotice.includes('MPL-2.0'));
  assert(rootIndex.includes('https://github.com/kubohiroya/tmpose-kamishibai-samples'));
  assert(!rootIndex.includes('https://kubohiroya.github.io/tmpose-kamishibai/stories/'));
  assert(sampleIndex.includes(manifest.profiles.player.sb3.sha256));
  assert(sampleIndex.includes(manifest.profiles.editor.sb3.sha256));
  assert(sampleIndex.includes(manifest.web.output.sha256));
  assert(rootIndex.indexOf('Web版を開く') < rootIndex.indexOf('台本を表示'));
  assert(rootIndex.indexOf('台本を表示') < rootIndex.indexOf('再生用SB3をダウンロード'));
  assert(sampleIndex.indexOf('Web版を開く') < sampleIndex.indexOf('台本を表示'));
  assert(sampleIndex.indexOf('台本を表示') < sampleIndex.indexOf('再生用SB3をダウンロード'));
  assert(publishedFiles.includes('.nojekyll'));

  const noJekyll = await stat(path.join(outputDirectory, '.nojekyll'));
  assert(noJekyll.isFile());
  return {assetCount: manifest.assets.length, fileCount: publishedFiles.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await verifyPublishedSite();
  console.log(`Verified ${results.fileCount} published files and ${results.assetCount} assets.`);
}
