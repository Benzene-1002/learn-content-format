/**
 * 展開済みの教材パッケージが、契約(`docs/product/content-format.md`)を満たすかを判定する。
 *
 * **満たさなければ拒否する**(要件 §5.8 A)。警告にはしない。取り込めてしまってから
 * 「この単元は永久に終わらない」と分かるのが最悪であり、入口で止めるのが唯一の防ぎ方。
 *
 * DB もファイル I/O も持たない純粋関数。ZIP を開く側(p21)が、展開した結果を渡す。
 * 圧縮率・目録の申告値・同名エントリは、対応表になった時点で失われるため
 * **展開する側の責任**にしてある(§1.6 の展開段)。
 */

import { type ContentIssue, type ContentIssueStage, contentIssue } from './issues.js';
import {
  ASSETS_DIR,
  CONTENT_LIMITS,
  CONTROL_CHARACTERS,
  classifyEntryName,
  type ImageKind,
  imageKindFromBytes,
  imageKindFromFileName,
  isValidAssetFileName,
  PACKAGE_FILES,
  REQUIRED_PACKAGE_FILES,
} from './limits.js';
import { scanMarkdown } from './markdown.js';
import {
  type Exam,
  examSchema,
  isGradable,
  isSupportedFormatVersion,
  type Manifest,
  manifestSchema,
  type MockExamsFile,
  mockExamsFileSchema,
  type Question,
  type QuestionsFile,
  questionsFileSchema,
  SUPPORTED_FORMAT_VERSION,
  toContentIssues,
} from './schema.js';
import { parseTextbook, type Textbook } from './textbook.js';

/** ZIP を展開した結果。名前は ZIP のエントリ名そのまま。 */
export type ExtractedEntry = {
  readonly name: string;
  readonly bytes: Uint8Array;
};

export type ExtractedPackage = {
  readonly entries: readonly ExtractedEntry[];
};

/** 検証を通ったパッケージ。取り込み(p21)はここから先を扱う。 */
export type ValidatedPackage = {
  readonly manifest: Manifest;
  readonly exam: Exam;
  readonly textbook: Textbook;
  readonly textbookSource: string;
  readonly questions: QuestionsFile['questions'];
  readonly mockExams: MockExamsFile['mockExams'] | null;
  readonly assets: ReadonlyMap<string, { readonly bytes: Uint8Array; readonly kind: ImageKind }>;
};

export type ValidationResult =
  | { readonly ok: true; readonly package: ValidatedPackage }
  | { readonly ok: false; readonly issues: readonly ContentIssue[] };

/** 違反を集める入れ物。段ごとに区切り、前の段で落ちたらその先を判定しない(§1.6)。 */
class IssueCollector {
  private readonly items: ContentIssue[] = [];

  add(issue: {
    code: ContentIssue['code'];
    stage: ContentIssueStage;
    file: string;
    message: string;
    line?: number;
    path?: string;
    id?: string;
  }): void {
    this.items.push(contentIssue(issue));
  }

  addAll(issues: readonly ContentIssue[]): void {
    this.items.push(...issues);
  }

  get empty(): boolean {
    return this.items.length === 0;
  }

  get all(): readonly ContentIssue[] {
    return this.items;
  }
}

export function validateContentPackage(input: ExtractedPackage): ValidationResult {
  const issues = new IssueCollector();

  // --- パッケージ段(§1.1 / §1.4 / §1.5)---
  const files = new Map<string, Uint8Array>();
  const assets = new Map<string, { bytes: Uint8Array; kind: ImageKind }>();

  for (const entry of input.entries) {
    const classified = classifyEntryName(entry.name);
    switch (classified.kind) {
      case 'directory':
        break;
      case 'unsafe':
        issues.add({
          code: 'package.path_unsafe',
          stage: 'package',
          file: entry.name,
          message: `エントリ名が安全でない(§1.5。${classified.reason})。`,
        });
        break;
      case 'unknown':
        issues.add({
          code: 'package.entry_unexpected',
          stage: 'package',
          file: entry.name,
          message: `パッケージに入れてよいのは §1.1 の 6 つだけ。"${entry.name}" は入れられない。`,
        });
        break;
      case 'root-file':
        if (files.has(classified.name)) {
          issues.add({
            code: 'package.entry_unexpected',
            stage: 'package',
            file: classified.name,
            message: '同じファイルが 2 回現れている(§1.1)。',
          });
          break;
        }
        files.set(classified.name, entry.bytes);
        checkFileSize(classified.name, entry.bytes, issues);
        break;
      case 'asset':
        checkAsset(classified.name, entry.bytes, assets, issues);
        break;
    }
  }

  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!files.has(required)) {
      issues.add({
        code: 'package.entry_missing',
        stage: 'package',
        file: required,
        message: `必須のファイルが無い(§1.1)。`,
      });
    }
  }
  if (assets.size > CONTENT_LIMITS.imageCount) {
    issues.add({
      code: 'package.limit_exceeded',
      stage: 'package',
      file: ASSETS_DIR,
      message: `画像は ${CONTENT_LIMITS.imageCount} 枚まで(§1.4)。${assets.size} 枚ある。`,
    });
  }

  if (!issues.empty) return { ok: false, issues: issues.all };

  // --- 構文段(§1.1 / §1.3 / §3)---
  const texts = new Map<string, string>();
  for (const [name, bytes] of files) {
    const text = decodeUtf8(bytes);
    if (text === null) {
      issues.add({
        code: 'syntax.encoding_invalid',
        stage: 'syntax',
        file: name,
        message: 'UTF-8 として読めない(§1.1)。',
      });
      continue;
    }
    // BOM は**バイト列で**見る。TextDecoder が黙って落とすため、
    // 復号したあとの文字列からは BOM があったことが分からない。
    if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      issues.add({
        code: 'syntax.encoding_invalid',
        stage: 'syntax',
        file: name,
        message: 'BOM が付いている(§1.1。UTF-8 の BOM なしで書く)。',
      });
      continue;
    }
    if (text.includes('\r')) {
      issues.add({
        code: 'syntax.encoding_invalid',
        stage: 'syntax',
        file: name,
        message: '改行に CR が含まれている(§1.1。改行は LF だけを使う)。',
      });
      continue;
    }
    if (CONTROL_CHARACTERS.test(text)) {
      issues.add({
        code: 'syntax.encoding_invalid',
        stage: 'syntax',
        file: name,
        message: '制御文字を含んでいる(§7.2。本文で使えるのは改行とタブだけ)。',
      });
      continue;
    }
    texts.set(name, text);
  }

  const parsed = new Map<string, unknown>();
  for (const name of [PACKAGE_FILES.manifest, PACKAGE_FILES.exam, PACKAGE_FILES.questions, PACKAGE_FILES.mockExams]) {
    const text = texts.get(name);
    if (text === undefined) continue;
    try {
      parsed.set(name, JSON.parse(text));
    } catch (error) {
      issues.add({
        code: 'syntax.json_unparsable',
        stage: 'syntax',
        file: name,
        message: `JSON として読めない(${error instanceof Error ? error.message : String(error)})。`,
      });
    }
  }

  const formatVersion = readFormatVersion(parsed.get(PACKAGE_FILES.manifest));
  if (formatVersion === null || !isSupportedFormatVersion(formatVersion)) {
    issues.add({
      code: 'syntax.format_version_unsupported',
      stage: 'syntax',
      file: PACKAGE_FILES.manifest,
      path: 'formatVersion',
      message: `受理できる形式の版はメジャー ${SUPPORTED_FORMAT_VERSION.major} 系だけ(§1.3)。"${formatVersion ?? '(無し)'}" は受理できない。`,
    });
  }

  const textbookSource = texts.get(PACKAGE_FILES.textbook) ?? '';
  const textbookResult = parseTextbook(textbookSource);
  issues.addAll(textbookResult.issues);

  if (!issues.empty) return { ok: false, issues: issues.all };

  // --- スキーマ段(§1.2 / §2 / §4 / §5)---
  const manifest = manifestSchema.safeParse(parsed.get(PACKAGE_FILES.manifest));
  if (!manifest.success) issues.addAll(toContentIssues(manifest.error, PACKAGE_FILES.manifest));

  const exam = examSchema.safeParse(parsed.get(PACKAGE_FILES.exam));
  if (!exam.success) issues.addAll(toContentIssues(exam.error, PACKAGE_FILES.exam));

  const questions = questionsFileSchema.safeParse(parsed.get(PACKAGE_FILES.questions));
  if (!questions.success) issues.addAll(toContentIssues(questions.error, PACKAGE_FILES.questions));

  const hasMockExams = parsed.has(PACKAGE_FILES.mockExams);
  const mockExams = hasMockExams
    ? mockExamsFileSchema.safeParse(parsed.get(PACKAGE_FILES.mockExams))
    : null;
  if (mockExams !== null && !mockExams.success) {
    issues.addAll(toContentIssues(mockExams.error, PACKAGE_FILES.mockExams));
  }

  if (!issues.empty || !manifest.success || !exam.success || !questions.success) {
    return { ok: false, issues: issues.all };
  }
  if (mockExams !== null && !mockExams.success) return { ok: false, issues: issues.all };

  // --- 整合段(§4.6 / §6)---
  const mockExamList = mockExams === null ? null : mockExams.data.mockExams;
  const headingIds = textbookResult.textbook.ids;
  checkInlineNotation(questions.data.questions, PACKAGE_FILES.questions, headingIds, issues);
  if (mockExamList !== null) {
    for (const [index, mock] of mockExamList.entries()) {
      checkInlineNotation(
        mock.questions,
        PACKAGE_FILES.mockExams,
        headingIds,
        issues,
        `mockExams[${index}].`,
      );
    }
  }
  checkCrossFile({
    textbook: textbookResult.textbook,
    questions: questions.data.questions,
    mockExams: mockExamList,
    exam: exam.data,
    assets,
    issues,
  });

  if (!issues.empty) return { ok: false, issues: issues.all };

  return {
    ok: true,
    package: {
      manifest: manifest.data,
      exam: exam.data,
      textbook: textbookResult.textbook,
      textbookSource,
      questions: questions.data.questions,
      mockExams: mockExamList,
      assets,
    },
  };
}

function checkFileSize(name: string, bytes: Uint8Array, issues: IssueCollector): void {
  const limit = name === PACKAGE_FILES.textbook ? CONTENT_LIMITS.textbookBytes : CONTENT_LIMITS.jsonBytes;
  if (bytes.byteLength > limit) {
    issues.add({
      code: 'package.limit_exceeded',
      stage: 'package',
      file: name,
      message: `${limit} バイトまで(§1.4)。${bytes.byteLength} バイトある。`,
    });
  }
}

function checkAsset(
  name: string,
  bytes: Uint8Array,
  assets: Map<string, { bytes: Uint8Array; kind: ImageKind }>,
  issues: IssueCollector,
): void {
  const file = `${ASSETS_DIR}${name}`;
  if (!isValidAssetFileName(name)) {
    issues.add({
      code: 'package.asset_name_invalid',
      stage: 'package',
      file,
      message: '画像のファイル名が規則を満たさない(§1.5)。',
    });
    return;
  }
  const declared = imageKindFromFileName(name);
  if (declared === null) {
    issues.add({
      code: 'package.asset_extension_unsupported',
      stage: 'package',
      file,
      message: '画像は png / jpg / jpeg / webp(小文字)だけ(§1.5)。',
    });
    return;
  }
  if (bytes.byteLength > CONTENT_LIMITS.imageBytes) {
    issues.add({
      code: 'package.limit_exceeded',
      stage: 'package',
      file,
      message: `画像は ${CONTENT_LIMITS.imageBytes} バイトまで(§1.4)。${bytes.byteLength} バイトある。`,
    });
    return;
  }
  const actual = imageKindFromBytes(bytes);
  if (actual !== declared) {
    // 拡張子を信じない。中身と食い違うものを保存すると、配信時の MIME と実体がずれる。
    issues.add({
      code: 'package.asset_content_mismatch',
      stage: 'package',
      file,
      message: `拡張子(${declared})と中身(${actual ?? '判別不能'})が食い違う(§1.5)。`,
    });
    return;
  }
  assets.set(name, { bytes, kind: declared });
}

/** 問題文・解説・選択肢の記法(§4.6)。 */
function checkInlineNotation(
  questions: readonly Question[],
  file: string,
  headingIds: ReadonlySet<string>,
  issues: IssueCollector,
  prefix = '',
): void {
  for (const [index, question] of questions.entries()) {
    const at = `${prefix}questions[${index}]`;
    const fields: [string, string][] = [[`${at}.prompt`, question.prompt]];
    if (question.explanation !== undefined) fields.push([`${at}.explanation`, question.explanation]);
    if (question.type === 'choice' || question.type === 'multi') {
      question.options.forEach((option, optionIndex) =>
        fields.push([`${at}.options[${optionIndex}]`, option]),
      );
    }
    if (question.type === 'flashcard') fields.push([`${at}.answer`, question.answer]);

    for (const [path, text] of fields) {
      const scan = scanMarkdown(text, { file, kind: 'inline', path });
      issues.addAll(scan.issues);
      // 文書内アンカーは教科書の見出しを指す(§4.6 が準用する §3.3)。
      // 指す先が無いリンクを置いたまま取り込ませない。
      for (const anchor of scan.anchors) {
        if (headingIds.has(anchor.id)) continue;
        issues.add({
          code: 'consistency.anchor_not_found',
          stage: 'consistency',
          file,
          path,
          id: anchor.id,
          message: `文書内アンカー "#${anchor.id}" が指す見出しが教科書に存在しない(§3.3)。`,
        });
      }
    }
  }
}

/** ファイルをまたぐ条件(§6)。 */
function checkCrossFile(args: {
  textbook: Textbook;
  questions: readonly Question[];
  mockExams: MockExamsFile['mockExams'] | null;
  exam: Exam;
  assets: ReadonlyMap<string, unknown>;
  issues: IssueCollector;
}): void {
  const { textbook, questions, mockExams, exam, assets, issues } = args;

  // 条件 5: 区分の参照が exam.json の parts に実在する。無ければ、どの区分の条件で
  // 出す・解くかが決まらない。
  const partsById = new Map(exam.parts.map((part) => [part.id, part]));
  const checkPartExists = (part: string, file: string, path: string): void => {
    if (partsById.has(part)) return;
    issues.add({
      code: 'consistency.part_not_found',
      stage: 'consistency',
      file,
      path,
      id: part,
      message: `区分 "${part}" が exam.json の parts に無い(§6 の条件 5)。parts[].id のどれか(${[...partsById.keys()].map((id) => `"${id}"`).join(' / ')})を書く。`,
    });
  };
  questions.forEach((question, index) => {
    if (question.part !== undefined) {
      checkPartExists(question.part, PACKAGE_FILES.questions, `questions[${index}].part`);
    }
  });
  mockExams?.forEach((mock, index) => {
    checkPartExists(mock.part, PACKAGE_FILES.mockExams, `mockExams[${index}].part`);
  });

  // 問題 ID は questions.json と mock-exams.json を合わせた全体で一意(§7.1)。
  const seenQuestionIds = new Set<string>();
  const allQuestions: { question: Question; file: string; path: string }[] = questions.map(
    (question, index) => ({
      question,
      file: PACKAGE_FILES.questions,
      path: `questions[${index}]`,
    }),
  );
  mockExams?.forEach((mock, mockIndex) => {
    mock.questions.forEach((question, index) =>
      allQuestions.push({
        question,
        file: PACKAGE_FILES.mockExams,
        path: `mockExams[${mockIndex}].questions[${index}]`,
      }),
    );
  });

  for (const { question, file, path } of allQuestions) {
    if (seenQuestionIds.has(question.id)) {
      issues.add({
        code: 'consistency.question_id_duplicated',
        stage: 'consistency',
        file,
        path,
        id: question.id,
        message: `問題 ID "${question.id}" が重複している(§7.1)。ID は学習履歴の引き継ぎに使うため、全体で一意でなければならない。`,
      });
    }
    seenQuestionIds.add(question.id);

    // 条件 1: 根拠が教科書の項として実在する。
    if (!textbook.sectionOfSubsection.has(question.source)) {
      const code = textbook.ids.has(question.source)
        ? 'consistency.source_not_subsection'
        : 'consistency.source_not_found';
      issues.add({
        code,
        stage: 'consistency',
        file,
        path: `${path}.source`,
        id: question.source,
        message:
          code === 'consistency.source_not_subsection'
            ? `根拠 "${question.source}" は項(###)ではない(§4.1)。問題が指せるのは項だけ。`
            : `根拠 "${question.source}" が教科書に存在しない(§6 の条件 1)。`,
      });
    }
  }

  const mockExamIds = new Set<string>();
  mockExams?.forEach((mock, index) => {
    if (mockExamIds.has(mock.id)) {
      issues.add({
        code: 'consistency.question_id_duplicated',
        stage: 'consistency',
        file: PACKAGE_FILES.mockExams,
        path: `mockExams[${index}].id`,
        id: mock.id,
        message: `模試 ID "${mock.id}" が重複している(§7.1)。`,
      });
    }
    mockExamIds.add(mock.id);

    // 模試は本番形式で通しで解くもの(要件 §6.1 / §6.3)。問数はその区分の本番と一致させる
    // (§6 の条件 6)。区分が無い模試は条件 5 で報告済みで、照らす相手が無いので飛ばす。
    const part = partsById.get(mock.part);
    if (part !== undefined && mock.questions.length !== part.questionCount) {
      issues.add({
        code: 'consistency.mock_question_count_mismatch',
        stage: 'consistency',
        file: PACKAGE_FILES.mockExams,
        path: `mockExams[${index}].questions`,
        id: mock.id,
        message: `模試の問題数は、区分 "${part.id}"(${part.name})の本番の問数(${part.questionCount})と一致させる(§5)。${mock.questions.length} 問ある。`,
      });
    }
  });

  // 条件 2: 同じ根拠を持つ問題が 2 問以上(日々の問題集の中で数える)。
  // 区分ごとには数えない(§4.7)。類題は区分をまたいで出してよいため。
  const perSource = new Map<string, number>();
  for (const question of questions) {
    perSource.set(question.source, (perSource.get(question.source) ?? 0) + 1);
  }
  for (const [source, count] of perSource) {
    if (count < 2) {
      issues.add({
        code: 'consistency.source_single_question',
        stage: 'consistency',
        file: PACKAGE_FILES.questions,
        id: source,
        message: `根拠 "${source}" を持つ問題が ${count} 問しかない(§6 の条件 2)。読んだ直後に類題を出せない。2 問以上にする。`,
      });
    }
  }

  // 条件 3: すべての節に、到達判定へ算入できる問題が 1 問以上。区分ごとには数えない(§4.7)。
  const gradablePerSection = new Map<string, number>();
  for (const sectionId of textbook.sectionIds) gradablePerSection.set(sectionId, 0);
  for (const question of questions) {
    if (!isGradable(question)) continue;
    const sectionId = textbook.sectionOfSubsection.get(question.source);
    if (sectionId === undefined) continue;
    gradablePerSection.set(sectionId, (gradablePerSection.get(sectionId) ?? 0) + 1);
  }
  for (const [sectionId, count] of gradablePerSection) {
    if (count === 0) {
      issues.add({
        code: 'consistency.section_without_gradable_question',
        stage: 'consistency',
        file: PACKAGE_FILES.textbook,
        id: sectionId,
        message: `節 "${sectionId}" に、到達判定へ算入できる問題が 1 問も無い(§6 の条件 3)。この単元は永久に到達できず、成功指標が達成できなくなる。choice / multi / numeric を 1 問以上入れる。`,
      });
    }
  }

  // 画像は、参照したものが実在し、実在するものがすべて参照されている(§1.5 / §3.4)。
  for (const name of textbook.imageNames) {
    if (!assets.has(name)) {
      issues.add({
        code: 'consistency.image_not_found',
        stage: 'consistency',
        file: PACKAGE_FILES.textbook,
        id: name,
        message: `参照している画像 "${ASSETS_DIR}${name}" がパッケージに無い(§3.4)。`,
      });
    }
  }
  for (const name of assets.keys()) {
    if (!textbook.imageNames.has(name)) {
      issues.add({
        code: 'package.asset_unreferenced',
        stage: 'consistency',
        file: `${ASSETS_DIR}${name}`,
        message: '教科書から一度も参照されていない画像(§1.5)。取り込む対象は本文から辿れるものだけにする。',
      });
    }
  }
}

/** UTF-8 として厳密に読む。BOM の有無は `textbook.ts` 側で見る。 */
function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** スキーマ段の前に `formatVersion` だけを覗く(§1.3)。 */
function readFormatVersion(manifest: unknown): string | null {
  if (typeof manifest !== 'object' || manifest === null) return null;
  const value = (manifest as Record<string, unknown>).formatVersion;
  return typeof value === 'string' ? value : null;
}
