/**
 * 教科書を見出し単位に割る(ADR 0009 決定 3、roadmap p21)。
 *
 * 保存も表示も**項(`###`)単位**で行う。本文は最大 5MB あり、端末に丸ごと
 * 送れない(要件 §2.3 はスマホが主)。誤答したら根拠の項が 1 行で引け、
 * そこから前後へ読み進められ、目次は章と節だけを並べれば作れる、という
 * 3 つの読まれ方に、この形がそのまま対応する。
 *
 * 割るのは取り込みのときの 1 度だけ。p20 の解析(見出しの実在と一意性を
 * 確かめる工程)がすでに同じ構造を作っているので、ここは**本文を切り出して
 * 並び順を付ける**だけで済む。
 *
 * 純粋関数。DB もファイル I/O も持たない。
 */

import type { Textbook } from './textbook.js';

export type TextbookNode = {
  readonly nodeId: string;
  readonly level: 1 | 2 | 3;
  readonly chapterId: string;
  /** 節と項は所属する節。章は `null`。到達集計(要件 §4.4)がこの単位で束ねる。 */
  readonly sectionId: string | null;
  readonly title: string;
  /** 見出しの下から次の見出しまでの Markdown。描画のときに許可した記法だけを通す。 */
  readonly body: string;
  /** 文書順。前後へ読み進めるときは同じ世代の ±1 を引く。 */
  readonly position: number;
};

/**
 * 検証を通った教科書を、保存する行の並びにする。
 *
 * **検証を通っていることが前提**。見出しの階層・ID の実在と一意性は p20 が
 * 確かめ済みで、ここではもう疑わない(§5.8 A を通ったものだけが来る)。
 */
export function splitTextbook(source: string, textbook: Textbook): readonly TextbookNode[] {
  const lines = source.split('\n');
  const nodes: TextbookNode[] = [];
  let chapterId: string | null = null;

  textbook.headings.forEach((heading, index) => {
    if (heading.level === 1) {
      chapterId = heading.id;
    }
    // 章より前に節や項は来ない(p20 が階層を確かめている)。
    if (chapterId === null) return;

    const next = textbook.headings[index + 1];
    // 見出しの行は本文に含めない。次の見出しの手前までが、この見出しの本文。
    const from = heading.line;
    const to = next === undefined ? lines.length : next.line - 1;

    nodes.push({
      nodeId: heading.id,
      level: heading.level,
      chapterId,
      sectionId: sectionIdOf(heading.level, heading.id, textbook),
      title: heading.title,
      body: lines.slice(from, to).join('\n').trim(),
      position: nodes.length,
    });
  });

  return nodes;
}

function sectionIdOf(level: 1 | 2 | 3, id: string, textbook: Textbook): string | null {
  if (level === 1) return null;
  if (level === 2) return id;
  return textbook.sectionOfSubsection.get(id) ?? null;
}
