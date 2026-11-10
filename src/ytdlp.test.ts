import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeInput, videoArgs } from './ytdlp.js';

test('video args cap resolution and prefer mp4/m4a', () => {
  const args = videoArgs('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '720', 'mp4', '/out');
  assert.equal(args[args.indexOf('-S') + 1], 'res:720,vcodec:h264,acodec:m4a');
  assert.equal(args[args.indexOf('--merge-output-format') + 1], 'mp4');
  assert.ok(args.includes('--embed-thumbnail'));
  assert.equal(args.at(-2), '--');
});

test('video args: best quality has no res cap; webm skips thumbnail embedding', () => {
  const args = videoArgs('u', 'best', 'webm', '/out');
  assert.equal(args[args.indexOf('-S') + 1], 'res,ext:webm:webm');
  assert.ok(!args.includes('--embed-thumbnail'));
});

const ID = 'dQw4w9WgXcQ';

test('accepts a bare video ID', () => {
  assert.deepEqual(normalizeInput(ID), { id: ID, url: `https://www.youtube.com/watch?v=${ID}` });
});

test('accepts watch, shorts, live and embed URLs', () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
  ]) {
    assert.equal(normalizeInput(url).id, ID, url);
  }
});

test('maps youtu.be links to youtube.com', () => {
  assert.deepEqual(normalizeInput(`https://youtu.be/${ID}`), {
    id: ID,
    url: `https://www.youtube.com/watch?v=${ID}`,
  });
});

test('keeps the music.youtube.com host', () => {
  assert.equal(
    normalizeInput(`https://music.youtube.com/watch?v=${ID}&feature=share`).url,
    `https://music.youtube.com/watch?v=${ID}`
  );
});

test('drops playlist parameters', () => {
  assert.equal(
    normalizeInput(`https://www.youtube.com/watch?v=${ID}&list=PL123&index=4`).url,
    `https://www.youtube.com/watch?v=${ID}`
  );
});

test('rejects other hosts and schemes', () => {
  assert.throws(() => normalizeInput(`https://vimeo.com/${ID}`), /Only youtube\.com/);
  assert.throws(() => normalizeInput(`ftp://youtube.com/watch?v=${ID}`), /Only youtube\.com/);
  assert.throws(() => normalizeInput('not a link'), /Not a YouTube URL/);
});

test('rejects URLs without a valid video ID', () => {
  assert.throws(() => normalizeInput('https://www.youtube.com/'), /Could not find a video ID/);
  assert.throws(() => normalizeInput('https://youtu.be/short'), /Could not find a video ID/);
});
