import { describe, expect, it } from 'vitest';

import {
  classifyEntryName,
  imageKindFromBytes,
  imageKindFromFileName,
  isValidAssetFileName,
  isValidId,
} from './limits.js';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('classifyEntryName', () => {
  it('パッケージ直下のファイルと assets/ の画像を見分ける', () => {
    expect(classifyEntryName('textbook.md')).toEqual({ kind: 'root-file', name: 'textbook.md' });
    expect(classifyEntryName('assets/fig-0301.png')).toEqual({
      kind: 'asset',
      name: 'fig-0301.png',
    });
  });

  it('遡る指定・絶対パス・Windows 形式を拒む(§1.5)', () => {
    for (const name of [
      'assets/../secret',
      '../secret',
      './textbook.md',
      '/etc/passwd',
      'assets\\fig.png',
      'assets//fig.png',
      '',
    ]) {
      expect(classifyEntryName(name).kind, name).toBe('unsafe');
    }
  });

  it('assets/ のディレクトリエントリを通す(§1.1)', () => {
    // ZIP はディレクトリを末尾 / のエントリとして持つことがある。
    expect(classifyEntryName('assets/')).toEqual({ kind: 'directory' });
    expect(classifyEntryName('other/').kind).toBe('unsafe');
  });

  it('想定外のファイルと assets/ の入れ子は unknown にする(§1.1)', () => {
    expect(classifyEntryName('README.md').kind).toBe('unknown');
    expect(classifyEntryName('assets/sub/fig.png').kind).toBe('unknown');
  });
});

describe('isValidAssetFileName', () => {
  it('小文字の名前だけを通す(§1.5)', () => {
    expect(isValidAssetFileName('fig-0301.png')).toBe(true);
    expect(isValidAssetFileName('Fig.png')).toBe(false);
    expect(isValidAssetFileName('.hidden.png')).toBe(false);
    expect(isValidAssetFileName('a..b.png')).toBe(false);
  });
});

describe('imageKindFromFileName', () => {
  it('許可した拡張子だけを通す(§1.5)', () => {
    expect(imageKindFromFileName('a.png')).toBe('png');
    expect(imageKindFromFileName('a.jpg')).toBe('jpeg');
    expect(imageKindFromFileName('a.jpeg')).toBe('jpeg');
    expect(imageKindFromFileName('a.webp')).toBe('webp');
    expect(imageKindFromFileName('a.PNG')).toBeNull();
    expect(imageKindFromFileName('a.gif')).toBeNull();
    expect(imageKindFromFileName('png')).toBeNull();
  });
});

describe('imageKindFromBytes', () => {
  it('マジックバイトから種類を判定する(§1.5)', () => {
    expect(imageKindFromBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(imageKindFromBytes(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(
      imageKindFromBytes(
        bytes(0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50),
      ),
    ).toBe('webp');
  });

  it('画像でない中身と、途中で切れた中身を通さない', () => {
    expect(imageKindFromBytes(bytes(0x3c, 0x73, 0x76, 0x67))).toBeNull(); // "<svg"
    expect(imageKindFromBytes(bytes(0x89, 0x50))).toBeNull();
    expect(imageKindFromBytes(bytes(0x52, 0x49, 0x46, 0x46))).toBeNull();
  });
});

describe('isValidId', () => {
  it('§7.1 の規則を守らせる', () => {
    expect(isValidId('ch03-02-01')).toBe(true);
    expect(isValidId('q0412')).toBe(true);
    expect(isValidId('Ch03')).toBe(false);
    expect(isValidId('ch--03')).toBe(false);
    expect(isValidId('-ch03')).toBe(false);
    expect(isValidId('ch03-')).toBe(false);
    expect(isValidId('a'.repeat(65))).toBe(false);
  });
});
