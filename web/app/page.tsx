'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

type LogLine = { t: string; level?: 'info' | 'warn' | 'error' };

const GREETING_TEXT = `Hi! I'm your Case Connect intake assistant. When you're ready, tell me briefly what happened and I’ll ask a few questions.`;

export default function Page() {
  const [voiceId, setVoiceId] = useState<number>(2);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [logs, setLogs] = useState<LogLine[]>([{ t: 'System: Ready (click Start)' }]);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const log = useCallback((t: string, level: LogLine['level'] = 'info') => {
    setLogs((prev) => [...prev, { t, level }]);
    if (level === 'error') console.error(t);
    else if (level === 'warn') console.warn(t);
    else console.log(t);
  }, []);

  // ---- Browser TTS ----
  const speakGreeting = useCallback(async () => {
    try {
      if (!('speechSynthesis' in window)) {
        log('speechSynthesis not available in this browser', 'warn');
        return;
      }
      // Stop any in-flight speech
      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(GREETING_TEXT);
      // Pick a voice by chosen avatar (best-effort)
      const pickVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        if (!voices?.length) return null;

        // crude mapping: 1=male, 2=female, 3=male alt
        const wantFemale = voiceId === 2;
        // Prefer en-* voices
        const en = voices.filter(v => /^en(-|_|$)/i.test(v.lang));
        const pool = en.length ? en : voices;

        // Try to pick voice names that look male/female
        const pickByName = (needle: RegExp) => pool.find(v => needle.test(v.name));
        if (wantFemale) {
          return pickByName(/female|susan|victoria|siri|karen|allison|emma|google.*female/i) || pool[0];
        } else {
          return pickByName(/male|daniel|alex|tom|google.*male/i) || pool[0];
        }
      };

      // Some browsers need async wait for voices to load
      const ensureVoices = () =>
        new Promise<void>((resolve) => {
          const voices = window.speechSynthesis.getVoices();
          if (voices && voices.length) return resolve();
          const onVoices = () => {
            window.speechSynthesis.removeEventListener('voiceschanged', onVoices);
            resolve();
          };
          window.speechSynthesis.addEventListener('voiceschanged', onVoices);
          setTimeout(resolve, 500); // fallback
        });

      await ensureVoices();
      const v = pickVoice();
      if (v) utter.voice = v;

      utter.rate = 1.0;
      utter.pitch = 1.0;
      utter.onstart = () => log('Greeting: speaking…');
      utter.onend = () => log('Greeting: done.');
      utter.onerror = (e) => log(`Greeting error: ${String(e.error || e)}`, 'error');

      window.speechSynthesis.speak(utter);
    } catch (e) {
      log(`Greeting failed: ${String(e)}`, 'error');
    }
  }, [log, voiceId]);

  const computeWsUrl = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/web-demo/ws?voiceId=${voiceId}`;
  }, [voiceId]);

  const start = useCallback(async () => {
    if (status === 'connected' || status === 'connecting') return;

    setStatus('connecting');
    log(`Requesting mic permission…`);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      log(`Mic permission granted.`);
    } catch (err) {
      setStatus('error');
      log(`Mic permission denied: ${String(err)}`, 'error');
      return;
    }

    const url = computeWsUrl();
    log(`Connecting WS → ${url}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    const timer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        setStatus('error');
        log('WS connect timed out after 8s', 'error');
        try { ws.close(); } catch {}
      }
    }, 8000);

    ws.onopen = () => {
      clearTimeout(timer);
      setStatus('connected');
      log('WS open ✔');
      // Let server know we're alive
      ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'server_ready') {
          log(`Server ready (voiceId=${msg.voiceId}). You should now wire up the TTS/ASR pipeline.`);
          // ===== Play an immediate greeting so the demo behaves like local =====
          speakGreeting();
        } else if (msg.type === 'pong') {
          log('Server pong');
        } else {
          log(`Message: ${ev.data}`);
        }
      } catch {
        log(`Binary/unknown frame (${(ev.data as any)?.byteLength ?? 'n/a'} bytes)`);
      }
    };

    ws.onclose = (e) => {
      log(`WS closed (code=${e.code}, reason=${e.reason || 'no-reason'})`, 'warn');
      setStatus('idle');
    };

    ws.onerror = (e) => {
      log(`WS error: ${String(e)}`, 'error');
      setStatus('error');
    };
  }, [computeWsUrl, log, speakGreeting, status]);

  const stop = useCallback(() => {
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;

    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
    setStatus('idle');
    log('Stopped.');
  }, [log]);

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-[#0f0f10] text-white">
      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="rounded-2xl border border-[#222] p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 rounded-full bg-emerald-500/20 grid place-items-center">
                <span className="text-emerald-400 font-bold">C</span>
              </div>
              <h1 className="text-xl font-semibold">CASE CONNECT</h1>
              <span className="ml-2 text-sm text-gray-400">status: {status}</span>
            </div>

            <h2 className="text-2xl font-bold text-amber-400 mb-2">Demo our AI intake experience</h2>
            <p className="text-gray-300">Speak with our virtual assistant and experience a legal intake done right.</p>

            <div className="mt-6">
              <button
                onClick={start}
                disabled={status === 'connecting' || status === 'connected'}
                className="rounded-2xl bg-amber-500 hover:bg-amber-600 px-5 py-3 font-semibold disabled:opacity-50"
              >
                Speak with AI Assistant
              </button>
            </div>

            <div className="mt-8">
              <h3 className="font-semibold mb-3">Choose a voice to sample</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map((id) => (
                  <button
                    key={id}
                    onClick={() => setVoiceId(id)}
                    className={`rounded-xl border p-3 text-center ${
                      voiceId === id ? 'border-amber-500' : 'border-[#222]'
                    }`}
                  >
                    <img
                      src={`/images/${id === 1 ? 'voice-m1' : id === 2 ? 'voice-f1' : 'voice-m2'}.png`}
                      alt={`Voice ${id}`}
                      className="rounded-lg mb-2"
                    />
                    <div className="text-sm text-gray-300">Voice {id}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="md:col-span-1 rounded-2xl border border-[#222] p-4 shadow-lg flex flex-col">
          <h3 className="font-semibold mb-2">Conversation</h3>
          <div className="flex-1 overflow-auto rounded-lg bg-black/30 p-3 text-sm">
            {logs.map((l, i) => (
              <div key={i} className={l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : ''}>
                {l.t}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-3">
            <button
              onClick={start}
              disabled={status === 'connecting' || status === 'connected'}
              className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 px-4 py-2 font-semibold disabled:opacity-50"
            >
              Start
            </button>
            <button onClick={stop} className="rounded-xl bg-zinc-800 hover:bg-zinc-700 px-4 py-2">
              Stop
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
