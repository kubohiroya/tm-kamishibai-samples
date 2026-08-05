import {copyFile, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildMyUrashima} from './build-my-urashima.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/my-urashima');

export async function updateMyUrashimaArtifacts({scriptDate} = {}) {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'my-urashima-update-'));
  try {
    const {artifactLock, result} = await buildMyUrashima(temporaryDirectory, {
      scriptDate,
      verifyArtifacts: false,
    });
    await Promise.all([
      copyFile(
        result.outputPaths[result.manifest.outputs.sb3.filename],
        path.join(storyDirectory, result.manifest.outputs.sb3.filename),
      ),
      copyFile(
        result.outputPaths[result.manifest.outputs.script.filename],
        path.join(storyDirectory, result.manifest.outputs.script.filename),
      ),
      writeFile(
        path.join(storyDirectory, 'artifacts.lock.json'),
        `${JSON.stringify(artifactLock, null, 2)}\n`,
      ),
    ]);
    console.log('Updated my-urashima checked artifacts and lock.');
    return artifactLock;
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await updateMyUrashimaArtifacts();
}
