import { describe, expect, it } from 'vitest';

import { parseTextbook } from './textbook.js';

const VALID = [
  '# 第3章 データベース {#ch03}',
  '',
  '## 3.2 正規化 {#ch03-02}',
  '',
  '### 3.2.1 第1正規形 {#ch03-02-01}',
  '本文。',
  '',
  '### 3.2.2 第2正規形 {#ch03-02-02}',
  '本文。',
  '',
  '## 3.3 SQL {#ch03-03}',
  '',
  '### 3.3.1 SELECT {#ch03-03-01}',
  '本文。',
].join('\n');

const codes = (source: string) => parseTextbook(source).issues.map((issue) => issue.code);

describe('parseTextbook', () => {
  it('正しい教科書から構造を取り出す', () => {
    const { issues, textbook } = parseTextbook(VALID);
    expect(issues).toEqual([]);
    expect(textbook.sectionIds).toEqual(['ch03-02', 'ch03-03']);
    expect([...textbook.sectionOfSubsection]).toEqual([
      ['ch03-02-01', 'ch03-02'],
      ['ch03-02-02', 'ch03-02'],
      ['ch03-03-01', 'ch03-03'],
    ]);
    expect(textbook.ids.has('ch03')).toBe(true);
  });

  it('{#id} の無い見出しを拒否する', () => {
    expect(codes('# 章\n\n## 節 {#s1}\n\n### 項 {#s1-1}')).toContain('syntax.heading_id_missing');
  });

  it('規則を満たさない ID を拒否する', () => {
    for (const id of ['Ch03', 'ch_03', 'ch--03', '-ch03', 'ch03-', 'あ', 'a'.repeat(65)]) {
      expect(codes(`# 章 {#${id}}\n\n## 節 {#s1}\n\n### 項 {#s1-1}`), id).toContain(
        'syntax.heading_id_invalid',
      );
    }
  });

  it('ID の重複を拒否する', () => {
    expect(codes('# 章 {#same}\n\n## 節 {#same}\n\n### 項 {#s1-1}')).toContain(
      'syntax.heading_id_duplicated',
    );
  });

  it('4 階層以上の見出しを拒否する', () => {
    expect(codes(`${VALID}\n\n#### 細目 {#ch03-03-01-01}`)).toContain('syntax.heading_level_invalid');
  });

  it('階層の飛ばしを拒否する', () => {
    expect(codes('# 章 {#ch01}\n\n### 項 {#ch01-01-01}')).toContain('syntax.heading_level_skipped');
    expect(codes('## 節 {#s1}\n\n### 項 {#s1-1}')).toContain('syntax.heading_level_skipped');
  });

  it('最初の見出しより前の本文を拒否する', () => {
    expect(codes(`まえがき\n\n${VALID}`)).toContain('syntax.body_before_first_heading');
  });

  it('章か節が無い教科書を拒否する', () => {
    expect(codes('# 章 {#ch01}\n本文。')).toContain('syntax.heading_missing');
  });

  it('存在しない見出しを指す文書内アンカーを拒否する', () => {
    const issues = parseTextbook(`${VALID}\n\n[参照](#ch99)`).issues;
    expect(issues.map((issue) => issue.code)).toContain('consistency.anchor_not_found');
    expect(issues.at(-1)?.id).toBe('ch99');
  });

  it('前方参照のアンカーは通す', () => {
    expect(codes('# 章 {#ch01}\n\n[先](#ch01-02)\n\n## 節 {#ch01-02}\n\n### 項 {#ch01-02-01}')).toEqual(
      [],
    );
  });


  it('参照している画像を集める', () => {
    const { textbook } = parseTextbook(`${VALID}\n\n![図3-1 正規化](assets/fig-0301.png)`);
    expect([...textbook.imageNames]).toEqual(['fig-0301.png']);
  });

  it('違反があっても読めたところまで返す', () => {
    // 同じ段の違反をまとめて返すため、途中で止めない(§1.6)。
    const { issues, textbook } = parseTextbook('# 章 {#ch01}\n\n## 節\n\n## 節2 {#s2}\n\n### 項 {#s2-1}');
    expect(issues.map((issue) => issue.code)).toEqual(['syntax.heading_id_missing']);
    expect(textbook.sectionIds).toEqual(['s2']);
  });
});
