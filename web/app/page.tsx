'use client';

// Make TS happy in client components when reading NEXT_PUBLIC_* envs
// (Next will inline these at build time; this avoids @types/node in the web app)
declare const process: any;

import React, { useEffect, useRef, useState } from 'react';

const WS_URL =
  (process?.env?.NEXT_PUBLIC_WS_URL as string | undefined) ||
  `${typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'}://${typeof window !== 'undefined' ? window.location.host : ''}/web-demo/ws`;

type Status = 'idle' | 'connecting' | 'ready' | 'stopped' | 'error';
type Voice = { id: number; name: string; img: string };

const VOICES: Voice[] = [
  { id: 1, name: 'Voice 1', img: '/images/voice-m1.png' },
  { id: 2, name: 'Voice 2', img: '/images/voice-f1.png' },
  { id: 3, name: 'Voice 3', img: '/images/voice-m2.png' },
];

export default function Page() {
  const [status, setStatus] = useState<Status>('idle');
  const [voiceId, setVoiceId] = useState<number>(2);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micNodeRef = useRef<AudioWorkletNode | null>(null);
  const playerNodeRef = useRef<AudioWorkletNode | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {}
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const micList = all.filter((d) => d.kind === 'audioinput');
        setMics(micList);
        if (!micId && micList[0]) setMicId(micList[0].deviceId);
      } catch {}
    })();
    return () => stopEverything(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pushTranscript(line: string) {
    setTranscripts((prev) => (prev.length > 200 ? prev.slice(-200).concat(line) : prev.concat(line)));
  }

  async function ensureAudioContext(): Promise<AudioContext> {
    if (acRef.current) {
      await acRef.current.resume().catch(() => {});
      return acRef.current;
    }
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    acRef.current = ac;
    await ac.resume().catch(() => {});
    return ac;
  }

  async function setupPlayback(ac: AudioContext) {
    if (playerNodeRef.current) return playerNodeRef.current;
    await ac.audioWorklet.addModule('/worklets/pcm-player.js');
    const node = new AudioWorkletNode(ac, 'pcm-player');
    node.connect(ac.destination);
    playerNodeRef.current = node;
    return node;
  }

  async function setupMic(ac: AudioContext) {
    if (micNodeRef.current) return micNodeRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: micId ? { deviceId: { exact: micId } } : true,
      video: false,
    });
    micStreamRef.current = stream;
    const src = ac.createMediaStreamSource(stream);
    await ac.audioWorklet.addModule('/worklets/pcm-processor.js');
    const node = new AudioWorkletNode(ac, 'pcm-processor', {
      processorOptions: { targetSampleRate: ac.sampleRate },
    });
    src.connect(node);
    micNodeRef.current = node;
    return node;
  }

  function safeCloseWS() {
    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;
  }

  function stopEverything(silent = false) {
    try {
      micNodeRef.current?.disconnect();
    } catch {}
    micNodeRef.current = null;

    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;

    try {
      playerNodeRef.current?.disconnect();
    } catch {}
    playerNodeRef.current = null;

    if (acRef.current) acRef.current.suspend().catch(() => {});

    safeCloseWS();
    if (!silent) setStatus('stopped');
  }

  async function handleStart() {
    if (status === 'connecting' || status === 'ready') return;
    setStatus('connecting');

    try {
      const ac = await ensureAudioContext();
      const player = await setupPlayback(ac);
      const micNode = await setupMic(ac);

      const url = `${WS_URL}?voiceId=${encodeURIComponent(String(voiceId))}`;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('ready');
        pushTranscript(`System: Connected (voiceId=${voiceId}).`);
      };

      ws.onerror = (e) => {
        console.error('WS error', e);
        pushTranscript('System: WebSocket error.');
        setStatus('error');
      };

      ws.onclose = () => {
        pushTranscript('System: Disconnected.');
        setStatus((s) => (s === 'error' ? 'error' : 'stopped'));
      };

      ws.onmessage = (evt) => {
        if (typeof evt.data === 'string') {
          try {
            const msg = JSON.parse(evt.data);
            if (msg?.type === 'transcript' && msg.text) pushTranscript(msg.text);
            else if (msg?.status) pushTranscript(`System: ${msg.status}`);
            else if (msg?.text) pushTranscript(String(msg.text));
            else pushTranscript(String(evt.data));
          } catch {
            pushTranscript(String(evt.data));
          }
          return;
        }
        // Audio chunk (PCM16)
        try {
          const buf = evt.data as ArrayBuffer;
          player.port.postMessage({ type: 'play', pcm16: buf });
        } catch (e) {
          console.warn('Failed to play audio chunk', e);
        }
      };

      micNode.port.onmessage = (ev) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const f32 = ev.data?.samples as Float32Array | undefined;
        if (!f32) return;
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        wsRef.current.send(i16.buffer);
      };
    } catch (err: any) {
      console.error(err);
      pushTranscript(`System: ${err?.message || 'Failed to initialize audio/WS.'}`);
      setStatus('error');
      stopEverything(true);
    }
  }

  function handleStop() {
    stopEverything();
  }

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="text-emerald-400 text-2xl font-semibold">CASE CONNECT</div>
          <div className="ml-auto text-sm rounded-full px-2 py-1 bg-neutral-800">
            {status}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="rounded-2xl bg-neutral-900 p-8 shadow-xl">
            <h1 className="text-3xl font-bold">
              Demo our <span className="text-amber-400">AI intake</span> experience
            </h1>
            <p className="mt-2 text-neutral-300">
              Speak with our virtual assistant and experience a legal intake done right.
            </p>

            <div className="mt-6">
              <button
                onClick={handleStart}
                disabled={status === 'connecting' || status === 'ready'}
                className="rounded-xl bg-amber-500 px-6 py-3 font-semibold text-black disabled:opacity-60"
              >
                Speak with AI Assistant
              </button>
              <button
                onClick={handleStop}
                disabled={status !== 'ready' && status !== 'connecting'}
                className="ml-3 rounded-xl bg-neutral-800 px-4 py-3"
              >
                Stop
              </button>
            </div>

            <div className="mt-10">
              <div className="mb-3 font-semibold text-neutral-200">Choose a voice to sample</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                {VOICES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVoiceId(v.id)}
                    className={`rounded-2xl bg-neutral-800 p-4 text-center ring-2 ${
                      voiceId === v.id ? 'ring-amber-500' : 'ring-transparent'
                    }`}
                  >
                    <img
                      src={v.img}
                      alt={v.name}
                      className="mx-auto h-44 w-full object-cover rounded-xl"
                      draggable={false}
                    />
                    <div className="mt-2 text-sm text-neutral-300">{v.name}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8">
              <div className="mb-2 text-sm text-neutral-300">Microphone</div>
              <select
                className="w-full rounded-lg bg-neutral-800 p-2"
                value={micId}
                onChange={(e) => setMicId(e.target.value)}
              >
                {mics.length === 0 && <option>Default microphone</option>}
                {mics.map((m) => (
                  <option key={m.deviceId} value={m.deviceId}>
                    {m.label || `Mic ${m.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 text-xs text-neutral-400">
              WS: <code className="break-words">{WS_URL}?voiceId={voiceId}</code>
            </div>
          </div>

          <div className="rounded-2xl bg-neutral-900 p-6 shadow-xl">
            <div className="mb-3 font-semibold">Conversation</div>
            <div className="h-[520px] overflow-auto rounded-xl bg-neutral-950 p-4 text-sm">
              {transcripts.length === 0 ? (
                <div className="text-neutral-500">System: Initializing… chosen avatar voiceId={voiceId}</div>
              ) : (
                transcripts.map((t, i) => (
                  <div key={i} className="mb-2 whitespace-pre-wrap">
                    {t}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
