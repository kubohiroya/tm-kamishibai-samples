import {defineConfig} from 'vitest/config';

// このリポジトリはブラウザ向けバンドルを持たないため、Vite はテスト設定のホストとして使う。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // sb3 のビルドやパッケージングを伴うテストがあるため、既定より長めに取る。
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
