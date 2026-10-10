/**
 * ブロック台本SB3とYAML台本が同じ意味であることを確かめる。
 *
 * バイト一致では成立しない。ブロックへ書くとコメントとキー順が落ち、書き戻したYAMLの改行位置も
 * 元とは違う。そこで公式CLIの `validate-dsl4 --format canonical-json` を両方に通し、frontendに
 * 依存しない正規形を比べる。比較しているのは台本の構造そのもので、書式ではない。
 *
 * 対象は `artifacts` に `source-yaml` と `sb3-blocks` の両方をhrefで宣言した作品すべてなので、
 * 2作目以降を足すときにこのスクリプトを触る必要はない。
 *
 * @see https://github.com/kubohiroya/turbowarp-kamishibai-samples/issues/132
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import type {Dsl4BuildConfig} from './story-config.ts';
import {readWorksCatalog, type WorkEntry} from './works-catalog.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultKamishibaiRoot = path.resolve(projectRoot, '../turbowarp-kamishibai-app');
const kamishibaiRootEnvironmentName = 'TURBOWARP_KAMISHIBAI_APP_ROOT';
/** 台本1本あたりの上限。stories/tutorial/dsl4-build.config.json の limits と同じ値。 */
const maxSourceBytes = 262_144;

export interface BlockSourceRoundTrip {
  workId: string;
  sourcePath: string;
  blocksPath: string;
  canonicalBytes: number;
}

function commandOutput(command: string, arguments_: readonly string[], cwd: string): string {
  const result = spawnSync(command, [...arguments_], {encoding: 'utf8', cwd});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${command} ${arguments_.join(' ')}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

/** 作品が宣言する標準4形式のうち、YAML台本とブロック台本SB3の両方を持つものだけ。 */
function roundTrippableWorks(works: readonly WorkEntry[]) {
  return works.flatMap((work) => {
    const sourceHref = work.artifacts?.['source-yaml']?.href;
    const blocksHref = work.artifacts?.['sb3-blocks']?.href;
    return sourceHref && blocksHref ? [{work, sourceHref, blocksHref}] : [];
  });
}

export async function verifyDsl4BlockSourceRoundTrip({
  kamishibaiRoot = path.resolve(process.env[kamishibaiRootEnvironmentName] ?? defaultKamishibaiRoot),
} = {}): Promise<BlockSourceRoundTrip[]> {
  const builderCli = path.join(kamishibaiRoot, 'bin/turbowarp-kamishibai.mjs');
  const catalog = await readWorksCatalog(path.join(projectRoot, 'site/works.json'));
  const tutorialConfig = JSON.parse(
    await readFile(path.join(projectRoot, 'stories/tutorial/dsl4-build.config.json'), 'utf8'),
  ) as Dsl4BuildConfig;
  const works = [...catalog.works, tutorialConfig.work as unknown as WorkEntry];
  const candidates = roundTrippableWorks(works);
  assert(
    candidates.length > 0,
    'No work declares both a YAML source and a block source SB3; the round trip would check nothing.',
  );

  const canonical = (sourcePath: string) =>
    commandOutput(
      process.execPath,
      [
        builderCli,
        'validate-dsl4',
        '--input',
        sourcePath,
        '--max-source-bytes',
        String(maxSourceBytes),
        '--format',
        'canonical-json',
      ],
      kamishibaiRoot,
    );

  const verified: BlockSourceRoundTrip[] = [];
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'dsl4-block-round-trip-'));
  try {
    for (const {work, sourceHref, blocksHref} of candidates) {
      const exportDirectory = path.join(temporaryDirectory, work.id);
      commandOutput(
        process.execPath,
        [
          builderCli,
          'export-block-dsl',
          '--input',
          path.join(projectRoot, blocksHref),
          '--output-dir',
          exportDirectory,
          '--name',
          work.id,
        ],
        kamishibaiRoot,
      );
      const exportedPath = path.join(exportDirectory, `${work.id}.k4.yml`);
      const authored = canonical(path.join(projectRoot, sourceHref));
      const exported = canonical(exportedPath);
      assert.equal(
        exported,
        authored,
        `${work.id}: the YAML exported from ${blocksHref} does not mean the same as ${sourceHref}.`,
      );
      verified.push({
        workId: work.id,
        sourcePath: sourceHref,
        blocksPath: blocksHref,
        canonicalBytes: authored.length,
      });
    }
  } finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
  }
  return verified;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const verified = await verifyDsl4BlockSourceRoundTrip();
  for (const {workId, blocksPath, canonicalBytes} of verified) {
    process.stdout.write(
      `Verified ${workId}: ${blocksPath} round-trips to the authored story (${canonicalBytes} canonical bytes).\n`,
    );
  }
}
