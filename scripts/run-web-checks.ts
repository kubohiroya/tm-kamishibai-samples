import {spawn} from 'node:child_process';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

/**
 * Run the packaged-web browser checks at the same time.
 *
 * The three are independent: each builds its own fixture server on an ephemeral port, drives its
 * own browser, and reads artifacts nobody writes during the run. Chained with `&&` they cost the
 * sum of their runtimes -- the slowest two are 51s and 34s on an M1 Max -- while the machine sits
 * mostly idle waiting for a browser. Run together they cost the longest one.
 *
 * Output is buffered per check and printed when that check finishes, so two browsers logging at
 * once cannot interleave into something unreadable. Every check runs to completion even after one
 * fails: a run that reports only the first failure sends you back for a second full pass to find
 * the next.
 */
const checks = [
  'scripts/verify-packaged-web-browser.ts',
  'scripts/verify-packaged-web-webkit-audio.ts',
  'scripts/verify-dsl4-packaged-web-browser.ts',
] as const;

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

interface CheckResult {
  readonly script: string;
  readonly code: number;
  readonly output: string;
  readonly ms: number;
}

function runCheck(script: string): Promise<CheckResult> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({
        script,
        code: signal ? 1 : (code ?? 1),
        output: Buffer.concat(chunks).toString('utf8'),
        ms: Date.now() - startedAt,
      });
    });
  });
}

const results = await Promise.all(checks.map((script) => runCheck(script)));
for (const result of results) {
  const seconds = (result.ms / 1000).toFixed(1);
  process.stdout.write(`\n--- ${result.script} (${seconds}s, exit ${result.code})\n`);
  process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
}

const failed = results.filter((result) => result.code !== 0);
if (failed.length > 0) {
  process.stdout.write(`\n${failed.length} of ${checks.length} packaged-web checks failed:\n`);
  for (const result of failed) process.stdout.write(`  ${result.script}\n`);
  process.exitCode = 1;
}
