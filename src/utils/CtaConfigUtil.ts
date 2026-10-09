/**
 * Call-to-action configuration for the public item page.
 *
 * A menu stores the defaults every item inherits. An item may store its own
 * config to override them; `null` on an item means "use the menu default".
 * Everything that crosses the API boundary goes through `cleanCtaConfig`, so
 * stored JSON always has the same shape regardless of what the client sent.
 */

export type BuiltInCta = 'like' | 'dislike' | 'save' | 'share';
export type CustomCtaKind = 'whatsapp' | 'call' | 'link';

export type CustomCta = {
  id: string;
  label: string;
  kind: CustomCtaKind;
  /** Phone number for whatsapp/call, absolute https URL for link. */
  value: string;
  /** Optional prefilled WhatsApp message. `{item}` is replaced with the item name. */
  message?: string;
};

export type CtaConfig = Record<BuiltInCta, boolean> & { custom: CustomCta[] };

export const BUILT_IN_CTAS: BuiltInCta[] = ['like', 'dislike', 'save', 'share'];
const CUSTOM_KINDS = new Set<CustomCtaKind>(['whatsapp', 'call', 'link']);
const MAX_CUSTOM_CTAS = 3;

export function defaultCtaConfig(): CtaConfig {
  return { like: true, dislike: true, save: true, share: true, custom: [] };
}

function cleanPhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

function cleanLink(value: string): string {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function cleanCustomCta(raw: unknown, index: number): CustomCta | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const kind = String(input.kind || '') as CustomCtaKind;
  if (!CUSTOM_KINDS.has(kind)) return null;
  const label = String(input.label || '').trim().slice(0, 32);
  const rawValue = String(input.value || '');
  const value = kind === 'link' ? cleanLink(rawValue) : cleanPhone(rawValue);
  if (!label || !value) return null;
  const message = kind === 'whatsapp' ? String(input.message || '').trim().slice(0, 300) : '';
  const id = String(input.id || '').trim().slice(0, 40) || `cta-${index + 1}`;
  return message ? { id, label, kind, value, message } : { id, label, kind, value };
}

/**
 * Normalises a stored or submitted CTA config. Missing built-in flags fall back
 * to the default (on), invalid custom CTAs are dropped.
 */
export function cleanCtaConfig(raw: unknown): CtaConfig {
  const base = defaultCtaConfig();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const input = raw as Record<string, unknown>;
  for (const key of BUILT_IN_CTAS) {
    if (typeof input[key] === 'boolean') base[key] = input[key] as boolean;
  }
  if (Array.isArray(input.custom)) {
    base.custom = input.custom
      .map(cleanCustomCta)
      .filter((cta): cta is CustomCta => Boolean(cta))
      .slice(0, MAX_CUSTOM_CTAS);
  }
  return base;
}

/** Item override: `null`/absent means inherit the menu default. */
export function cleanItemCtaOverride(raw: unknown): CtaConfig | null {
  if (raw === null || raw === undefined || raw === '') return null;
  return cleanCtaConfig(raw);
}

/** The config a guest actually sees for an item. */
export function resolveCtaConfig(menuConfig: unknown, itemOverride: unknown): CtaConfig {
  const override = cleanItemCtaOverride(itemOverride);
  return override ?? cleanCtaConfig(menuConfig);
}
