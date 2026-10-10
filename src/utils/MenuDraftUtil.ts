/**
 * Menu Studio drafts. The studio edits a working copy of a menu (settings + every
 * line item) and either stores it as a draft or saves it, which makes it live.
 * New items in a working copy carry negative temporary ids until they are saved.
 *
 * Pure helpers only (no Sequelize) so they can be unit tested.
 */
import { cleanCtaConfig, cleanItemCtaOverride, type CtaConfig } from './CtaConfigUtil';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ITEMS = 2000;

export type DraftItem = {
  id: number;
  parentId: number | null;
  sortOrder: number;
  name: string;
  displayName: string;
  description: string | null;
  ingredients: string | null;
  image: string | null;
  type: string;
  enumType: string | null;
  isActive: boolean;
  price: string | null;
  tags: string[];
  allergens: string[];
  isVeg: boolean | null;
  spiceLevel: number | null;
  ctaConfig: CtaConfig | null;
};

export type DraftMenuSettings = {
  displayName: string;
  description: string | null;
  itemStoryHeading: string;
  itemMaterialHeading: string;
  elaborateDescriptions: boolean;
  ctaConfig: CtaConfig;
};

export type MenuDraft = { menu: DraftMenuSettings; items: DraftItem[]; savedAt: string };

export type PublishPlan = {
  deleteIds: number[];
  /** New items, parents before children. Their ids are temporary. */
  creates: DraftItem[];
  updates: DraftItem[];
};

const text = (value: unknown, max = 5000): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
};

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).map((entry) => entry.trim()).filter(Boolean).slice(0, 50) : [];

export function cleanDraftMenu(raw: unknown): DraftMenuSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const displayName = text(input.displayName, 200);
  if (!displayName) throw new Error('Menu name is required');
  return {
    displayName,
    description: text(input.description),
    itemStoryHeading: text(input.itemStoryHeading, 80) ?? 'The backstory',
    itemMaterialHeading: text(input.itemMaterialHeading, 80) ?? 'Material',
    elaborateDescriptions: Boolean(input.elaborateDescriptions),
    ctaConfig: cleanCtaConfig(input.ctaConfig),
  };
}

/**
 * Validates a working copy's items: unique non-zero ids, a name and URL-safe
 * unique slug on every item, parents that exist in the copy, and no cycles.
 */
export function cleanDraftItems(raw: unknown): DraftItem[] {
  if (!Array.isArray(raw)) throw new Error('Items must be a list');
  if (raw.length > MAX_ITEMS) throw new Error(`A menu can hold at most ${MAX_ITEMS} entries`);
  const items: DraftItem[] = raw.map((value) => {
    const input = (value ?? {}) as Record<string, unknown>;
    const id = Number(input.id);
    if (!Number.isInteger(id) || id === 0) throw new Error('Every entry needs an id');
    const displayName = text(input.displayName, 200);
    if (!displayName) throw new Error('Every item and section needs a name');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!SLUG_PATTERN.test(name)) throw new Error(`"${displayName}" has an invalid link name`);
    const spice = Number(input.spiceLevel);
    return {
      id,
      parentId: input.parentId === null || input.parentId === undefined || Number(input.parentId) === 0 ? null : Number(input.parentId),
      sortOrder: Number.isFinite(Number(input.sortOrder)) ? Math.max(0, Math.round(Number(input.sortOrder))) : 0,
      name,
      displayName,
      description: text(input.description),
      ingredients: text(input.ingredients),
      image: text(input.image, 2000),
      type: text(input.type, 40) ?? 'item',
      enumType: text(input.enumType, 60),
      isActive: input.isActive !== false,
      price: text(input.price, 60),
      tags: list(input.tags),
      allergens: list(input.allergens),
      isVeg: typeof input.isVeg === 'boolean' ? input.isVeg : null,
      spiceLevel: input.spiceLevel === null || input.spiceLevel === undefined || !Number.isFinite(spice) || spice <= 0 ? null : Math.min(3, Math.round(spice)),
      ctaConfig: cleanItemCtaOverride(input.ctaConfig),
    };
  });

  const ids = new Set<number>();
  const slugs = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error('Two entries share the same id');
    ids.add(item.id);
    if (slugs.has(item.name)) throw new Error(`Two entries share the link name "${item.name}"`);
    slugs.add(item.name);
  }
  const parentOf = new Map(items.map((item) => [item.id, item.parentId]));
  for (const item of items) {
    if (item.parentId !== null && !ids.has(item.parentId)) throw new Error(`"${item.displayName}" is inside a section that isn't in the menu`);
    const seen = new Set<number>([item.id]);
    let cursor = item.parentId;
    while (cursor !== null) {
      if (seen.has(cursor)) throw new Error('A section cannot be inside itself');
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }
  return items;
}

/** Orders items so parents always come before their children. */
function parentsFirst(items: DraftItem[]): DraftItem[] {
  const ordered: DraftItem[] = [];
  const visit = (parentId: number | null) => {
    for (const item of items.filter((candidate) => candidate.parentId === parentId)) {
      ordered.push(item);
      visit(item.id);
    }
  };
  visit(null);
  return ordered;
}

/**
 * Works out what saving a working copy does to the live menu.
 * Positive ids must still exist in the menu; negative ids are new.
 */
export function planPublish(existingIds: number[], items: DraftItem[]): PublishPlan {
  const existing = new Set(existingIds);
  const missing = items.find((item) => item.id > 0 && !existing.has(item.id));
  if (missing) throw new Error(`"${missing.displayName}" was removed from this menu somewhere else. Reload the menu and try again.`);
  const kept = new Set(items.map((item) => item.id));
  return {
    deleteIds: existingIds.filter((id) => !kept.has(id)),
    creates: parentsFirst(items).filter((item) => item.id < 0),
    updates: items.filter((item) => item.id > 0),
  };
}
