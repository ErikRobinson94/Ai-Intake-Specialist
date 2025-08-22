// web/app/page.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    AudioWorkletNode: any;
  }
}

type Status = { ts: number; level: 'info' | 'warn' | 'error' | 'debug'; message: string };

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<Status[]>([]);
  const [voiceId, setVoiceId] = useState<number>(2);

  const wsRef = useRef<WebSocket | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const inNodeRef = useRef<any>(null);
  const outNodeRef = useRef<any>(null);

  const addLog = (level: Status['level'], message: string) => {
    setLogs((prev) => [{ ts: Date.now(), level, message }, ...prev].slice(0, 300));
    // eslint-disable-next-line no-console
    const c = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[c](`[${level}] ${message}`);
  };

  async function ensureAudioGraph() {
    if (!acRef.current) {
      const ac = new AudioContext({ sampleRate: 16000 });
      await ac.audioWorklet.addModule('/worklets/pcm-processor.js');
      await ac.audioWorklet.addModule('/worklets/pcm-player.js');

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true },
      });
      const src = ac.createMediaStreamSource(mic);

      const inNode = new (window.AudioWorkletNode as any)(ac, 'pcm-processor');
      const outNode = new (window.AudioWorkletNode as any)(ac, 'pcm-player');

      src.connect(inNode);
      outNode.connect(ac.destination);

      acRef.current = ac;
      inNodeRef.current = inNode;
      outNodeRef.current = outNode;
    }
  }

  function connect() {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      addLog('warn', 'WS already open/connecting.');
      return;
    }

    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/web-demo/ws?voiceId=${voiceId}`;
    addLog('info', `Connecting WS → ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = async () => {
      setConnected(true);
      addLog('info', 'WS open ✔');
      // Notify server
      ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      ws.send(JSON.stringify({ type: 'set_voice', voiceId }));

      // Build audio graph and start mic capture
      await ensureAudioGraph();
      inNodeRef.current?.port.postMessage({ type: 'start' });

      // ---- FIX: relax type to avoid TS error here ----
      inNodeRef.current?.port.addEventListener('message', (evt: any) => {
        if (evt?.data?.type === 'chunk' && evt?.data?.payload) {
          try {
            ws.send(evt.data.payload); // Int16Array.buffer
          } catch {
            /* ignore */
          }
        }
      });
      inNodeRef.current?.port.start?.();
      // ------------------------------------------------

      addLog('info', 'Mic streaming → server');
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data === 'string') {
        try {
          const msg = JSON.parse(evt.data);
          if (msg?.type === 'status') addLog(msg.level ?? 'debug', msg.message ?? JSON.stringify(msg));
          if (msg?.type === 'ready') addLog('info', `Server ready (voiceId=${msg.voiceId ?? voiceId}).`);
          if (msg?.type === 'asr' && msg.text) addLog('debug', `ASR: ${msg.text}`);
          if (msg?.type === 'pong') addLog('debug', 'Server pong');
          return;
        } catch {
          addLog('debug', evt.data);
          return;
        }
      }

      // Binary PCM (16k mono) → player worklet
      try {
        const buf = evt.data as ArrayBuffer;
        outNodeRef.current?.port.postMessage({ type: 'play', payload: buf }, [buf]);
      } catch {
        outNodeRef.current?.port.postMessage({ type: 'play', payload: evt.data });
      }
    };

    ws.onerror = (e: any) => {
      addLog('error', `WS error: ${e?.message ?? e}`);
    };

    ws.onclose = (e) => {
      setConnected(false);
      addLog('warn', `WS closed (${e.code})`);
    };
  }

  function disconnect() {
    try {
      wsRef.current?.close(1000, 'user');
    } catch {
      /* ignore */
    }
    setConnected(false);
    addLog('info', 'Disconnected.');
  }

  useEffect(() => {
    addLog('info', 'Requesting mic permission…');
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(() => addLog('info', 'Mic permission granted.'))
      .catch((err) => addLog('error', `Mic permission denied: ${err?.message ?? err}`));
  }, []);

  return (
    <main className="min-h-screen p-6 flex flex-col items-center gap-4">
      <h1 className="text-2xl font-semibold">AI Intake Specialist — Web Demo</h1>

      <div className="flex gap-3 items-center">
        <label className="text-sm">Voice ID:</label>
        <input
          type="number"
          className="border rounded px-2 py-1 w-20"
          value={voiceId}
          onChange={(e) => setVoiceId(Number(e.target.value || 0))}
        />
        {!connected ? (
          <button onClick={connect} className="px-4 py-2 rounded bg-black text-white">
            Start
          </button>
        ) : (
          <button onClick={disconnect} className="px-4 py-2 rounded bg-gray-200">
            Stop
          </button>
        )}
      </div>

      <div className="w-full max-w-3xl">
        <h2 className="text-sm font-medium mb-2">Logs</h2>
        <div className="h-64 overflow-auto border rounded p-2 text-xs font-mono bg-gray-50">
          {logs.map((l) => (
            <div key={l.ts}>
              [{new Date(l.ts).toLocaleTimeString()}] {l.level.toUpperCase()} — {l.message}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
