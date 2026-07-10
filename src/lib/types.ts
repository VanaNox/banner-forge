export type TargetPlatform = 'umh' | 'fusify' | 'admixer';

export type AdmixerMode = 'fullscreen' | 'halfscreen';

export interface ConversionOptions {
  landingUrl: string;
  admixerMode: AdmixerMode;
  umhAutoButton: boolean;
  targetPlatforms: TargetPlatform[];
}

export interface CreativeMetadata {
  entryPath: string;
  basePath: string;
  sourceFileName: string;
  width?: number;
  height?: number;
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
