/**
 * scripts/site-navigation.ts から契約配布物 scripts/site-navigation.mjs を生成する。
 *
 * ナビゲーション描画コードは tm-kamishibai / tm-kamishibai-docs / tm-kamishibai-samples の
 * 三リポジトリで `cmp` によりバイト一致を保つ契約物になっている。TypeScript 化後は
 * このリポジトリの .ts を正本とし、生成した .mjs を各リポジトリが取り込む形に移行する。
 *
 *   node scripts/build-site-navigation.ts           # 生成して書き出す
 *   node scripts/build-site-navigation.ts --check   # 生成物が最新かどうかだけ検査する
 */
import assert from 'node:assert/strict';
import {readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ts from 'typescript';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const navigationSourcePath = path.join(projectRoot, 'scripts/site-navigation.ts');
export const navigationArtifactPath = path.join(projectRoot, 'scripts/site-navigation.mjs');

const banner = `// Generated from scripts/site-navigation.ts. Do not edit by hand.
// Regenerate with: pnpm build:site-navigation
`;

/** 三リポジトリで同じバイト列になるよう、出力に影響する設定はすべて明示する。 */
const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2024,
  module: ts.ModuleKind.ESNext,
  newLine: ts.NewLineKind.LineFeed,
  removeComments: false,
  verbatimModuleSyntax: true,
};

export async function renderNavigationArtifact(): Promise<string> {
  const source = await readFile(navigationSourcePath, 'utf8');
  const {outputText, diagnostics} = ts.transpileModule(source, {
    compilerOptions,
    fileName: navigationSourcePath,
    reportDiagnostics: true,
  });
  assert.equal(
    diagnostics?.length ?? 0,
    0,
    `site-navigation.ts failed to transpile:\n${(diagnostics ?? [])
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n')}`,
  );
  return `${banner}${outputText.replace(/\r\n/gu, '\n').replace(/\n*$/u, '\n')}`;
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
