const test = require('node:test');
const assert = require('node:assert/strict');
const { previewDocument } = require('../dist/controllers/SharePreviewController');
const { resolveSocialPreview } = require('../dist/services/SocialPreviewService');
const { renderEntityPreviewImage, renderEventPreviewImage } = require('../dist/controllers/SocialPreviewImageController');
const { instagramOgImage } = require('../dist/controllers/InstagramAvatarController');
const sharp = require('sharp');

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

test('generated event card is an exact, compressed 1200 by 630 JPEG', async () => {
  const image = await renderEventPreviewImage({
    displayName: 'ChapterHer September Edit',
    eventDescription: 'Festive Edit bringing 30+ labels under the same roof.',
    startTime: new Date('2026-09-09T03:30:00.000Z'),
    experienceConfig: { venueName: 'Radisson Jalandhar', venueAddress: 'GT Road, Jalandhar' },
    vendor: { displayName: 'Niharika Singh & Vidhu Shoor' },
  });
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
  assert.ok(image.length < 350 * 1024, `image was ${image.length} bytes`);
});

test('vendor, collection and item cards are distinct compressed 1200 by 630 JPEGs', async () => {
  const inputs = [
    { kind: 'vendor', title: 'ChapterHer', description: 'Curated fashion and conversations.', context: 'New Delhi' },
    { kind: 'collection', title: 'The Festive Edit', description: 'A considered edit for the season.', context: 'By ChapterHer' },
    { kind: 'item', title: 'Hand-finished Gold Ring', description: 'A sculptural statement with a quiet finish.', context: 'By ChapterHer' },
  ];
  const images = await Promise.all(inputs.map((input) => renderEntityPreviewImage(input)));
  for (const image of images) {
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 630);
    assert.ok(image.length < 350 * 1024, `image was ${image.length} bytes`);
  }
  assert.equal(new Set(images.map((image) => image.toString('base64'))).size, 3);
});

test('Instagram avatar resolver extracts either valid Open Graph meta ordering', () => {
  assert.equal(
    instagramOgImage('<meta property="og:image" content="https://scontent.cdninstagram.com/avatar.jpg?x=1&amp;y=2">'),
    'https://scontent.cdninstagram.com/avatar.jpg?x=1&y=2',
  );
  assert.equal(
    instagramOgImage('<meta content="https://scontent.fbcdn.net/avatar.webp" property="og:image">'),
    'https://scontent.fbcdn.net/avatar.webp',
  );
  assert.equal(instagramOgImage('<html><head></head></html>'), null);
});
