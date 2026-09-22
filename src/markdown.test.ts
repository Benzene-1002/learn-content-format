import { describe, expect, it } from 'vitest';

import { classifyUrl, scanMarkdown } from './markdown.js';

const textbook = (source: string) => scanMarkdown(source, { file: 'textbook.md', kind: 'textbook' });
const inline = (source: string) =>
  scanMarkdown(source, { file: 'questions.json', kind: 'inline', path: 'questions[0].prompt' });

const codes = (scan: ReturnType<typeof scanMarkdown>) => scan.issues.map((issue) => issue.code);

describe('classifyUrl', () => {
  it('https と文書内アンカーだけを通す', () => {
    expect(classifyUrl('https://example.com/a')).toEqual({ kind: 'https' });
    expect(classifyUrl('#ch03-02-01')).toEqual({ kind: 'anchor', value: 'ch03-02-01' });
    expect(classifyUrl('assets/fig-0301.png')).toEqual({ kind: 'asset', value: 'fig-0301.png' });
  });

  it('危険なスキームと外部パスを拒む', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,x',
      'vbscript:x',
      'file:///etc/passwd',
      'http://example.com',
      '//example.com',
      '/etc/passwd',
      '../secret',
      '',
    ]) {
      expect(classifyUrl(url).kind, url).toBe('forbidden');
    }
  });

  it('空白・制御文字・大文字で分割したスキームも拒む', () => {
    // 判定の前に空白と制御文字を落とし、小文字にする(§3.3)。
    for (const url of ['JavaScript:alert(1)', ' java\tscript:alert(1)', 'jav\u0000ascript:alert(1)']) {
      expect(classifyUrl(url).kind, url).toBe('forbidden');
    }
  });

  it('返す値は大文字小文字を保つ', () => {
    // 小文字化して照合すると #CH03 が ch03 に一致した扱いになり、
    // 実際には開けないリンクを含むパッケージが通ってしまう。
    expect(classifyUrl('#CH03')).toEqual({ kind: 'anchor', value: 'CH03' });
    expect(classifyUrl('assets/FIG-0301.PNG')).toEqual({ kind: 'asset', value: 'FIG-0301.PNG' });
    // ディレクトリ名の綴りも元の表記で見る。
    expect(classifyUrl('Assets/fig-0301.png').kind).toBe('forbidden');
  });

  it('assets/ の外や入れ子は画像として通さない', () => {
    expect(classifyUrl('assets/../secret.png').kind).toBe('forbidden');
    expect(classifyUrl('assets/sub/fig.png').kind).toBe('forbidden');
    expect(classifyUrl('https://example.com/fig.png').kind).toBe('https');
  });
});

describe('scanMarkdown: raw HTML', () => {
  it('raw HTML を拒否する', () => {
    expect(codes(textbook('# 章 {#ch01}\n<div>本文</div>'))).toContain('syntax.markdown_html_forbidden');
    expect(codes(textbook('# 章 {#ch01}\n<!-- 内緒 -->'))).toContain('syntax.markdown_html_forbidden');
    expect(codes(textbook('# 章 {#ch01}\n<img src=x onerror=alert(1)>'))).toContain(
      'syntax.markdown_html_forbidden',
    );
  });

  it('コードブロックとインラインコードの中身は HTML と見なさない', () => {
    expect(codes(textbook('# 章 {#ch01}\n```html\n<div>x</div>\n```'))).toEqual([]);
    expect(codes(textbook('# 章 {#ch01}\n`<div>` は区画を表す。'))).toEqual([]);
  });

  it('数式の中の不等号を HTML と誤認しない', () => {
    expect(codes(textbook('# 章 {#ch01}\n$a <b$ のとき。'))).toEqual([]);
    expect(codes(textbook('# 章 {#ch01}\n$$\nx <y\n$$\n続き。'))).toEqual([]);
  });

  it('閉じていないコードブロック・数式を拒否する', () => {
    // 閉じ忘れの後ろは全部「中身」になり、raw HTML を見逃す。拒否側に倒す。
    expect(codes(textbook('# 章 {#ch01}\n```\n<div>'))).toEqual([
      'syntax.markdown_notation_forbidden',
    ]);
    expect(codes(textbook('# 章 {#ch01}\n$$\nx = 1\n<div>'))).toEqual([
      'syntax.markdown_notation_forbidden',
    ]);
  });

  it('見出し行の raw HTML も拒否する', () => {
    expect(codes(textbook('# <img src=x onerror=alert(1)> {#ch01}'))).toContain(
      'syntax.markdown_html_forbidden',
    );
  });

  it('補助文字があっても塗り潰す位置がずれない', () => {
    // 塗り潰しを UTF-16 の位置で行わないと、絵文字の後ろで範囲が狂い、
    // コードの外にある raw HTML を見逃す。
    expect(codes(textbook('# 章 {#ch01}\n🙂 `code` <script>'))).toEqual([
      'syntax.markdown_html_forbidden',
    ]);
  });
});

describe('scanMarkdown: リンクと画像', () => {
  it('許可した URL のリンクは通り、アンカーを集める', () => {
    const scan = textbook('# 章 {#ch01}\n[外部](https://example.com) と [中](#ch01)。');
    expect(codes(scan)).toEqual([]);
    expect(scan.anchors).toEqual([{ id: 'ch01', line: 2 }]);
  });

  it('禁じた URL のリンクを拒否する', () => {
    expect(codes(textbook('# 章 {#ch01}\n[押すな](javascript:alert(1))'))).toContain(
      'syntax.markdown_url_forbidden',
    );
  });

  it('画像は alt が要る', () => {
    expect(codes(textbook('# 章 {#ch01}\n![](assets/fig-0301.png)'))).toContain(
      'syntax.markdown_image_alt_missing',
    );
    const ok = textbook('# 章 {#ch01}\n![図3-1 正規化](assets/fig-0301.png)');
    expect(codes(ok)).toEqual([]);
    expect(ok.images).toEqual([{ path: 'fig-0301.png', line: 2 }]);
  });

  it('画像は assets/ 直下しか指せない', () => {
    expect(codes(textbook('# 章 {#ch01}\n![図](https://example.com/a.png)'))).toContain(
      'syntax.markdown_url_forbidden',
    );
    expect(codes(textbook('# 章 {#ch01}\n![図](assets/../secret.png)'))).toContain(
      'syntax.markdown_url_forbidden',
    );
  });

  it('参照形式のリンクとリンク参照定義を拒否する', () => {
    expect(codes(textbook('# 章 {#ch01}\n[外部][ref]'))).toContain(
      'syntax.markdown_notation_forbidden',
    );
    expect(codes(textbook('# 章 {#ch01}\n[ref]: https://example.com'))).toContain(
      'syntax.markdown_notation_forbidden',
    );
  });

  it('リンクの文字列に入れ子になった画像も検査する', () => {
    // 外側のリンクだけ見て飛ばすと、内側の画像の URL が検査されないまま通る。
    const scan = textbook('# 章 {#ch01}\n[![図](https://example.com/x.png)](https://example.com)');
    expect(codes(scan)).toContain('syntax.markdown_url_forbidden');
    expect(
      textbook('# 章 {#ch01}\n[![図3-1 正規化](assets/fig-0301.png)](https://example.com)').images,
    ).toEqual([{ path: 'fig-0301.png', line: 2 }]);
  });

  it('深すぎる入れ子は記法として拒否する', () => {
    // 深さに上限が無いと、包み続けただけの入力で再帰が尽き、
    // 違反を値として返せなくなる(例外になる)。
    const deep = `${'['.repeat(40)}x${'](https://example.com)'.repeat(40)}`;
    expect(codes(textbook(`# 章 {#ch01}\n${deep}`))).toContain(
      'syntax.markdown_notation_forbidden',
    );
  });

  it('閉じない [ を大量に並べても走査量が二乗にならない', () => {
    // 1 つずつ残りを走査し直す実装だと、この入力で取り込みを長時間占有できる。
    const start = performance.now();
    expect(codes(textbook(`# 章 {#ch01}\n${'['.repeat(40_000)}`))).toEqual([]);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('タイトルつきの画像記法から URL だけを取り出す', () => {
    const scan = textbook('# 章 {#ch01}\n![図3-1](assets/fig-0301.png "図3-1")');
    expect(codes(scan)).toEqual([]);
    expect(scan.images).toEqual([{ path: 'fig-0301.png', line: 2 }]);
  });
});

describe('scanMarkdown: 見出し', () => {
  it('見出しと {#id} を取り出す', () => {
    const scan = textbook('# 第3章 データベース              {#ch03}\n## 3.2 正規化 {#ch03-02}');
    expect(scan.headings).toEqual([
      { level: 1, title: '第3章 データベース', id: 'ch03', line: 1 },
      { level: 2, title: '3.2 正規化', id: 'ch03-02', line: 2 },
    ]);
  });

  it('{#id} が無い見出しは id が null になる', () => {
    expect(textbook('# 章').headings[0].id).toBeNull();
  });

  it('最初の見出しより前の本文の行を返す', () => {
    expect(textbook('まえがき\n\n# 章 {#ch01}').bodyBeforeFirstHeading).toBe(1);
    expect(textbook('\n# 章 {#ch01}').bodyBeforeFirstHeading).toBeNull();
  });
});

describe('scanMarkdown: 問題文の文脈(§4.6)', () => {
  it('見出しと画像を拒否する', () => {
    expect(codes(inline('# 見出し'))).toEqual(['syntax.markdown_notation_forbidden']);
    expect(codes(inline('![図](assets/fig-0301.png)'))).toEqual([
      'syntax.markdown_notation_forbidden',
    ]);
  });

  it('行番号ではなく JSON の位置を持つ', () => {
    const [issue] = inline('<div>').issues;
    expect(issue.path).toBe('questions[0].prompt');
    expect(issue.line).toBeUndefined();
  });

  it('コード・強調・数式・表は通す', () => {
    expect(codes(inline('**太字** と `code` と $x^2$ と\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'))).toEqual(
      [],
    );
  });
});
