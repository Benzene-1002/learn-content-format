/**
 * 教材パッケージの検証で見つかった違反(`docs/product/content-format.md` §1.6)。
 *
 * 契約を満たさないパッケージは**拒否**する(要件 §5.8 A)。警告にはしない。
 * 1 件目で止めず、同じ段の違反をすべて集めて返すため、例外ではなく値として扱う。
 *
 * 純粋関数の世界に閉じる。DB もファイル I/O も持たないので `server-only` は付けない。
 */

/**
 * 検証の段(`content-format.md` §1.6)。
 *
 * 展開段(`extract`)は ZIP を開く側(p21)の担当。展開後の対応表からは圧縮率も
 * 同名エントリも見えないので、この段を判定できるのは `content/extract.ts` だけで、
 * 純粋関数の検証(`validate.ts`)が扱うのは `package` 以降になる。
 */
export type ContentIssueStage = 'extract' | 'package' | 'syntax' | 'schema' | 'consistency';

/** 違反の識別子。機械可読で、文言を変えても壊れないようにする。 */
export type ContentIssueCode =
  // extract 段(p21。ZIP を開くときにしか分からないこと)
  | 'extract.not_a_zip'
  | 'extract.unsupported'
  | 'extract.limit_exceeded'
  | 'extract.entry_duplicated'
  | 'extract.entry_symlink'
  | 'extract.size_mismatch'
  | 'extract.corrupt'
  // package 段
  | 'package.entry_unexpected'
  | 'package.entry_missing'
  | 'package.path_unsafe'
  | 'package.asset_name_invalid'
  | 'package.asset_extension_unsupported'
  | 'package.asset_content_mismatch'
  | 'package.asset_unreferenced'
  | 'package.limit_exceeded'
  // syntax 段
  | 'syntax.json_unparsable'
  | 'syntax.encoding_invalid'
  | 'syntax.format_version_unsupported'
  | 'syntax.markdown_html_forbidden'
  | 'syntax.markdown_notation_forbidden'
  | 'syntax.markdown_url_forbidden'
  | 'syntax.markdown_image_alt_missing'
  | 'syntax.heading_id_missing'
  | 'syntax.heading_id_invalid'
  | 'syntax.heading_id_duplicated'
  | 'syntax.heading_level_invalid'
  | 'syntax.heading_level_skipped'
  | 'syntax.heading_missing'
  | 'syntax.body_before_first_heading'
  // schema 段
  | 'schema.invalid'
  // consistency 段
  | 'consistency.source_not_found'
  | 'consistency.source_not_subsection'
  | 'consistency.source_single_question'
  | 'consistency.section_without_gradable_question'
  | 'consistency.question_id_duplicated'
  | 'consistency.anchor_not_found'
  | 'consistency.image_not_found'
  | 'consistency.mock_question_count_mismatch'
  | 'consistency.part_not_found';

/**
 * 違反 1 件。
 *
 * 「どう直すか」が分かる粒度で `message` を書く。変換ツール(別プロダクト。ADR 0007)を
 * 作る人が、この 1 件だけを見て直せることを狙う。
 */
export type ContentIssue = {
  readonly code: ContentIssueCode;
  readonly stage: ContentIssueStage;
  /** パッケージ内のファイル名(`textbook.md` など)。パッケージ全体に関わるものは `package`。 */
  readonly file: string;
  /** 1 始まりの行番号。Markdown で位置が特定できたときだけ持つ。 */
  readonly line?: number;
  /** JSON の位置(`questions[3].options[1]` のような形)。 */
  readonly path?: string;
  /** 対象の ID(問題 ID・見出し ID など)。 */
  readonly id?: string;
  /** 何がどう満たされていないか。日本語で書く。 */
  readonly message: string;
};

/** 違反を組み立てる。省略したい位置情報を `undefined` のまま持たせないための薄い包み。 */
export function contentIssue(issue: {
  code: ContentIssueCode;
  stage: ContentIssueStage;
  file: string;
  message: string;
  line?: number;
  path?: string;
  id?: string;
}): ContentIssue {
  const { code, stage, file, message, line, path, id } = issue;
  return {
    code,
    stage,
    file,
    message,
    ...(line === undefined ? {} : { line }),
    ...(path === undefined ? {} : { path }),
    ...(id === undefined ? {} : { id }),
  };
}
