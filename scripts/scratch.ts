/**
 * SB3 (Scratch 3) の project.json のうち、このリポジトリのビルド/検証が触る部分の型。
 *
 * Scratch の仕様全体を写したものではないので、未知のフィールドは索引シグネチャで受ける。
 */

export interface ScratchCostume {
  name: string;
  dataFormat: string;
  assetId?: string;
  md5ext?: string;
  [key: string]: unknown;
}

export interface ScratchSound {
  name: string;
  dataFormat?: string;
  assetId?: string;
  md5ext?: string;
  [key: string]: unknown;
}

export interface ScratchBlock {
  opcode: string;
  next?: string | null;
  parent?: string | null;
  /**
   * inputs / fields / mutation は Scratch のブロック定義そのままで、
   * 深くネストした配列やブロック種別ごとに異なる形を取る。
   * 構造を型で写すより実行時 assert で確かめる方が確実なので any で受ける。
   */
  inputs?: Record<string, any>;
  fields?: Record<string, any>;
  mutation?: {proccode?: string; [key: string]: any};
  [key: string]: unknown;
}

/** variables / lists は [表示名, 値] のタプルで表現される。 */
export type ScratchVariable = [name: string, value: unknown];
export type ScratchList = [name: string, values: unknown[]];

export interface ScratchTarget {
  isStage: boolean;
  name: string;
  costumes: ScratchCostume[];
  sounds: ScratchSound[];
  blocks: Record<string, ScratchBlock>;
  variables: Record<string, ScratchVariable>;
  lists: Record<string, ScratchList>;
  currentCostume?: number;
  x?: number;
  y?: number;
  visible?: boolean;
  [key: string]: unknown;
}

export interface ScratchExtensionComponent {
  application?: {mode?: string; [key: string]: unknown};
  source: {displayName: string; sourceId: string; text: string; [key: string]: unknown};
  artifact: {controlProfile: string; [key: string]: unknown};
  assets: {
    manifest: {assets: unknown[]; [key: string]: unknown};
    files: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ScratchProject {
  targets: ScratchTarget[];
  extensionURLs?: Record<string, string>;
  extensionStorage?: Record<
    string,
    {components?: Record<string, ScratchExtensionComponent>; [key: string]: unknown}
  >;
  extensions?: string[];
  monitors?: unknown[];
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}
