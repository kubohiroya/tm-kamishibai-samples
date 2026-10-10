/**
 * extensions.turbowarp.org の拡張機能を、リポジトリへ固定した複製から読み込む。
 *
 * TurboWarp Packager は bakeExtensions のとき http(s) の拡張機能 URL を build 時に取得して
 * HTML へ埋め込む。取得先は版を固定できず、上流の自動翻訳更新だけで生成 HTML が変わる。
 * 取得に失敗した場合も警告だけで URL のまま残すため、オフラインの build が黙って
 * 実行時取得の HTML になる。ここでは Packager へ渡す前に、固定した複製を Packager と同じ形の
 * data URL へ変換し、Packager にネットワーク取得をさせない。
 *
 *   node scripts/turbowarp-extensions.ts --update   # 上流から取り直して複製と lock を更新する
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const vendoredExtensionsDirectory = path.join(projectRoot, 'resources/turbowarp-extensions');
export const vendoredExtensionsLockPath = path.join(vendoredExtensionsDirectory, 'lock.json');

const allowedOrigin = 'https://extensions.turbowarp.org';

export interface VendoredExtension {
  url: string;
  path: string;
  size: number;
  sha256: string;
  license: string;
}

export interface VendoredExtensionsLock {
  formatVersion: 1;
  origin: string;
  fetchedAt: string;
  extensions: VendoredExtension[];
}

function sha256(contents: Uint8Array | string): string {
  return createHash('sha256').update(contents).digest('hex');
}

function isNetworkUrl(url: string): boolean {
  try {
    const {protocol} = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** 拡張機能 URL から、複製を置く lock 基準の相対 path を決める。 */
export function vendoredPathForUrl(url: string): string {
  const parsed = new URL(url);
  assert.equal(parsed.origin, allowedOrigin, `Unsupported extension origin: ${url}`);
  assert.equal(parsed.search, '', `Extension URL must not have a query: ${url}`);
  assert.equal(parsed.hash, '', `Extension URL must not have a fragment: ${url}`);
  const relative = decodeURIComponent(parsed.pathname).replace(/^\/+/u, '');
  assert.match(relative, /^[\w.\-/]+\.js$/u, `Unsupported extension path: ${url}`);
  assert(!relative.split('/').includes('..'), `Unsafe extension path: ${url}`);
  return `${parsed.host}/${relative}`;
}

/** 拡張機能の先頭コメントにある `// License:` 行を読む。 */
export function readLicenseHeader(source: string): string {
  const license = /^\/\/ License: (.+)$/mu.exec(source.slice(0, 2048))?.[1]?.trim();
  assert(license, 'Vendored extension must declare its license in the header.');
  return license;
}

export async function readVendoredExtensionsLock(): Promise<VendoredExtensionsLock> {
  const lock = JSON.parse(
    await readFile(vendoredExtensionsLockPath, 'utf8'),
  ) as VendoredExtensionsLock;
  assert.equal(lock.formatVersion, 1, 'Unsupported vendored extensions lock format.');
  assert.equal(lock.origin, allowedOrigin, 'Unexpected vendored extensions origin.');
  return lock;
}

/** lock と一致することを確かめてから、固定した拡張機能の本文を返す。 */
export async function readVendoredExtension(
  lock: VendoredExtensionsLock,
  url: string,
): Promise<string> {
  const entry = lock.extensions.find((candidate) => candidate.url === url);
  assert(
    entry,
    `Extension ${url} is not vendored. Run node scripts/turbowarp-extensions.ts --update.`,
  );
  assert.equal(entry.path, vendoredPathForUrl(url), `Vendored path mismatch for ${url}.`);
  const contents = await readFile(path.join(vendoredExtensionsDirectory, entry.path));
  assert.equal(contents.length, entry.size, `Vendored extension size mismatch for ${url}.`);
  assert.equal(sha256(contents), entry.sha256, `Vendored extension SHA-256 mismatch for ${url}.`);
  return contents.toString('utf8');
}

/** Packager 3.13.0 の generateExtensionURLs が bake するときと同じ data URL を作る。 */
export function bakedExtensionDataUrl(source: string): string {
  return `data:text/javascript;,${encodeURIComponent(`(function(Scratch) { ${source} })(Scratch);`)}`;
}

/**
 * Packager へ渡す拡張機能 URL を、ネットワーク取得なしで bake 済みの並びへ変える。
 * Packager と同じく、data URL などの非ネットワーク URL を先に、bake した URL を後に並べる。
 */
export async function bakeVendoredExtensionUrls(
  urls: readonly string[],
  lock?: VendoredExtensionsLock,
): Promise<string[]> {
  const networkUrls = urls.filter(isNetworkUrl);
  if (networkUrls.length === 0) return [...urls];
  const resolvedLock = lock ?? (await readVendoredExtensionsLock());
  const baked = await Promise.all(
    networkUrls.map(async (url) =>
      bakedExtensionDataUrl(await readVendoredExtension(resolvedLock, url)),
    ),
  );
  return [...urls.filter((url) => !isNetworkUrl(url)), ...baked];
}

/** lock の拡張機能を上流から取り直し、複製と lock を更新する。 */
export async function updateVendoredExtensions(
  fetchImplementation: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<VendoredExtensionsLock> {
  const previous = await readVendoredExtensionsLock();
  const extensions: VendoredExtension[] = [];
  for (const {url} of previous.extensions) {
    const response = await fetchImplementation(url, {redirect: 'error'});
    assert(response.ok, `Cannot download ${url}: HTTP ${response.status}`);
    const contents = Buffer.from(await response.arrayBuffer());
    const relative = vendoredPathForUrl(url);
    const destination = path.join(vendoredExtensionsDirectory, relative);
    await mkdir(path.dirname(destination), {recursive: true});
    await writeFile(`${destination}.tmp`, contents);
    await rename(`${destination}.tmp`, destination);
    extensions.push({
      url,
      path: relative,
      size: contents.length,
      sha256: sha256(contents),
      license: readLicenseHeader(contents.toString('utf8')),
    });
  }
  const lock: VendoredExtensionsLock = {
    formatVersion: 1,
    origin: allowedOrigin,
    fetchedAt: now.toISOString().slice(0, 10),
    extensions,
  };
  await writeFile(vendoredExtensionsLockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--update')) {
    const lock = await updateVendoredExtensions();
    process.stdout.write(
      `Updated ${lock.extensions.length} vendored TurboWarp extension(s) (${lock.fetchedAt}).\n`,
    );
  } else {
    const lock = await readVendoredExtensionsLock();
    for (const {url} of lock.extensions) await readVendoredExtension(lock, url);
    process.stdout.write(`Verified ${lock.extensions.length} vendored TurboWarp extension(s).\n`);
  }
}
