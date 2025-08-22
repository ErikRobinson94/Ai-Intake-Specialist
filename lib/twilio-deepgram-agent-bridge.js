// lib/twilio-deepgram-agent-bridge.js
'use strict';

/**
 * Browser <-> Agent (Deepgram) bidirectional bridge.
 * Expects browser to:
 *   - connect to /web-demo/ws
 *   - send raw 16kHz, 16-bit PCM (little endian) audio chunks as ArrayBuffer/Binary for mic
 *   - handle incoming Binary audio (same PCM) for playback
 *
 * Environment:
 *   DEEPGRAM_API_KEY   (required)
 *   DEEPGRAM_AGENT_URL (optional override, otherwise defaults below)
 *   DG_MODEL           (optional; e.g., 'agent' variant)
 */

const WebSocket = require('ws');
const url = require('url');

const DEFAULT_DG_URL =
  process.env.DEEPGRAM_AGENT_URL ||
  'wss://api.deepgram.com/v1/agent?encoding=linear16&sample_rate=16000'; // raw PCM in/out

function setupBidiBridge(app, { route = '/web-demo/ws' } = {}) {
  app.ws(route, (browser, req) => {
    const q = url.parse(req.url, true).query;
    const voiceId = q.voiceId || '2';
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    console.log('[web-demo] connected', { ip, voiceId });

    if (!process.env.DEEPGRAM_API_KEY) {
      const msg = { type: 'status', level: 'error', message: 'Missing DEEPGRAM_API_KEY' };
      try { browser.send(JSON.stringify(msg)); } catch {}
      browser.close(1011, 'Missing DEEPGRAM_API_KEY');
      console.error('[agent] DEEPGRAM_API_KEY is not set; closing browser ws');
      return;
    }

    // ---------- Connect to Deepgram Agent ----------
    const agentHeaders = {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      // Some proxies behave better with explicit Upgrade headers in ws lib
      'User-Agent': 'ai-intake-specialist/bridge',
    };

    console.log('[agent] connecting', { url: DEFAULT_DG_URL });

    const agent = new WebSocket(DEFAULT_DG_URL, {
      headers: agentHeaders,
      perMessageDeflate: false,
    });

    let agentOpen = false;
    let browserOpen = true;

    const safeClose = (which, code = 1000, reason = 'normal') => {
      try { which.close(code, reason); } catch {}
    };

    const tellBrowser = (payload) => {
      if (browserOpen) {
        try { browser.send(JSON.stringify(payload)); } catch {}
      }
    };

    // ---------- Browser -> Agent (mic audio) ----------
    browser.on('message', (data, isBinary) => {
      if (!agentOpen) return;

      // We accept:
      // - Binary mic frames (PCM16)
      // - JSON control messages (ignored except ping)
      if (isBinary) {
        // forward raw PCM to agent
        try { agent.send(data, { binary: true }); } catch (e) {
          console.error('[bridge] agent.send binary failed', e.message);
        }
        return;
      }

      // JSON/control from browser
      try {
        const msg = JSON.parse(data.toString('utf8'));
        if (msg?.type === 'ping') {
          tellBrowser({ type: 'pong', ts: Date.now() });
        }
        if (msg?.type === 'set_voice' && typeof msg.voiceId !== 'undefined') {
          // optional: send a hint to agent (if supported by your Agent config)
          // Many DG agent deployments accept a JSON control message to change voices.
          // If not supported, this will be a no-op.
          try {
            agent.send(JSON.stringify({ type: 'set_voice', voice_id: String(msg.voiceId) }));
          } catch {}
        }
      } catch (_ignore) {}
    });

    browser.on('close', (code, reason) => {
      browserOpen = false;
      console.log('[web-demo] disconnected', { code, reason: reason?.toString() });
      safeClose(agent, 1000, 'browser_closed');
    });

    browser.on('error', (err) => {
      browserOpen = false;
      console.error('[web-demo] error', err.message);
      safeClose(agent, 1011, 'browser_error');
    });

    // ---------- Agent -> Browser (tts audio) ----------
    agent.on('open', () => {
      agentOpen = true;
      console.log('[agent] connected OK');

      // Let browser know the pipe is ready
      tellBrowser({ type: 'status', level: 'info', message: 'Agent connected.' });

      // Optional: ask agent to greet immediately (if your agent supports it)
      // Many agent backends begin speaking on connect; if not, you can send:
      try {
        agent.send(JSON.stringify({ type: 'start', voice_id: String(voiceId) }));
      } catch {}
    });

    agent.on('message', (chunk, isBinary) => {
      if (!browserOpen) return;

      // DG Agent usually streams TTS as binary PCM; any JSON "events" also come through.
      if (isBinary) {
        try { browser.send(chunk, { binary: true }); } catch (e) {
          console.error('[bridge] browser.send binary failed', e.message);
        }
        return;
      }

      // If text event/control from agent, forward as status for debugging
      try {
        const msg = JSON.parse(chunk.toString('utf8'));
        // Normalize a few common event shapes
        if (msg?.type === 'transcript' && msg.text) {
          tellBrowser({ type: 'asr', text: msg.text });
        } else if (msg?.type === 'status' || msg?.event) {
          tellBrowser({ type: 'status', level: 'debug', message: JSON.stringify(msg) });
        }
      } catch {
        // pass-through opaque text
        tellBrowser({ type: 'status', level: 'debug', message: chunk.toString('utf8') });
      }
    });

    agent.on('close', (code, reason) => {
      agentOpen = false;
      console.log('[agent] closed', { code, reason: reason?.toString() });
      tellBrowser({ type: 'status', level: 'warn', message: `Agent closed (${code})` });
      safeClose(browser, 1000, 'agent_closed');
    });

    agent.on('error', (err) => {
      agentOpen = false;
      console.error('[agent] error', err.message);
      tellBrowser({ type: 'status', level: 'error', message: `Agent error: ${err.message}` });
      safeClose(browser, 1011, 'agent_error');
    });
  });
}

module.exports = { setupBidiBridge };
