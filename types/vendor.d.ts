// 依存パッケージ 3 つは型定義を同梱していないため、このリポジトリで使う API 面だけを宣言する。
// 実際のシグネチャは各パッケージの src/ を参照。値の中身は動的な JSON なので unknown 相当に留める。

declare module '@kubohiroya/tmpose-kamishibai/builder' {
  export interface BuildSb3BundleOptions {
    baseSb3: string;
    sourceScript: string;
    assetManifest: string | Record<string, unknown>;
    manifestBaseDirectory?: string;
    outputDirectory: string;
    outputName: string;
    profile: string;
  }

  export interface Sb3OutputDigest {
    filename: string;
    size: number;
    sha256: string;
    [key: string]: unknown;
  }

  export interface Sb3BundleManifest {
    profile: string;
    outputName: string;
    script: {mode: string; [key: string]: unknown};
    outputs: {
      sb3: Sb3OutputDigest;
      script: Sb3OutputDigest;
      manifest: Sb3OutputDigest;
      [key: string]: Sb3OutputDigest;
    };
    [key: string]: unknown;
  }

  export interface Sb3BundleResult {
    manifest: Sb3BundleManifest;
    outputPaths: Record<string, string>;
    [key: string]: unknown;
  }

  export function buildSb3Bundle(options: BuildSb3BundleOptions): Promise<Sb3BundleResult>;
  /** @turbowarp/packager 側と揃えて、値の中身は unknown のまま扱う。 */
  export function validateAssetManifest(rawManifest: unknown): Record<string, unknown>;
  export function validateBundle(bundle: unknown): Record<string, unknown>;
}

declare module '@kubohiroya/sb3-toolchain' {
  export const packageName: string;
  export const packageVersion: string;

  export interface ImportSb3Options {
    inputPath: string;
    outputDirectory: string;
  }

  export interface CreateDeterministicSb3Options {
    allowedAssetRoots?: readonly string[];
    projectAssetsPath?: string;
  }

  export interface DeterministicSb3Result {
    archive: Uint8Array;
    [key: string]: unknown;
  }

  export function importSb3(options: ImportSb3Options): Promise<unknown>;
  export function createDeterministicSb3(
    sourceDirectory: string,
    options?: CreateDeterministicSb3Options,
  ): Promise<DeterministicSb3Result>;
}

