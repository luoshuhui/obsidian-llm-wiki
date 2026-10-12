import { describe, it, expect } from 'vitest';
import { splitEpubMarkdown } from '../../core/epub-splitter';

describe('epub-splitter', () => {
  it('splits markdown into chapters based on H1 and H2 headings', () => {
    const sample = `
# Deep Learning Book

This is the preface of the book.

# Chapter 1: Introduction

Deep learning is a subset of machine learning. It uses neural networks with many layers to learn representations of data.

# Chapter 2: Linear Algebra

Linear algebra is a branch of mathematics concerning linear equations and linear maps.
It is fundamental to modern machine learning.
`;

    const result = splitEpubMarkdown(sample, 50);

    expect(result.bookTitle).toBe('Deep Learning Book');
    expect(result.overviewContent).toContain('# Deep Learning Book');
    expect(result.overviewContent).toContain('This is the preface of the book.');
    expect(result.overviewContent).toContain('[[01 - Chapter 1 Introduction|Chapter 1: Introduction]]');
    expect(result.overviewContent).toContain('[[02 - Chapter 2 Linear Algebra|Chapter 2: Linear Algebra]]');

    expect(result.chapters.length).toBe(2);
    expect(result.chapters[0].index).toBe(1);
    expect(result.chapters[0].title).toBe('Chapter 1: Introduction');
    expect(result.chapters[0].filename).toBe('01 - Chapter 1 Introduction.md');
    expect(result.chapters[0].content).toContain('Deep learning is a subset');

    expect(result.chapters[1].index).toBe(2);
    expect(result.chapters[1].title).toBe('Chapter 2: Linear Algebra');
    expect(result.chapters[1].filename).toBe('02 - Chapter 2 Linear Algebra.md');
    expect(result.chapters[1].content).toContain('Linear algebra is a branch');
  });

  it('merges sections shorter than minChars into previous chapter', () => {
    const sample = `
# Main Book Title

# Chapter 1

This is a long chapter that contains enough text to satisfy the minimum threshold for standalone chapters.
It has lots of detailed explanations and definitions.

## Brief Note

Too short.

# Chapter 2

This is the second long chapter with substantial content discussing advanced methodologies and evaluation.
`;

    const result = splitEpubMarkdown(sample, 100);

    // "Brief Note" has very few characters, so it should be merged into Chapter 1
    expect(result.chapters.length).toBe(2);
    expect(result.chapters[0].title).toBe('Chapter 1');
    expect(result.chapters[0].content).toContain('Brief Note');
    expect(result.chapters[0].content).toContain('Too short.');
    expect(result.chapters[1].title).toBe('Chapter 2');
  });

  it('handles markdown without headings by returning a single content chapter', () => {
    const plainText = 'This is a book without explicit markdown headings. Just paragraphs of text describing concepts.';

    const result = splitEpubMarkdown(plainText, 50);

    expect(result.chapters.length).toBe(1);
    expect(result.chapters[0].filename).toBe('01 - Content.md');
    expect(result.chapters[0].content).toBe(plainText);
    expect(result.overviewContent).toContain('[[01 - Content.md|Content]]');
  });

  it('sanitizes illegal filename characters in chapter titles', () => {
    const sample = `
# Book: The Ultimate Guide?

# Chapter 1: What / Why * How <Special>?

Chapter body with ample text to exceed the minimum character requirement for testing purposes.
`;

    const result = splitEpubMarkdown(sample, 50);

    expect(result.chapters[0].filename).toBe('01 - Chapter 1 What  Why  How Special.md');
  });
});
