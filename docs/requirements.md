# learn-content-format 要件定義

作成日: 2026-09-22
関連: `portfolio` リポジトリの `docs/product/content-format.md`(**契約書の正本**)、ADR 0007

---

## 1. これは何か

**教材パッケージ形式(現行は v2.0)の検証関数を、2 つのプロダクトから使うための共有パッケージ。**

```
learn-content-format   ← このリポジトリ(Zod スキーマ + 検証関数)
   ↑                        git の URL + タグで固定して参照する
   ├── portfolio            学習アプリ。取り込み時に検証する
   └── learn-content-tool   変換ツール。出力を出す前に自己検査する
```

### なぜ切り出すのか

ADR 0007 が 2 つのプロダクトを「形式」だけで接続すると決めた。その形式の**判定を 2 か所で実装すると、
必ず食い違う**。食い違ったとき、変換ツールは「通った」と言い、学習アプリは「拒否」と言う。
原因の切り分けに時間を取られ、しかもどちらが正しいか分からない。

**判定はひとつだけ存在する**という状態を作るために切り出す。

### なぜ npm に公開しないのか

利用者が 2 つとも本人のものだから。git の URL を**タグで固定**して参照すれば足りる。
公開の手間とリリース作業を増やす理由がない。

### なぜ **リポジトリ自体は public** にするのか

利用側(portfolio / 変換ツール)の CI や本番ビルドが取りに行けるようにするため。private のままだと
参照ごとにトークンが要り、その置き場と失効の面倒を抱え込む。参照は `git+https://` にする。

公開されるのは**形式の検証関数だけ**。鍵・DB・本人情報・実際の教材・仕様書はこのリポジトリに入れない。
npm レジストリへは公開しない(`package.json` の `private: true` で事故を止める)。

---

## 2. 中身(portfolio から移してくるもの)

`portfolio` の `src/features/learn/content/` がそのまま移動対象になる。**実装 約 1,800 行 + テスト**。

| ファイル | 役割 |
| --- | --- |
| `limits.ts` | 上限値、ID 規則、画像の MIME、エントリ名の分類 |
| `schema.ts` | Zod スキーマ(manifest / exam / questions / mock-exams) |
| `markdown.ts` | 教科書 Markdown の記法検査(許可する記法、危険な URL) |
| `textbook.ts` / `textbook-split.ts` | 見出しの階層と ID、項への分割 |
| `validate.ts` | ファイルをまたぐ条件(§6)と、展開済みの対応表を受け取る検証の入口 |
| `issues.ts` | 拒否理由の型(段階とコード) |
| `fixtures/valid/` / `fixtures/valid-two-parts/` | 正常系の教材パッケージ(区分 1 つ / 区分 2 つ。図 1 枚を含む) |

`extract.ts`(ZIP を開く段)は移さず、portfolio の `src/features/learn/import/extract.ts` に残した
(下の「移すときの制約」)。

### 移すときの制約

- **純粋関数のまま保つ。** DB・ファイル I/O・ネットワークを持ち込まない。入力は
  「ファイル名 → 中身」の対応表(`Map<string, Uint8Array>` 相当)
- **`server-only` に依存しない。** Next.js 専用の目印で、変換ツール(Next.js ではない)では
  読み込めない。移送元は p20 の時点で「純粋関数の世界に閉じるので付けない」と決めており、
  どこも import していなかったので、外す作業は要らなかった(ADR 0011)
- 依存は `zod` だけ。バージョンは portfolio と揃える(固定版。`^` を付けない)
- ZIP を開く処理は**含めない**。ZIP の目録や重複エントリの判定は展開する側の責任
  (`content-format.md` §0.1 の「展開段」)

---

## 3. 公開する API

現在 portfolio の内部で export されているものを、そのままパッケージの公開 API にする。
**入口は `extractContentPackage(archive)` ではなく、展開済みの対応表を受け取る関数**にする
(ZIP を開く責任を持たないため)。`validate.ts` の `validateContentPackage` がこの入口。

最低限、次が外から使えること。

- 検証の入口(対応表 → 検証結果)
- 拒否理由の型(`ContentIssue` と段階・コード)
- 上限値と ID 規則の定数(`CONTENT_LIMITS` / `ID_PATTERN` など。変換ツールが**出力を作る時点で**参照する)
- Zod スキーマ(変換ツールが組み立てた JSON を型で受けられるように)

---

## 4. バージョン規則

- **タグは形式のバージョンに追随させる。** 形式 v2.0 に対応する実装は `v2.0.x`(v1.0 は `v1.0.x`)
- **受理する形式のメジャーは 1 つだけ。** 古いメジャーを読み替えて受理する経路は持たない
  (`content-format.md` §1.3、ADR 0012 決定 4)
- 形式が変わらない修正(バグ・内部整理)はパッチを上げる
- 利用側は**タグで固定**して参照する。ブランチ名で参照しない
  (`git+https://github.com/Benzene-1002/learn-content-format.git#v2.0.0`)
- `content-format.md` は **portfolio に残る**。このリポジトリは実装だけを持つ。
  仕様を変えるときは **portfolio 側の文書が先**で、こちらが追随する

---

## 5. 受入条件

1. `npm test` が通る(portfolio から移したテストがすべて通ること)
2. **portfolio がこのパッケージを参照するように切り替えても、portfolio の全テストが通る**
   (この確認は portfolio 側のタスクで行う)
3. Next.js を使わない素の Node から import して動く(`server-only` に依存していないこと)
4. `README.md` に、2 つの利用者と「仕様書の正本は portfolio 側」であることが書いてある

---

## 6. やらないこと

- npm レジストリへの公開
- ZIP の展開
- 教材の保存・配信(学習アプリの責任)
- 教材の生成(変換ツールの責任)
