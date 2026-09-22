/**
 * 教材の Markdown が、許可した記法の範囲に収まっているかを調べる
 * (`docs/product/content-format.md` §3.2 / §3.3 / §3.4 / §4.6)。
 *
 * **raw HTML は無害化せず拒否する**(§3.2)。サニタイザという依存を増やさず、
 * 「何が起きるか分からない入力を受け取らない」形で安全側に倒すため。ここは
 * 描画のための parser ではなく、**受け取ってよいかを判定するための走査**である。
 *
 * そのため完全な CommonMark の実装ではない。判定に要るもの(コード・数式の範囲、
 * 見出し、リンク、画像)だけを見て、判断に迷う形は「許可した記法ではない」として
 * 拒否側に倒す。
 */

import { type ContentIssue, contentIssue } from './issues.js';

/** 走査する文脈。`inline` は問題文・解説・選択肢(§4.6)。 */
export type MarkdownKind = 'textbook' | 'inline';

/** 見出し 1 行分。階層や ID の妥当性は `textbook.ts` が判断する。 */
export type RawHeading = {
  readonly level: number;
  readonly title: string;
  /** 行末の `{#id}` から取れた ID。記法が無ければ `null`。 */
  readonly id: string | null;
  readonly line: number;
};

export type MarkdownScan = {
  readonly issues: readonly ContentIssue[];
  readonly headings: readonly RawHeading[];
  /** 参照している画像(`assets/` からの相対パス)。 */
  readonly images: readonly { readonly path: string; readonly line: number }[];
  /** 参照している文書内アンカー(`#id` の `id` の部分)。 */
  readonly anchors: readonly { readonly id: string; readonly line: number }[];
  /** 最初の見出しより前に本文があった行。無ければ `null`。 */
  readonly bodyBeforeFirstHeading: number | null;
};

type ScanOptions = {
  /** パッケージ内のファイル名。 */
  readonly file: string;
  readonly kind: MarkdownKind;
  /** `inline` のときの JSON の位置(`questions[3].prompt` など)。 */
  readonly path?: string;
};

/** 見出し行。`# ` のあとに本文、行末に任意で `{#id}`。 */
const HEADING = /^(#{1,6})[ \t]+(.*)$/;
/** 行末の `{#id}`。前に空白が 1 つ以上要る(§3.1)。 */
const HEADING_ID = /^(.*?)[ \t]+\{#([^}]*)\}$/;
/** コードフェンスの開始・終了。 */
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;
/** フェンスに書いてよい言語名(§3.2)。 */
const FENCE_INFO = /^[a-z0-9+#-]{0,20}$/;
/** raw HTML の始まり。タグ・コメント・宣言・処理命令のいずれか。 */
const RAW_HTML_START = /<[a-zA-Z/!?]/;
/** リンク参照定義(`[ref]: https://…`)。許可した記法に含まれない。 */
const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:/;
/**
 * リンクの文字列に入れ子にできる深さの上限。
 *
 * 入れ子を走査する以上、深さに上限が要る。無いと `[…]( )` を繰り返し包んだだけの
 * 入力で再帰が尽き、**違反を値として返せなくなる**(例外になる)。教材で実際に要る
 * 深さは 1〜2 なので、余裕を見て 8 で止め、それより深いものは記法として拒否する。
 */
const MAX_LINK_NESTING = 8;

/** Markdown を走査する。 */
export function scanMarkdown(source: string, options: ScanOptions): MarkdownScan {
  const issues: ContentIssue[] = [];
  const headings: RawHeading[] = [];
  const images: { path: string; line: number }[] = [];
  const anchors: { id: string; line: number }[] = [];
  let bodyBeforeFirstHeading: number | null = null;

  const add = (
    code: Parameters<typeof contentIssue>[0]['code'],
    line: number,
    message: string,
  ) => {
    issues.push(
      contentIssue({
        code,
        stage: 'syntax',
        file: options.file,
        message,
        // 問題文などは 1 つの文字列なので、行番号より JSON の位置のほうが役に立つ。
        ...(options.kind === 'textbook' ? { line } : {}),
        ...(options.path === undefined ? {} : { path: options.path }),
      }),
    );
  };

  const lines = source.split('\n');
  const state = { inDisplayMath: false };
  let fence: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = index + 1;

    const fenceMatch = FENCE.exec(raw);
    if (fenceMatch) {
      const [, marker, info] = fenceMatch;
      if (fence === null) {
        // 開いた印そのものを覚える。**同じ種類で、同じ数以上**でなければ
        // 閉じない(3 連で開いた中の 4 連は本文、4 連で開いた中の 3 連も本文)。
        fence = marker;
        if (!FENCE_INFO.test(info.trim())) {
          add(
            'syntax.markdown_notation_forbidden',
            line,
            `コードブロックの言語名 "${info.trim()}" は許可した形式ではない(§3.2。[a-z0-9+#-] を 20 文字まで)。`,
          );
        }
      } else if (
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        info.trim() === ''
      ) {
        fence = null;
      }
      continue;
    }
    // フェンスの中は、中身を raw HTML と見なさない(§3.2)。
    if (fence !== null) continue;

    const heading = state.inDisplayMath ? null : HEADING.exec(raw);
    if (heading !== null) {
      if (options.kind === 'inline') {
        add(
          'syntax.markdown_notation_forbidden',
          line,
          '問題文・解説・選択肢に見出しは書けない(§4.6)。',
        );
      } else {
        headings.push(parseHeading(heading, line));
      }
      // 見出し行でも走査は続ける。見出しの本文に raw HTML やリンクを書けるため。
    } else if (
      options.kind === 'textbook' &&
      headings.length === 0 &&
      bodyBeforeFirstHeading === null &&
      raw.trim() !== ''
    ) {
      bodyBeforeFirstHeading = line;
    }

    const masked = maskCodeAndMath(raw, state);

    if (RAW_HTML_START.test(masked)) {
      add(
        'syntax.markdown_html_forbidden',
        line,
        'raw HTML は書けない(§3.2)。無害化せず拒否する。HTML を説明したい場合はコードブロックに入れる。',
      );
    }
    if (LINK_DEFINITION.test(masked)) {
      add(
        'syntax.markdown_notation_forbidden',
        line,
        'リンク参照定義は許可した記法ではない(§3.2)。リンクは [文字列](URL) の形だけを使う。',
      );
    }

    for (const found of findLinksAndImages(masked, raw, 0)) {
      if (found.tooDeep) {
        add(
          'syntax.markdown_notation_forbidden',
          line,
          `リンク・画像の入れ子が深すぎる(${MAX_LINK_NESTING} 段まで)。`,
        );
        continue;
      }
      if (found.reference) {
        add(
          'syntax.markdown_notation_forbidden',
          line,
          '参照形式のリンク・画像は許可した記法ではない(§3.2)。[文字列](URL) の形だけを使う。',
        );
        continue;
      }
      if (found.isImage) {
        checkImage(found, line, options.kind, add, images);
      } else {
        checkLink(found, line, add, anchors);
      }
    }
  }

  // 閉じ忘れは、その後ろ全部を「中身」として見逃すことにつながる。拒否する。
  if (fence !== null) {
    add(
      'syntax.markdown_notation_forbidden',
      lines.length,
      'コードブロックが閉じていない(§3.2)。閉じるまでの範囲を中身として扱うため、閉じ忘れは受け付けない。',
    );
  }
  if (state.inDisplayMath) {
    add(
      'syntax.markdown_notation_forbidden',
      lines.length,
      '数式($$)が閉じていない(§3.2)。閉じるまでの範囲を中身として扱うため、閉じ忘れは受け付けない。',
    );
  }

  return { issues, headings, images, anchors, bodyBeforeFirstHeading };
}

type AddIssue = (
  code: Parameters<typeof contentIssue>[0]['code'],
  line: number,
  message: string,
) => void;

function checkImage(
  found: LinkLike,
  line: number,
  kind: MarkdownKind,
  add: AddIssue,
  images: { path: string; line: number }[],
): void {
  if (kind === 'inline') {
    add(
      'syntax.markdown_notation_forbidden',
      line,
      '問題文・解説・選択肢に画像は書けない(§4.6)。図は根拠の項に置き、問題文から参照させる。',
    );
    return;
  }
  if (found.text.trim() === '') {
    add(
      'syntax.markdown_image_alt_missing',
      line,
      '図にはタイトル(alt テキスト)が要る(§3.4)。図の中身を検索できるようにするため。',
    );
  }
  const url = classifyUrl(found.destination);
  if (url.kind !== 'asset') {
    add(
      'syntax.markdown_url_forbidden',
      line,
      `画像は assets/ 直下の相対パスだけを指せる(§3.4)。"${found.destination}" は指せない。`,
    );
    return;
  }
  images.push({ path: url.value, line });
}

function checkLink(
  found: LinkLike,
  line: number,
  add: AddIssue,
  anchors: { id: string; line: number }[],
): void {
  const url = classifyUrl(found.destination);
  if (url.kind === 'https') return;
  if (url.kind === 'anchor') {
    anchors.push({ id: url.value, line });
    return;
  }
  add(
    'syntax.markdown_url_forbidden',
    line,
    `リンクに使えるのは https: と文書内アンカー(#id)だけ(§3.3)。"${found.destination}" は使えない。`,
  );
}

function parseHeading(match: RegExpExecArray, line: number): RawHeading {
  const level = match[1].length;
  const body = match[2].trimEnd();
  const withId = HEADING_ID.exec(body);
  if (withId === null) {
    return { level, title: body.trim(), id: null, line };
  }
  return { level, title: withId[1].trim(), id: withId[2], line };
}

/**
 * URL の判定(§3.3 / §3.4)。
 *
 * スキームの安全性は、**空白と制御文字をすべて取り除き、小文字にしてから**判定する。
 * `java\tscript:` のように分割して書いてもスキームとして扱われる余地があるため、
 * 判定の前に形を潰す。
 *
 * 一方、**返す値(アンカー ID・画像のファイル名)は大文字小文字を保つ**。ここを
 * 小文字化して照合すると、`#CH03` が `ch03` に一致した扱いになり、実際には
 * 開けないリンクや図を含むパッケージが通ってしまう。
 */
type UrlClassification =
  | { kind: 'https' }
  | { kind: 'anchor'; value: string }
  | { kind: 'asset'; value: string }
  | { kind: 'forbidden' };

export function classifyUrl(raw: string): UrlClassification {
  const stripped = raw.replace(/[\s\u0000-\u001F\u007F]/g, '');
  const normalized = stripped.toLowerCase();
  if (normalized === '') return { kind: 'forbidden' };
  if (normalized.startsWith('#')) {
    return { kind: 'anchor', value: stripped.slice(1) };
  }
  if (normalized.startsWith('https://')) {
    return normalized.length > 'https://'.length ? { kind: 'https' } : { kind: 'forbidden' };
  }
  // スキームつき(https 以外)、プロトコル相対、絶対パスはすべて拒否。
  if (/^[a-z][a-z0-9+.-]*:/.test(normalized) || normalized.startsWith('//') || normalized.startsWith('/')) {
    return { kind: 'forbidden' };
  }
  // `assets/` の綴りも元の表記で見る。`Assets/` を通すと、契約のパスと
  // 一致しないものが実在する画像に照合されてしまう。
  if (stripped.startsWith('assets/')) {
    const name = stripped.slice('assets/'.length);
    if (name === '' || name.includes('/') || name.includes('..')) return { kind: 'forbidden' };
    return { kind: 'asset', value: name };
  }
  return { kind: 'forbidden' };
}

/**
 * コード(インライン)と数式の範囲を空白で塗り潰す。
 *
 * 位置をずらさないために、取り除くのではなく**同じ長さの空白に置き換える**。
 * 塗り潰した範囲は raw HTML ともリンクとも見なさない。`$a < b$` の `< b` を
 * HTML と誤認しないために、数式も塗り潰す対象に含める。
 */
function maskCodeAndMath(line: string, state: { inDisplayMath: boolean }): string {
  // indexOf / line[i] は UTF-16 の位置を返す。塗り潰す配列も同じ単位で作らないと、
  // 補助文字(絵文字など)の手前と後ろで位置がずれ、塗り潰す範囲が狂う。
  const out = line.split('');
  const mask = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i += 1) out[i] = ' ';
  };

  let i = 0;
  if (state.inDisplayMath) {
    const close = line.indexOf('$$');
    if (close === -1) {
      return ' '.repeat(line.length);
    }
    mask(0, close + 2);
    state.inDisplayMath = false;
    i = close + 2;
  }

  while (i < line.length) {
    const char = line[i];
    if (char === '\\') {
      // エスケープ。次の 1 文字ごと無効化する(\$ や \< を記法と見なさない)。
      mask(i, i + 2);
      i += 2;
      continue;
    }
    if (char === '`') {
      let run = 0;
      while (line[i + run] === '`') run += 1;
      const marker = '`'.repeat(run);
      const close = line.indexOf(marker, i + run);
      if (close === -1) {
        // 閉じていないバッククォートは、ただの文字として扱う(CommonMark と同じ)。
        i += run;
        continue;
      }
      mask(i, close + run);
      i = close + run;
      continue;
    }
    if (char === '$') {
      const isDisplay = line[i + 1] === '$';
      const marker = isDisplay ? '$$' : '$';
      const close = line.indexOf(marker, i + marker.length);
      if (close === -1) {
        if (isDisplay) {
          mask(i, line.length);
          state.inDisplayMath = true;
          return out.join('');
        }
        // 閉じていない `$` は数式ではない。ただの文字として扱う。
        i += 1;
        continue;
      }
      mask(i, close + marker.length);
      i = close + marker.length;
      continue;
    }
    i += 1;
  }

  return out.join('');
}

type LinkLike = {
  readonly isImage: boolean;
  readonly text: string;
  readonly destination: string;
  /** 参照形式(`[a][b]`)だったか。 */
  readonly reference: boolean;
  /** 入れ子が上限を超えたか。超えた時点で、その先は走査しない。 */
  readonly tooDeep?: boolean;
};

/**
 * `[文字列](URL)` と `![文字列](URL)` を拾う。
 *
 * 塗り潰し済みの行で位置を探し、原文から中身を取り出す(URL の大文字小文字や
 * 元の綴りを、そのまま診断に出すため)。
 */
function findLinksAndImages(masked: string, raw: string, depth: number): LinkLike[] {
  if (depth > MAX_LINK_NESTING) {
    return [{ isImage: false, text: '', destination: '', reference: false, tooDeep: true }];
  }
  const found: LinkLike[] = [];
  // 対応する括弧を先に 1 往復で求めておく。1 つずつ残りを走査し直すと、
  // 閉じない `[` を並べただけの入力で走査量が二乗になり、取り込みを占有できる。
  const brackets = matchPairs(masked, '[', ']');
  const parens = matchPairs(masked, '(', ')');

  let i = 0;
  while (i < masked.length) {
    if (masked[i] !== '[') {
      i += 1;
      continue;
    }
    const isImage = i > 0 && masked[i - 1] === '!';
    const textEnd = brackets.get(i);
    if (textEnd === undefined) {
      i += 1;
      continue;
    }
    const next = masked[textEnd + 1];
    if (next === '[') {
      found.push({ isImage, text: '', destination: '', reference: true });
      i = textEnd + 2;
      continue;
    }
    if (next !== '(') {
      i = textEnd + 1;
      continue;
    }
    const destEnd = parens.get(textEnd + 1);
    if (destEnd === undefined) {
      i = textEnd + 1;
      continue;
    }
    found.push({
      isImage,
      text: raw.slice(i + 1, textEnd),
      destination: extractDestination(raw.slice(textEnd + 2, destEnd)),
      reference: false,
    });
    // リンクの文字列の中に入れ子になった記法(`[![図](…)](…)`)も走査する。
    // 外側だけ見て飛ばすと、内側の画像の URL が検査されないまま通ってしまう。
    found.push(
      ...findLinksAndImages(masked.slice(i + 1, textEnd), raw.slice(i + 1, textEnd), depth + 1),
    );
    i = destEnd + 1;
  }
  return found;
}

/** 開き括弧の位置 → 対応する閉じ括弧の位置。1 往復(線形時間)で求める。 */
function matchPairs(text: string, open: string, close: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === open) {
      stack.push(i);
    } else if (text[i] === close) {
      const start = stack.pop();
      if (start !== undefined) pairs.set(start, i);
    }
  }
  return pairs;
}

/** `path "title"` や `<path>` から、URL の部分だけを取り出す(§3.4)。 */
function extractDestination(inner: string): string {
  const trimmed = inner.trim();
  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>');
    return close === -1 ? trimmed.slice(1) : trimmed.slice(1, close);
  }
  const space = trimmed.search(/\s/);
  return space === -1 ? trimmed : trimmed.slice(0, space);
}
