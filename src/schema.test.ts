import { describe, expect, it } from 'vitest';

import {
  examSchema,
  isSupportedFormatVersion,
  manifestSchema,
  mockExamsFileSchema,
  questionSchema,
  questionsFileSchema,
  toContentIssues,
} from './schema.js';

const choice = {
  id: 'q-0412',
  type: 'choice',
  source: 'ch03-02-01',
  difficulty: 2,
  prompt: '第1正規形の条件として正しいものはどれか。',
  options: ['あ', 'い', 'う', 'え'],
  answer: [1],
};

describe('manifestSchema', () => {
  const valid = {
    formatVersion: '2.0',
    generator: 'converter',
    generatorVersion: '0.3.1',
    generatedAt: '2026-09-20T10:00:00Z',
  };

  it('正しい manifest を通す', () => {
    expect(manifestSchema.parse(valid)).toEqual(valid);
  });

  it('未知のフィールドを黙って落とす(§1.3)', () => {
    expect(manifestSchema.parse({ ...valid, future: 'x' })).toEqual(valid);
  });

  it('形式の版と日時の形を確かめる', () => {
    expect(manifestSchema.safeParse({ ...valid, formatVersion: '2' }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...valid, generatedAt: '2026-09-20' }).success).toBe(false);
  });
});

describe('isSupportedFormatVersion', () => {
  it('メジャーが同じなら、マイナーが上でも受理する(§1.3)', () => {
    expect(isSupportedFormatVersion('2.0')).toBe(true);
    expect(isSupportedFormatVersion('2.7')).toBe(true);
  });

  it('古いメジャー(v1.x)は読み替えずに拒否する(§1.3、ADR 0012 決定 4)', () => {
    expect(isSupportedFormatVersion('1.0')).toBe(false);
    expect(isSupportedFormatVersion('1.9')).toBe(false);
  });

  it('メジャーが違えば拒否する', () => {
    expect(isSupportedFormatVersion('3.0')).toBe(false);
    expect(isSupportedFormatVersion('0.9')).toBe(false);
    expect(isSupportedFormatVersion('x')).toBe(false);
  });
});

describe('examSchema', () => {
  const part = {
    id: 'a',
    name: '科目A',
    questionCount: 60,
    durationMinutes: 90,
    passingScorePercent: 60,
  };
  const exam = { id: 'fe', name: '基本情報技術者試験', parts: [part] };

  /** 違反の位置だけを取り出す。どの規則で落ちたかを確かめるため。 */
  const failedPaths = (value: unknown) => {
    const result = examSchema.safeParse(value);
    expect(result.success, '拒否されるはずの exam.json が通った').toBe(false);
    return result.success ? [] : toContentIssues(result.error, 'exam.json').map((issue) => issue.path);
  };

  it('区分 1 つと 2 つを通す(§2)', () => {
    expect(examSchema.parse(exam)).toEqual(exam);
    const twoParts = { ...exam, parts: [part, { ...part, id: 'b', name: '科目B', questionCount: 20 }] };
    expect(examSchema.parse(twoParts)).toEqual(twoParts);
  });

  it('parts は模試セットの有無に関わらず必須(要件 §5.1)', () => {
    expect(failedPaths({ id: 'fe', name: '基本情報技術者試験' })).toEqual(['parts']);
  });

  it('v1.0 の realExam だけでは通らない。realExam は未知のフィールドとして落とす(§9)', () => {
    const realExam = { questionCount: 60, durationMinutes: 90, passingScorePercent: 60 };
    expect(failedPaths({ id: 'fe', name: '基本情報技術者試験', realExam })).toEqual(['parts']);
    expect(examSchema.parse({ ...exam, realExam })).toEqual(exam);
  });

  it('空の parts を拒否する(§2.1。「区分が無い」書き方は用意しない)', () => {
    expect(failedPaths({ ...exam, parts: [] })).toEqual(['parts']);
  });

  it('区分は 10 個まで(§2)', () => {
    const parts = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ ...part, id: `p${index}` }));
    expect(examSchema.safeParse({ ...exam, parts: parts(10) }).success).toBe(true);
    expect(failedPaths({ ...exam, parts: parts(11) })).toEqual(['parts']);
  });

  it('区分 ID の重複を拒否する(§7.1)', () => {
    expect(failedPaths({ ...exam, parts: [part, { ...part, name: '科目B' }] })).toEqual([
      'parts[1].id',
    ]);
  });

  it('区分 ID は ID の規則に従う(§7.1)', () => {
    expect(failedPaths({ ...exam, parts: [{ ...part, id: 'Part_A' }] })).toEqual(['parts[0].id']);
  });

  it('区分名は 1〜100 文字(§2)', () => {
    expect(failedPaths({ ...exam, parts: [{ ...part, name: '  ' }] })).toEqual(['parts[0].name']);
    expect(examSchema.safeParse({ ...exam, parts: [{ ...part, name: 'あ'.repeat(100) }] }).success).toBe(
      true,
    );
    expect(failedPaths({ ...exam, parts: [{ ...part, name: 'あ'.repeat(101) }] })).toEqual([
      'parts[0].name',
    ]);
  });

  it('区分の本番の条件は範囲内の整数(§2)', () => {
    expect(failedPaths({ ...exam, parts: [{ ...part, questionCount: 0 }] })).toEqual([
      'parts[0].questionCount',
    ]);
    expect(failedPaths({ ...exam, parts: [{ ...part, durationMinutes: 601 }] })).toEqual([
      'parts[0].durationMinutes',
    ]);
    expect(failedPaths({ ...exam, parts: [{ ...part, passingScorePercent: 60.5 }] })).toEqual([
      'parts[0].passingScorePercent',
    ]);
  });

  it('区分の各項目は必須(§2)', () => {
    const { passingScorePercent: _, ...withoutPassing } = part;
    expect(failedPaths({ ...exam, parts: [withoutPassing] })).toEqual([
      'parts[0].passingScorePercent',
    ]);
  });
});

describe('questionSchema', () => {
  it('多肢選択を通す', () => {
    expect(questionSchema.safeParse(choice).success).toBe(true);
  });

  it('ID の規則を守らせる(§7.1)', () => {
    expect(questionSchema.safeParse({ ...choice, id: 'Q_0412' }).success).toBe(false);
  });

  it('難易度は 1〜5 の整数(ADR 0008)', () => {
    expect(questionSchema.safeParse({ ...choice, difficulty: 0 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...choice, difficulty: 6 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...choice, difficulty: 2.5 }).success).toBe(false);
  });

  it('制御文字を含む文字列を拒否する(§7.2)', () => {
    expect(questionSchema.safeParse({ ...choice, prompt: '壊れた\u0000文' }).success).toBe(false);
  });

  it('空白だけの必須文字列を拒否する(§7.2)', () => {
    expect(questionSchema.safeParse({ ...choice, prompt: '   ' }).success).toBe(false);
  });

  it('null を受け付けない(§7.3)', () => {
    expect(questionSchema.safeParse({ ...choice, explanation: null }).success).toBe(false);
  });

  it('多肢選択の正解はちょうど 1 つ(§4.2)', () => {
    expect(questionSchema.safeParse({ ...choice, answer: [] }).success).toBe(false);
    expect(questionSchema.safeParse({ ...choice, answer: [0, 1] }).success).toBe(false);
  });

  it('正解の添字が選択肢の範囲を超えたら拒否する', () => {
    expect(questionSchema.safeParse({ ...choice, answer: [4] }).success).toBe(false);
  });

  it('選択肢の重複を拒否する(§4.2)', () => {
    expect(questionSchema.safeParse({ ...choice, options: ['あ', 'あ'] }).success).toBe(false);
  });

  it('複数選択の正解の重複を拒否する(§4.3)', () => {
    const multi = { ...choice, type: 'multi', answer: [0, 0] };
    expect(questionSchema.safeParse(multi).success).toBe(false);
    expect(questionSchema.safeParse({ ...multi, answer: [0, 2] }).success).toBe(true);
  });

  it('数値回答は許容誤差を必須にする(§4.4)', () => {
    const numeric = {
      id: 'q-1',
      type: 'numeric',
      source: 'ch03-02-01',
      difficulty: 3,
      prompt: '2 進数 1010 を 10 進数で表すと。',
      answer: 10,
    };
    expect(questionSchema.safeParse(numeric).success).toBe(false);
    expect(
      questionSchema.safeParse({ ...numeric, tolerance: { type: 'absolute', value: 0 } }).success,
    ).toBe(true);
  });

  it('正解が 0 のときの相対誤差を拒否する(§4.4)', () => {
    const numeric = {
      id: 'q-1',
      type: 'numeric',
      source: 'ch03-02-01',
      difficulty: 3,
      prompt: '答えは。',
      answer: 0,
      tolerance: { type: 'relative', value: 0.01 },
    };
    expect(questionSchema.safeParse(numeric).success).toBe(false);
    expect(
      questionSchema.safeParse({ ...numeric, tolerance: { type: 'absolute', value: 0.01 } }).success,
    ).toBe(true);
  });

  it('区分は任意・単数で、ID の規則に従う(§4.7)', () => {
    expect(questionSchema.parse({ ...choice, part: 'b' })).toEqual({ ...choice, part: 'b' });
    expect(questionSchema.safeParse({ ...choice, part: ['a', 'b'] }).success).toBe(false);
    expect(questionSchema.safeParse({ ...choice, part: 'B' }).success).toBe(false);
  });

  it('フラッシュカードは裏面を持つ(§4.5)', () => {
    const flashcard = {
      id: 'q-2',
      type: 'flashcard',
      source: 'ch03-02-01',
      difficulty: 1,
      prompt: '正規化とは。',
      answer: 'データの重複を排除すること。',
    };
    expect(questionSchema.safeParse(flashcard).success).toBe(true);
  });
});

describe('questionsFileSchema', () => {
  it('問題が 1 問も無いファイルを拒否する', () => {
    expect(questionsFileSchema.safeParse({ questions: [] }).success).toBe(false);
  });
});

describe('mockExamsFileSchema', () => {
  const mockExam = { id: 'mock-01', name: '模試 第1回', part: 'a', questions: [choice] };

  it('模試セットを通す', () => {
    expect(mockExamsFileSchema.safeParse({ mockExams: [mockExam] }).success).toBe(true);
  });

  it('模試の区分は必須(§5。区分が 1 つの試験でも書く)', () => {
    const { part: _, ...withoutPart } = mockExam;
    const result = mockExamsFileSchema.safeParse({ mockExams: [withoutPart] });
    expect(result.success).toBe(false);
    expect(toContentIssues(result.error!, 'mock-exams.json').map((issue) => issue.path)).toEqual([
      'mockExams[0].part',
    ]);
  });

  it('模試の区分は ID の規則に従う(§7.1)', () => {
    expect(mockExamsFileSchema.safeParse({ mockExams: [{ ...mockExam, part: 'A' }] }).success).toBe(
      false,
    );
  });

  it('模試の問題に part を書いたら拒否する(§5。区分は模試の part で決まる)', () => {
    for (const question of [
      { ...choice, part: 'a' },
      { ...choice, type: 'multi', part: 'a' },
      {
        id: 'm-3',
        type: 'numeric',
        source: 'ch03-02-01',
        difficulty: 3,
        prompt: '答えは。',
        answer: 1,
        tolerance: { type: 'absolute', value: 0 },
        part: 'a',
      },
    ]) {
      const result = mockExamsFileSchema.safeParse({
        mockExams: [{ ...mockExam, questions: [question] }],
      });
      expect(result.success, question.type).toBe(false);
      const [issue] = toContentIssues(result.error!, 'mock-exams.json');
      expect(issue.path).toBe('mockExams[0].questions[0].part');
      expect(issue.message).toContain('§5');
    }
  });

  it('空の配列を拒否する(無いならファイルごと省略する)', () => {
    expect(mockExamsFileSchema.safeParse({ mockExams: [] }).success).toBe(false);
  });

  it('模試にフラッシュカードは入れられない(§5)', () => {
    const flashcard = {
      id: 'm-2',
      type: 'flashcard',
      source: 'ch03-02-01',
      difficulty: 1,
      prompt: '正規化とは。',
      answer: '重複の排除。',
    };
    expect(
      mockExamsFileSchema.safeParse({ mockExams: [{ ...mockExam, questions: [flashcard] }] }).success,
    ).toBe(false);
  });
});

describe('toContentIssues', () => {
  it('Zod の位置を JSON の位置に直す', () => {
    const result = questionsFileSchema.safeParse({
      questions: [{ ...choice, options: ['あ', 'あ'] }],
    });
    expect(result.success).toBe(false);
    const issues = toContentIssues(result.error!, 'questions.json');
    expect(issues[0].file).toBe('questions.json');
    expect(issues[0].stage).toBe('schema');
    expect(issues[0].path).toBe('questions[0].options');
  });

  it('違反を 1 件目で止めず、すべて返す(§1.6)', () => {
    const result = questionsFileSchema.safeParse({
      questions: [
        { ...choice, id: 'BAD', difficulty: 9 },
        { ...choice, id: 'q-2', answer: [99] },
      ],
    });
    expect(result.success).toBe(false);
    const paths = toContentIssues(result.error!, 'questions.json').map((issue) => issue.path);
    expect(paths).toEqual(
      expect.arrayContaining(['questions[0].id', 'questions[0].difficulty', 'questions[1].answer[0]']),
    );
  });
});
