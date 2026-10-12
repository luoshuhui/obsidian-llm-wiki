import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import {
  runMarkitdownCli,
  MarkitdownDesktopOnlyError,
  MarkitdownNotFoundError,
  MarkitdownExecutionError,
} from '../../core/markitdown-cli';

vi.mock('obsidian', () => ({
  Platform: {
    isDesktop: true,
  },
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

describe('markitdown-cli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (Platform as { isDesktop: boolean }).isDesktop = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws MarkitdownDesktopOnlyError on non-desktop platforms', async () => {
    (Platform as { isDesktop: boolean }).isDesktop = false;
    await expect(runMarkitdownCli('/fake/book.epub')).rejects.toThrow(MarkitdownDesktopOnlyError);
  });

  it('runs execFile and returns markdown output upon success', async () => {
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback) => {
      // Simulate successful execution
      if (typeof callback === 'function') {
        callback(null, '', '');
      }
      return { kill: vi.fn() } as never;
    });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Converted Book Content\n\nSome text.');

    const result = await runMarkitdownCli('/fake/book.epub');

    expect(result).toBe('# Converted Book Content\n\nSome text.');
    expect(childProcess.execFile).toHaveBeenCalledWith(
      'markitdown',
      expect.arrayContaining(['/fake/book.epub', '-o']),
      expect.any(Object),
      expect.any(Function),
    );
    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it('throws MarkitdownNotFoundError when command is not in PATH (ENOENT)', async () => {
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback) => {
      const enoentErr = new Error('spawn markitdown ENOENT') as NodeJS.ErrnoException;
      enoentErr.code = 'ENOENT';
      if (typeof callback === 'function') {
        callback(enoentErr, '', '');
      }
      return { kill: vi.fn() } as never;
    });

    await expect(runMarkitdownCli('/fake/book.epub')).rejects.toThrow(MarkitdownNotFoundError);
  });

  it('throws MarkitdownExecutionError when command fails with non-zero exit code', async () => {
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback) => {
      const execErr = new Error('Command failed') as NodeJS.ErrnoException;
      execErr.code = '1';
      if (typeof callback === 'function') {
        callback(execErr, '', 'Corrupted EPUB file');
      }
      return { kill: vi.fn() } as never;
    });

    await expect(runMarkitdownCli('/fake/book.epub')).rejects.toThrow(MarkitdownExecutionError);
  });

  it('cancels execution when abortSignal is triggered', async () => {
    const killMock = vi.fn();
    const abortController = new AbortController();

    vi.mocked(childProcess.execFile).mockImplementation(() => {
      return { kill: killMock } as never;
    });

    const promise = runMarkitdownCli('/fake/book.epub', {
      abortSignal: abortController.signal,
    });

    abortController.abort();

    await expect(promise).rejects.toThrow();
    expect(killMock).toHaveBeenCalled();
  });
});
