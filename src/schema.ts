/**
 * 教材パッケージの各ファイルのスキーマ(`docs/product/content-format.md` §1.2 / §2 / §4 / §5)。
 *
 * **未知のフィールドは黙って無視する**(§1.3)。マイナー版が上がったパッケージを
 * 受理するために必要で、Zod の既定の挙動(object は未知のキーを落とす)をそのまま使う。
 *
 * 一方、`null` は受け付けない(§7.3)。任意の項目は「書かないこと」で表す。
 */

import { z } from 'zod';

import { type ContentIssue, contentIssue } from './issues.js';
import { CONTENT_LIMITS, CONTROL_CHARACTERS, ID_MAX_LENGTH, ID_PATTERN } from './limits.js';

/** 長さはコードポイント数で数える(§7.2)。 */
const codePointLength = (value: string) => [...value].length;

/**
 * 文字列。制御文字を拒否し、前後の空白を落としてから長さを見る(§7.2)。
 *
 * 空白を落としたあとに空になる必須項目は、この時点で最小長に引っかかる。
 */
function boundedText(min: number, max: number) {
  return z
    .string()
    .refine((value) => !CONTROL_CHARACTERS.test(value), '制御文字を含めてはならない(§7.2)')
    .transform((value) => value.trim())
    .refine((value) => codePointLength(value) >= min, `${min} 文字以上で書く`)
    .refine((value) => codePointLength(value) <= max, `${max} 文字以下で書く`);
}

/** ID(§7.1)。 */
const idSchema = z
  .string()
  .max(ID_MAX_LENGTH, `ID は ${ID_MAX_LENGTH} 文字まで(§7.1)`)
  .regex(
    ID_PATTERN,
    'ID は小文字英数字とハイフンだけ。先頭と末尾はハイフン以外で、ハイフンは連続させない(§7.1)',
  );

/** 有限の数値(§7.3)。 */
const finiteNumber = z.number().refine(Number.isFinite, '有限の数値で書く(§7.3)');

// --- manifest.json (§1.2) ---

export const manifestSchema = z.object({
  formatVersion: z
    .string()
    .regex(/^\d+\.\d+$/, 'formatVersion は "メジャー.マイナー" の形で書く(§1.3)'),
  generator: boundedText(1, 100),
  generatorVersion: boundedText(1, 50),
  generatedAt: z.iso.datetime({ message: 'generatedAt は RFC 3339 の UTC(末尾 Z)で書く(§1.2)' }),
});

export type Manifest = z.infer<typeof manifestSchema>;

/** この実装が受理する形式の版(§1.3)。 */
export const SUPPORTED_FORMAT_VERSION = { major: 2, minor: 0 } as const;

/**
 * `formatVersion` を受理してよいか(§1.3)。
 *
 * メジャーが違えば拒否。マイナーが上でも**受理する**(知らないフィールドは無視する)。
 * 古いメジャー(v1.x)も拒否する。読み替えて受理する経路は持たない(ADR 0012 決定 4)。
 */
export function isSupportedFormatVersion(formatVersion: string): boolean {
  const match = /^(\d+)\.(\d+)$/.exec(formatVersion);
  if (match === null) return false;
  return Number(match[1]) === SUPPORTED_FORMAT_VERSION.major;
}

// --- exam.json (§2) ---

/** 区分(§2.1)。本番で別々に時間を区切って解く単位。 */
const partSchema = z.object({
  id: idSchema,
  name: boundedText(1, 100),
  questionCount: z.number().int().min(1).max(1000),
  durationMinutes: z.number().int().min(1).max(600),
  passingScorePercent: z.number().int().min(0).max(100),
});

export type Part = z.infer<typeof partSchema>;

export const examSchema = z.object({
  id: idSchema,
  name: boundedText(1, 200),
  // 模試セットの有無に関わらず必須(要件 §5.1)。これは本番の条件であって、
  // 模試セットの持ち物ではない。区分が 1 つの試験も要素 1 個で書く(§2.1)。
  // v1.0 の `realExam` は未知のフィールドとして落ちる(§9)。
  parts: z
    .array(partSchema)
    .min(1, '区分が 1 つも無い(§2)。区分が 1 つの試験も要素 1 個の parts を書く')
    .max(CONTENT_LIMITS.partCount, `区分は ${CONTENT_LIMITS.partCount} 個まで(§2)`)
    .superRefine((parts, ctx) => {
      // 模試と問題が区分を ID で指すので、parts の中で一意でなければならない(§7.1)。
      const seen = new Set<string>();
      for (const [index, part] of parts.entries()) {
        if (seen.has(part.id)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'id'],
            message: `区分 ID "${part.id}" が重複している(§7.1)。区分 ID は parts の中で一意にする`,
          });
        }
        seen.add(part.id);
      }
    }),
});

export type Exam = z.infer<typeof examSchema>;

// --- 問題 (§4) ---

const questionCommon = {
  id: idSchema,
  source: idSchema,
  // 区分(§4.7)。書かなければ全区分に共通。実在するかは整合段で見る(§6 の条件 5)。
  part: idSchema.optional(),
  // 宣言難易度。1〜5 の順序尺度で、間隔に意味は無い(ADR 0008、要件 §5.4)。
  difficulty: z.number().int().min(1).max(5),
  prompt: boundedText(1, 4000),
  explanation: boundedText(1, 4000).optional(),
};

const optionsSchema = z
  .array(boundedText(1, 1000))
  .min(2, '選択肢は 2 つ以上(§4.2)')
  .max(10, '選択肢は 10 個まで(§4.2)')
  .refine((options) => new Set(options).size === options.length, '選択肢が重複している(§4.2)');

const answerIndexes = z.array(z.number().int().min(0)).max(10);

const choiceSchema = z.object({
  ...questionCommon,
  type: z.literal('choice'),
  options: optionsSchema,
  answer: answerIndexes.length(1, '多肢選択の正解はちょうど 1 つ(§4.2)'),
});

const multiSchema = z.object({
  ...questionCommon,
  type: z.literal('multi'),
  options: optionsSchema,
  answer: answerIndexes.min(1, '複数選択の正解は 1 つ以上(§4.3)'),
});

const numericSchema = z.object({
  ...questionCommon,
  type: z.literal('numeric'),
  answer: finiteNumber,
  tolerance: z.object({
    type: z.enum(['absolute', 'relative']),
    value: finiteNumber.min(0, '許容誤差は 0 以上(§4.4)'),
  }),
  unit: boundedText(1, 20).optional(),
});

const flashcardSchema = z.object({
  ...questionCommon,
  type: z.literal('flashcard'),
  answer: boundedText(1, 4000),
});

/** 型ごとの、フィールドをまたぐ規則(§4.2 / §4.3 / §4.4)。 */
function checkQuestion(question: Question, ctx: z.RefinementCtx): void {
  if (question.type === 'choice' || question.type === 'multi') {
    for (const [index, answer] of question.answer.entries()) {
      if (answer >= question.options.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['answer', index],
          message: `正解の添字 ${answer} が選択肢の範囲(0〜${question.options.length - 1})を超えている(§4.2)`,
        });
      }
    }
  }
  if (question.type === 'multi' && new Set(question.answer).size !== question.answer.length) {
    ctx.addIssue({ code: 'custom', path: ['answer'], message: '正解の添字が重複している(§4.3)' });
  }
  if (question.type === 'numeric' && question.answer === 0 && question.tolerance.type === 'relative') {
    // 相対誤差は |answer| に比例するので、answer が 0 だと許容幅も 0 になり、
    // value に関わらず完全一致しか正解にならない。意図しない厳しさを持ち込ませない。
    ctx.addIssue({
      code: 'custom',
      path: ['tolerance', 'type'],
      message: '正解が 0 のときに相対誤差は使えない(§4.4)。絶対誤差(absolute)で書く',
    });
  }
}

/** 日々の学習用の問題(§4)。4 つの型すべてを許す。 */
export const questionSchema = z
  .discriminatedUnion('type', [choiceSchema, multiSchema, numericSchema, flashcardSchema])
  .superRefine(checkQuestion);

/**
 * 模試の問題には `part` を書かせない(§5)。区分は模試の `part` で決まる。
 *
 * 未知のフィールドとして黙って落とすのではなく、書いてあれば拒否する。区分の表し方を
 * 1 つにし、「模試は a なのに問題は b」という食い違いを定義しなくて済むようにするため
 * (ADR 0012 決定 2)。
 */
const mockQuestionPart = {
  part: z
    .never({ message: '模試の問題に part は書かない(§5)。区分は模試の part で決まる' })
    .optional(),
};

/** 模試の問題(§5)。フラッシュカードは使えない。 */
export const mockQuestionSchema = z
  .discriminatedUnion('type', [
    choiceSchema.extend(mockQuestionPart),
    multiSchema.extend(mockQuestionPart),
    numericSchema.extend(mockQuestionPart),
  ])
  .superRefine(checkQuestion);

export type Question = z.infer<typeof questionSchema>;
export type MockQuestion = z.infer<typeof mockQuestionSchema>;

/** 到達判定へ算入できる型(要件 §5.5 / §5.6)。自己判定のフラッシュカードは入らない。 */
export function isGradable(question: Question): boolean {
  return question.type !== 'flashcard';
}

// --- questions.json (§4) ---

export const questionsFileSchema = z.object({
  questions: z
    .array(questionSchema)
    .min(1, '問題が 1 問も無い(§4)')
    .max(CONTENT_LIMITS.questionCount, `問題は ${CONTENT_LIMITS.questionCount} 問まで(§1.4)`),
});

export type QuestionsFile = z.infer<typeof questionsFileSchema>;

// --- mock-exams.json (§5) ---

export const mockExamsFileSchema = z
  .object({
    mockExams: z
      .array(
        z.object({
          id: idSchema,
          name: boundedText(1, 200),
          // どの区分の模試か(§5)。区分が 1 つの試験でも書く。暗黙の既定値を作らない。
          part: idSchema,
          questions: z
            .array(mockQuestionSchema)
            .min(1, '模試に問題が 1 問も無い(§5)')
            .max(
              CONTENT_LIMITS.mockExamQuestionCount,
              `模試 1 つの問題は ${CONTENT_LIMITS.mockExamQuestionCount} 問まで(§1.4)`,
            ),
        }),
      )
      .min(1, '模試が 1 つも無い(§5)。模試セットが無いならファイルごと省略する')
      .max(CONTENT_LIMITS.mockExamCount, `模試は ${CONTENT_LIMITS.mockExamCount} 個まで(§5)`),
  })
  .superRefine((file, ctx) => {
    const total = file.mockExams.reduce((sum, exam) => sum + exam.questions.length, 0);
    if (total > CONTENT_LIMITS.mockQuestionCount) {
      ctx.addIssue({
        code: 'custom',
        path: ['mockExams'],
        message: `模試の問題は全体で ${CONTENT_LIMITS.mockQuestionCount} 問まで(§1.4)。${total} 問ある`,
      });
    }
  });

export type MockExamsFile = z.infer<typeof mockExamsFileSchema>;

// --- 違反への変換 ---

/** Zod の位置(`['questions', 3, 'options', 1]`)を `questions[3].options[1]` に直す。 */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc === '' ? String(segment) : `${acc}.${String(segment)}`;
  }, '');
}

/** Zod の検証結果を、この文書の違反(§1.6)へ移す。 */
export function toContentIssues(error: z.ZodError, file: string): ContentIssue[] {
  return error.issues.map((issue) =>
    contentIssue({
      code: 'schema.invalid',
      stage: 'schema',
      file,
      path: formatPath(issue.path),
      message: issue.message,
    }),
  );
}
