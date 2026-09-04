/**
 * stories/*\/ 配下の設定ファイルとロックファイルの共有型。
 *
 * これらは JSON から読み込む動的な値だが、リポジトリ内で形が安定しているため
 * インターフェースとして固定し、ビルド/検証スクリプト間で共有する。
 * 将来フィールドが増えても壊れないよう、各インターフェースは索引シグネチャを持つ。
 */

export interface JsonRecord {
  [key: string]: unknown;
}

export interface PackagerOptionsConfig {
  target: string;
  autoplay: boolean;
  app: {windowTitle: string; [key: string]: unknown};
  cloudVariables: {mode: string; [key: string]: unknown};
  [key: string]: unknown;
}

export interface PackagerConfig {
  package: string;
  version: string;
  options: PackagerOptionsConfig;
}

export interface AudioUnlockConfig {
  enabled: boolean;
}

export interface OnlineDependency {
  urlPrefix: string;
  purpose: string;
}

export interface RuntimeCapability {
  capability: string;
  purpose: string;
}

/** sample.config.json / dsl4-build.config.json の `web` セクション。 */
export interface WebConfig {
  enabled: boolean;
  inputProfile: string;
  outputDirectory: string;
  outputFilename: string;
  maxOutputBytes: number;
  scriptMode: string;
  assets: string;
  audioUnlock: AudioUnlockConfig;
  packager: PackagerConfig;
  allowedOnlineDependencies: OnlineDependency[];
  runtimeCapabilities: RuntimeCapability[];
  [key: string]: unknown;
}

export interface BuilderIdentity {
  package: string;
  version: string;
  source?: string;
  commit: string;
  [key: string]: unknown;
}

export interface BaseSb3Identity {
  path: string;
  profile: string;
  source: string;
  commit: string;
  size: number;
  sha256: string;
  [key: string]: unknown;
}

export interface StoryProfileConfig {
  outputName: string;
  script: string;
  assets: string;
  [key: string]: unknown;
}

/** stories/urashima/sample.config.json */
export interface StoryConfig {
  formatVersion: number;
  sample: string;
  builder: BuilderIdentity;
  baseSb3: BaseSb3Identity;
  sourceScript: string;
  assetManifest: string;
  artifactsLock: string;
  profiles: Record<string, StoryProfileConfig>;
  web: WebConfig;
  [key: string]: unknown;
}

export interface ScriptReplacement {
  description: string;
  from: string;
  to: string;
}

/** stories/my-urashima/sample.config.json */
export interface DerivedStoryConfig {
  formatVersion: number;
  sample: string;
  parentStory: {name: string; config: string};
  profile: StoryProfileConfig;
  projectAssets: {manifest: string; allowedRoots: string[]};
  scriptReplacements: ScriptReplacement[];
  artifactsLock: string;
  [key: string]: unknown;
}

export interface Dsl4Limits {
  maxSourceBytes: number;
  maxAssetFileBytes: number;
  maxAssetFiles: number;
  maxTotalAssetBytes: number;
}

export interface Dsl4RuntimeConfig {
  /** 派生ストーリーは親の設定ファイルを参照するだけで、実体は持たない。 */
  config?: string;
  repository?: string;
  version?: string;
  commit?: string;
  basePath?: string;
  baseSourceIdentity?: string;
  baseSize?: number;
  baseSha256?: string;
  [key: string]: unknown;
}

/** stories/*\/dsl4-build.config.json */
export interface Dsl4BuildConfig {
  formatVersion: number;
  status?: string;
  version?: string;
  releaseDependency?: string;
  runtime: Dsl4RuntimeConfig;
  source?: string;
  starterSource?: string;
  sourceManifest?: string;
  starterManifest?: string;
  projectAssets: string;
  output: string;
  artifactsLock?: string;
  publicSurfaces?: string;
  webArtifactsLock: string;
  archives?: Record<string, string>;
  limits?: Dsl4Limits;
  publication?: {enabled: boolean; reason: string; issue: string};
  web: WebConfig;
  work?: JsonRecord;
  [key: string]: unknown;
}

export interface ProjectAssetSpecification {
  kind: string;
  file: string;
  target?: string;
  name?: string;
  license?: string;
  [key: string]: unknown;
}

/** project-assets*.yml */
export interface ProjectAssetsManifest {
  formatVersion: number;
  assets: Record<string, ProjectAssetSpecification>;
  [key: string]: unknown;
}

export interface AssetManifestEntry {
  name: string;
  uri: string;
  [key: string]: unknown;
}

/** assets.lock.json */
export interface AssetManifest {
  assets: AssetManifestEntry[];
  [key: string]: unknown;
}

export interface DependencyRecord {
  path: string;
  size: number;
  sha256: string;
}

export interface ArtifactDigest {
  filename?: string;
  size: number;
  sha256: string;
  [key: string]: unknown;
}

export interface StoryDateLock {
  value: string;
  contentSha256: string;
}

/** artifacts.lock.json の profiles 配下 1 件。 */
export interface ProfileLock {
  outputName: string;
  sb3: {size: number; sha256: string};
  script: {size: number; sha256: string};
  manifest: {sha256: string};
}

export interface ArtifactsLock {
  formatVersion: number;
  builder?: Partial<BuilderIdentity>;
  storyDate?: StoryDateLock;
  profiles?: Record<string, ProfileLock>;
  /** 派生ストーリー (my-urashima) の単一成果物。 */
  output?: {outputName: string; [artifact: string]: ArtifactDigest | string};
  outputs?: Record<string, ArtifactDigest>;
  web?: {input?: unknown; output?: unknown; [key: string]: unknown};
  [key: string]: unknown;
}
