export type TargetPlatform = 'umh' | 'fusify' | 'admixer';

/**
 * Кожен формат матриці постачання: фіксовані розміри — за своїм розміром, три
 * «пливкі» плейсменти — за назвою. Склад і платформи див. у ./formatMatrix.
 */
export type FormatKey =
  | '300x250'
  | '300x600'
  | '320x100'
  | '336x280'
  | '728x90'
  | 'fullscreen'
  | 'halfscreen'
  | 'catfish';

export interface ConversionOptions {
  landingUrl: string;
  /** Що саме конвертуємо. Якщо не передати — беремо розпізнаний із банера формат. */
  formatKey: FormatKey;
  umhAutoButton: boolean;
  targetPlatforms: TargetPlatform[];
}

/** Звідки взявся розмір креативу — показуємо в UI, щоб здогадка не була безмовною. */
export type SizeSource = 'ad.size meta' | 'container CSS' | 'file name';

export interface CreativeMetadata {
  entryPath: string;
  basePath: string;
  sourceFileName: string;
  width?: number;
  height?: number;
  sizeSource?: SizeSource;
  /** Розмір, оголошений самим банером, коли він розійшовся з розпізнаним форматом. */
  declaredSize?: { width: number; height: number };
  /** Формат із матриці, якщо розмір (або назва) банера його однозначно визначає. */
  detectedFormat?: FormatKey;
  /** 2 — джерело подане в подвійному (retina) варіанті базового розміру. */
  detectedScale?: 1 | 2;
  title?: string;
  assetCount: number;
  sourceSizeBytes: number;
  detectedClickTag: boolean;
}

export interface ValidationCheck {
  label: string;
  passed: boolean;
}

export interface OutputPackage {
  platform: TargetPlatform | 'bundle';
  fileName: string;
  blob: Blob;
  sizeBytes: number;
  warnings: string[];
  validation: ValidationCheck[];
}

export interface ConversionResult {
  metadata: CreativeMetadata;
  packages: OutputPackage[];
  warnings: string[];
}
