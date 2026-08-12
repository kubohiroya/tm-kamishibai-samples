import {readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  buildTutorialDsl4,
  createTutorialPublicSurfaces,
} from './build-tutorial-dsl4.mjs';
import {buildWebLock} from './update-dsl4-web-artifacts.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/tutorial');

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

const build = await buildTutorialDsl4({writeLock: true});
const web = await buildWebLock('tutorial');
const config = JSON.parse(
  await readFile(path.join(storyDirectory, 'dsl4-build.config.json'), 'utf8'),
);
const publicSurfaces = createTutorialPublicSurfaces(config, build.artifactLock, web);
await writeJsonAtomically(path.join(storyDirectory, config.publicSurfaces), publicSurfaces);

process.stdout.write(
  `Updated tutorial candidate ${config.version}: SB3 ${build.artifactLock.outputs.sb3.sha256}, Web ${web.output.sha256}, starter ${build.artifactLock.outputs.starter.sha256}.\n`,
);
