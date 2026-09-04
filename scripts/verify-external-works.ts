import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {readWorksCatalog, type WorksCatalog} from './works-catalog.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const acceptedRestrictedStatuses = new Set([401, 403]);

function externalUrls(catalog: WorksCatalog): string[] {
  return [
    ...new Set(
      catalog.works
        .filter(({category}) => category === 'external')
        .flatMap((work) => [work.actions[0]?.href, work.license.href])
        .filter((href): href is string => typeof href === 'string'),
    ),
  ];
}

async function requestUrl(url: string, fetchImpl: FetchLike): Promise<Response> {
  const options = {
    method: 'HEAD',
    redirect: 'follow' as const,
    signal: AbortSignal.timeout(15_000),
    headers: {'user-agent': 'tmpose-kamishibai-works-link-check/1.0'},
  };
  let response = await fetchImpl(url, options);
  if (response.status === 405) {
    response = await fetchImpl(url, {
      ...options,
      method: 'GET',
      headers: {...options.headers, range: 'bytes=0-0'},
    });
  }
  return response;
}

export async function verifyExternalWorkLinks(
  catalog: WorksCatalog,
  fetchImpl: FetchLike = fetch,
): Promise<number> {
  const failures: string[] = [];
  for (const url of externalUrls(catalog)) {
    try {
      const response = await requestUrl(url, fetchImpl);
      if (!response.ok && !acceptedRestrictedStatuses.has(response.status)) {
        failures.push(`${url}: HTTP ${response.status}`);
      }
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.equal(failures.length, 0, `External work links are unavailable:\n${failures.join('\n')}`);
  return externalUrls(catalog).length;
}

async function main() {
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const catalog = await readWorksCatalog(path.join(projectRoot, 'site', 'works.json'));
  const count = await verifyExternalWorkLinks(catalog);
  console.log(
    count === 0
      ? 'No external work links are currently registered.'
      : `Verified ${count} external work links.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
