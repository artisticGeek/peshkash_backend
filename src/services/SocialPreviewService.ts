export type SocialPreviewSource = 'custom' | 'generated' | 'hero' | 'fallback';

export type SocialPreviewConfig = {
  imageUrl?: string;
  imageAlt?: string;
  titleOverride?: string;
  descriptionOverride?: string;
  version?: number;
  generatedImageUrl?: string;
  generatedAt?: string;
  source?: SocialPreviewSource;
};

export type SocialPreviewCandidate = {
  url?: unknown;
  source: SocialPreviewSource;
};

export type ResolvedSocialPreview = {
  title: string;
  description: string;
  targetUrl: string;
  type: 'website' | 'article' | 'profile';
  imageUrl: string;
  imageAlt: string;
  imageType: string;
  imageWidth: number;
  imageHeight: number;
  version: number;
  source: SocialPreviewSource;
};

function cleanText(value: unknown, fallback: string, limit: number) {
  return String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function publicImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function versionedImageUrl(imageUrl: string, version: number, source: SocialPreviewSource) {
  if (source === 'fallback' || version <= 1) return imageUrl;
  const url = new URL(imageUrl);
  url.searchParams.set('spv', String(version));
  return url.toString();
}

function imageMimeType(imageUrl: string) {
  const pathname = new URL(imageUrl).pathname.toLowerCase();
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export function resolveSocialPreview(input: {
  title: string;
  description: string;
  targetUrl: string;
  type?: 'website' | 'article' | 'profile';
  imageAlt: string;
  fallbackImageUrl: string;
  config?: SocialPreviewConfig | null;
  candidates?: SocialPreviewCandidate[];
}): ResolvedSocialPreview {
  const config = input.config || {};
  const version = Math.max(1, Math.floor(Number(config.version) || 1));
  const candidates: SocialPreviewCandidate[] = [
    { url: config.imageUrl, source: 'custom' },
    { url: config.generatedImageUrl, source: 'generated' },
    ...(input.candidates || []),
    { url: input.fallbackImageUrl, source: 'fallback' },
  ];
  const selected = candidates
    .map((candidate) => ({ ...candidate, url: publicImageUrl(candidate.url) }))
    .find((candidate) => Boolean(candidate.url))!;
  const imageUrl = versionedImageUrl(selected.url!, version, selected.source);

  return {
    title: cleanText(config.titleOverride, input.title, 90),
    description: cleanText(config.descriptionOverride, input.description, 220),
    targetUrl: input.targetUrl,
    type: input.type || 'website',
    imageUrl,
    imageAlt: cleanText(config.imageAlt, input.imageAlt, 220),
    imageType: imageMimeType(imageUrl),
    imageWidth: 1200,
    imageHeight: 630,
    version,
    source: selected.source,
  };
}
