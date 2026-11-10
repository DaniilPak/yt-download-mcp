# Changelog

## 1.1.0

- Renamed to **yt-download-mcp** (MCP server name `yt-download`); the default output folder is now `~/Music/yt-download-mcp`. `YT_AUDIO_DIR` / `YT_VIDEO_DIR` still work, so point `YT_AUDIO_DIR` at your old folder to keep your library
- `download_video` tool: MP4 (default), MKV or WebM, capped at a chosen resolution (default 1080p), with metadata, chapters and thumbnail embedded
- Videos are saved to `YT_VIDEO_DIR` (default `<YT_AUDIO_DIR>/video`) and cached by video ID
- `list_downloads` lists videos too and takes an optional `type` filter

## 1.0.0

- `download_mp3`, `search_youtube` and `list_downloads` tools
- MP3s with ID3 tags and embedded cover art, cached by video ID
- "respect" Claude Code skill
