
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { SessionState } from './types';
import { createPcmBlob, decode, decodeAudioData } from './services/audioUtils';
import Visualizer from './components/Visualizer';

const App: React.FC = () => {
  const [sessionState, setSessionState] = useState<SessionState>(SessionState.DISCONNECTED);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState({ english: '', korean: '' });
  const [textInput, setTextInput] = useState('');
  const [volume, setVolume] = useState(0.1); 
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const outAudioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const englishBuffer = useRef<string>('');
  const koreanBuffer = useRef<string>('');
  const lastActivityTime = useRef<number>(Date.now());
  const frameRef = useRef<number | null>(null);

  const updateTranscriptState = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      setLiveTranscript({
        english: englishBuffer.current.length > 100 
          ? '...' + englishBuffer.current.slice(-90) 
          : englishBuffer.current,
        korean: koreanBuffer.current.length > 80 
          ? '...' + koreanBuffer.current.slice(-75) 
          : koreanBuffer.current
      });
      frameRef.current = null;
    });
  }, []);

  const stopSession = useCallback(async () => {
    setSessionState(SessionState.DISCONNECTED);
    if (sessionPromiseRef.current) {
      const session = await sessionPromiseRef.current;
      try { session.close(); } catch (e) {}
      sessionPromiseRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    sourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
    sourcesRef.current.clear();
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    if (outAudioContextRef.current) { outAudioContextRef.current.close(); outAudioContextRef.current = null; }
    
    setIsModelSpeaking(false);
    englishBuffer.current = '';
    koreanBuffer.current = '';
    setLiveTranscript({ english: '', korean: '' });
  }, []);

  const handleSendText = async () => {
    if (!textInput.trim() || !sessionPromiseRef.current) return;
    const textToSend = textInput.trim();
    try {
      const session = await sessionPromiseRef.current;
      session.sendRealtimeInput({ 
        text: `[Q]: "${textToSend}" 이 질문에 대해 영어로 대답해줘.` 
      });
      setTextInput('');
      englishBuffer.current = 'Syncing...';
      koreanBuffer.current = '답변 준비 중...';
      updateTranscriptState();
    } catch (e) {
      console.error('Send error:', e);
    }
  };

  const startSession = async () => {
    try {
      // iOS Safari 오디오 컨텍스트 재생 제한 해제를 위해 유저 제스처 내부에서 생성
      const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      setSessionState(SessionState.CONNECTING);
      
      const gainNode = outCtx.createGain();
      gainNode.gain.value = volume; 
      gainNode.connect(outCtx.destination);
      gainNodeRef.current = gainNode;

      await inCtx.resume(); 
      await outCtx.resume();
      
      audioContextRef.current = inCtx; 
      outAudioContextRef.current = outCtx;

      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `당신은 세계 최고의 '실시간 동시 통역사'입니다. 
1. 문장 단위가 아닌 단어/구문 단위로 즉시 통역하십시오. 
2. 즉각 통역 음성을 생성하십시오. 
3. 번역된 텍스트만 출력하십시오.`,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          inputAudioTranscription: {}, 
          outputAudioTranscription: {}, 
        },
        callbacks: {
          onopen: () => {
            setSessionState(SessionState.CONNECTED);
            const scriptProcessor = inCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (sessionPromiseRef.current) {
                const pcmBlob = createPcmBlob(e.inputBuffer.getChannelData(0));
                sessionPromiseRef.current.then(s => s.sendRealtimeInput({ media: pcmBlob }));
              }
            };
            inCtx.createMediaStreamSource(stream).connect(scriptProcessor);
            scriptProcessor.connect(inCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            lastActivityTime.current = Date.now();

            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              if (text) {
                englishBuffer.current += (englishBuffer.current ? ' ' : '') + text;
                updateTranscriptState();
              }
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              if (text) {
                koreanBuffer.current += text;
                updateTranscriptState();
              }
            }

            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.inlineData?.data && outAudioContextRef.current && gainNodeRef.current) {
                  const ctx = outAudioContextRef.current;
                  nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                  const audioBuffer = await decodeAudioData(decode(part.inlineData.data), ctx, 24000, 1);
                  const source = ctx.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(gainNodeRef.current);
                  setIsModelSpeaking(true);
                  source.onended = () => {
                    sourcesRef.current.delete(source);
                    if (sourcesRef.current.size === 0) setIsModelSpeaking(false);
                  };
                  source.start(nextStartTimeRef.current);
                  nextStartTimeRef.current += audioBuffer.duration;
                  sourcesRef.current.add(source);
                }
              }
            }

            if (message.serverContent?.turnComplete) {
              setTimeout(() => {
                if (Date.now() - lastActivityTime.current > 3500) {
                  englishBuffer.current = '';
                  koreanBuffer.current = '';
                  updateTranscriptState();
                }
              }, 4000);
            }
          },
          onerror: () => stopSession(),
          onclose: () => stopSession()
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err) {
      console.error(err);
      stopSession();
    }
  };

  const handleVolumeChange = (newVal: number) => {
    setVolume(newVal);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(newVal, outAudioContextRef.current?.currentTime || 0, 0.05);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#020617] text-slate-100 font-sans select-none overflow-hidden">
      {/* Background Layer */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,_#0f172a_0%,_#020617_100%)]" />
      
      {/* Header - iOS Safe Area Handling */}
      <header className="relative pt-[env(safe-area-inset-top)] px-6 py-4 flex justify-between items-center z-50 bg-slate-900/40 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${sessionState === SessionState.CONNECTED ? 'bg-emerald-400 shadow-[0_0_15px_#10b981] animate-pulse' : 'bg-slate-700'}`} />
          <h1 className="text-[10px] font-black tracking-[0.4em] text-white uppercase italic">Ultra Neural</h1>
        </div>

        <div className="flex items-center gap-3 bg-white/5 px-3 py-1 rounded-full border border-white/10">
          <span className="text-[8px] text-slate-500 font-bold uppercase">Volume</span>
          <input 
            type="range" min="0" max="0.4" step="0.05" 
            value={volume} 
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="w-12 h-1 bg-slate-800 rounded-lg appearance-none accent-emerald-500"
          />
        </div>
      </header>

      {/* Main Board */}
      <main className="relative flex-1 flex flex-col justify-evenly items-center px-6 z-10 overflow-hidden">
        {/* EN Section */}
        <div className="w-full text-center">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.6em] block mb-2">Speech (EN)</span>
          <div className="min-h-[80px] flex items-center justify-center">
            <p className="text-2xl sm:text-5xl font-bold text-white leading-tight transition-all">
              {liveTranscript.english || <span className="text-slate-800 italic">Listening...</span>}
            </p>
          </div>
        </div>

        {/* Visualizer Center */}
        <div className="relative py-4 scale-125 sm:scale-150">
             <div className={`absolute inset-0 bg-emerald-500/10 blur-[60px] rounded-full transition-opacity duration-700 ${isModelSpeaking ? 'opacity-100' : 'opacity-0'}`} />
             <Visualizer isActive={sessionState === SessionState.CONNECTED} isModelSpeaking={isModelSpeaking} />
        </div>

        {/* KR Section */}
        <div className="w-full text-center">
          <span className="text-[9px] font-black text-emerald-500/40 uppercase tracking-[0.6em] block mb-4">Translation (KR)</span>
          <div className="min-h-[140px] flex items-center justify-center">
            <p className={`text-5xl sm:text-[8rem] font-black text-white leading-[1] tracking-tighter transition-all duration-300 ${liveTranscript.korean ? 'opacity-100' : 'opacity-5 blur-xl scale-95'}`}>
              {liveTranscript.korean || "준비"}
            </p>
          </div>
        </div>
      </main>

      {/* Footer Controls - iOS Safe Area Handling */}
      <footer className="relative px-6 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] z-50">
        <div className="max-w-xl mx-auto flex flex-col items-center gap-8">
          
          {/* Quick Command */}
          <div className={`w-full transition-all duration-700 ${sessionState === SessionState.CONNECTED ? 'opacity-100' : 'opacity-0 pointer-events-none translate-y-4'}`}>
            <div className="flex items-center bg-white/[0.03] border border-white/10 rounded-2xl p-2 shadow-xl backdrop-blur-2xl ring-1 ring-white/5">
              <input 
                type="text" 
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                placeholder="Ask in English..."
                className="flex-1 bg-transparent px-4 py-2 focus:outline-none text-lg font-bold text-white placeholder:text-slate-800"
              />
              <button 
                onClick={handleSendText}
                disabled={!textInput.trim()}
                className={`p-3 rounded-xl transition-all ${textInput.trim() ? 'bg-emerald-500 text-slate-950 shadow-lg' : 'bg-slate-800 text-slate-600'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Main Toggle Button */}
          <div className="relative flex flex-col items-center gap-3">
            <button
              onClick={sessionState === SessionState.CONNECTED ? stopSession : startSession}
              className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 active:scale-90 ${
                sessionState === SessionState.CONNECTED 
                  ? 'bg-red-500/10 border-red-500/40 text-red-500' 
                  : 'bg-white text-slate-950 shadow-[0_0_50px_rgba(255,255,255,0.15)]'
              } border-2 overflow-hidden`}
            >
              {sessionState === SessionState.CONNECTING ? (
                <div className="w-10 h-10 border-4 border-slate-950/20 border-t-slate-950 rounded-full animate-spin" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={sessionState === SessionState.CONNECTED ? "M6 18L18 6M6 6l12 12" : "M13 10V3L4 14h7v7l9-11h-7z"} />
                </svg>
              )}
            </button>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
              {sessionState === SessionState.CONNECTED ? "DISCONNECT" : "START TRANSLATOR"}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};