#!/usr/bin/env bun
/**
 * FlowScript Web Server
 *
 * Self-hosted: paste a URL, text, or upload a file — get an SVG flowchart.
 *
 * Env vars:
 *   LLM_API_KEY    API key for your LLM provider (OpenAI, Groq, etc.)
 *   LLM_BASE_URL   OpenAI-compatible base URL (default: https://api.openai.com/v1)
 *   LLM_MODEL      Model name (default: gpt-4o-mini)
 *   PORT           HTTP port (default: 3000)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { jsonToFlow } from '../src/compiler/json-to-flow.js';
import { render } from '../src/index.js';
import { extractFromUrl, extractFromFile } from './extract.js';
import { extractGraph, hasApiKey } from './llm.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const UI_HTML     = readFileSync(join(import.meta.dir, 'ui/index.html'),  'utf-8');
const EDITOR_HTML = readFileSync(join(import.meta.dir, 'ui/editor.html'), 'utf-8');

// ── Request handlers ──────────────────────────────────────────────────────────

async function handleGenerate(req: Request): Promise<Response> {
  const contentType = req.headers.get('content-type') ?? '';

  let sopText = '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const url  = form.get('url')  as string | null;
    const text = form.get('text') as string | null;
    const file = form.get('file') as File   | null;

    if (url?.trim()) {
      sopText = await extractFromUrl(url.trim());
    } else if (file && file.size > 0) {
      const buf = Buffer.from(await file.arrayBuffer());
      sopText = await extractFromFile(file.name, buf);
    } else if (text?.trim()) {
      sopText = text.trim();
    } else {
      return json({ error: 'Provide a URL, file, or text.' }, 400);
    }
  } else {
    // JSON body
    const body = await req.json() as { url?: string; text?: string };
    if (body.url?.trim()) {
      sopText = await extractFromUrl(body.url.trim());
    } else if (body.text?.trim()) {
      sopText = body.text.trim();
    } else {
      return json({ error: 'Provide url or text.' }, 400);
    }
  }

  if (sopText.length < 20) {
    return json({ error: 'Extracted text too short — check the source.' }, 400);
  }

  // Trim to avoid hitting token limits on huge documents
  const MAX_CHARS = 40_000;
  if (sopText.length > MAX_CHARS) sopText = sopText.slice(0, MAX_CHARS);

  // LLM extraction → compile → render
  const graph = await extractGraph(sopText);
  const flow  = jsonToFlow(graph);
  const svg   = render(flow);

  return json({ flow, svg });
}

// ── Router ────────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url);

    // Status — lets the UI know if the server is ready
    if (url.pathname === '/status') {
      return json({ ok: true, apiKeySet: hasApiKey(), model: process.env.LLM_MODEL ?? 'gpt-4o-mini' });
    }

    // Main UI
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return new Response(UI_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // Live editor
    if (req.method === 'GET' && url.pathname === '/editor') {
      return new Response(EDITOR_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // Browser bundle — served from the built editor/ directory
    if (req.method === 'GET' && url.pathname === '/flowscript.js') {
      const file = Bun.file(join(import.meta.dir, '../editor/flowscript.js'));
      return new Response(file, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
    }

    // Generate endpoint
    if (req.method === 'POST' && url.pathname === '/generate') {
      try {
        return await handleGenerate(req);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: message }, 500);
      }
    }

    return new Response('Not found', { status: 404 });
  },
});

console.log(`\n  FlowScript ✦ http://localhost:${PORT}\n`);
if (!hasApiKey()) {
  console.warn('  ⚠  LLM_API_KEY not set — /generate will fail.\n' +
               '     Set it via env var or use Ollama (LLM_BASE_URL=http://localhost:11434/v1)\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
