/**
 * dist/ に書き出す公開マニフェストの型。
 *
 * build-site.ts が生成し、verify-site.ts が読み直して検証するため、両者で同じ型を共有する。
 */
import type {PackagedWeb} from './build-packaged-web.ts';
import type {BaseSb3Identity, BuilderIdentity} from './story-config.ts';

export interface FileRecord {
  path: string;
  size: number;
  sha256: string;
}

export interface AssetRecord extends FileRecord {
  contentType: string;
}

export interface ProfileRecord {
  profile: string;
  outputName: string;
  scriptMode: string;
  assets: string;
  sb3: FileRecord;
  script: FileRecord;
  builderManifest: {path: string; sha256: string};
}

export interface Dsl4OfflineRecord {
  path: string;
  size: number;
  sha256: string;
  sourceAssetCount: number;
  embeddedFileCount: number;
  runtimeCommit: unknown;
  sb3Toolchain: {package: string; version: string};
}

/** dist/stories/urashima/manifest.json */
export interface SiteManifest {
  formatVersion: number;
  sample: string;
  updatedAt: string;
  publicUrl: string;
  license: string;
  builder: BuilderIdentity;
  baseSb3: BaseSb3Identity & {published: boolean};
  source: {script: FileRecord; dsl4Script: FileRecord; assetManifest: FileRecord};
  script: FileRecord;
  profiles: {editor: ProfileRecord; player: ProfileRecord; [key: string]: ProfileRecord};
  dsl4Offline: Dsl4OfflineRecord;
  dsl4Web: PackagedWeb;
  web: PackagedWeb;
  assetCounts: {images: number; sounds: number; embedded: number};
  unusedSourceAssets: string[];
  assets: AssetRecord[];
}

/** dist/stories/my-urashima/dsl4-manifest.json */
export interface MyUrashimaDsl4Manifest {
  sample: string;
  publicUrl: string;
  web: PackagedWeb;
  output: {path: string; size: number; sha256: string; princessCostumes: string[]};
  [key: string]: unknown;
}

/** 作品カードのボタン表示可否を決める、ビルド時に判明する機能フラグ。 */
export interface SiteFeatures {
  urashimaWeb: boolean;
  urashimaDsl4Web: boolean;
  myUrashimaDsl4Web: boolean;
}

/** renderArtifactSizes に渡す一覧。record が無い成果物は行ごと省略される。 */
export interface ArtifactSizeEntry {
  name: string;
  record?: {size: number} | undefined;
}
