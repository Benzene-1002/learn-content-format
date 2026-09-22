import { describe, expect, it } from 'vitest';

import { parseTextbook } from './textbook.js';
import { splitTextbook } from './textbook-split.js';

/** 検証を通った教科書を用意する(割る側は、通ったものしか受け取らない)。 */
function split(source: string) {
  const parsed = parseTextbook(source);
  expect(parsed.issues, JSON.stringify(parsed.issues)).toEqual([]);
  return splitTextbook(source, parsed.textbook);
}

const SOURCE = [
  '# 第3章 データベース {#ch03}',
  '',
  'この章では関係データベースを扱う。',
  '',
  '## 3.2 正規化 {#ch03-02}',
  '',
  '正規化とは何か。',
  '',
  '### 3.2.1 第1正規形 {#ch03-02-01}',
  '',
  '繰り返しを持たない形。',
  '',
  '| 列 | 意味 |',
  '| --- | --- |',
  '| a | b |',
  '',
  '### 3.2.2 第2正規形 {#ch03-02-02}',
  '',
  '部分関数従属を取り除く。',
  '',
  '# 第4章 ネットワーク {#ch04}',
  '',
  '最後の章。',
  '',
].join('\n');

describe('splitTextbook', () => {
  it('見出しごとに 1 行にし、文書順の並び番号を振る', () => {
    const nodes = split(SOURCE);

    expect(nodes.map((node) => node.nodeId)).toEqual([
      'ch03',
      'ch03-02',
      'ch03-02-01',
      'ch03-02-02',
      'ch04',
    ]);
    expect(nodes.map((node) => node.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it('本文は見出しの次から、次の見出しの手前まで', () => {
    const nodes = split(SOURCE);
    const subsection = nodes.find((node) => node.nodeId === 'ch03-02-01');

    expect(subsection?.body).toBe(
      ['繰り返しを持たない形。', '', '| 列 | 意味 |', '| --- | --- |', '| a | b |'].join('\n'),
    );
  });

  it('最後の見出しの本文は文書の終わりまで', () => {
    expect(split(SOURCE).at(-1)?.body).toBe('最後の章。');
  });

  it('章・節・項の所属を持つ', () => {
    const nodes = split(SOURCE);
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));

    expect(byId.get('ch03')).toMatchObject({ level: 1, chapterId: 'ch03', sectionId: null });
    expect(byId.get('ch03-02')).toMatchObject({
      level: 2,
      chapterId: 'ch03',
      sectionId: 'ch03-02',
    });
    expect(byId.get('ch03-02-02')).toMatchObject({
      level: 3,
      chapterId: 'ch03',
      sectionId: 'ch03-02',
    });
    // 章が変わったら、そこから先は新しい章に属する。
    expect(byId.get('ch04')).toMatchObject({ level: 1, chapterId: 'ch04', sectionId: null });
  });

  it('本文の無い見出しは空文字になる', () => {
    const nodes = split(
      ['# 章 {#ch01}', '## 節 {#ch01-01}', '### 項 {#ch01-01-01}', '本文', ''].join('\n'),
    );

    expect(nodes[0].body).toBe('');
    expect(nodes[1].body).toBe('');
    expect(nodes[2].body).toBe('本文');
  });

  it('見出しの行そのものは本文に含めない', () => {
    for (const node of split(SOURCE)) {
      expect(node.body).not.toContain('{#');
    }
  });
});
