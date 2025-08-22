// web-demo-live.js
// Browser mic <-> Deepgram Agent bridge (NO Twilio).
// PCM16 @ 16k, 20ms framing, preroll flush, transcript forwarding.

const WebSocket = require("ws");

// --------- tiny helpers ----------
function sanitizeASCII(str) {
  if (!str) return "";
  return String(str).replace(/[\u0000-\u001F\u007F-\uFFFF]/g, " ").replace(/\s+/g, " ").trim();
}
function compact(s, max = 380) {
  if (!s) return "";
  const t = s.length <= max ? s : s.slice(0, max);
  if (t.length >= 40) return t;
  return "You are the intake specialist. Determine existing client vs accident. If existing: ask full name, best phone, and attorney; then say you will transfer. If accident: collect full name, phone, email, what happened, when, and city/state; confirm all; then say you will transfer. Be warm, concise, and stop speaking if the caller talks.";
}

function setupWebDemoLive(server, { route = "/web-demo/ws" } = {}) {
  // IMPORTANT: handle upgrades explicitly for our route only
  const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try { pathname = new URL(req.url, "http://localhost").pathname || ""; } catch {}
    if (pathname !== route) return; // not our endpoint
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (browserWS, req) => {
    const remote = req.socket?.remoteAddress || "unknown";
    console.log("[web-demo] browser connected", { remote });

    // ---- pick avatar voice ----
    let voiceId = 1;
    try {
      const u = new URL(req.url, "http://localhost");
      const v = parseInt(u.searchParams.get("voiceId") || "1", 10);
      if ([1, 2, 3].includes(v)) voiceId = v;
    } catch {}

    const ttsVoice =
      process.env[`VOICE_${voiceId}_TTS`] ||
      process.env.DG_TTS_VOICE ||
      "aura-2-odysseus-en";

    // ---- Agent settings ----
    const dgUrl = process.env.DG_AGENT_URL || "wss://agent.deepgram.com/v1/agent/converse";
    const dgKey = process.env.DEEPGRAM_API_KEY;

    const sttModel = (process.env.DG_STT_MODEL || "nova-2").trim();
    const llmModel = (process.env.LLM_MODEL || "gpt-4o-mini").trim();

    const firm      = process.env.FIRM_NAME  || "Benji Personal Injury";
    const agentName = process.env.AGENT_NAME || "Alexis";
    const DEFAULT_PROMPT =
      `You are ${agentName} for ${firm}. First ask: existing client or accident? Ask exactly one question per turn and wait for the reply. Existing: get name, best phone, attorney; then say youll transfer. Accident: get name, phone, email, what happened, when, city/state; confirm, then say youll transfer. Stop if the caller talks.`;

    const useEnv = String(process.env.DISABLE_ENV_INSTRUCTIONS || "false").toLowerCase() !== "true";
    const rawEnvPrompt = useEnv ? (process.env.AGENT_INSTRUCTIONS || "") : "";
    const prompt = compact(sanitizeASCII(rawEnvPrompt || DEFAULT_PROMPT), 380);

    const greeting = sanitizeASCII(
      process.env.AGENT_GREETING ||
      `Thank you for calling ${firm}. Were you in an accident, or are you an existing client?`
    );

    if (!dgKey) {
      try { browserWS.send(JSON.stringify({ type: "status", text: "Missing DEEPGRAM_API_KEY" })); } catch {}
      console.warn("[web-demo] DEEPGRAM_API_KEY missing");
      return;
    }

    const agentWS = new WebSocket(dgUrl, ["token", dgKey]);
    let settingsSent = false;
    let settingsApplied = false;

    const temperature = Number(process.env.LLM_TEMPERATURE || "0.15");
    const settings = {
      type: "Settings",
      audio: {
        input:  { encoding: "linear16", sample_rate: 16000 },
        output: { encoding: "linear16", sample_rate: 16000 },
      },
      agent: {
        language: "en",
        greeting,
        listen: { provider: { type: "deepgram", model: sttModel, smart_format: true } },
        think:  { provider: { type: "open_ai", model: llmModel, temperature }, prompt },
        speak:  { provider: { type: "deepgram", model: ttsVoice } },
      },
    };

    function sendSettings(tag = "initial") {
      if (agentWS.readyState !== WebSocket.OPEN) return;
      try {
        agentWS.send(JSON.stringify(settings));
        settingsSent = true;
        console.log("[web-demo] sent Settings", { tag, sttModel, ttsVoice, llmModel, temperature });
        try {
          browserWS.send(JSON.stringify({
            type: "status",
            text: `Settings sent (${tag}). STT=${sttModel} LLM=${llmModel} TTS=${ttsVoice}`
          }));
        } catch {}
      } catch (e) { console.warn("[web-demo] failed to send Settings", e?.message || e); }
    }

    // ---- agent WS wiring ----
    agentWS.on("open", () => {
      console.log("[web-demo] connected to Deepgram");
      try { browserWS.send(JSON.stringify({ type: "status", text: "Connected to Deepgram." })); } catch {}
      sendSettings("onopen");

      // safety: if SettingsApplied not seen, resend a couple times
      setTimeout(() => { if (!settingsApplied) sendSettings("retry-500ms"); }, 500);
      setTimeout(() => { if (!settingsApplied) sendSettings("retry-1500ms"); }, 1500);
    });

    agentWS.on("message", (data) => {
      const isBuf = Buffer.isBuffer(data);
      if (!isBuf || (isBuf && data.length && data[0] === 0x7b)) {
        let evt = null; try { evt = JSON.parse(isBuf ? data.toString("utf8") : data); } catch {}
        if (!evt) return;

        // helpful logging
        if (evt.type) console.log("[web-demo] agent evt", evt.type);

        const role = String((evt.role || evt.speaker || evt.actor || "")).toLowerCase();
        const text = String(evt.content ?? evt.text ?? evt.transcript ?? evt.message ?? "").trim();
        const isFinal = evt.final === true || evt.is_final === true || evt.status === "final" || evt.type === "UserResponse";

        if (evt.type === "Welcome") sendSettings("welcome");
        if (evt.type === "SettingsApplied") {
          settingsApplied = true;
          try { browserWS.send(JSON.stringify({ type: "status", text: "Agent settings applied." })); } catch {}
        }

        // transcripts/status forwarding
        switch (evt.type) {
          case "ConversationText":
          case "History":
          case "UserTranscript":
          case "UserResponse":
          case "Transcript":
          case "AddUserMessage":
          case "AddAssistantMessage":
          case "AgentTranscript":
          case "AgentResponse":
          case "PartialTranscript":
          case "AddPartialTranscript": {
            if (!text) break;
            const payload = {
              type: "transcript",
              role: (role.includes("agent") || role.includes("assistant")) ? "Agent" : "User",
              text, partial: !isFinal
            };
            try { browserWS.send(JSON.stringify(payload)); } catch {}
            break;
          }
          case "AgentWarning":
            try { browserWS.send(JSON.stringify({ type: "status", text: `Agent warning: ${evt.message || "unknown"}` })); } catch {}
            break;
          case "AgentError":
          case "Error":
            try { browserWS.send(JSON.stringify({ type: "status", text: `Agent error: ${evt.description || evt.message || "unknown"}` })); } catch {}
            break;
        }
        return;
      }

      // Binary = DG TTS PCM16 @ 16k → forward to browser for playback
      try { browserWS.send(data, { binary: true }); } catch {}
    });

    agentWS.on("error", (e) => {
      console.warn("[web-demo] Deepgram error:", e?.message || e);
      try { browserWS.send(JSON.stringify({ type: "status", text: `Deepgram error: ${e?.message || e}` })); } catch {}
    });
    agentWS.on("close", () => {
      console.log("[web-demo] Deepgram closed");
      try { browserWS.send(JSON.stringify({ type: "status", text: "Deepgram connection closed." })); } catch {}
    });

    // ---- Browser mic → DG, 20 ms framing
    const FRAME_MS = 20, IN_RATE = 16000, BPS = 2;
    const BYTES_PER_FRAME = Math.round(IN_RATE * BPS * (FRAME_MS / 1000)); // 640
    let micBuf = Buffer.alloc(0);

    browserWS.on("message", (msg) => {
      if (typeof msg === "string") return; // ignore any text control from browser
      if (agentWS.readyState !== WebSocket.OPEN) return;

      const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      micBuf = Buffer.concat([micBuf, buf]);

      while (micBuf.length >= BYTES_PER_FRAME) {
        const frame = micBuf.subarray(0, BYTES_PER_FRAME);
        micBuf = micBuf.subarray(BYTES_PER_FRAME);
        try { agentWS.send(frame); } catch {}
      }
    });

    browserWS.on("close", () => {
      try { agentWS.close(1000); } catch {}
      console.log("[web-demo] browser closed");
    });
    browserWS.on("error", () => {
      try { agentWS.close(1011); } catch {}
      console.log("[web-demo] browser ws error");
    });

    // Let the UI know we’re alive
    try { browserWS.send(JSON.stringify({ type: "status", text: `Browser connected. VoiceId=${voiceId}` })); } catch {}
  });
}

module.exports = { setupWebDemoLive };
