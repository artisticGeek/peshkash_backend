/**
 * Pure helpers for working with a menu's line-item tree (parent_id + sort_order).
 * Kept free of Sequelize so they can be unit tested directly.
 */

export type TreeNode = { id: number; parentId?: number | null; type?: string | null; isActive?: boolean };

export type ReorderEntry = { id: number; parentId: number | null; sortOrder: number };

export type CopyOptions = {
  /** Copy leaf items, not just the section structure. Default true. */
  includeItems?: boolean;
  /** Copy items/sections that are hidden from guests. Default true. */
  includeHidden?: boolean;
};

/** A node is a section when it is typed as one or has children. */
export function isSection(node: TreeNode, all: TreeNode[]): boolean {
  return node.type === 'category' || all.some((other) => other.parentId === node.id);
}

/**
 * Orders nodes so every parent comes before its children, at any depth.
 * Nodes whose parent is missing from the list are treated as roots.
 */
export function parentsFirst<T extends TreeNode>(nodes: T[]): T[] {
  const ids = new Set(nodes.map((node) => node.id));
  const childrenOf = new Map<number | null, T[]>();
  for (const node of nodes) {
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(node);
    childrenOf.set(parent, list);
  }
  const ordered: T[] = [];
  const visit = (parent: number | null) => {
    for (const child of childrenOf.get(parent) ?? []) {
      ordered.push(child);
      visit(child.id);
    }
  };
  visit(null);
  return ordered;
}

/** Picks which nodes a menu clone should copy. Dropping a node drops its subtree. */
export function selectForCopy<T extends TreeNode>(nodes: T[], options: CopyOptions = {}): T[] {
  const includeItems = options.includeItems !== false;
  const includeHidden = options.includeHidden !== false;
  const kept = new Set<number>();
  for (const node of parentsFirst(nodes)) {
    const parentKept = !node.parentId || kept.has(node.parentId) || !nodes.some((n) => n.id === node.parentId);
    if (!parentKept) continue;
    if (!includeHidden && node.isActive === false) continue;
    if (!includeItems && !isSection(node, nodes)) continue;
    kept.add(node.id);
  }
  return nodes.filter((node) => kept.has(node.id));
}

/** All descendant ids of `rootId` (not including it). */
export function descendantIds(nodes: TreeNode[], rootId: number): number[] {
  const result: number[] = [];
  const stack = [rootId];
  while (stack.length) {
    const current = stack.pop()!;
    for (const node of nodes) {
      if (node.parentId === current) {
        result.push(node.id);
        stack.push(node.id);
      }
    }
  }
  return result;
}

/**
 * Validates a full or partial reorder of a menu and returns cleaned entries.
 * Throws an Error with a user-facing message when the result would not be a tree.
 */
export function validateReorder(raw: unknown, menuNodes: TreeNode[]): ReorderEntry[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('Nothing to reorder');
  const known = new Map(menuNodes.map((node) => [node.id, node]));
  const entries: ReorderEntry[] = raw.map((value) => {
    const input = (value ?? {}) as Record<string, unknown>;
    const id = Number(input.id);
    const parentId = input.parentId === null || input.parentId === undefined || input.parentId === 0 ? null : Number(input.parentId);
    const sortOrder = Number(input.sortOrder);
    if (!known.has(id)) throw new Error('Every reordered item must belong to this menu');
    if (parentId !== null && !known.has(parentId)) throw new Error('A parent must belong to the same menu');
    if (!Number.isFinite(sortOrder)) throw new Error('Sort order must be a number');
    return { id, parentId, sortOrder: Math.max(0, Math.round(sortOrder)) };
  });

  // Apply the moves to a copy of the tree and make sure no node became its own ancestor.
  const parentOf = new Map<number, number | null>(menuNodes.map((node) => [node.id, node.parentId ?? null]));
  for (const entry of entries) parentOf.set(entry.id, entry.parentId);
  for (const entry of entries) {
    const seen = new Set<number>([entry.id]);
    let cursor = parentOf.get(entry.id) ?? null;
    while (cursor !== null) {
      if (seen.has(cursor)) throw new Error('An item cannot be moved inside itself or one of its descendants');
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }
  return entries;
}
