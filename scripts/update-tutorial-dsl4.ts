import assert from 'node:assert/strict';
import {readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  buildTutorialDsl4,
  createTutorialPublicSurfaces,
} from './build-tutorial-dsl4.ts';
import {buildWebLock} from './update-dsl4-web-artifacts.ts';
import type {Dsl4BuildConfig} from './story-config.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const storyDirectory = path.join(projectRoot, 'stories/tutorial');

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

const build = await buildTutorialDsl4({writeLock: true});
const web = await buildWebLock('tutorial');
assert(web.enabled, 'The tutorial Web artifact must be enabled before publishing surfaces.');
const config = JSON.parse(
  await readFile(path.join(storyDirectory, 'dsl4-build.config.json'), 'utf8'),
) as Dsl4BuildConfig;
const publicSurfaces = createTutorialPublicSurfaces(config, build.artifactLock, web);
await writeJsonAtomically(
  path.join(storyDirectory, config.publicSurfaces as string),
  publicSurfaces,
);

process.stdout.write(
  `Updated tutorial release ${config.version}: SB3 ${build.artifactLock.outputs.sb3.sha256}, Web ${web.output.sha256}, starter ${build.artifactLock.outputs.starter.sha256}.\n`,
);
