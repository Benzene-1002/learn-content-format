# learn-content-format

**教材パッケージ形式 v1.0 の検証関数。** 学習アプリと変換ツールが同じ判定を使うための共有パッケージ。

```
learn-content-format   ← このリポジトリ(Zod スキーマ + 検証関数)
   ↑                        git の URL + タグで固定して参照する
   ├── portfolio            学習アプリ。取り込み時に検証する
   └── learn-content-tool   変換ツール。出力を出す前に自己検査する
```

**仕様書の正本は `portfolio` の `docs/product/content-format.md`。**
このリポジトリは実装だけを持つ。仕様を変えるときは、あちらの文書が先。

判定を 2 か所で実装すると必ず食い違い、変換ツールは「通った」・学習アプリは「拒否」と言い出す。
それを避けるために切り出している(ADR 0007)。

- 要件と移行の制約: [`docs/requirements.md`](docs/requirements.md)
