import { describe, expect, it } from 'vitest';
import {
  FORMAT_MATRIX,
  acceptedSizes,
  acceptsSize,
  detectFormat,
  detectFormatFromName,
  fixedFormatDimensions,
  isFixedFormat,
  platformsForFormat,
  supportsFormat
} from '../src/lib/formatMatrix';
import type { FormatKey, TargetPlatform } from '../src/lib/types';

// Матриця постачання, як її надали. Тест тримає код і домовленість синхронними:
// зміна одного рядка матриці має ламати саме цей список, а не поведінку конвертера.
const EXPECTED: Array<[TargetPlatform, FormatKey, string]> = [
  ['fusify', '300x250', '300x250'],
  ['fusify', '300x600', '300x600'],
  ['fusify', '320x100', '320x100'],
  ['fusify', '336x280', '336x280'],
  ['fusify', '728x90', '728x90'],
  ['fusify', 'halfscreen', '800x400'],
  ['admixer', 'fullscreen', '492x696 or 696x492'],
  ['admixer', 'halfscreen', '800x400'],
  ['umh', 'fullscreen', '492x696 or 696x492'],
  ['umh', 'halfscreen', '800x400 or 1600x800'],
  ['umh', 'catfish', '1920x200 or 3840x400']
];

describe('delivery matrix', () => {
  it('offers exactly the ordered platform/format/size combinations', () => {
    const actual = FORMAT_MATRIX.flatMap((spec) =>
      (['fusify', 'admixer', 'umh'] as TargetPlatform[])
        .filter((platform) => supportsFormat(platform, spec.key))
        .map((platform): [TargetPlatform, FormatKey, string] => [
          platform,
          spec.key,
          acceptedSizes(platform, spec.key).map((size) => `${size.width}x${size.height}`).join(' or ')
        ])
    );

    expect(new Set(actual.map(String))).toEqual(new Set(EXPECTED.map(String)));
  });

  it('does not offer UMH or Admixer for the fixed AdPartner sizes', () => {
    for (const key of ['300x250', '300x600', '320x100', '336x280', '728x90'] as FormatKey[]) {
      expect(platformsForFormat(key)).toEqual(['fusify']);
    }
  });

  it('does not offer catfish outside UMH', () => {
    expect(platformsForFormat('catfish')).toEqual(['umh']);
  });
});

describe('detectFormat', () => {
  it('resolves each accepted size, marking the 2x variants', () => {
    expect(detectFormat(728, 90)).toMatchObject({ format: { key: '728x90' }, size: { scale: 1 } });
    expect(detectFormat(800, 400)).toMatchObject({ format: { key: 'halfscreen' }, size: { scale: 1 } });
    expect(detectFormat(1600, 800)).toMatchObject({ format: { key: 'halfscreen' }, size: { scale: 2 } });
    expect(detectFormat(3840, 400)).toMatchObject({ format: { key: 'catfish' }, size: { scale: 2 } });
  });

  it('returns null for sizes and partial input outside the matrix', () => {
    expect(detectFormat(970, 250)).toBeNull();
    expect(detectFormat(320, 480)).toBeNull();
    expect(detectFormat(800, undefined)).toBeNull();
    expect(detectFormat()).toBeNull();
  });

  it('narrows the platform set to those accepting the exact size', () => {
    // 800x400 замовляють усі три; 1600x800 (2x) — лише UMH.
    expect(new Set(platformsForFormat('halfscreen', { width: 800, height: 400 }))).toEqual(
      new Set<TargetPlatform>(['fusify', 'admixer', 'umh'])
    );
    expect(platformsForFormat('halfscreen', { width: 1600, height: 800 })).toEqual(['umh']);
    // Розмір поза матрицею не звужує вибір молча.
    expect(new Set(platformsForFormat('halfscreen', { width: 1200, height: 600 }))).toEqual(
      new Set<TargetPlatform>(['fusify', 'admixer', 'umh'])
    );
  });
});

describe('format helpers', () => {
  it('recognises the fluid formats by name', () => {
    expect(detectFormatFromName('Halfscreen_LEVIA_adpartner.zip')?.key).toBe('halfscreen');
    expect(detectFormatFromName('banner_fullscreen@REMIX_Wide_1_umh.zip')?.key).toBe('fullscreen');
    expect(detectFormatFromName('Sampling_01_1920x200_Catfish.zip')?.key).toBe('catfish');
    expect(detectFormatFromName('Levia_DV360.zip')).toBeNull();
  });

  it('exposes the fixed formats own dimensions and nothing for the fluid ones', () => {
    expect(isFixedFormat('336x280')).toBe(true);
    expect(fixedFormatDimensions('336x280')).toEqual({ width: 336, height: 280 });
    expect(isFixedFormat('halfscreen')).toBe(false);
    expect(fixedFormatDimensions('halfscreen')).toBeUndefined();
  });

  it('checks a source size against what the platform accepts', () => {
    expect(acceptsSize('umh', 'halfscreen', { width: 1600, height: 800 })).toBe(true);
    expect(acceptsSize('fusify', 'halfscreen', { width: 1600, height: 800 })).toBe(false);
    expect(acceptsSize('fusify', 'halfscreen', { width: 800, height: 400 })).toBe(true);
    expect(acceptsSize('fusify', 'halfscreen', undefined)).toBe(false);
  });
});
