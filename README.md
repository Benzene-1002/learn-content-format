# learn-content-format

**教材パッケージ形式 v1.0 の検証関数。** 学習アプリと変換ツールが同じ判定を使うための共有パッケージ。

```
learn-content-format   ← このリポジトリ(Zod スキーマ + 検証関数)
   ↑                        git の URL + タグで固定して参照する
   ├── portfolio            学習アプリ。取り込み時に検証する
   └── learn-content-tool   変換ツール。出力を出す前に自己検査する
```

**仕様書の正本は `portfolio` の `docs/product/content-format.md`。**
このリポジトリは実装だけを持つ。仕様を変えるときは、あちらの文書が先で、こちらが追随する。

判定を 2 か所で実装すると必ず食い違い、変換ツールは「通った」・学習アプリは「拒否」と言い出す。
それを避けるために切り出している(ADR 0007)。

このリポジトリは public だが、**公開されるのは形式の検証関数だけ**。
鍵・DB・本人情報・実際の教材・仕様書は入らない。npm レジストリへは公開しない。

---

## 入れる

タグで固定して参照する。ブランチ名では参照しない。

```bash
npm install 'git+https://github.com/Benzene-1002/learn-content-format.git#v1.0.0'
```

`prepare` で `dist` を作るので、利用側にビルドの設定は要らない。
Next.js でも素の Node でも、そのまま import できる。

```js
import { validateContentPackage } from 'learn-content-format';
```

> `--ignore-scripts` を付けると `prepare` が走らず `dist` ができない。
> タグを上げたときは、利用側の lockfile も更新する。

## 使う

入口は **展開済みの対応表**(ファイル名 → 中身)を受け取る純粋関数ひとつ。
DB もファイル I/O もネットワークも持たない。

`entries` の `bytes` は `Uint8Array`。どこから読んだかは問わない(ZIP を展開した結果でも、
変換ツールが組み立てたばかりの中身でもよい)。

```js
import { readFileSync } from 'node:fs';
import { validateContentPackage } from 'learn-content-format';

const read = (name) => ({ name, bytes: new Uint8Array(readFileSync(`out/${name}`)) });

const result = validateContentPackage({
  entries: [
    read('manifest.json'),
    read('exam.json'),
    read('questions.json'),
    read('mock-exams.json'),
    read('textbook.md'),
    read('assets/fig-0301.png'),
  ],
});

if (result.ok) {
  // result.package に、検証を通った中身が入っている
} else {
  for (const issue of result.issues) {
    console.error(`${issue.file}: [${issue.code}] ${issue.message}`);
  }
}
```

**ZIP を開く段はここには無い。** 圧縮率・目録の申告値・同名エントリ・シンボリックリンクは
対応表になった時点で失われるので、判定できるのは ZIP を開く側だけ。その責任は取り込む側
(portfolio)が持つ(`content-format.md` §0.1)。`ContentIssueStage` の `'extract'` と
`extract.*` のコードは、その側が理由を組み立てるためにここが型として提供している。

### 公開 API

`src/index.ts` が 7 つのモジュールの export をすべて再輸出する。深い import は要らない。

| モジュール | 主なもの |
| --- | --- |
| `validate` | `validateContentPackage` / `ValidationResult` / `ExtractedPackage` / `ExtractedEntry` / `ValidatedPackage` |
| `issues` | `ContentIssue` / `ContentIssueCode` / `ContentIssueStage` / `contentIssue` |
| `limits` | `CONTENT_LIMITS` / `ID_PATTERN` / `ID_MAX_LENGTH` / `isValidId` / `classifyEntryName` / `IMAGE_MIME` / `PACKAGE_FILES` / `REQUIRED_PACKAGE_FILES` / `ASSETS_DIR` / `CONTROL_CHARACTERS` / `isValidAssetFileName` / `imageKindFromFileName` / `imageKindFromBytes` |
| `schema` | `manifestSchema` / `examSchema` / `questionSchema` / `mockQuestionSchema` / `questionsFileSchema` / `mockExamsFileSchema` / `Question` / `MockQuestion` / `Manifest` / `Exam` / `isGradable` / `SUPPORTED_FORMAT_VERSION` / `isSupportedFormatVersion` / `toContentIssues` |
| `markdown` | `scanMarkdown` / `classifyUrl` / `MarkdownScan` |
| `textbook` | `parseTextbook` / `Textbook` / `TextbookHeading` |
| `textbook-split` | `splitTextbook` / `TextbookNode` |

変換ツールは、**出力を組み立てる時点で** `CONTENT_LIMITS` と `ID_PATTERN` と Zod スキーマを
参照する。検証で弾かれてから直すのでは遅いため。

### fixtures

正常系の教材パッケージ 1 式を、実ファイルとして同梱する。

```
node_modules/learn-content-format/fixtures/valid/
```

---

## 開発

```bash
npm install     # prepare で dist まで作る
npm test        # vitest
npm run check   # typecheck → test → build
```

- 要件と移行の制約: [`docs/requirements.md`](docs/requirements.md)
- タグは形式のバージョンに追随する。形式 v1.0 に対応する実装は `v1.0.x`
