import type { FormatKey, TargetPlatform } from './types';

// Матриця постачання: які формати реально замовляються на яких платформах і в якому
// нативному розмірі DV360-джерело має прийти. Це єдине джерело правди — UI бере з неї
// і список форматів, і набір платформ, а конвертер звіряє з нею вхідний банер.
//
// Рядки матриці для 1+1 / dv360 / vpoint / division global digital / rst свідомо
// відсутні: там еталон — сам DV360-пакет, конвертувати нічого не потрібно.

export interface Dimensions {
  width: number;
  height: number;
}

export interface SourceSize extends Dimensions {
  /** 2 — прийнятний подвійний (retina) варіант базового розміру формату. */
  scale: 1 | 2;
  platforms: TargetPlatform[];
}

export interface FormatSpec {
  key: FormatKey;
  label: string;
  /** fixed — банер фіксованого розміру; fluid — плейсмент, що розтягується платформою. */
  kind: 'fixed' | 'fluid';
  /** Усі нативні розміри джерела, які формат приймає, разом із платформами. */
  sizes: SourceSize[];
}

export interface FormatDetection {
  format: FormatSpec;
  size: SourceSize;
}

function fixedFormat(width: number, height: number): FormatSpec {
  const key = `${width}x${height}` as FormatKey;
  return {
    key,
    label: `${width} x ${height}`,
    kind: 'fixed',
    sizes: [{ width, height, scale: 1, platforms: ['fusify'] }]
  };
}

export const FORMAT_MATRIX: FormatSpec[] = [
  fixedFormat(300, 250),
  fixedFormat(300, 600),
  fixedFormat(320, 100),
  fixedFormat(336, 280),
  fixedFormat(728, 90),
  {
    key: 'fullscreen',
    label: 'Fullscreen',
    kind: 'fluid',
    sizes: [
      { width: 492, height: 696, scale: 1, platforms: ['admixer', 'umh'] },
      { width: 696, height: 492, scale: 1, platforms: ['admixer', 'umh'] }
    ]
  },
  {
    key: 'halfscreen',
    label: 'Halfscreen',
    kind: 'fluid',
    sizes: [
      { width: 800, height: 400, scale: 1, platforms: ['fusify', 'admixer', 'umh'] },
      { width: 1600, height: 800, scale: 2, platforms: ['umh'] }
    ]
  },
  {
    key: 'catfish',
    label: 'Catfish',
    kind: 'fluid',
    sizes: [
      { width: 1920, height: 200, scale: 1, platforms: ['umh'] },
      { width: 3840, height: 400, scale: 2, platforms: ['umh'] }
    ]
  }
];

export const FORMAT_KEYS: FormatKey[] = FORMAT_MATRIX.map((spec) => spec.key);

export function formatSpec(key: FormatKey): FormatSpec {
  const spec = FORMAT_MATRIX.find((item) => item.key === key);
  if (!spec) {
    throw new Error(`Unknown creative format "${key}".`);
  }
  return spec;
}

export function isFixedFormat(key: FormatKey): boolean {
  return formatSpec(key).kind === 'fixed';
}

/** Розміри самого формату — використовуються, коли з банера розмір не вичитався. */
export function fixedFormatDimensions(key: FormatKey): Dimensions | undefined {
  const spec = formatSpec(key);
  if (spec.kind !== 'fixed') return undefined;
  const { width, height } = spec.sizes[0];
  return { width, height };
}

/** Формат, до якого належить саме цей піксельний розмір джерела. */
export function detectFormat(width?: number, height?: number): FormatDetection | null {
  if (!width || !height) return null;
  for (const format of FORMAT_MATRIX) {
    const size = format.sizes.find((item) => item.width === width && item.height === height);
    if (size) return { format, size };
  }
  return null;
}

/** Резервний шлях: формат зашитий у назву архіву/теки (Fullscreen, Halfscreen, Catfish). */
export function detectFormatFromName(name: string): FormatSpec | null {
  if (/half[\s_-]*screen/i.test(name)) return formatSpec('halfscreen');
  if (/full[\s_-]*screen/i.test(name)) return formatSpec('fullscreen');
  if (/cat[\s_-]*fish/i.test(name)) return formatSpec('catfish');
  return null;
}

export function platformsForFormat(key: FormatKey, size?: Dimensions): TargetPlatform[] {
  const spec = formatSpec(key);
  if (size) {
    const exact = spec.sizes.find((item) => item.width === size.width && item.height === size.height);
    // Розмір поза матрицею (напр. 1600x800 для AdPartner halfscreen) — не звужуємо
    // вибір молча, віддаємо всі платформи формату, а невідповідність піде окремим warning.
    if (exact) return [...exact.platforms];
  }
  const platforms = new Set<TargetPlatform>();
  spec.sizes.forEach((item) => item.platforms.forEach((platform) => platforms.add(platform)));
  return [...platforms];
}

export function supportsFormat(platform: TargetPlatform, key: FormatKey): boolean {
  return platformsForFormat(key).includes(platform);
}

/** Нативні розміри, які платформа приймає для формату. */
export function acceptedSizes(platform: TargetPlatform, key: FormatKey): SourceSize[] {
  return formatSpec(key).sizes.filter((size) => size.platforms.includes(platform));
}

export function acceptsSize(platform: TargetPlatform, key: FormatKey, size?: Dimensions): boolean {
  if (!size) return false;
  return acceptedSizes(platform, key).some((item) => item.width === size.width && item.height === size.height);
}

export function describeSizes(sizes: Dimensions[]): string {
  return sizes.map((size) => `${size.width}x${size.height}`).join(' or ');
}

/** Людський підпис формату для UI: «Halfscreen (800x400 or 1600x800)». */
export function describeFormat(key: FormatKey): string {
  const spec = formatSpec(key);
  if (spec.kind === 'fixed') return spec.label;
  return `${spec.label} (${describeSizes(spec.sizes)})`;
}
