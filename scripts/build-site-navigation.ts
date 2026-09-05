/**
 * scripts/site-navigation.ts から契約配布物 scripts/site-navigation.mjs を生成する。
 *
 * ナビゲーション描画コードは tm-kamishibai / tm-kamishibai-docs / tm-kamishibai-samples の
 * 三リポジトリで `cmp` によりバイト一致を保つ契約物になっている。TypeScript 化後は
 * このリポジトリの .ts を正本とし、生成した .mjs を各リポジトリが取り込む。
 *
 * 生成は Node 自身の型剥がし（module.stripTypeScriptTypes）で行う。tsc の emitter と違い
 * 型注釈を取り除くだけで元の整形と空行をそのまま残すため、生成物は「Node が実際に実行する
 * コード」と一致し、契約物としての差分も最小になる。剥がした跡の余白は Prettier で整える。
 *
 *   node scripts/build-site-navigation.ts           # 生成して書き出す
 *   node scripts/build-site-navigation.ts --check   # 生成物が最新かどうかだけ検査する
 */
import assert from 'node:assert/strict';
import {readFile, rename, writeFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import prettier from 'prettier';

// stripTypeScriptTypes は experimental 扱いで、呼ぶたびに警告を出す。
// `pnpm verify` の出力を汚すだけなので、この警告だけ落として他はそのまま出す。
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  const isTypeStrippingNotice =
    warning.name === 'ExperimentalWarning' && warning.message.includes('stripTypeScriptTypes');
  if (!isTypeStrippingNotice) process.stderr.write(`${warning.stack ?? warning.message}\n`);
});

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const navigationSourcePath = path.join(projectRoot, 'scripts/site-navigation.ts');
export const navigationArtifactPath = path.join(projectRoot, 'scripts/site-navigation.mjs');

/**
 * 契約先リポジトリ（tm-kamishibai / tm-kamishibai-docs）の .prettierrc.json と同じ設定。
 * 生成物はあちらの `prettier --check` も通る必要があるため、ここを勝手に変えない。
 */
const prettierOptions = {
  parser: 'babel' as const,
  bracketSpacing: false,
  printWidth: 100,
  singleQuote: true,
};

export async function renderNavigationArtifact(): Promise<string> {
  const source = await readFile(navigationSourcePath, 'utf8');
  const stripped = stripTypeScriptTypes(source, {mode: 'strip'});
  return prettier.format(stripped, prettierOptions);
}

async function readArtifactIfPresent(): Promise<string | null> {
  try {
    return await readFile(navigationArtifactPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export interface NavigationArtifactResult {
  changed: boolean;
  contents: string;
}

export async function buildSiteNavigationArtifact({
  check = false,
}: {check?: boolean} = {}): Promise<NavigationArtifactResult> {
  const contents = await renderNavigationArtifact();
  const existing = await readArtifactIfPresent();
  const changed = existing !== contents;
  if (check) {
    assert.equal(
      changed,
      false,
      'scripts/site-navigation.mjs is stale; run "pnpm build:site-navigation".',
    );
    return {changed, contents};
  }
  if (changed) {
    const temporaryPath = `${navigationArtifactPath}.tmp-${process.pid}`;
    await writeFile(temporaryPath, contents, 'utf8');
    await rename(temporaryPath, navigationArtifactPath);
  }
  return {changed, contents};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const {changed} = await buildSiteNavigationArtifact({check});
  process.stdout.write(
    check
      ? 'scripts/site-navigation.mjs is up to date.\n'
      : `${changed ? 'Regenerated' : 'Verified'} scripts/site-navigation.mjs.\n`,
  );
}
