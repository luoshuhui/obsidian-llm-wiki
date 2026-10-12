import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Platform, TFile, TFolder } from 'obsidian';

const cacheStore = vi.hoisted(() => new Map<string, unknown>());

vi.mock('obsidian', () => ({
  Platform: {
    isDesktop: true,
  },
  normalizePath: (p: string) => p,
  TFile: class {
    path = '';
    basename = '';
    parent: { path: string } | null = null;
  },
  TFolder: class {
    path = '';
  },
}));

vi.mock('../../core/pdf-cache', () => ({
  sha256Bytes: vi.fn(async () => 'fake-epub-sha256'),
  hashCacheKey: vi.fn(async (key: string) => `hash-${key.slice(0, 10)}`),
}));

vi.mock('../../core/epub-cache', () => ({
  EPUB_CONVERTER_VERSION: 'v1.0.0',
  createEpubCache: () => ({
    get: async (key: string) => cacheStore.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      cacheStore.set(key, value);
    },
  }),
}));

const runMarkitdownCliMock = vi.hoisted(() => vi.fn());
vi.mock('../../core/markitdown-cli', () => ({
  runMarkitdownCli: runMarkitdownCliMock,
  MarkitdownDesktopOnlyError: class extends Error {
    constructor() {
      super('Desktop only');
      this.name = 'MarkitdownDesktopOnlyError';
    }
  },
}));

import { convertAndSplitEpub } from '../../core/epub-converter';

describe('epub-converter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheStore.clear();
    (Platform as { isDesktop: boolean }).isDesktop = true;
  });

  function createMockApp() {
    const vaultFiles = new Map<string, unknown>();
    return {
      vault: {
        adapter: {
          readBinary: vi.fn(async () => new Uint8Array([1, 2, 3])),
          getBasePath: vi.fn(() => '/vault/root'),
        },
        getAbstractFileByPath: vi.fn((path: string) => vaultFiles.get(path) ?? null),
        createFolder: vi.fn(async (path: string) => {
          const folder = new TFolder();
          folder.path = path;
          vaultFiles.set(path, folder);
          return folder;
        }),
        create: vi.fn(async (path: string, _content: string) => {
          const file = new TFile();
          file.path = path;
          vaultFiles.set(path, file);
          return file;
        }),
        modify: vi.fn(async (_file: TFile, _content: string) => {}),
      },
    };
  }

  it('converts EPUB via MarkItDown and writes Sidecar files on cache miss', async () => {
    const app = createMockApp();
    const file = new TFile();
    file.path = 'books/neural-networks.epub';
    file.basename = 'neural-networks';
    file.parent = { path: 'books' } as never;

    runMarkitdownCliMock.mockResolvedValue(`
# Neural Networks and Deep Learning

This is an introduction to neural networks.

# Chapter 1: Using Neural Nets

Deep learning neural networks are parameterized functions.

# Chapter 2: How Backprop Works

Backpropagation calculates gradients efficiently across computational graphs.
`);

    const result = await convertAndSplitEpub({
      app: app as never,
      file,
      settings: {
        markitdownCliPath: 'markitdown',
        epubChapterMinChars: 50,
      },
    });

    expect(runMarkitdownCliMock).toHaveBeenCalledTimes(1);
    expect(result.bookTitle).toBe('Neural Networks and Deep Learning');
    expect(result.sidecarFolder).toBe('books/neural-networks');
    expect(result.chapters.length).toBe(2);
    expect(result.chapterFiles.length).toBe(2);
    expect(app.vault.createFolder).toHaveBeenCalledWith('books/neural-networks');
    expect(app.vault.create).toHaveBeenCalledWith(
      'books/neural-networks/00 - Overview.md',
      expect.stringContaining('Table of Contents'),
    );
  });

  it('returns cached chapters without re-invoking MarkItDown CLI on cache hit', async () => {
    const app = createMockApp();
    const file = new TFile();
    file.path = 'books/neural-networks.epub';
    file.basename = 'neural-networks';
    file.parent = { path: 'books' } as never;

    // Seed cache
    const cacheKey = 'hash-fake-epub-';
    cacheStore.set(cacheKey, {
      markdown: '...',
      bookTitle: 'Cached Book',
      overviewContent: '# Cached Book\n\n- [[01 - Intro.md|Intro]]',
      chapters: [
        { index: 1, title: 'Intro', filename: '01 - Intro.md', content: 'Intro text' },
      ],
      metadata: {
        bookTitle: 'Cached Book',
        chapterCount: 1,
        convertedAt: new Date().toISOString(),
        converter: 'markitdown/epub',
      },
    });

    const result = await convertAndSplitEpub({
      app: app as never,
      file,
      settings: {
        markitdownCliPath: 'markitdown',
      },
    });

    expect(runMarkitdownCliMock).not.toHaveBeenCalled();
    expect(result.bookTitle).toBe('Cached Book');
    expect(result.chapters.length).toBe(1);
    expect(result.chapterFiles.length).toBe(1);
  });
});
