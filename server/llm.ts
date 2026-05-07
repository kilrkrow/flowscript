/**
 * LLM call: raw SOP text → JsonGraph
 *
 * Uses any OpenAI-compatible API endpoint. Supports:
 *   - OpenAI          (default)
 *   - Groq            (set BASE_URL + MODEL)
 *   - Ollama          (BASE_URL=http://localhost:11434/v1, no key needed)
 *   - Any OAI-compat  (set BASE_URL + MODEL + API_KEY)
 *
 * Env vars:
 *   LLM_API_KEY    — API key (required for cloud providers)
 *   LLM_BASE_URL   — base URL (default: https://api.openai.com/v1)
 *   LLM_MODEL      — model name (default: gpt-4o-mini)
 */

import type { JsonGraph } from '../src/compiler/json-to-flow.js';

const BASE_URL = (process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL    = process.env.LLM_MODEL    ?? 'gpt-4o-mini';
const API_KEY  = process.env.LLM_API_KEY  ?? '';

const SYSTEM_PROMPT = `\
You are a process analyst. Extract the steps and decision points from the provided \
SOP or procedure text and return them as a JSON process graph.

Return ONLY a valid JSON object — no markdown, no explanation, no code fences.

Schema:
{
  "title": "string (optional — diagram title from the document)",
  "nodes": [
    { "id": "n1", "label": "concise step label", "shape": "start|end|process|decision|subprocess|io|note" }
  ],
  "edges": [
    { "from": "n1", "to": "n2" },
    { "from": "n2", "to": "n3", "condition": "yes" },
    { "from": "n3", "to": "n2", "condition": "no", "retry": true }
  ]
}

Rules:
- First node must have shape "start". Final node(s) must have shape "end".
- Use "decision" for any branching step; include "condition" ("yes"/"no" or a short label) on ALL edges leaving a decision node.
- Set "retry": true on any edge that loops back to an earlier step.
- Keep labels under 40 characters. Split long labels across fewer words.
- Every node must appear in at least one edge. Every path must terminate at an "end" node.
- Use "subprocess" for reusable procedures, "note" for cautions/warnings, "io" for data inputs/outputs.
- Extract only the procedural steps — omit scope statements, definitions, and policy references.`;

export async function extractGraph(sopText: string): Promise<JsonGraph> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: sopText },
    ],
    temperature: 0.1,   // low temp for deterministic extraction
    max_tokens: 4096,
  });

  const res = await fetch(`${BASE_URL}/chat/completions`, { method: 'POST', headers, body });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const raw = data.choices[0]?.message?.content ?? '';
  return parseJsonGraph(raw);
}

function parseJsonGraph(raw: string): JsonGraph {
  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  try {
    return JSON.parse(cleaned) as JsonGraph;
  } catch {
    // Last resort: find the first { ... } block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as JsonGraph; } catch { /* fall through */ }
    }
    throw new Error(`LLM returned invalid JSON. Raw response:\n${raw.slice(0, 500)}`);
  }
}

export function hasApiKey(): boolean {
  return !!API_KEY || BASE_URL.includes('localhost'); // Ollama needs no key
}
