/** DSL 4.0 の台本・ロックファイルの共有型。 */

export interface Dsl4Asset {
  file?: string;
  delivery?: string;
  source?: string;
  [key: string]: unknown;
}

export interface Dsl4Story {
  assets?: Record<string, Dsl4Asset>;
  scenes?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Dsl4SourceDigest {
  path: string;
  size: number;
  sha256: string;
  assetCount: number;
  remoteAssetCount: number;
}

export interface Dsl4OutputDigest {
  path: string;
  size: number;
  sha256: string;
  archiveEntryCount: number;
  targetNames: string[];
}

/** stories/*\/dsl4-artifacts.lock.json */
export interface Dsl4ArtifactLock {
  formatVersion: number;
  runtime: Record<string, unknown>;
  sb3Toolchain: {package: string; version: string};
  source: Dsl4SourceDigest;
  output: Dsl4OutputDigest;
  [key: string]: unknown;
}

export interface Dsl4ArchiveAssetRecord {
  name: string;
  source: string;
  entry: string;
  output: string;
  size: number;
  sha256: string;
}

export interface Dsl4PoseModelFile {
  path: string;
  size: number;
  sha256: string;
}

export interface Dsl4PoseModelRecord {
  name: string;
  source: string;
  output: string;
  files: Dsl4PoseModelFile[];
}

/** stories/urashima/dsl4-inputs.lock.json */
export interface Dsl4InputsLock {
  formatVersion: number;
  archiveAssets: Dsl4ArchiveAssetRecord[];
  poseModels: Dsl4PoseModelRecord[];
  [key: string]: unknown;
}

export interface MaterializedInput {
  path: string;
  written: boolean;
}
