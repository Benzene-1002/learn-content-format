/**
 * `textbook.md` の見出し構造を読み取る(`docs/product/content-format.md` §3.1)。
 *
 * 見出しの階層がそのままアプリの構造になる(要件 §5.2)。
 *   `#` 章 / `##` 節 = 単元(到達を測る単位) / `###` 項 = 問題が根拠として指す先
 *
 * ここで作る対応表(節 → 配下の項)が、§6 のファイルをまたぐ条件の土台になる。
 * 問題は項の ID しか持たないので、単元がどれだけ問題を持つかは教科書側から引く。
 *
 * 受け取るのは復号済みの文字列。**符号化の検査(BOM・CR・制御文字)は `validate.ts`
 * が持つ**。BOM は復号すると消えてしまい、文字列からは判定できないためである。
 */

import { type ContentIssue, contentIssue } from './issues.js';
import { isValidId, ID_MAX_LENGTH } from './limits.js';
import { scanMarkdown } from './markdown.js';

const TEXTBOOK_FILE = 'textbook.md';

export type TextbookHeading = {
  readonly level: 1 | 2 | 3;
  readonly id: string;
  readonly title: string;
  readonly line: number;
};

export type Textbook = {
  readonly headings: readonly TextbookHeading[];
  /** すべての見出し ID。文書内アンカーの解決に使う。 */
  readonly ids: ReadonlySet<string>;
  /** 節(`##`)の ID の一覧。到達を測る単位(要件 §3.2)。 */
  readonly sectionIds: readonly string[];
  /** 項(`###`)の ID → 所属する節の ID。 */
  readonly sectionOfSubsection: ReadonlyMap<string, string>;
  /** 参照している画像のファイル名(`assets/` を除いた部分)。 */
  readonly imageNames: ReadonlySet<string>;
};

export type TextbookParseResult = {
  readonly issues: readonly ContentIssue[];
  readonly textbook: Textbook;
};

/**
 * 教科書を読み取る。
 *
 * 違反があっても途中で止めず、読み取れたところまでを `textbook` として返す。
 * 呼び出し側(`validate.ts`)が、同じ段の違反をまとめて返せるようにするため(§1.6)。
 */
export function parseTextbook(source: string): TextbookParseResult {
  const issues: ContentIssue[] = [];
  const add = (
    code: Parameters<typeof contentIssue>[0]['code'],
    message: string,
    extra?: { line?: number; id?: string },
  ) => {
    issues.push(
      contentIssue({ code, stage: 'syntax', file: TEXTBOOK_FILE, message, ...extra }),
    );
  };

  const scan = scanMarkdown(source, { file: TEXTBOOK_FILE, kind: 'textbook' });
  issues.push(...scan.issues);

  if (scan.bodyBeforeFirstHeading !== null) {
    add('syntax.body_before_first_heading', '最初の見出しより前に本文は書けない(§3.1)。', {
      line: scan.bodyBeforeFirstHeading,
    });
  }

  const headings: TextbookHeading[] = [];
  const ids = new Set<string>();
  const sectionIds: string[] = [];
  const sectionOfSubsection = new Map<string, string>();
  let currentSection: string | null = null;
  let previousLevel = 0;

  for (const raw of scan.headings) {
    if (raw.level > 3) {
      add(
        'syntax.heading_level_invalid',
        `見出しは # / ## / ### の 3 階層だけ(§3.1)。${'#'.repeat(raw.level)} は使えない。`,
        { line: raw.line },
      );
      continue;
    }
    const level = raw.level as 1 | 2 | 3;

    if (previousLevel !== 0 && level > previousLevel + 1) {
      add(
        'syntax.heading_level_skipped',
        `見出しの階層を飛ばしている(§3.1)。${'#'.repeat(previousLevel)} の次に ${'#'.repeat(level)} は置けない。`,
        { line: raw.line },
      );
    }
    if (previousLevel === 0 && level !== 1) {
      add(
        'syntax.heading_level_skipped',
        `最初の見出しは章(#)でなければならない(§3.1)。`,
        { line: raw.line },
      );
    }
    previousLevel = level;

    if (raw.id === null) {
      add('syntax.heading_id_missing', `見出し「${raw.title}」に {#id} が無い(§3.1)。`, {
        line: raw.line,
      });
      continue;
    }
    if (!isValidId(raw.id)) {
      add(
        'syntax.heading_id_invalid',
        `見出し ID "${raw.id}" が規則を満たさない(§7.1。小文字英数字とハイフン、${ID_MAX_LENGTH} 文字まで、先頭と末尾はハイフン以外、ハイフンは連続させない)。`,
        { line: raw.line, id: raw.id },
      );
      continue;
    }
    if (ids.has(raw.id)) {
      add('syntax.heading_id_duplicated', `見出し ID "${raw.id}" が重複している(§3.1)。`, {
        line: raw.line,
        id: raw.id,
      });
      continue;
    }

    ids.add(raw.id);
    headings.push({ level, id: raw.id, title: raw.title, line: raw.line });
    if (level === 2) {
      sectionIds.push(raw.id);
      currentSection = raw.id;
    } else if (level === 3 && currentSection !== null) {
      sectionOfSubsection.set(raw.id, currentSection);
    } else if (level === 1) {
      currentSection = null;
    }
  }

  if (!headings.some((heading) => heading.level === 1)) {
    add('syntax.heading_missing', '章(#)が 1 つも無い(§3.1)。');
  }
  if (sectionIds.length === 0) {
    add('syntax.heading_missing', '節(##)が 1 つも無い(§3.1)。節は到達を測る単位(要件 §3.2)。');
  }

  // 文書内アンカーは、見出しを読み終えてから解決する(前方参照があるため)。
  for (const anchor of scan.anchors) {
    if (!ids.has(anchor.id)) {
      issues.push(
        contentIssue({
          code: 'consistency.anchor_not_found',
          stage: 'syntax',
          file: TEXTBOOK_FILE,
          line: anchor.line,
          id: anchor.id,
          message: `文書内アンカー "#${anchor.id}" が指す見出しが存在しない(§3.3)。`,
        }),
      );
    }
  }

  return {
    issues,
    textbook: {
      headings,
      ids,
      sectionIds,
      sectionOfSubsection,
      imageNames: new Set(scan.images.map((image) => image.path)),
    },
  };
}
