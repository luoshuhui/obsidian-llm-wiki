/**
 * MarkItDown CLI subprocess bridge for EPUB -> Markdown conversion.
 *
 * Runs only on desktop (Platform.isDesktop). Converts EPUB files to
 * Markdown via Microsoft's `markitdown` CLI utility.
 */

import { Platform } from 'obsidian';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DEFAULT_MARKITDOWN_CLI_PATH, MARKITDOWN_TIMEOUT_MS } from '../constants';

export class MarkitdownDesktopOnlyError extends Error {
  constructor() {
    super('EPUB conversion via MarkItDown is only supported on desktop platforms.');
    this.name = 'MarkitdownDesktopOnlyError';
  }
}

export class MarkitdownNotFoundError extends Error {
  constructor(public readonly cliPath: string) {
    super(
      `MarkItDown CLI command "${cliPath}" was not found. ` +
        'Please ensure Python 3.10+ is installed and run `pip install markitdown`, ' +
        'or configure the full executable path in Settings → Wiki Configuration.'
    );
    this.name = 'MarkitdownNotFoundError';
  }
}

export class MarkitdownExecutionError extends Error {
  constructor(message: string, public readonly exitCode?: number | null) {
    super(message);
    this.name = 'MarkitdownExecutionError';
  }
}

export interface RunMarkitdownOptions {
  cliPath?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

/**
 * Execute markitdown CLI to convert an EPUB file into Markdown.
 *
 * @param inputFilePath Absolute filesystem path to the source EPUB file
 * @param options Execution options (cliPath, timeout, abortSignal)
 * @returns Converted Markdown content string
 */
export async function runMarkitdownCli(
  inputFilePath: string,
  options?: RunMarkitdownOptions,
): Promise<string> {
  if (!Platform.isDesktop) {
    throw new MarkitdownDesktopOnlyError();
  }

  const cliPath = (options?.cliPath || '').trim() || DEFAULT_MARKITDOWN_CLI_PATH;
  const timeoutMs = options?.timeoutMs ?? MARKITDOWN_TIMEOUT_MS;

  // Generate a unique temporary output file path
  const tempOutputName = `markitdown-${Date.now()}-${Math.random().toString(16).slice(2)}.md`;
  const tempOutputPath = path.join(os.tmpdir(), tempOutputName);

  try {
    await new Promise<void>((resolve, reject) => {
      if (options?.abortSignal?.aborted) {
        reject(new DOMException('MarkItDown conversion was cancelled.', 'AbortError'));
        return;
      }

      const child = execFile(
        cliPath,
        [inputFilePath, '-o', tempOutputPath],
        { timeout: timeoutMs },
        (error, _stdout, stderr) => {
          if (options?.abortSignal?.aborted) {
            reject(new DOMException('MarkItDown conversion was cancelled.', 'AbortError'));
            return;
          }

          if (error) {
            const errRecord = error as NodeJS.ErrnoException;
            if (errRecord.code === 'ENOENT') {
              reject(new MarkitdownNotFoundError(cliPath));
              return;
            }
            const errMessage = stderr?.trim() || error.message;
            reject(new MarkitdownExecutionError(`MarkItDown failed: ${errMessage}`, error.code as number));
            return;
          }

          resolve();
        },
      );

      if (options?.abortSignal) {
        const onAbort = () => {
          child.kill('SIGTERM');
          reject(new DOMException('MarkItDown conversion was cancelled.', 'AbortError'));
        };
        options.abortSignal.addEventListener('abort', onAbort, { once: true });
      }
    });

    if (!fs.existsSync(tempOutputPath)) {
      throw new MarkitdownExecutionError('MarkItDown completed without producing an output file.');
    }

    const markdown = fs.readFileSync(tempOutputPath, 'utf-8');
    return markdown;
  } finally {
    if (fs.existsSync(tempOutputPath)) {
      try {
        fs.unlinkSync(tempOutputPath);
      } catch (e) {
        console.warn('[markitdown-cli] Failed to remove temp file:', tempOutputPath, e);
      }
    }
  }
}
