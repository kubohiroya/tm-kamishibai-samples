import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8"));
}

async function assertFile(relativePath) {
  const filePath = path.join(projectRoot, relativePath);
  const information = await stat(filePath);
  assert(information.isFile(), `${relativePath} must be a file.`);
  assert(information.size > 0, `${relativePath} must not be empty.`);
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(path.join(projectRoot, directory), {
    withFileTypes: true,
  });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) return listFiles(path.posix.join(directory, entry.name), relativePath);
      return entry.isFile() ? [relativePath] : [];
    }),
  );
  return nested.flat().sort();
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function assertNoHumanFacingLegacyText(relativePath, source) {
  const legacyPattern = /tmpose|TMPose|TMPOSE|turbowarp-tmpose/u;
  assert.equal(
    legacyPattern.test(source),
    false,
    `${relativePath} contains legacy TMPose wording in human-facing text.`,
  );
}

function assertNoSpacedTurboWarpProductNames(relativePath, source) {
  const invalidPattern =
    /TurboWarp (?:Asset Manager|Async Input|Runtime Expression|SVG Text|Diagnostic Overlay|Extended Notification|Camera Source|WebUSB PaSoRi|WebUSB Pasori|Text Lines)/u;
  assert.equal(
    invalidPattern.test(source),
    false,
    `${relativePath} contains a non-hyphenated TurboWarp product name.`,
  );
}

async function assertLicense() {
  const license = await readFile(path.join(projectRoot, "LICENSE"), "utf8");
  assert(license.startsWith("Mozilla Public License Version 2.0"));
}

async function assertPackage(policy) {
  const packageJson = await readJson("package.json");
  assert.equal(packageJson.name, policy.package.name);
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, policy.package.license);
  assert.equal(packageJson.homepage, policy.homepage);
  assert.equal(packageJson.packageManager, policy.package.packageManager);
  assert.equal(packageJson.engines.node, policy.package.node);
  assert.equal(
    packageJson.dependencies[policy.dependencies.builderPackage],
    policy.dependencies.builderVersion,
  );
  assert.equal(
    packageJson.devDependencies["@kubohiroya/sb3-toolchain"],
    policy.dependencies.sb3Toolchain,
  );
  assert.equal(packageJson.devDependencies["@turbowarp/packager"], policy.dependencies.packager);
  for (const script of ["check", "repo:check", "pack:dry-run", "release:check"]) {
    assert.equal(typeof packageJson.scripts[script], "string", `${script} script is missing.`);
  }
}

async function assertStoryContracts(policy) {
  const sampleConfig = await readJson("stories/urashima/sample.config.json");
  assert.equal(sampleConfig.builder.package, policy.dependencies.builderPackage);
  assert.equal(sampleConfig.builder.version, policy.dependencies.builderVersion);
  assert.equal(sampleConfig.builder.commit, policy.dependencies.builderGitHead);
  assert.deepEqual(
    sampleConfig.web.allowedOnlineDependencies.map(({ purpose }) => purpose),
    [
      "TurboWarp TMのTensorFlow.jsランタイム",
      "TurboWarp TMのTeachable Machine Poseランタイム",
      "台本で指定するTeachable Machine Poseモデル",
    ],
  );
  assert.deepEqual(
    sampleConfig.web.runtimeCapabilities.map(({ purpose }) => purpose),
    ["TurboWarp TMによるポーズ認識", "組み込み済み音声の再生"],
  );

  const resourceFiles = await listFiles("resources/20260801");
  assert(resourceFiles.includes("tm/urashima/.gitkeep"));
  assert(resourceFiles.includes("tm/my-urashima/.gitkeep"));
  assert(resourceFiles.includes("tm-samples/project.tm"));
  assert(!resourceFiles.some((file) => file.startsWith("tmpose")));

  await assertFile("stories/urashima/licenses/tm-kamishibai-MPL-2.0.txt");
}

async function assertHumanFacingText() {
  const files = [
    "README.md",
    "WORKS_POLICY.md",
    "resources/20260801/README.md",
    "resources/20260801/LICENSES.md",
    "site/CARD_SCENES.md",
    "stories/urashima/LICENSES.md",
    "stories/urashima/README.md",
    "stories/my-urashima/README.md",
    "stories/tutorial/README.md",
  ];
  for (const relativePath of files) {
    const source = await readFile(path.join(projectRoot, relativePath), "utf8");
    assertNoHumanFacingLegacyText(relativePath, source);
    assertNoSpacedTurboWarpProductNames(relativePath, source);
  }
}

async function assertPackContents() {
  const packOutput = execFileSync(
    "pnpm",
    ["pack", "--json", "--pack-destination", ".tmp/pack-check"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const packRecord = JSON.parse(packOutput);
  const record = Array.isArray(packRecord) ? packRecord[0] : packRecord;
  const archivePath = path.resolve(projectRoot, record.filename);
  await assertFile(path.relative(projectRoot, archivePath));
  const files = execFileSync("tar", ["-tzf", archivePath], {
    cwd: projectRoot,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .sort();
  assert(files.includes("package/README.md"));
  assert(files.includes("package/LICENSE"));
  assert(files.includes("package/repo-policy.json"));
  assert(files.includes("package/scripts/check-repo.mjs"));
  assert(!files.some((file) => file.startsWith("package/dist/")));
}

async function assertLockAlignment(policy) {
  const lock = await readFile(path.join(projectRoot, "pnpm-lock.yaml"), "utf8");
  assert(lock.includes(`${policy.dependencies.builderPackage}@${policy.dependencies.builderVersion}`));
  assert(lock.includes(`@kubohiroya/sb3-toolchain@${policy.dependencies.sb3Toolchain}`));

  const runtimeLicense = await readFile(
    path.join(projectRoot, "stories/urashima/licenses/tm-kamishibai-MPL-2.0.txt"),
  );
  const rootLicense = await readFile(path.join(projectRoot, "LICENSE"));
  assert.equal(sha256(runtimeLicense), sha256(rootLicense));
}

const policy = await readJson("repo-policy.json");
await assertLicense();
await assertPackage(policy);
await assertStoryContracts(policy);
await assertHumanFacingText();
await assertLockAlignment(policy);
await assertPackContents();
console.log("Repository policy checks passed.");
