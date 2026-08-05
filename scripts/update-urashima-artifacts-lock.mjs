import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildPackagedWeb} from './build-packaged-web.mjs';
import {buildUrashima} from './build-urashima.mjs';
import {storyDateMetadata} from './story-date.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sampleDirectory = path.join(projectRoot, 'stories/urashima');

export async function updateUrashimaArtifactsLock() {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'tmpose-kamishibai-lock-'));
  try {
    const {config, profileLocks, results} = await buildUrashima(outputDirectory, {
      verifyArtifacts: false,
    });
    const playerSb3Path =
      results.player.outputPaths[results.player.manifest.outputs.sb3.filename];
    const web = await buildPackagedWeb({
      inputSb3Path: playerSb3Path,
      outputSampleDirectory: outputDirectory,
      rawWebConfig: config.web,
    });
    const sourceScriptPath = path.join(sampleDirectory, config.sourceScript);
    const sourceScript = await readFile(sourceScriptPath, 'utf8');
    const artifactsLock = {
      formatVersion: 2,
      builder: {
        package: config.builder.package,
        version: config.builder.version,
        commit: config.builder.commit,
      },
      storyDate: storyDateMetadata(sourceScript),
      profiles: profileLocks,
      web: {
        packager: {
          package: config.web.packager.package,
          version: config.web.packager.version,
        },
        input: web.input,
        output: web.output,
      },
    };
    const artifactsLockPath = path.join(sampleDirectory, config.artifactsLock);
    const temporaryLockPath = `${artifactsLockPath}.tmp`;
    const publishedScriptPath = path.join(sampleDirectory, 'urashima.txt');
    const temporaryScriptPath = `${publishedScriptPath}.tmp`;
    const generatedScriptPath =
      results.player.outputPaths[results.player.manifest.outputs.script.filename];
    await mkdir(path.dirname(artifactsLockPath), {recursive: true});
    await Promise.all([
      writeFile(temporaryLockPath, `${JSON.stringify(artifactsLock, null, 2)}\n`, 'utf8'),
      readFile(generatedScriptPath).then((contents) => writeFile(temporaryScriptPath, contents)),
    ]);
    await Promise.all([
      rename(temporaryLockPath, artifactsLockPath),
      rename(temporaryScriptPath, publishedScriptPath),
    ]);
    console.log(`Updated ${path.relative(projectRoot, artifactsLockPath)}.`);
    return artifactsLock;
  } finally {
    await rm(outputDirectory, {recursive: true, force: true});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await updateUrashimaArtifactsLock();
}
