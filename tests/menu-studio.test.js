const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanCtaConfig, cleanItemCtaOverride, resolveCtaConfig, defaultCtaConfig } = require('../dist/utils/CtaConfigUtil');
const { parentsFirst, selectForCopy, descendantIds, validateReorder } = require('../dist/utils/MenuTreeUtil');

test('CTA config falls back to all built-ins on and no custom CTAs', () => {
  assert.deepEqual(cleanCtaConfig(undefined), defaultCtaConfig());
  assert.deepEqual(cleanCtaConfig({}), defaultCtaConfig());
  assert.deepEqual(cleanCtaConfig('nope'), defaultCtaConfig());
});

test('CTA config keeps valid custom CTAs and drops invalid ones', () => {
  const config = cleanCtaConfig({
    like: false,
    share: 'yes',
    custom: [
      { id: 'wa', label: 'Ask on WhatsApp', kind: 'whatsapp', value: '+91 98765 43210', message: 'About {item}' },
      { label: 'Call us', kind: 'call', value: '12' },
      { label: 'Menu PDF', kind: 'link', value: 'javascript:alert(1)' },
      { label: 'Book', kind: 'link', value: 'https://example.com/book' },
      { label: 'Fax', kind: 'fax', value: '123456789' },
    ],
  });
  assert.equal(config.like, false);
  assert.equal(config.share, true, 'non-boolean flags keep the default');
  assert.deepEqual(config.custom.map((cta) => cta.label), ['Ask on WhatsApp', 'Book']);
  assert.equal(config.custom[0].value, '+919876543210');
  assert.equal(config.custom[0].message, 'About {item}');
  assert.equal(config.custom[1].id, 'cta-4');
});

test('item CTA override inherits the menu default when null', () => {
  const menu = { like: false, custom: [] };
  assert.equal(cleanItemCtaOverride(null), null);
  assert.equal(resolveCtaConfig(menu, null).like, false);
  assert.equal(resolveCtaConfig(menu, { like: true }).like, true);
});

const tree = [
  { id: 4, parentId: 3, type: 'item', isActive: true },
  { id: 3, parentId: 2, type: 'category', isActive: true },
  { id: 2, parentId: null, type: 'category', isActive: true },
  { id: 5, parentId: 2, type: 'item', isActive: false },
  { id: 6, parentId: null, type: 'item', isActive: true },
  { id: 7, parentId: 99, type: 'item', isActive: true },
];

test('parentsFirst orders every parent before its descendants at any depth', () => {
  const order = parentsFirst(tree).map((node) => node.id);
  assert.ok(order.indexOf(2) < order.indexOf(3));
  assert.ok(order.indexOf(3) < order.indexOf(4));
  assert.equal(order.length, tree.length, 'nodes with a missing parent are kept as roots');
});

test('selectForCopy can copy structure only and skip hidden items', () => {
  assert.deepEqual(selectForCopy(tree, { includeItems: false }).map((n) => n.id).sort(), [2, 3]);
  assert.deepEqual(selectForCopy(tree, { includeHidden: false }).map((n) => n.id).sort(), [2, 3, 4, 6, 7]);
  assert.equal(selectForCopy(tree).length, tree.length);
});

test('descendantIds walks the whole subtree', () => {
  assert.deepEqual(descendantIds(tree, 2).sort(), [3, 4, 5]);
  assert.deepEqual(descendantIds(tree, 6), []);
});

test('validateReorder accepts moves and rejects cycles and foreign ids', () => {
  const entries = validateReorder([{ id: 4, parentId: null, sortOrder: 2 }, { id: 6, parentId: 3, sortOrder: 0 }], tree);
  assert.deepEqual(entries[0], { id: 4, parentId: null, sortOrder: 2 });
  assert.throws(() => validateReorder([{ id: 2, parentId: 4, sortOrder: 0 }], tree), /inside itself/);
  assert.throws(() => validateReorder([{ id: 1234, parentId: null, sortOrder: 0 }], tree), /belong to this menu/);
  assert.throws(() => validateReorder([], tree), /Nothing to reorder/);
});
