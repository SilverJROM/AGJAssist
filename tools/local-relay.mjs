#!/usr/bin/env node
/**
 * AGJAssist Local LLM Relay
 *
 * Connects your local LLM (Ollama, LM Studio, etc.) to the AGJAssist server.
 * The server sends inference requests via WebSocket; this script calls your
 * local LLM and sends the response back.
 *
 * Usage:
 *   node local-relay.mjs <server-ws-url> <local-llm-url> <format> <model>
 *
 * Examples:
 *   node local-relay.mjs "wss://agjasst.silverjrom.app/ws/local-llm?token=YOUR_TOKEN" http://127.0.0.1:1234 openai qwen3-coder-30b
 *   node local-relay.mjs "wss://agjasst.silverjrom.app/ws/local-llm?token=YOUR_TOKEN" http://localhost:11434 ollama llama3
 */

const [,, serverUrl, llmUrl, format, model] = process.argv;

if (!serverUrl || !llmUrl || !format || !model) {
  console.error('Usage: node local-relay.mjs <server-ws-url> <local-llm-url> <format> <model>');
  console.error('  format: "ollama" or "openai"');
  console.error('');
  console.error('Example:');
  console.error('  node local-relay.mjs "wss://agjasst.silverjrom.app/ws/local-llm?token=xxx" http://127.0.0.1:1234 openai qwen3-coder');
  process.exit(1);
}

async function callLlm(messages, maxTokens) {
  if (format === 'ollama') {
    const res = await fetch(`${llmUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        options: { num_predict: maxTokens || 1800 },
        messages
      })
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.message?.content?.trim() || '';
  } else {
    const res = await fetch(`${llmUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens || 1800,
        temperature: 0.2
      })
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }
}

function connect() {
  console.log(`Connecting to ${serverUrl.replace(/token=[^&]+/, 'token=***')}...`);
  console.log(`Local LLM: ${llmUrl} (${format}, model: ${model})`);

  const ws = new WebSocket(serverUrl);

  ws.addEventListener('open', () => {
    console.log('Connected to AGJAssist server. Waiting for inference requests...');
    // Identify this client
    const hostname = typeof globalThis.process !== 'undefined' ? (await import('node:os')).hostname() : 'unknown';
    ws.send(JSON.stringify({ type: 'hello', name: hostname, model, format }));
  });

  ws.addEventListener('message', async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'connected') {
      console.log('Server confirmed connection.');
      return;
    }

    if (msg.type === 'inference_request') {
      const msgCount = msg.messages?.length || 0;
      console.log(`[${new Date().toLocaleTimeString()}] Inference request (${msgCount} messages, max ${msg.maxTokens} tokens)...`);
      const start = Date.now();
      try {
        const content = await callLlm(msg.messages, msg.maxTokens);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  Response: ${content.length} chars in ${elapsed}s`);
        ws.send(JSON.stringify({ type: 'inference_response', id: msg.id, content }));
      } catch (err) {
        console.error(`  Error: ${err.message}`);
        ws.send(JSON.stringify({ type: 'inference_error', id: msg.id, error: err.message }));
      }
      return;
    }

    if (msg.type === 'error') {
      console.error('Server error:', msg.error);
      return;
    }
  });

  ws.addEventListener('close', (event) => {
    console.log(`Disconnected (code: ${event.code}). Reconnecting in 5s...`);
    setTimeout(connect, 5000);
  });

  ws.addEventListener('error', (err) => {
    console.error('WebSocket error. Reconnecting in 5s...');
    setTimeout(connect, 5000);
  });
}

connect();
