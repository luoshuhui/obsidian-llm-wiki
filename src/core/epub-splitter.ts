/**
 * EPUB Markdown Chapter Splitter.
 *
 * Parses Markdown produced by MarkItDown from an EPUB file,
 * detects chapter boundaries based on headings, and splits the content
 * into individual chapter notes plus an overview table of contents.
 *
 * Pure function without IO for deterministic testing.
 */

import { DEFAULT_EPUB_CHAPTER_MIN_CHARS } from '../constants';

export interface SplitChapter {
  index: number;
  title: string;
  filename: string;
  content: string;
}

export interface EpubSplitResult {
  bookTitle: string;
  overviewContent: string;
  chapters: SplitChapter[];
}

function sanitizeFilename(raw: string): string {
  const sanitized = raw.replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
  const clamped = sanitized.slice(0, 80).trim();
  return clamped.length > 0 ? clamped : 'Chapter';
}

/**
 * Split a full EPUB Markdown document into structured chapters.
 *
 * @param markdown The full Markdown text converted from the EPUB
 * @param minChars Minimum characters for a standalone chapter (default 300)
 * @returns Split chapters and an overview TOC document
 */
export function splitEpubMarkdown(
  markdown: string,
  minChars = DEFAULT_EPUB_CHAPTER_MIN_CHARS,
): EpubSplitResult {
  const lines = markdown.split(/\r?\n/);

  // Detect heading lines: # Heading or ## Heading
  const headingIndices: Array<{ lineIndex: number; level: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,2})\s+(.+)$/);
    if (match) {
      headingIndices.push({
        lineIndex: i,
        level: match[1].length,
        title: match[2].trim(),
      });
    }
  }

  // If no headings found, return a single chapter
  if (headingIndices.length === 0) {
    const singleContent = markdown.trim();
    const chapter: SplitChapter = {
      index: 1,
      title: 'Content',
      filename: '01 - Content.md',
      content: singleContent,
    };
    const overviewContent = `# Untitled Book\n\n## Chapters\n\n- [[${chapter.filename}|Content]]\n`;
    return { bookTitle: 'Untitled Book', overviewContent, chapters: [chapter] };
  }

  // Determine whether the first heading represents the book title
  // If there are multiple headings and the first is an H1, treat it as the book header + preface
  let bookTitle = headingIndices[0].title;
  let preface = '';
  let chapterHeadings = headingIndices;

  if (headingIndices.length > 1 && headingIndices[0].level === 1) {
    bookTitle = headingIndices[0].title;
    const prefaceLines = lines.slice(headingIndices[0].lineIndex + 1, headingIndices[1].lineIndex);
    preface = prefaceLines.join('\n').trim();
    chapterHeadings = headingIndices.slice(1);
  }

  // Pre-heading content (anything before the first heading)
  const preHeadingContent = lines.slice(0, headingIndices[0].lineIndex).join('\n').trim();

  // Extract raw sections for chapters
  interface RawSection {
    title: string;
    content: string;
  }
  const rawSections: RawSection[] = [];

  for (let i = 0; i < chapterHeadings.length; i++) {
    const current = chapterHeadings[i];
    const nextLineIndex = i + 1 < chapterHeadings.length ? chapterHeadings[i + 1].lineIndex : lines.length;
    const sectionLines = lines.slice(current.lineIndex, nextLineIndex);
    const content = sectionLines.join('\n').trim();
    rawSections.push({ title: current.title, content });
  }

  // Merge sections that are too short into the previous section
  const chapters: SplitChapter[] = [];
  let currentAccumulated: RawSection | null = null;
  let chapterIndex = 1;

  for (let i = 0; i < rawSections.length; i++) {
    const sec = rawSections[i];
    if (currentAccumulated === null) {
      currentAccumulated = { title: sec.title, content: sec.content };
    } else if (currentAccumulated.content.length < minChars) {
      currentAccumulated.content += `\n\n${sec.content}`;
    } else if (sec.content.length < minChars) {
      currentAccumulated.content += `\n\n${sec.content}`;
    } else {
      const safeTitle = sanitizeFilename(currentAccumulated.title);
      const prefix = String(chapterIndex).padStart(2, '0');
      chapters.push({
        index: chapterIndex,
        title: currentAccumulated.title,
        filename: `${prefix} - ${safeTitle}.md`,
        content: currentAccumulated.content,
      });
      chapterIndex++;
      currentAccumulated = { title: sec.title, content: sec.content };
    }
  }

  if (currentAccumulated !== null && currentAccumulated.content.trim().length > 0) {
    const safeTitle = sanitizeFilename(currentAccumulated.title);
    const prefix = String(chapterIndex).padStart(2, '0');
    chapters.push({
      index: chapterIndex,
      title: currentAccumulated.title,
      filename: `${prefix} - ${safeTitle}.md`,
      content: currentAccumulated.content,
    });
  }

  // Build Overview document with TOC
  const tocLines = chapters.map(c => `- [[${c.filename.replace(/\.md$/, '')}|${c.title}]]`);
  let overviewContent = `# ${bookTitle}\n\n`;
  if (preHeadingContent.length > 0) {
    overviewContent += `${preHeadingContent}\n\n`;
  }
  if (preface.length > 0) {
    overviewContent += `${preface}\n\n`;
  }
  overviewContent += `## Table of Contents\n\n${tocLines.join('\n')}\n`;

  return {
    bookTitle,
    overviewContent,
    chapters,
  };
}
