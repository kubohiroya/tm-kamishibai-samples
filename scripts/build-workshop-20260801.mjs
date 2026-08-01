import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { unzipSync, zipSync } from "fflate";

import { buildSite } from "./build-site.mjs";

export const workshopEdition = "20260801";
export const workshopPdfEnvironmentVariable = "TMPOSE_KAMISHIBAI_WORKSHOP_PDF";
export const workshopResourceDirectories = Object.freeze([
  "drafts",
  "draft-samples",
  "master",
  "generated",
  "generated-samples",
  "tmpose",
  "tmpose-samples",
]);

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
// ZIP stores local calendar fields, so construct the fixed date in local time for timezone-independent bytes.
const zipTimestamp = new Date(2026, 7, 1, 0, 0, 0);
const storedExtensions = new Set([".pdf", ".png", ".sb3", ".tm"]);

async function assertDirectory(directory, description) {
  let information;
  try {
    information = await stat(directory);
  } catch (error) {
    throw new Error(`${description} is missing: ${directory}`, {
      cause: error,
    });
  }
  assert(
    information.isDirectory(),
    `${description} must be a directory: ${directory}`,
  );
}

async function assertFile(filename, description) {
  let information;
  try {
    information = await stat(filename);
  } catch (error) {
    throw new Error(`${description} is missing: ${filename}`, { cause: error });
  }
  assert(
    information.isFile(),
    `${description} must be a regular file: ${filename}`,
  );
  assert(information.size > 0, `${description} must not be empty: ${filename}`);
}

async function copyVisibleDirectory(sourceDirectory, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const entries = (
    await readdir(sourceDirectory, { withFileTypes: true })
  ).sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const sourcePath = path.join(sourceDirectory, entry.name);
    const outputPath = path.join(outputDirectory, entry.name);
    if (entry.isDirectory()) {
      await copyVisibleDirectory(sourcePath, outputPath);
    } else {
      assert(
        entry.isFile(),
        `Workshop resources must not contain links: ${sourcePath}`,
      );
      await copyFile(sourcePath, outputPath);
    }
  }
}

async function collectZipEntries(directory, archivePath, zipEntries) {
  zipEntries[`${archivePath}/`] = [
    new Uint8Array(),
    { level: 0, mtime: zipTimestamp },
  ];
  const entries = (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name, "en"),
  );
  for (const entry of entries) {
    const sourcePath = path.join(directory, entry.name);
    const entryPath = `${archivePath}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectZipEntries(sourcePath, entryPath, zipEntries);
    } else {
      assert(
        entry.isFile(),
        `Workshop output must not contain links: ${sourcePath}`,
      );
      const level = storedExtensions.has(path.extname(entry.name).toLowerCase())
        ? 0
        : 9;
      zipEntries[entryPath] = [
        new Uint8Array(await readFile(sourcePath)),
        { level, mtime: zipTimestamp },
      ];
    }
  }
}

export async function verifyWorkshopArchive(zipPath) {
  const bytes = await readFile(zipPath);
  const archive = unzipSync(new Uint8Array(bytes));
  const requiredEntries = [
    `${workshopEdition}/README.md`,
    `${workshopEdition}/LICENSE`,
    `${workshopEdition}/LICENSES.md`,
    `${workshopEdition}/tmpose-kamishibai-20260801.pdf`,
    `${workshopEdition}/stories/urashima/urashima.sb3`,
    `${workshopEdition}/stories/urashima/urashima.txt`,
    `${workshopEdition}/stories/urashima/licenses/tmpose-kamishibai-MPL-2.0.txt`,
    `${workshopEdition}/stories/my-urashima/my-urashima.sb3`,
    `${workshopEdition}/stories/my-urashima/my-urashima.txt`,
    ...workshopResourceDirectories.map((name) => `${workshopEdition}/${name}/`),
  ];
  for (const entry of requiredEntries) {
    assert(Object.hasOwn(archive, entry), `Workshop ZIP is missing ${entry}`);
  }
  for (const entry of Object.keys(archive)) {
    assert(
      !entry.includes("/.DS_Store"),
      `Workshop ZIP contains .DS_Store: ${entry}`,
    );
    assert(
      !entry.includes("/.gitkeep"),
      `Workshop ZIP contains .gitkeep: ${entry}`,
    );
    assert(
      !entry.endsWith("/licenses/tmpose-kamishibai-MIT.txt"),
      `Workshop ZIP contains the retired runtime license: ${entry}`,
    );
  }
  return Object.freeze({
    entryCount: Object.keys(archive).length,
    size: bytes.length,
  });
}

export async function assembleWorkshopDistribution({
  licensePath,
  outputDirectory,
  pdfPath,
  resourcesDirectory,
  siteOutputDirectory,
  zipPath,
}) {
  await Promise.all([
    assertDirectory(resourcesDirectory, "Workshop resource directory"),
    assertDirectory(siteOutputDirectory, "Site output directory"),
    assertFile(path.join(resourcesDirectory, "README.md"), "Workshop README"),
    assertFile(
      path.join(resourcesDirectory, "LICENSES.md"),
      "Workshop license notice",
    ),
    assertFile(licensePath, "MPL-2.0 license"),
    assertFile(pdfPath, "Workshop PDF"),
    ...workshopResourceDirectories.map((name) =>
      assertDirectory(
        path.join(resourcesDirectory, name),
        `Workshop resource ${name}`,
      ),
    ),
  ]);

  const storyFiles = [
    ["urashima", "urashima.sb3"],
    ["urashima", "urashima.txt"],
    ["my-urashima", "my-urashima.sb3"],
    ["my-urashima", "my-urashima.txt"],
  ];
  await Promise.all(
    storyFiles.map(([story, filename]) =>
      assertFile(
        path.join(siteOutputDirectory, "stories", story, filename),
        `Published story artifact ${story}/${filename}`,
      ),
    ),
  );
  await assertFile(
    path.join(siteOutputDirectory, "stories/urashima/LICENSES.md"),
    "Urashima license notice",
  );
  await assertDirectory(
    path.join(siteOutputDirectory, "stories/urashima/licenses"),
    "Urashima license directory",
  );

  const outputParent = path.dirname(outputDirectory);
  await mkdir(outputParent, { recursive: true });
  const stagingRoot = await mkdtemp(
    path.join(outputParent, ".workshop-20260801-"),
  );
  const stagingDirectory = path.join(stagingRoot, workshopEdition);
  const stagingZipPath = path.join(stagingRoot, `${workshopEdition}.zip`);

  try {
    await mkdir(stagingDirectory, { recursive: true });
    await Promise.all(
      workshopResourceDirectories.map((name) =>
        copyVisibleDirectory(
          path.join(resourcesDirectory, name),
          path.join(stagingDirectory, name),
        ),
      ),
    );
    await Promise.all([
      copyFile(
        path.join(resourcesDirectory, "README.md"),
        path.join(stagingDirectory, "README.md"),
      ),
      copyFile(
        path.join(resourcesDirectory, "LICENSES.md"),
        path.join(stagingDirectory, "LICENSES.md"),
      ),
      copyFile(licensePath, path.join(stagingDirectory, "LICENSE")),
      copyFile(
        pdfPath,
        path.join(stagingDirectory, "tmpose-kamishibai-20260801.pdf"),
      ),
      ...storyFiles.map(async ([story, filename]) => {
        const storyOutputDirectory = path.join(
          stagingDirectory,
          "stories",
          story,
        );
        await mkdir(storyOutputDirectory, { recursive: true });
        await copyFile(
          path.join(siteOutputDirectory, "stories", story, filename),
          path.join(storyOutputDirectory, filename),
        );
      }),
    ]);
    await copyFile(
      path.join(siteOutputDirectory, "stories/urashima/LICENSES.md"),
      path.join(stagingDirectory, "stories/urashima/LICENSES.md"),
    );
    await copyVisibleDirectory(
      path.join(siteOutputDirectory, "stories/urashima/licenses"),
      path.join(stagingDirectory, "stories/urashima/licenses"),
    );

    const zipEntries = {};
    await collectZipEntries(stagingDirectory, workshopEdition, zipEntries);
    await writeFile(
      stagingZipPath,
      zipSync(zipEntries, { level: 9, mtime: zipTimestamp }),
    );
    const verification = await verifyWorkshopArchive(stagingZipPath);

    await rm(outputDirectory, { recursive: true, force: true });
    await rm(zipPath, { force: true });
    await rename(stagingDirectory, outputDirectory);
    await rename(stagingZipPath, zipPath);
    return verification;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export async function buildWorkshop20260801({
  environment = process.env,
} = {}) {
  const defaultPdfPath = path.resolve(
    projectRoot,
    "../tmpose-kamishibai/output/pdf/workshops/2026-08-01/tmpose-kamishibai-20260801.pdf",
  );
  const pdfPath = environment[workshopPdfEnvironmentVariable]
    ? path.resolve(environment[workshopPdfEnvironmentVariable])
    : defaultPdfPath;

  await assertFile(pdfPath, "Workshop PDF");
  await buildSite();
  const verification = await assembleWorkshopDistribution({
    licensePath: path.join(projectRoot, "LICENSE"),
    outputDirectory: path.join(projectRoot, "dist/workshop", workshopEdition),
    pdfPath,
    resourcesDirectory: path.join(projectRoot, "resources", workshopEdition),
    siteOutputDirectory: path.join(projectRoot, "dist"),
    zipPath: path.join(projectRoot, "dist/workshop", `${workshopEdition}.zip`),
  });
  console.log(
    `Built workshop ${workshopEdition}: ${verification.entryCount} ZIP entries, ${verification.size} bytes.`,
  );
  return verification;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildWorkshop20260801();
}
