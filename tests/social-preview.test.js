const test = require('node:test');
const assert = require('node:assert/strict');
const { previewDocument } = require('../dist/controllers/SharePreviewController');
const { resolveSocialPreview } = require('../dist/services/SocialPreviewService');

const base = {
  title: 'ChapterHer September Edit',
  description: '9 September 2026 · Radisson Jalandhar',
  targetUrl: 'https://peshkash.app/event/chapter-her-sept',
  type: 'article',
  imageAlt: 'ChapterHer event at Radisson Jalandhar',
  fallbackImageUrl: 'https://peshkash.app/brand/social/peshkash-home-preview.jpg',
};

test('resolver follows custom, generated, hero and fallback priority', () => {
  const custom = resolveSocialPreview({
    ...base,
    config: { imageUrl: 'https://cdn.example.com/custom.png', generatedImageUrl: 'https://cdn.example.com/generated.jpg', version: 3 },
    candidates: [{ url: 'https://cdn.example.com/hero.jpg', source: 'hero' }],
  });
  assert.equal(custom.source, 'custom');
  assert.equal(new URL(custom.imageUrl).searchParams.get('spv'), '3');

  const generated = resolveSocialPreview({ ...base, config: { generatedImageUrl: 'https://cdn.example.com/generated.jpg' } });
  assert.equal(generated.source, 'generated');

  const hero = resolveSocialPreview({ ...base, candidates: [{ url: 'https://cdn.example.com/hero.jpg', source: 'hero' }] });
  assert.equal(hero.source, 'hero');

  const fallback = resolveSocialPreview({ ...base, config: { imageUrl: 'javascript:alert(1)' } });
  assert.equal(fallback.source, 'fallback');
});

test('share HTML has one complete metadata block and escapes supplied copy', () => {
  const resolved = resolveSocialPreview({ ...base, title: 'ChapterHer <September>' });
  const html = previewDocument(resolved);
  for (const key of ['og:title', 'og:type', 'og:image', 'og:url', 'og:image:secure_url', 'og:image:type', 'og:image:width', 'og:image:height', 'og:image:alt']) {
    assert.equal((html.match(new RegExp(`property="${key}"`, 'g')) || []).length, 1, key);
  }
  assert.equal((html.match(/name="twitter:image:alt"/g) || []).length, 1);
  assert.match(html, /ChapterHer &lt;September&gt;/);
  assert.doesNotMatch(html, /ChapterHer <September>/);
  assert.match(html, /rel="canonical" href="https:\/\/peshkash\.app\/event\/chapter-her-sept"/);
});
