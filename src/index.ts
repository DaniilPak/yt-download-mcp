#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  OUTPUT_DIR,
  VIDEO_CONTAINERS,
  VIDEO_DIR,
  VIDEO_QUALITIES,
  downloadMp3,
  downloadVideo,
  listDownloads,
  search,
} from './ytdlp.js';

const server = new McpServer({ name: 'yt-download', version: '1.1.0' });

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});
const fail = (err: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
});

server.registerTool(
  'download_mp3',
  {
    title: 'Download MP3 from YouTube',
    description:
      'Download the audio of a YouTube or YouTube Music video as an MP3 file. ' +
      `Files are saved to ${OUTPUT_DIR}. Already-downloaded videos are returned from disk unless force=true.`,
    inputSchema: {
      url: z
        .string()
        .describe('youtube.com / music.youtube.com / youtu.be link, or a bare 11-character video ID'),
      bitrate: z
        .enum(['0', '320K', '256K', '192K', '128K'])
        .default('0')
        .describe('"0" = best VBR (default), or a fixed CBR bitrate'),
      force: z.boolean().default(false).describe('Re-download even if the file already exists'),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async ({ url, bitrate, force }) => {
    try {
      return json(await downloadMp3(url, bitrate, force));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  'download_video',
  {
    title: 'Download video from YouTube',
    description:
      'Download a YouTube or YouTube Music video (picture + sound) as a video file. ' +
      `Files are saved to ${VIDEO_DIR}. Already-downloaded videos are returned from disk unless force=true ` +
      '(use force to re-download at a different quality).',
    inputSchema: {
      url: z
        .string()
        .describe('youtube.com / music.youtube.com / youtu.be link, or a bare 11-character video ID'),
      quality: z
        .enum(VIDEO_QUALITIES)
        .default('1080')
        .describe('Max resolution height in pixels, or "best". Falls back to the nearest lower resolution.'),
      container: z
        .enum(VIDEO_CONTAINERS)
        .default('mp4')
        .describe('"mp4" (default, plays everywhere), "mkv", or "webm"'),
      force: z.boolean().default(false).describe('Re-download even if the file already exists'),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async ({ url, quality, container, force }) => {
    try {
      return json(await downloadVideo(url, quality, container, force));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  'search_youtube',
  {
    title: 'Search YouTube',
    description: 'Search YouTube and return video IDs/URLs that can be passed to download_mp3 or download_video.',
    inputSchema: {
      query: z.string().min(1).describe('Search text, e.g. "artist - song title"'),
      limit: z.number().int().min(1).max(25).default(5),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, limit }) => {
    try {
      return json(await search(query, limit));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  'list_downloads',
  {
    title: 'List downloads',
    description: `List downloaded MP3s (${OUTPUT_DIR}) and videos (${VIDEO_DIR}), newest first.`,
    inputSchema: {
      type: z.enum(['all', 'audio', 'video']).default('all').describe('Filter by download type'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ type }) => {
    try {
      return json(await listDownloads(type));
    } catch (err) {
      return fail(err);
    }
  }
);

await server.connect(new StdioServerTransport());
console.error(`yt-download MCP server running (audio: ${OUTPUT_DIR}, video: ${VIDEO_DIR})`);
