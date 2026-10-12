/**
 * EPUB Conversion and Chapter Split Cache.
 *
 * Stores converted EPUB -> Markdown and split chapter results on disk,
 * keyed by content hash + converter version.
 *
 * Cache directory: `.obsidian/plugins/karpathywiki/epub-cache/{token}.json`
 */

import { normalizePath, type App } from 'obsidian';
import {
  EPUB_CACHE_TTL_MS,
  PDF_CACHE_MAX_BYTES,
  PDF_CACHE_MAX_ENTRIES,
  PDF_CACHE_MAX_SINGLE_ENTRY_BYTES,
} from '../constants';
import { DiskCache } from './disk-cache';
import type { SplitChapter } from './epub-splitter';

export const EPUB_CONVERTER_VERSION = 'v1.0.0';

export interface EpubCacheMetadata {
  bookTitle: string;
  chapterCount: number;
  convertedAt: string;
  converter: string;
}

export interface EpubCacheEntry {
  markdown: string;
  bookTitle: string;
  overviewContent: string;
  chapters: SplitChapter[];
  metadata: EpubCacheMetadata;
}

export function createEpubCache(app: App): DiskCache<EpubCacheEntry> {
  const cacheDir = normalizePath(`${app.vault.configDir}/plugins/karpathywiki/epub-cache`);
  return new DiskCache<EpubCacheEntry>({
    cacheDir,
    adapter: app.vault.adapter,
    ttlMs: EPUB_CACHE_TTL_MS,
    maxBytes: PDF_CACHE_MAX_BYTES,
    maxEntries: PDF_CACHE_MAX_ENTRIES,
    maxSingleEntryBytes: PDF_CACHE_MAX_SINGLE_ENTRY_BYTES,
  });
}
