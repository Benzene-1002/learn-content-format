import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type ExtractedEntry, type ExtractedPackage, validateContentPackage } from './validate.js';

// fixtures はリポジトリ直下に置く(`src/` の下ではない)。利用側が
// `node_modules/learn-content-format/fixtures/valid` を実ファイルとして読むため。
const FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'valid');

/** 正常な fixture を、ZIP を展開した結果の形で読み込む。 */
function loadValidPackage(): ExtractedEntry[] {
  const entries: ExtractedEntry[] = [];
  for (const name of readdirSync(FIXTURE_DIR).sort()) {
    if (name === 'assets') continue;
    entries.push({ name, bytes: new Uint8Array(readFileSync(join(FIXTURE_DIR, name))) });
  }
  entries.push({ name: 'assets/', bytes: new Uint8Array() });
  for (const name of readdirSync(join(FIXTURE_DIR, 'assets')).sort()) {
    entries.push({
      name: `assets/${name}`,
      bytes: new Uint8Array(readFileSync(join(FIXTURE_DIR, 'assets', name))),
    });
  }
  return entries;
}

const encode = (text: string) => new TextEncoder().encode(text);

/** 正常な fixture の 1 ファイルだけを差し替える。 */
function withFile(name: string, content: string | Uint8Array): ExtractedPackage {
  const bytes = typeof content === 'string' ? encode(content) : content;
  const entries = loadValidPackage().filter((entry) => entry.name !== name);
  entries.push({ name, bytes });
  return { entries };
}

/** 正常な fixture の JSON を読み、書き換えて差し替える。 */
function withJson(name: string, mutate: (value: Record<string, never>) => void): ExtractedPackage {
  const original = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8'));
  mutate(original);
  return withFile(name, JSON.stringify(original, null, 2));
}

/** 正常な fixture の JSON を複数まとめて書き換える。ファイルをまたぐ条件を試すため。 */
function withJsons(
  mutations: Record<string, (value: Record<string, never>) => void>,
): ExtractedPackage {
  const replaced = new Map(
    Object.entries(mutations).map(([name, mutate]) => {
      const original = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8'));
      mutate(original);
      return [name, encode(JSON.stringify(original, null, 2))];
    }),
  );
  const entries = loadValidPackage().filter((entry) => !replaced.has(entry.name));
  for (const [name, bytes] of replaced) entries.push({ name, bytes });
  return { entries };
}

/** 問数の違う 2 区分。a は 60 問、b は fixture の模試と同じ 2 問。 */
const TWO_PARTS = [
  { id: 'a', name: '科目A', questionCount: 60, durationMinutes: 90, passingScorePercent: 60 },
  { id: 'b', name: '科目B', questionCount: 2, durationMinutes: 100, passingScorePercent: 60 },
];

function withoutFile(name: string): ExtractedPackage {
  return { entries: loadValidPackage().filter((entry) => entry.name !== name) };
}

function issuesOf(input: ExtractedPackage) {
  const result = validateContentPackage(input);
  expect(result.ok, '拒否されるはずのパッケージが通った').toBe(false);
  return result.ok ? [] : result.issues;
}

const codesOf = (input: ExtractedPackage) => issuesOf(input).map((issue) => issue.code);

describe('validateContentPackage: 正常なパッケージ', () => {
  it('取り込める', () => {
    const result = validateContentPackage({ entries: loadValidPackage() });
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));

    expect(result.package.exam.id).toBe('fe');
    expect(result.package.textbook.sectionIds).toEqual(['ch03-02', 'ch03-03']);
    expect(result.package.questions).toHaveLength(6);
    expect(result.package.mockExams).toHaveLength(1);
    expect([...result.package.assets.keys()]).toEqual(['fig-0301.png']);
  });

  it('模試セットは無くてもよい(要件 §6.5)', () => {
    expect(validateContentPackage(withoutFile('mock-exams.json')).ok).toBe(true);
  });
});

describe('validateContentPackage: パッケージ段(§1.1 / §1.4 / §1.5)', () => {
  it('必須のファイルが無ければ拒否する', () => {
    for (const name of ['manifest.json', 'exam.json', 'textbook.md', 'questions.json']) {
      expect(codesOf(withoutFile(name)), name).toContain('package.entry_missing');
    }
  });

  it('想定外のファイルを拒否する', () => {
    expect(codesOf(withFile('README.md', '# x'))).toContain('package.entry_unexpected');
  });

  it('ディレクトリを遡るエントリ名を拒否する', () => {
    for (const name of ['assets/../secret.png', '../secret.png', '/etc/passwd', 'assets\\x.png']) {
      expect(codesOf(withFile(name, 'x')), name).toContain('package.path_unsafe');
    }
  });

  it('拡張子と中身が食い違う画像を拒否する', () => {
    // 中身は SVG だが .png を名乗る。配信時の MIME と実体がずれる。
    expect(codesOf(withFile('assets/fake.png', '<svg onload="alert(1)"></svg>'))).toContain(
      'package.asset_content_mismatch',
    );
  });

  it('許可していない拡張子と名前を拒否する', () => {
    expect(codesOf(withFile('assets/fig.gif', 'x'))).toContain(
      'package.asset_extension_unsupported',
    );
    expect(codesOf(withFile('assets/Fig-0302.png', 'x'))).toContain('package.asset_name_invalid');
  });

  it('上限を超えたファイルを拒否する', () => {
    const huge = 'あ'.repeat(2 * 1024 * 1024);
    expect(codesOf(withFile('textbook.md', huge.repeat(2)))).toContain('package.limit_exceeded');
  });

  it('理由と場所を添えて返す', () => {
    const [issue] = issuesOf(withFile('README.md', '# x')).filter(
      (candidate) => candidate.code === 'package.entry_unexpected',
    );
    expect(issue.file).toBe('README.md');
    expect(issue.stage).toBe('package');
    expect(issue.message).toContain('§1.1');
  });
});

describe('validateContentPackage: 構文段(§1.3 / §3)', () => {
  it('JSON として読めなければ拒否する', () => {
    expect(codesOf(withFile('questions.json', '{'))).toContain('syntax.json_unparsable');
  });

  it('UTF-8 として読めなければ拒否する', () => {
    expect(codesOf(withFile('exam.json', Uint8Array.from([0xff, 0xfe, 0x00])))).toContain(
      'syntax.encoding_invalid',
    );
  });

  it('メジャーの違う形式を拒否する(§1.3)', () => {
    expect(
      codesOf(withJson('manifest.json', (m) => Object.assign(m, { formatVersion: '3.0' }))),
    ).toContain('syntax.format_version_unsupported');
  });

  it('v1.x のパッケージを読み替えずに拒否する(§1.3、ADR 0012 決定 4)', () => {
    const issues = issuesOf(
      withJson('manifest.json', (m) => Object.assign(m, { formatVersion: '1.0' })),
    );
    expect(issues.map((issue) => issue.code)).toEqual(['syntax.format_version_unsupported']);
    expect(issues[0].message).toContain('メジャー 2');
  });

  it('マイナーが上の形式は受理する(§1.3)', () => {
    expect(
      validateContentPackage(withJson('manifest.json', (m) => Object.assign(m, { formatVersion: '2.9' })))
        .ok,
    ).toBe(true);
  });

  it('BOM・CR・制御文字を拒否する(§1.1 / §7.2)', () => {
    const textbook = readFileSync(join(FIXTURE_DIR, 'textbook.md'), 'utf-8');
    // BOM はバイト列で見ないと分からない(TextDecoder が黙って落とす)。
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...encode(textbook)]);
    expect(codesOf(withFile('textbook.md', withBom))).toContain('syntax.encoding_invalid');
    expect(codesOf(withFile('textbook.md', textbook.replace(/\n/g, '\r\n')))).toContain(
      'syntax.encoding_invalid',
    );
    expect(codesOf(withFile('textbook.md', `${textbook}\n\n壊れた\u0000本文。`))).toContain(
      'syntax.encoding_invalid',
    );
    // JSON も同じ規則の対象(§1.1)。
    const exam = readFileSync(join(FIXTURE_DIR, 'exam.json'), 'utf-8');
    expect(
      codesOf(withFile('exam.json', new Uint8Array([0xef, 0xbb, 0xbf, ...encode(exam)]))),
    ).toContain('syntax.encoding_invalid');
  });

  it('教科書の raw HTML と危険な URL を拒否する', () => {
    const textbook = readFileSync(join(FIXTURE_DIR, 'textbook.md'), 'utf-8');
    expect(codesOf(withFile('textbook.md', `${textbook}\n\n<script>alert(1)</script>`))).toContain(
      'syntax.markdown_html_forbidden',
    );
    expect(codesOf(withFile('textbook.md', `${textbook}\n\n[押すな](javascript:alert(1))`))).toContain(
      'syntax.markdown_url_forbidden',
    );
  });

  it('見出しの ID が無い・重複する教科書を拒否する(§6 の条件 4)', () => {
    const textbook = readFileSync(join(FIXTURE_DIR, 'textbook.md'), 'utf-8');
    expect(codesOf(withFile('textbook.md', `${textbook}\n\n### 3.3.2 INSERT\n本文。`))).toContain(
      'syntax.heading_id_missing',
    );
    expect(
      codesOf(withFile('textbook.md', `${textbook}\n\n### 3.3.2 INSERT {#ch03-03-01}\n本文。`)),
    ).toContain('syntax.heading_id_duplicated');
  });
});

describe('validateContentPackage: スキーマ段(§4)', () => {
  it('問題の型が満たすべき条件を確かめる', () => {
    expect(
      codesOf(
        withJson('questions.json', (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.questions[0].answer = [99];
        }),
      ),
    ).toContain('schema.invalid');
  });

  it('JSON の位置を添えて返す', () => {
    const [issue] = issuesOf(
      withJson('questions.json', (file) => {
        // @ts-expect-error fixture を壊すための書き換え
        file.questions[2].difficulty = 9;
      }),
    );
    expect(issue.file).toBe('questions.json');
    expect(issue.path).toBe('questions[2].difficulty');
  });

  it('問題文に raw HTML や画像を書けない(§4.6)', () => {
    expect(
      codesOf(
        withJson('questions.json', (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.questions[0].prompt = '<img src=x onerror=alert(1)>';
        }),
      ),
    ).toContain('syntax.markdown_html_forbidden');
    expect(
      codesOf(
        withJson('questions.json', (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.questions[0].prompt = '![図](assets/fig-0301.png)';
        }),
      ),
    ).toContain('syntax.markdown_notation_forbidden');
  });
});

describe('validateContentPackage: 整合段(§6)', () => {
  it('条件 1: 根拠が実在しなければ拒否する', () => {
    const issues = issuesOf(
      withJson('questions.json', (file) => {
        // @ts-expect-error fixture を壊すための書き換え
        file.questions[0].source = 'ch99-99-99';
      }),
    );
    expect(issues.map((issue) => issue.code)).toContain('consistency.source_not_found');
    expect(issues.some((issue) => issue.id === 'ch99-99-99')).toBe(true);
  });

  it('条件 1: 根拠が項でなく章・節なら拒否する', () => {
    expect(
      codesOf(
        withJson('questions.json', (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.questions[0].source = 'ch03-02';
        }),
      ),
    ).toContain('consistency.source_not_subsection');
  });

  it('条件 2: 同じ根拠の問題が 1 問しかなければ拒否する', () => {
    const issues = issuesOf(
      withJson('questions.json', (file) => {
        // @ts-expect-error fixture を壊すための書き換え
        file.questions = file.questions.filter((question) => question.id !== 'q-0002');
      }),
    );
    const single = issues.find((issue) => issue.code === 'consistency.source_single_question');
    expect(single?.id).toBe('ch03-02-01');
    expect(single?.message).toContain('類題');
  });

  it('条件 3: 問題の無い節を拒否する', () => {
    const textbook = readFileSync(join(FIXTURE_DIR, 'textbook.md'), 'utf-8');
    const issues = issuesOf(
      withFile('textbook.md', `${textbook}\n\n## 3.4 トランザクション {#ch03-04}\n\n### 3.4.1 ACID {#ch03-04-01}\n本文。`),
    );
    const orphan = issues.find(
      (issue) => issue.code === 'consistency.section_without_gradable_question',
    );
    expect(orphan?.id).toBe('ch03-04');
    expect(orphan?.message).toContain('永久に到達できず');
  });

  it('条件 3: フラッシュカードだけの節を拒否する(§5.6)', () => {
    const issues = issuesOf(
      withJson('questions.json', (file) => {
        // @ts-expect-error fixture を壊すための書き換え
        file.questions = file.questions.map((question) =>
          question.source.startsWith('ch03-03')
            ? { ...question, type: 'flashcard', answer: '自己判定', options: undefined, tolerance: undefined, unit: undefined }
            : question,
        );
      }),
    );
    const orphan = issues.find(
      (issue) => issue.code === 'consistency.section_without_gradable_question',
    );
    expect(orphan?.id).toBe('ch03-03');
  });

  it('問題文の文書内アンカーが指す見出しを確かめる(§4.6 / §3.3)', () => {
    expect(
      codesOf(
        withJson('questions.json', (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.questions[0].explanation = '詳しくは [3.9 未定義](#ch99-99) を参照。';
        }),
      ),
    ).toContain('consistency.anchor_not_found');
    expect(
      validateContentPackage(
        withJson('questions.json', (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.questions[0].explanation = '詳しくは [3.2.2 第2正規形](#ch03-02-02) を参照。';
        }),
      ).ok,
    ).toBe(true);
  });

  it('大文字小文字の違うアンカー・画像を一致させない', () => {
    const textbook = readFileSync(join(FIXTURE_DIR, 'textbook.md'), 'utf-8');
    expect(codesOf(withFile('textbook.md', `${textbook}\n\n[参照](#CH03)`))).toContain(
      'consistency.anchor_not_found',
    );
    expect(
      codesOf(withFile('textbook.md', textbook.replace('assets/fig-0301.png', 'assets/FIG-0301.PNG'))),
    ).toContain('consistency.image_not_found');
  });

  it('問題 ID の重複を拒否する(日々の問題集と模試をまたいで数える)', () => {
    expect(
      codesOf(
        withJson('mock-exams.json', (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.mockExams[0].questions[0].id = 'q-0001';
        }),
      ),
    ).toContain('consistency.question_id_duplicated');
  });

  it('模試の問題数が、その区分の本番の問数と違えば拒否する(§5 / §6 の条件 6)', () => {
    const issues = issuesOf(
      withJson('exam.json', (file) => {
        // @ts-expect-error fixture を壊すための書き換え
        file.parts[0].questionCount = 60;
      }),
    );
    const mismatch = issues.find(
      (issue) => issue.code === 'consistency.mock_question_count_mismatch',
    );
    expect(mismatch?.id).toBe('mock-01');
    expect(mismatch?.message).toContain('"main"');
  });

  it('模試の問題数は、その模試の part が指す区分と照らす(先頭の区分ではない)', () => {
    // 区分 a は 60 問、b は fixture の模試と同じ 2 問。照らす相手で結果が変わる。
    const withParts = (mockPart: string) =>
      withJsons({
        'exam.json': (file) => Object.assign(file, { parts: TWO_PARTS }),
        'mock-exams.json': (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.mockExams[0].part = mockPart;
        },
      });

    expect(validateContentPackage(withParts('b')).ok).toBe(true);
    const mismatch = issuesOf(withParts('a')).find(
      (issue) => issue.code === 'consistency.mock_question_count_mismatch',
    );
    expect(mismatch?.id).toBe('mock-01');
    expect(mismatch?.message).toContain('"a"');
    expect(mismatch?.message).toContain('60');
  });

  it('存在しない区分を指す問題を拒否する(§6 の条件 5)', () => {
    const issues = issuesOf(
      withJson('questions.json', (file) => {
        // @ts-expect-error fixture を壊すための書き換え
        file.questions[2].part = 'b';
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'consistency.part_not_found',
        stage: 'consistency',
        file: 'questions.json',
        path: 'questions[2].part',
        id: 'b',
      }),
    ]);
    expect(issues[0].message).toContain('"main"');
  });

  it('存在する区分を指す問題は通す(§4.7)', () => {
    expect(
      validateContentPackage(
        withJson('questions.json', (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.questions[2].part = 'main';
        }),
      ).ok,
    ).toBe(true);
  });

  it('存在しない区分を指す模試を拒否し、問題数は照らさない(§6 の条件 5・6)', () => {
    // main の問数を模試(2 問)と違う値にしておく。誤って別の区分と照らせば不一致が出る。
    const issues = issuesOf(
      withJsons({
        'exam.json': (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.parts[0].questionCount = 60;
        },
        'mock-exams.json': (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.mockExams[0].part = 'b';
        },
      }),
    );
    // 照らす相手の区分が無いので、問題数の不一致は出さない(出しても直し方が分からない)。
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'consistency.part_not_found',
        file: 'mock-exams.json',
        path: 'mockExams[0].part',
        id: 'b',
      }),
    ]);
  });

  it('区分 ID の大文字小文字の違いを同じ区分と見なさない', () => {
    // ID の規則で大文字は書けないので、スキーマ段で落ちる。整合段まで進まない。
    const issues = issuesOf(
      withJson('mock-exams.json', (file) => {
        // @ts-expect-error fixture を壊すための書き換え
        file.mockExams[0].part = 'MAIN';
      }),
    );
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['schema.invalid', 'mockExams[0].part'],
    ]);
  });

  it('条件 2 は区分ごとに数えない(§4.7)。同じ根拠の 2 問が別の区分でも通す', () => {
    // q-0001 と q-0002 は根拠 ch03-02-01 の 2 問。区分を分けても類題は区分をまたいで出せる。
    const result = validateContentPackage(
      withJsons({
        'exam.json': (file) => Object.assign(file, { parts: TWO_PARTS }),
        'mock-exams.json': (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.mockExams[0].part = 'b';
        },
        'questions.json': (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.questions[0].part = 'a';
          // @ts-expect-error fixture を壊すための書き換え
          file.questions[1].part = 'b';
        },
      }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  });

  it('条件 3 は区分ごとに数えない(§4.7)。節の算入できる問題が 1 区分にしか無くても通す', () => {
    // 節 ch03-03 の問題(q-0005 / q-0006)をすべて区分 a にする。区分 b から見るとこの節の
    // 問題は 0 問だが、到達判定は区分に関わらず 1 つなので拒否しない。
    const result = validateContentPackage(
      withJsons({
        'exam.json': (file) => Object.assign(file, { parts: TWO_PARTS }),
        'mock-exams.json': (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.mockExams[0].part = 'b';
        },
        'questions.json': (file) => {
          // @ts-expect-error fixture を壊すための書き換え
          file.questions[4].part = 'a';
          // @ts-expect-error fixture を壊すための書き換え
          file.questions[5].part = 'a';
        },
      }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  });

  it('存在しない画像の参照と、参照されない画像を拒否する', () => {
    const textbook = readFileSync(join(FIXTURE_DIR, 'textbook.md'), 'utf-8');
    expect(
      codesOf(withFile('textbook.md', `${textbook}\n\n![図3-2 無い図](assets/fig-9999.png)`)),
    ).toContain('consistency.image_not_found');
    expect(
      codesOf(withFile('textbook.md', textbook.replace(/!\[図3-1[^\n]*\n/, ''))),
    ).toContain('package.asset_unreferenced');
  });
});

describe('validateContentPackage: 違反の返し方(§1.6)', () => {
  it('同じ段の違反を 1 件目で止めずに集める', () => {
    const issues = issuesOf(
      withJson('questions.json', (file) => {
        // @ts-expect-error fixture を壊すための書き換え
        file.questions[0].source = 'ch99-99-99';
        // @ts-expect-error fixture を壊すための書き換え
        file.questions[2].source = 'ch88-88-88';
      }),
    );
    expect(
      issues.filter((issue) => issue.code === 'consistency.source_not_found'),
    ).toHaveLength(2);
  });

  it('前の段で落ちたら、その先の段は判定しない', () => {
    // JSON として読めない時点で、スキーマも整合も判定できない。
    const issues = issuesOf(withFile('questions.json', '{'));
    expect(new Set(issues.map((issue) => issue.stage))).toEqual(new Set(['syntax']));
  });
});
