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
  {script: 'scripts/verify-packaged-web-browser.ts', line: 'dsl32'},
  {script: 'scripts/verify-packaged-web-webkit-audio.ts', line: 'dsl32'},
  {script: 'scripts/verify-dsl4-packaged-web-browser.ts', line: 'dsl4'},
] as const;

/**
 * `all` by default, so running this by hand checks everything.
 *
 * The pull-request workflow narrows it to `dsl4` when nothing in the change can reach the DSL 3.2
 * artifacts -- `scripts/web-checks-scope.ts` owns that judgement -- and the scheduled run never
 * narrows it, because the DSL 3.2 Web build is not hermetic and drifts on its own.
 */
const scope = process.env.KAMISHIBAI_WEB_CHECKS ?? 'all';
if (scope !== 'all' && scope !== 'dsl4') {
  throw new Error(`KAMISHIBAI_WEB_CHECKS must be all or dsl4, received: ${scope}`);
}
const selected = checks.filter((check) => scope === 'all' || check.line === 'dsl4');

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

if (scope !== 'all') {
  const skipped = checks.filter((check) => !selected.includes(check)).map(({script}) => script);
  process.stdout.write(`Skipping the DSL 3.2 packaged-web checks: ${skipped.join(', ')}\n`);
  process.stdout.write('Nothing in this change reaches them; the scheduled run covers drift.\n');
}
const results = await Promise.all(selected.map(({script}) => runCheck(script)));
for (const result of results) {
  const seconds = (result.ms / 1000).toFixed(1);
  process.stdout.write(`\n--- ${result.script} (${seconds}s, exit ${result.code})\n`);
  process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
}

const failed = results.filter((result) => result.code !== 0);
if (failed.length > 0) {
  process.stdout.write(`\n${failed.length} of ${selected.length} packaged-web checks failed:\n`);
  for (const result of failed) process.stdout.write(`  ${result.script}\n`);
  process.exitCode = 1;
}
