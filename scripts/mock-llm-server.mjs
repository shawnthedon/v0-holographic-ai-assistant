#!/usr/bin/env node
/**
 * OpenAI-compatible mock server used by scripts/verify-llm.mjs.
 *
 * It exists so the LLM adapter layer can be verified end-to-end — request
 * shape, response parsing, streaming, error mapping — without provider keys or
 * outbound network access. It is NOT wired into the app.
 *
 *   node scripts/mock-llm-server.mjs [port]
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 4010);

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    return send(res, 200, {
      object: 'list',
      data: [
        { id: 'mock-gpt', object: 'model', context_length: 8192 },
        { id: 'mock-qwen', object: 'model', context_length: 32768 },
      ],
    });
  }

  if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(res, 400, { error: { message: 'invalid json' } });
    }

    const auth = req.headers.authorization || '';
    if (body.model === 'unauthorised-model') {
      return send(res, 401, { error: { message: 'invalid api key' } });
    }
    if (body.model === 'rate-limited-model') {
      return send(res, 429, { error: { message: 'rate limit exceeded' } });
    }

    const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === 'user');
    const reply = `mock reply to "${(lastUser?.content || '').slice(0, 40)}" via ${body.model} (auth ${auth ? 'present' : 'absent'})`;

    if (body.stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      for (const word of reply.split(' ')) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${word} ` } }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    return send(res, 200, {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: reply.split(' ').length, total_tokens: 20 },
    });
  }

  send(res, 404, { error: { message: `no route ${req.method} ${url.pathname}` } });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[mock-llm] listening on http://127.0.0.1:${port}/v1`);
});
