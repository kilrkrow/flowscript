/**
 * Text extraction from various document formats.
 * Returns plain text suitable for LLM processing.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

// ── URL ──────────────────────────────────────────────────────────────────────

export async function extractFromUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FlowScript/1.0 (diagram generator)' },
  });
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);

  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('pdf')) {
    const buf = await res.arrayBuffer();
    return extractFromPdf(Buffer.from(buf));
  }

  if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
    return res.text();
  }

  // HTML — strip tags and collapse whitespace
  const html = await res.text();
  return stripHtml(html);
}

// ── File buffer ───────────────────────────────────────────────────────────────

export async function extractFromFile(
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  switch (ext) {
    case 'pdf':  return extractFromPdf(buffer);
    case 'docx': return extractFromDocx(buffer);
    case 'rtf':  return stripRtf(buffer.toString('utf-8'));
    case 'txt':
    case 'md':
    case 'markdown':
    default:     return buffer.toString('utf-8');
  }
}

// ── Format handlers ───────────────────────────────────────────────────────────

async function extractFromPdf(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return result.text.trim();
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

function stripRtf(rtf: string): string {
  return rtf
    .replace(/\{[^{}]*\}/g, '')         // remove groups
    .replace(/\\[a-z]+[-]?\d* ?/g, ' ') // remove control words
    .replace(/\\/g, '')                  // remove remaining backslashes
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(html: string): string {
  // Remove script and style blocks entirely
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Convert block elements to newlines
  text = text.replace(/<\/?(p|div|h[1-6]|li|tr|br)[^>]*>/gi, '\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ');

  // Collapse whitespace
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
