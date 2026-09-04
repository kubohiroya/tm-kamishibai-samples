import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from 'vitest';
import { fileURLToPath } from "node:url";

import { unzipSync } from "fflate";

import {
  assembleWorkshopDistribution,
  verifyWorkshopArchive,
  workshopEdition,
  workshopResourceDirectories,
} from "../scripts/build-workshop-20260801.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function writeFixture(filename: string, contents: string = filename): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
}

async function listRelativeFiles(
  directory: string,
  relativeDirectory = "",
): Promise<string[]> {
  const files: string[] = [];
  const entries = (
    await readdir(path.join(directory, relativeDirectory), {
      withFileTypes: true,
    })
  ).sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(directory, relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

test("tracks the declared workshop sources with their mixed-license notice", async () => {
  const resourcesDirectory = path.join(
    projectRoot,
    "resources",
    workshopEdition,
  );
  assert.deepEqual(await listRelativeFiles(resourcesDirectory), [
    "draft-samples/pose1.png",
    "draft-samples/pose2.png",
    "drafts/pose1.png",
    "drafts/pose2.png",
    "drafts/pose3.png",
    "drafts/pose4.png",
    "generated/.gitkeep",
    "generated-samples/p1.png",
    "generated-samples/p2.png",
    "generated-samples/p3.png",
    "generated-samples/p4.png",
    "LICENSES.md",
    "master/Princess.png",
    "master/Urashima.png",
    "README.md",
    "tmpose/my-urashima/.gitkeep",
    "tmpose/urashima/.gitkeep",
    "tmpose-samples/project.tm",
  ]);
  const licenses = await readFile(
    path.join(resourcesDirectory, "LICENSES.md"),
    "utf8",
  );
  assert.match(licenses, /Copyright © 2026 Hiroya Kubo/u);
  assert.match(licenses, /CC BY-SA 4\.0/u);
  assert.match(
    licenses,
    /tmpose-kamishibai-20260801\.pdf[^]*All rights reserved\./u,
  );
});

test("assembles a deterministic workshop directory and ZIP with explicit license boundaries", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "tmpose-workshop-test-"),
  );
  try {
    const resourcesDirectory = path.join(
      temporaryRoot,
      "resources",
      workshopEdition,
    );
    const siteOutputDirectory = path.join(temporaryRoot, "site-output");
    const outputDirectory = path.join(
      temporaryRoot,
      "dist/workshop",
      workshopEdition,
    );
    const zipPath = path.join(
      temporaryRoot,
      "dist/workshop",
      `${workshopEdition}.zip`,
    );
    const pdfPath = path.join(temporaryRoot, "workshop.pdf");
    const licensePath = path.join(temporaryRoot, "LICENSE");

    for (const name of workshopResourceDirectories) {
      await mkdir(path.join(resourcesDirectory, name), { recursive: true });
    }
    await Promise.all([
      writeFixture(path.join(resourcesDirectory, "README.md"), "# Workshop"),
      writeFixture(
        path.join(resourcesDirectory, "LICENSES.md"),
        "All rights reserved and CC BY-SA 4.0",
      ),
      writeFixture(path.join(resourcesDirectory, "drafts/pose.png"), "png"),
      writeFixture(
        path.join(resourcesDirectory, "generated/.gitkeep"),
        "placeholder",
      ),
      writeFixture(
        path.join(resourcesDirectory, "tmpose-samples/project.tm"),
        "tm",
      ),
      writeFixture(path.join(resourcesDirectory, ".DS_Store"), "metadata"),
      writeFixture(pdfPath, "%PDF-1.4"),
      writeFixture(licensePath, "MPL-2.0"),
      writeFixture(
        path.join(siteOutputDirectory, "stories/urashima/urashima.sb3"),
        "sb3",
      ),
      writeFixture(
        path.join(siteOutputDirectory, "stories/urashima/urashima.txt"),
        "script",
      ),
      writeFixture(
        path.join(siteOutputDirectory, "stories/my-urashima/my-urashima.sb3"),
        "sb3",
      ),
      writeFixture(
        path.join(siteOutputDirectory, "stories/my-urashima/my-urashima.txt"),
        "script",
      ),
      writeFixture(
        path.join(siteOutputDirectory, "stories/my-urashima/my-urashima.k4.yml"),
        "kamishibai: '4.0'",
      ),
      writeFixture(
        path.join(siteOutputDirectory, "stories/my-urashima/project-assets.yml"),
        "formatVersion: 1",
      ),
      writeFixture(
        path.join(siteOutputDirectory, "stories/urashima/LICENSES.md"),
        "Story licenses",
      ),
      writeFixture(
        path.join(
          siteOutputDirectory,
          "stories/urashima/licenses/tmpose-kamishibai-MPL-2.0.txt",
        ),
        "Mozilla Public License Version 2.0",
      ),
    ]);

    const options = {
      licensePath,
      outputDirectory,
      pdfPath,
      resourcesDirectory,
      siteOutputDirectory,
      zipPath,
    };
    const firstVerification = await assembleWorkshopDistribution(options);
    const firstZip = await readFile(zipPath);
    await writeFixture(path.join(outputDirectory, "stale.txt"), "stale");
    const secondVerification = await assembleWorkshopDistribution(options);
    const secondZip = await readFile(zipPath);

    assert.deepEqual(secondVerification, firstVerification);
    assert(firstZip.equals(secondZip));
    assert.deepEqual(await verifyWorkshopArchive(zipPath), secondVerification);
    const archive = unzipSync(new Uint8Array(secondZip));
    assert(Object.hasOwn(archive, `${workshopEdition}/generated/`));
    assert(Object.hasOwn(archive, `${workshopEdition}/tmpose/`));
    assert(
      Object.hasOwn(
        archive,
        `${workshopEdition}/stories/urashima/licenses/tmpose-kamishibai-MPL-2.0.txt`,
      ),
    );
    assert(
      Object.hasOwn(
        archive,
        `${workshopEdition}/stories/my-urashima/my-urashima.k4.yml`,
      ),
    );
    assert(
      Object.hasOwn(
        archive,
        `${workshopEdition}/stories/my-urashima/project-assets.yml`,
      ),
    );
    assert.equal(
      Object.hasOwn(archive, `${workshopEdition}/generated/.gitkeep`),
      false,
    );
    assert.equal(Object.hasOwn(archive, `${workshopEdition}/.DS_Store`), false);
    assert.equal(Object.hasOwn(archive, `${workshopEdition}/stale.txt`), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
