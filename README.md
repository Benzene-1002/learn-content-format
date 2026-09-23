# learn-content-format

**教材パッケージ形式 v2.0 の検証関数。** 学習アプリと変換ツールが同じ判定を使うための共有パッケージ。

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
npm install 'git+https://github.com/Benzene-1002/learn-content-format.git#v2.0.0'
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
| `schema` | `manifestSchema` / `examSchema` / `Part` / `questionSchema` / `mockQuestionSchema` / `questionsFileSchema` / `mockExamsFileSchema` / `Question` / `MockQuestion` / `Manifest` / `Exam` / `isGradable` / `SUPPORTED_FORMAT_VERSION` / `isSupportedFormatVersion` / `toContentIssues` |
| `markdown` | `scanMarkdown` / `classifyUrl` / `MarkdownScan` |
| `textbook` | `parseTextbook` / `Textbook` / `TextbookHeading` |
| `textbook-split` | `splitTextbook` / `TextbookNode` |

変換ツールは、**出力を組み立てる時点で** `CONTENT_LIMITS` と `ID_PATTERN` と Zod スキーマを
参照する。検証で弾かれてから直すのでは遅いため。

### fixtures

正常系の教材パッケージを 2 式、実ファイルとして同梱する。どちらも 1 つのディレクトリが
そのまま 1 つのパッケージで、中にあるものをすべてエントリとして読めばよい。

| 置き場所 | 中身 |
| --- | --- |
| `node_modules/learn-content-format/fixtures/valid/` | 区分 1 つ(ID `main`・名前「本試験」)。模試 1 本 |
| `node_modules/learn-content-format/fixtures/valid-two-parts/` | 区分 2 つ(`a` 科目A・`b` 科目B)。区分ごとに模試 1 本。`part` を書いた問題と書かない問題の両方を含む |

## v1.0.0 からの変更(v2.0.0)

形式 v2.0(`content-format.md` §9、ADR 0012)に追随した。**メジャーが上がったので、
利用側は取り込み・模試・型を合わせて直す必要がある。**

- **受理する版はメジャー 2 だけ。** `formatVersion: "1.x"` は `syntax.format_version_unsupported`
  で拒否する。v1.x を v2 に読み替えて受理する経路は無い
- `exam.json` の `realExam` が無くなり、`parts`(区分。1〜10 個)が必須になった。
  型では `Exam['realExam']` が消え、`Exam['parts']`(要素は `Part`)が入った。
  `realExam` を書いても未知のフィールドとして落ち、`parts` が無ければ拒否する
- `mockExams[].part` が必須になった。各模試の問題数は、その区分の `questionCount` と照らす
- `questions[].part` を書けるようになった(任意・単数。書かなければ全区分に共通)。
  模試の問題に `part` を書くと拒否する
- 違反コード `consistency.part_not_found` を足した(区分の参照が `parts` に無い。§6 の条件 5)。
  `parts` の欠落・空・11 個以上・区分 ID の重複、`mockExams[].part` の欠落、模試の問題の `part` は、
  いずれも `schema.invalid` として場所つきで返す
- `CONTENT_LIMITS.partCount`(10)を足した
- fixtures: `valid` を v2.0(区分 1 つ)に書き換え、`valid-two-parts` を足した

---

## 開発

```bash
npm install     # prepare で dist まで作る
npm test        # vitest
npm run check   # typecheck → test → build
```

- 要件と移行の制約: [`docs/requirements.md`](docs/requirements.md)
- タグは形式のバージョンに追随する。形式 v2.0 に対応する実装は `v2.0.x`。受理するメジャーは 1 つだけ
