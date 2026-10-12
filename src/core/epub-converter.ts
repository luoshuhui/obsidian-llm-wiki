/**
 * EPUB Converter and Sidecar Orchestrator.
 *
 * Coordinates MarkItDown CLI conversion, chapter splitting, disk caching,
 * and vault sidecar folder creation.
 */

import { App, TFile, TFolder, normalizePath, Platform } from 'obsidian';
import * as path from 'node:path';
import { sha256Bytes, hashCacheKey } from './pdf-cache';
import { createEpubCache, EPUB_CONVERTER_VERSION } from './epub-cache';
import { runMarkitdownCli, MarkitdownDesktopOnlyError } from './markitdown-cli';
import { splitEpubMarkdown, type SplitChapter } from './epub-splitter';

export interface EpubConversionContext {
  app: App;
  file: TFile;
  settings: {
    markitdownCliPath?: string;
    epubChapterMinChars?: number;
    [k: string]: unknown;
  };
  subtle?: SubtleCrypto;
  abortSignal?: AbortSignal;
}

export interface EpubConversionResult {
  bookTitle: string;
  chapters: SplitChapter[];
  sidecarFolder: string;
  overviewFile: TFile;
  chapterFiles: TFile[];
}

export async function convertAndSplitEpub(ctx: EpubConversionContext): Promise<EpubConversionResult> {
  if (!Platform.isDesktop) {
    throw new MarkitdownDesktopOnlyError();
  }

  const { app, file, settings, subtle, abortSignal } = ctx;

  // 1. Read EPUB binary bytes and compute hash
  const bytes = new Uint8Array(await app.vault.adapter.readBinary(file.path));
  const sourceHash = await sha256Bytes(bytes, subtle);
  const cache = createEpubCache(app);
  const logicalKey = `${sourceHash}:markitdown:epub:${EPUB_CONVERTER_VERSION}`;
  const cacheToken = await hashCacheKey(logicalKey, subtle);

  let bookTitle = file.basename;
  let overviewContent = '';
  let chapters: SplitChapter[] = [];

  // 2. Cache check
  const cached = await cache.get(cacheToken);
  if (cached) {
    bookTitle = cached.bookTitle;
    overviewContent = cached.overviewContent;
    chapters = cached.chapters;
  } else {
    // 3. Resolve absolute filesystem path
    const adapter = app.vault.adapter as { getBasePath?(): string };
    const basePath = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
    const absInputPath = basePath ? path.join(basePath, file.path) : file.path;

    // 4. Run MarkItDown CLI
    const markdown = await runMarkitdownCli(absInputPath, {
      cliPath: settings.markitdownCliPath,
      abortSignal,
    });

    // 5. Split Markdown into chapters
    const splitResult = splitEpubMarkdown(markdown, settings.epubChapterMinChars);
    bookTitle = splitResult.bookTitle || file.basename;
    overviewContent = splitResult.overviewContent;
    chapters = splitResult.chapters;

    // 6. Write to disk cache
    await cache.set(cacheToken, {
      markdown,
      bookTitle,
      overviewContent,
      chapters,
      metadata: {
        bookTitle,
        chapterCount: chapters.length,
        convertedAt: new Date().toISOString(),
        converter: 'markitdown/epub',
      },
    });
  }

  // 7. Write Sidecar files into Vault
  const parentDir = file.parent?.path ?? '';
  const rawDir = parentDir ? `${parentDir}/${file.basename}` : file.basename;
  const sidecarDir = normalizePath(rawDir);

  const existingFolder = app.vault.getAbstractFileByPath(sidecarDir);
  if (!existingFolder) {
    await app.vault.createFolder(sidecarDir);
  } else if (!(existingFolder instanceof TFolder)) {
    throw new Error(`Cannot create sidecar folder: "${sidecarDir}" is not a folder.`);
  }

  // Write Overview note
  const overviewPath = normalizePath(`${sidecarDir}/00 - Overview.md`);
  let overviewFile = app.vault.getAbstractFileByPath(overviewPath);
  if (overviewFile instanceof TFile) {
    await app.vault.modify(overviewFile, overviewContent);
  } else {
    overviewFile = await app.vault.create(overviewPath, overviewContent);
  }

  // Write chapter notes
  const chapterFiles: TFile[] = [];
  for (const chapter of chapters) {
    const chapterPath = normalizePath(`${sidecarDir}/${chapter.filename}`);
    const existing = app.vault.getAbstractFileByPath(chapterPath);
    let targetFile: TFile;
    if (existing instanceof TFile) {
      await app.vault.modify(existing, chapter.content);
      targetFile = existing;
    } else {
      targetFile = await app.vault.create(chapterPath, chapter.content);
    }
    chapterFiles.push(targetFile);
  }

  return {
    bookTitle,
    chapters,
    sidecarFolder: sidecarDir,
    overviewFile: overviewFile as TFile,
    chapterFiles,
  };
}
