/**
 * TurboWarp Packager が生成した HTML ページに現れるブラウザ側グローバル。
 *
 * これらは Playwright の page.evaluate() の中だけで使う。実体は scratch-vm /
 * scratch-render の実行時オブジェクトで、公式の型定義が存在せず API 面も広い。
 * VM 全体の型をこのリポジトリで再現するのは保守コストに見合わないため、
 * 「型のない外部ランタイムとの境界」として、検証コードが実際に辿る経路だけを
 * 名前付きにし、その先は any で受けている。ページ側の不変条件は実行時 assert が担保する。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ScratchRuntimeLike {
  /**
   * target / costume / drawable は scratch-vm の内部オブジェクトで、
   * 形が VM のバージョンに追随して変わる。ページ側の検証は実行時 assert に任せ、
   * ここでは any 配列として受ける（コールバック引数の暗黙 any も避けられる）。
   */
  targets: any[];
  renderer: any;
  audioEngine: any;
  stageWidth: number;
  stageHeight: number;
  getTargetForStage(): any;
  emit(event: string, ...args: any[]): void;
  startHats(name: string, matchFields?: any, target?: any): any;
  [key: string]: any;
}

interface TmposeScaffolding {
  vm: {runtime: ScratchRuntimeLike; [key: string]: any};
  [key: string]: any;
}

/** build-packaged-web.ts が埋め込む音声アンロックスクリプトの観測用ステート。 */
interface TmposeAudioUnlockState {
  installed: boolean;
  attempts: number;
  primeAttempts: number;
  primeCompletions: number;
  verifications: number;
  ignoredEvents: number;
  lifecycleEvents: number;
  completed: boolean;
  clockAdvanced: boolean;
  hasActivated: boolean;
  listenersInstalled: boolean;
  unlocking: boolean;
  lastClockDelta: number;
  lastError?: string;
  lastPrimeError?: string;
  lastEvent?: string;
  lastPointerType?: string;
  lastLifecycleEvent?: string;
  lastContextState?: string;
  [key: string]: unknown;
}

/** page.evaluate / addInitScript が globalThis 経由で触るグローバル。 */
declare var scaffolding: TmposeScaffolding;
declare var Scratch:
  | {vm: {runtime: ScratchRuntimeLike; [key: string]: any}; [key: string]: any}
  | undefined;
declare var __tmposeFilePickerCalls: any[];

interface Window {
  /** パッケージ済みページの読み込み後に必ず存在する。 */
  scaffolding: TmposeScaffolding;
  __tmposeAudioUnlockState: TmposeAudioUnlockState;
  /** 検証スクリプトがページ側に仕掛ける観測用フック。 */
  __tmposeSvgTextSkins?: any;
  __tmposeLoadingBackdropSamples?: any;
  __tmposeLoadingBackdropTimer?: any;
  __tmposeWhiteTransitionSamples?: any;
  __tmposeWhiteTransitionTimer?: any;
  __tmposeTitleUiDrawableIds?: any;
  __tmposeTitleUiTargetIds?: any;
  __tmposeUnexpectedFilePicker?: any;
  showOpenFilePicker?: any;
}
