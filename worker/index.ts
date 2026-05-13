/**
 * FlowScript Compile Worker
 *
 * POST /compile  — JsonGraph → { flow, svg }
 *
 * No LLM. No Node.js APIs. Pure FlowScript pipeline running on Cloudflare's edge.
 * Any model or agent can POST a JsonGraph and receive a rendered SVG back.
 *
 * See: https://github.com/kilrkrow/flowscript/blob/master/docs/schema.md
 */

import { jsonToFlow } from '../src/compiler/json-to-flow.js';
import { render }     from '../src/index.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check
    if (req.method === 'GET' && url.pathname === '/status') {
      return json({ ok: true, service: 'flowscript-compile' });
    }

    // Compile
    if (req.method === 'POST' && url.pathname === '/compile') {
      let graph: unknown;
      try {
        graph = await req.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, 400);
      }

      try {
        const flow = jsonToFlow(graph as any);
        const svg  = render(flow);
        return json({ flow, svg });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ error: message }, 400);
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
