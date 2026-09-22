/**
 * 教材パッケージの上限と、ファイル構成・画像の規則(`docs/product/content-format.md` §1.1 / §1.4 / §1.5)。
 *
 * 教材は信頼できない入力(要件 §5.2 / §7.3、ADR 0007 の Consequences)。ここは
 * 「受け取ってよい大きさ・形・中身」を数値と規則として一箇所にまとめる。
 *
 * 圧縮率や ZIP の目録に関する上限は**展開する側(p21)**が使う。展開後の対応表からは
 * 見えないため、この module は値だけを持ち、判定は行わない(§1.6 の展開段)。
 */

const MIB = 1024 * 1024;

/** `content-format.md` §1.4 の上限。 */
export const CONTENT_LIMITS = {
  /** ZIP ファイル(圧縮後)。展開段で使う。 */
  packageBytes: 50 * MIB,
  /** ZIP の目録のエントリ数。展開段で使う。 */
  entryCount: 510,
  /** 展開後の合計サイズ。展開段で使う。 */
  extractedTotalBytes: 200 * MIB,
  /** 圧縮率(展開後 ÷ 圧縮後)。展開段で使う。 */
  compressionRatio: 100,
  /** `textbook.md`。 */
  textbookBytes: 5 * MIB,
  /** JSON ファイル 1 個あたり。 */
  jsonBytes: 5 * MIB,
  /** 画像 1 枚。 */
  imageBytes: 2 * MIB,
  /** 画像の枚数。 */
  imageCount: 500,
  /** `questions.json` の問題数。 */
  questionCount: 20_000,
  /** `mock-exams.json` 全体の問題数。 */
  mockQuestionCount: 5_000,
  /** 模試の数。 */
  mockExamCount: 50,
  /** 模試 1 つあたりの問題数。 */
  mockExamQuestionCount: 1_000,
} as const;

/** パッケージ直下に置いてよいファイル(§1.1)。 */
export const PACKAGE_FILES = {
  manifest: 'manifest.json',
  exam: 'exam.json',
  textbook: 'textbook.md',
  questions: 'questions.json',
  mockExams: 'mock-exams.json',
} as const;

/** 必須のファイル。`mock-exams.json` は任意(要件 §6.5)。 */
export const REQUIRED_PACKAGE_FILES: readonly string[] = [
  PACKAGE_FILES.manifest,
  PACKAGE_FILES.exam,
  PACKAGE_FILES.textbook,
  PACKAGE_FILES.questions,
];

/** 画像を置いてよいディレクトリ(§1.5)。 */
export const ASSETS_DIR = 'assets/';

/** 許可する画像の種類(§1.5)。 */
export type ImageKind = 'png' | 'jpeg' | 'webp';

/** 拡張子 → 画像の種類。小文字のみ許可する。 */
const EXTENSION_TO_KIND: Readonly<Record<string, ImageKind>> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
};

/** 画像の種類 → MIME。保存・配信する p21 が使う。 */
export const IMAGE_MIME: Readonly<Record<ImageKind, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** 画像のファイル名(`assets/` を除いた部分)の規則(§1.5)。 */
const ASSET_FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/** ID の規則(§7.1)。先頭・末尾はハイフン以外で、ハイフンは連続しない。 */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** ID の最大長(§7.1。コードポイント数だが、文字種が ASCII なので長さで足りる)。 */
export const ID_MAX_LENGTH = 64;

/** 拒否する制御文字(§7.2)。改行とタブは本文中で使えるので外す。 */
export const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** ID として妥当か(§7.1)。 */
export function isValidId(value: string): boolean {
  return value.length <= ID_MAX_LENGTH && ID_PATTERN.test(value);
}

/**
 * ZIP のエントリ名が、パッケージのどこに属するか。
 *
 * **遡る指定・絶対パス・Windows 形式はすべて拒否する**(§1.5)。正規化してから
 * 判定するのではなく、**正規化が要る形そのものを受け付けない**。`a/../b` を
 * `b` と解釈してよいかはツール次第であり、解釈の余地を残さないため。
 */
export type EntryClassification =
  | { kind: 'root-file'; name: string }
  | { kind: 'asset'; name: string }
  /** `assets/` そのもの。ZIP がディレクトリを 1 エントリとして持つ形(§1.1)。 */
  | { kind: 'directory' }
  | { kind: 'unsafe'; reason: string }
  | { kind: 'unknown' };

export function classifyEntryName(entryName: string): EntryClassification {
  if (entryName.length === 0) {
    return { kind: 'unsafe', reason: 'エントリ名が空' };
  }
  // ZIP はディレクトリを末尾 / のエントリとして持つことがある。許可するのは
  // `assets/` だけで、他のディレクトリは下の段で unknown になる。
  if (entryName === `${ASSETS_DIR}`) {
    return { kind: 'directory' };
  }
  if (entryName.includes('\\')) {
    return { kind: 'unsafe', reason: 'Windows 形式の区切り(\\)を含む' };
  }
  if (entryName.startsWith('/')) {
    return { kind: 'unsafe', reason: '絶対パス(/ で始まる)' };
  }
  if (CONTROL_CHARACTERS.test(entryName)) {
    return { kind: 'unsafe', reason: '制御文字を含む' };
  }
  const segments = entryName.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return { kind: 'unsafe', reason: '空・. ・.. を含む(ディレクトリを遡る指定)' };
  }

  if (segments.length === 1) {
    const name = segments[0];
    return Object.values(PACKAGE_FILES).includes(name as (typeof PACKAGE_FILES)[keyof typeof PACKAGE_FILES])
      ? { kind: 'root-file', name }
      : { kind: 'unknown' };
  }
  if (segments.length === 2 && segments[0] === 'assets') {
    return { kind: 'asset', name: segments[1] };
  }
  // assets/ の下に更にディレクトリを作ってはならない(§1.1)。
  return { kind: 'unknown' };
}

/** 画像のファイル名が規則を満たすか(§1.5)。 */
export function isValidAssetFileName(name: string): boolean {
  return ASSET_FILE_NAME.test(name) && !name.includes('..');
}

/** 拡張子から画像の種類を得る。許可外なら `null`。 */
export function imageKindFromFileName(name: string): ImageKind | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return EXTENSION_TO_KIND[name.slice(dot)] ?? null;
}

/**
 * 中身の先頭(マジックバイト)から画像の種類を判定する(§1.5)。
 *
 * 拡張子を信じない。拡張子と中身が食い違うパッケージは拒否する。
 */
export function imageKindFromBytes(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  // WebP は RIFF コンテナ。4〜7 バイト目にファイル長が入るので、そこは見ない。
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return 'webp';
  }
  return null;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}
