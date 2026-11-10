import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const expandHome = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());

export const OUTPUT_DIR = path.resolve(
  process.env.YT_AUDIO_DIR ? expandHome(process.env.YT_AUDIO_DIR) : path.join(os.homedir(), 'Music', 'yt-download-mcp')
);
export const VIDEO_DIR = path.resolve(
  process.env.YT_VIDEO_DIR ? expandHome(process.env.YT_VIDEO_DIR) : path.join(OUTPUT_DIR, 'video')
);
const YTDLP = process.env.YTDLP_PATH ?? 'yt-dlp';
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const VIDEO_TIMEOUT_MS = 60 * 60 * 1000;

export const VIDEO_QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360'] as const;
export const VIDEO_CONTAINERS = ['mp4', 'mkv', 'webm'] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number];
const VIDEO_EXT = /\.(mp4|mkv|webm)$/;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

export interface Track {
  id: string;
  title: string;
  duration: number | null;
  uploader: string | null;
  filepath: string;
  cached: boolean;
}

export interface Video extends Track {
  height: number | null;
}

export interface SearchResult {
  id: string;
  title: string;
  duration: number | null;
  channel: string | null;
  url: string;
}

/** Accepts a YouTube / YouTube Music URL or a bare 11-char video ID; returns { id, url }. */
export function normalizeInput(input: string): { id: string; url: string } {
  const value = input.trim();
  if (VIDEO_ID.test(value)) {
    return { id: value, url: `https://www.youtube.com/watch?v=${value}` };
  }

  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`Not a YouTube URL or video ID: ${input}`);
  }
  if (!['http:', 'https:'].includes(u.protocol) || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`Only youtube.com, music.youtube.com and youtu.be links are supported: ${input}`);
  }

  const id =
    u.hostname === 'youtu.be'
      ? u.pathname.slice(1)
      : u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
  if (!id || !VIDEO_ID.test(id)) {
    throw new Error(`Could not find a video ID in: ${input}`);
  }
  // Keep the original host so music.youtube.com links resolve the same way, but drop playlist params.
  return { id, url: `https://${u.hostname === 'youtu.be' ? 'www.youtube.com' : u.hostname}/watch?v=${id}` };
}

function run(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`yt-dlp timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error('yt-dlp not found. Install it (brew install yt-dlp) or set YTDLP_PATH.')
          : err
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else {
        const errLines = stderr.split('\n').filter((l) => l.startsWith('ERROR')).join('\n');
        reject(new Error(errLines || stderr.trim() || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

async function findExisting(id: string, dir = OUTPUT_DIR, ext = 'mp3'): Promise<string | null> {
  const files = await fs.readdir(dir).catch(() => []);
  const hit = files.find((f) => f.endsWith(`[${id}].${ext}`));
  return hit ? path.join(dir, hit) : null;
}

/** yt-dlp arguments for a video download. Exported for tests. */
export function videoArgs(url: string, quality: VideoQuality, container: VideoContainer, dir: string): string[] {
  // Sort rather than filter, so a lower resolution is used when the requested one doesn't exist.
  // Resolution wins over codec; within a resolution, mp4 prefers H.264/AAC (plays natively in
  // QuickTime, iOS and most editors), webm prefers VP9/Opus, and mkv takes yt-dlp's default (best codec).
  const codecs = { mp4: 'vcodec:h264,acodec:m4a', webm: 'ext:webm:webm', mkv: null }[container];
  const sort = [quality === 'best' ? 'res' : `res:${quality}`, codecs].filter(Boolean).join(',');
  return [
    '--no-playlist',
    '-f', 'bv*+ba/b',
    '-S', sort,
    '--merge-output-format', container,
    '--remux-video', container,
    '--embed-metadata', '--embed-chapters',
    // yt-dlp can't embed thumbnails into webm.
    ...(container === 'webm' ? [] : ['--embed-thumbnail']),
    '--force-overwrites',
    '-P', dir,
    '-o', '%(title)s [%(id)s].%(ext)s',
    '--no-simulate', '--no-progress',
    '--print', 'after_move:%(.{id,title,duration,uploader,filepath,height})j',
    '--', url,
  ];
}

export async function downloadVideo(
  input: string,
  quality: VideoQuality,
  container: VideoContainer,
  force: boolean
): Promise<Video> {
  const { id, url } = normalizeInput(input);
  await fs.mkdir(VIDEO_DIR, { recursive: true });

  if (!force) {
    const existing = await findExisting(id, VIDEO_DIR, container);
    if (existing) {
      return {
        id,
        title: path.basename(existing).replace(/ \[[^\]]+\]\.\w+$/, ''),
        duration: null,
        uploader: null,
        height: null,
        filepath: existing,
        cached: true,
      };
    }
  }

  const stdout = await run(videoArgs(url, quality, container, VIDEO_DIR), VIDEO_TIMEOUT_MS);
  const info = JSON.parse(stdout.trim().split('\n').pop()!);
  return {
    id: info.id,
    title: info.title,
    duration: info.duration ?? null,
    uploader: info.uploader ?? null,
    height: info.height ?? null,
    filepath: info.filepath,
    cached: false,
  };
}

export async function downloadMp3(input: string, bitrate: string, force: boolean): Promise<Track> {
  const { id, url } = normalizeInput(input);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  if (!force) {
    const existing = await findExisting(id);
    if (existing) {
      return {
        id,
        title: path.basename(existing).replace(/ \[[^\]]+\]\.mp3$/, ''),
        duration: null,
        uploader: null,
        filepath: existing,
        cached: true,
      };
    }
  }

  const stdout = await run(
    [
      '--no-playlist',
      '-f', 'bestaudio/best',
      '-x', '--audio-format', 'mp3',
      '--audio-quality', bitrate,
      '--embed-metadata', '--embed-thumbnail',
      '--force-overwrites',
      '-P', OUTPUT_DIR,
      '-o', '%(title)s [%(id)s].%(ext)s',
      '--no-simulate', '--no-progress',
      '--print', 'after_move:%(.{id,title,duration,uploader,filepath})j',
      '--', url,
    ],
    DOWNLOAD_TIMEOUT_MS
  );

  const info = JSON.parse(stdout.trim().split('\n').pop()!);
  return {
    id: info.id,
    title: info.title,
    duration: info.duration ?? null,
    uploader: info.uploader ?? null,
    filepath: info.filepath,
    cached: false,
  };
}

export async function search(query: string, limit: number): Promise<SearchResult[]> {
  const stdout = await run(
    ['--flat-playlist', '-J', '--', `ytsearch${limit}:${query}`],
    60_000
  );
  const data = JSON.parse(stdout);
  return (data.entries ?? []).map((e: any) => ({
    id: e.id,
    title: e.title,
    duration: e.duration ?? null,
    channel: e.channel ?? e.uploader ?? null,
    url: `https://www.youtube.com/watch?v=${e.id}`,
  }));
}

async function listDir(dir: string, match: RegExp, type: 'audio' | 'video') {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  return Promise.all(
    files
      .filter((f) => match.test(f))
      .map(async (f) => {
        const filepath = path.join(dir, f);
        const st = await fs.stat(filepath);
        return {
          type,
          file: f,
          filepath,
          id: f.match(/\[([A-Za-z0-9_-]{11})\]\.\w+$/)?.[1] ?? null,
          size_mb: +(st.size / 1024 / 1024).toFixed(2),
          downloaded_at: st.mtime.toISOString(),
        };
      })
  );
}

export async function listDownloads(type: 'audio' | 'video' | 'all' = 'all') {
  const rows = [
    ...(type !== 'video' ? await listDir(OUTPUT_DIR, /\.mp3$/, 'audio') : []),
    ...(type !== 'audio' ? await listDir(VIDEO_DIR, VIDEO_EXT, 'video') : []),
  ];
  return rows.sort((a, b) => b.downloaded_at.localeCompare(a.downloaded_at));
}
