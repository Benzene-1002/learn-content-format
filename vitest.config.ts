import { defineConfig } from 'vitest/config';

/**
 * 純粋関数だけのパッケージなので、環境は `node` 1 つで足りる。
 * fixtures は実ファイルとしてリポジトリ直下に置き、テストはそこを読む。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
