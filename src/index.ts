/**
 * 教材パッケージ形式 v1.0 の検証関数。ここが唯一の公開入口。
 *
 * 仕様書の正本は portfolio の `docs/product/content-format.md`。このパッケージは
 * その判定の実装だけを持つ。仕様を変えるときは、あちらの文書が先。
 *
 * 利用者は 2 つ。
 * - portfolio(学習アプリ): ZIP を開いたあとの対応表を `validateContentPackage` に渡す
 * - learn-content-tool(変換ツール): 出力を出す前に自己検査する。上限値・ID 規則・
 *   Zod スキーマは**出力を組み立てる時点で**参照する
 *
 * ZIP を開く段(`content-format.md` §0.1 の展開段)はここには無い。圧縮率も同名エントリも
 * 対応表になった時点で失われるため、取り込む側(portfolio)の責任として残している。
 *
 * 各モジュールの export は**すべて**ここから見える。取りこぼすと、利用側が
 * 深い import に手を伸ばして公開範囲が曖昧になるため。
 */

// 拒否理由の型(段階とコード)
export * from './issues.js';
// 上限値・ID 規則・画像の MIME・エントリ名の分類
export * from './limits.js';
// 教科書 Markdown の記法検査
export * from './markdown.js';
// Zod スキーマ(manifest / exam / questions / mock-exams)
export * from './schema.js';
// 見出しの階層と ID
export * from './textbook.js';
// 項への分割
export * from './textbook-split.js';
// ファイルをまたぐ条件と、検証の入口
export * from './validate.js';
