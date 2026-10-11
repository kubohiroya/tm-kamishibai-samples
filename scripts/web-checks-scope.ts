import process from 'node:process';
import {fileURLToPath} from 'node:url';

/**
 * Decide which packaged-web checks a change needs.
 *
 * The two DSL 3.2 checks cost 85 of the 105 seconds the three take, and they re-play an artifact
 * whose bytes are pinned in `stories/urashima/artifacts.lock.json`: `pnpm build` already refuses a
 * packaged HTML that does not hash to the locked value, so a change that cannot reach that artifact
 * cannot change what those two checks see.
 *
 * "Cannot reach" is the whole question, so the list below is deliberately wide: the 3.2 inputs, the
 * scripts that build or drive them, and the manifests that pin the packager and the browsers. A
 * missing entry here means a change ships without the check that covers it, so prefer running them.
 *
 * Upstream drift is the one thing this cannot see -- the DSL 3.2 Web build is not hermetic, since
 * the packager pulls TurboWarp extensions at build time -- and that is what the scheduled run is
 * for. It skips nothing.
 */
const dsl32Triggers: readonly RegExp[] = [
  // The DSL 3.2 story and its pinned inputs and outputs. The 4.0 files in the same directory carry
  // `dsl4` or `4.0` in their name, and the shared assets belong to both lines.
  /^stories\/urashima\/(?!.*(?:dsl4|-4\.0|4\.0\.sb3))/u,
  /^stories\/my-urashima\/(?!.*(?:dsl4|-4\.0|4\.0\.sb3))/u,
  // Everything that builds, packages, serves or drives the 3.2 artifacts.
  /^scripts\/build-site\.ts$/u,
  /^scripts\/build-packaged-web\.ts$/u,
  /^scripts\/build-my-urashima\.ts$/u,
  /^scripts\/refresh-story-artifacts\.ts$/u,
  /^scripts\/story-config\.ts$/u,
  /^scripts\/verify-site\.ts$/u,
  /^scripts\/verify-packaged-web-/u,
  /^scripts\/run-web-checks\.ts$/u,
  /^scripts\/web-checks-scope\.ts$/u,
  /^scripts\/turbowarp-extensions\.ts$/u,
  /^turbowarp-extensions\.lock\.json$/u,
  // The packager, the toolchain and the browsers are pinned here.
  /^package\.json$/u,
  /^pnpm-lock\.yaml$/u,
  // The workflows decide what runs at all.
  /^\.github\//u,
];

export type WebCheckScope = 'all' | 'dsl4';

export function webCheckScope(changedPaths: readonly string[]): WebCheckScope {
  if (changedPaths.length === 0) return 'all';
  return changedPaths.some((candidate) => dsl32Triggers.some((pattern) => pattern.test(candidate)))
    ? 'all'
    : 'dsl4';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = await new Promise<string>((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
    });
    process.stdin.once('end', () => resolve(text));
    process.stdin.once('error', reject);
  });
  const paths = input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  process.stdout.write(`${webCheckScope(paths)}\n`);
}
