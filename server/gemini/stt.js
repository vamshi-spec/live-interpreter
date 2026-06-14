import { Modality } from '@google/genai';
import { ai } from './client.js';
import { config, SPEAKER_INPUT_LANGUAGES, AUDIO } from '../config.js';

/**
 * Streaming speech-to-text over the Gemini Live API.
 *
 * Uses the native-audio model as a transcriber: audio in (16 kHz PCM),
 * input transcription out. Auto-detects among the speaker's languages and
 * tolerates code-switching.
 *
 * Finalization strategy: we emit a "final" chunk either when the Live API
 * signals turn/utterance end, OR after a short silence debounce — whichever
 * comes first. The debounce makes the cascade fire reliably even if the
 * model's turn semantics differ from what we expect.
 *
 * Emits:
 *   onPartial(text)  — interim transcript (may be revised)
 *   onFinal(text)    — a stable transcript chunk, ready to interpret
 */
const SILENCE_FLUSH_MS = 1200;

export class SttSession {
  constructor({ onPartial, onFinal, onError, onOpen, onClose }) {
    this.onPartial = onPartial || (() => {});
    this.onFinal = onFinal || (() => {});
    this.onError = onError || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onClose = onClose || (() => {});
    this.session = null;
    this.buffer = '';
    this.closed = false;
    this._dbg = 0;
    this._silenceTimer = null;
  }

  async connect() {
    // The Live API only emits AUDIO as a response modality (TEXT is rejected by
    // every Live model in this API version). We don't want the model's spoken
    // reply — we use it purely as a transcriber: `inputAudioTranscription` returns
    // the transcript of the SPEAKER's audio regardless of the output modality.
    // So we request AUDIO (to satisfy the API) and simply ignore the model's audio.
    const systemInstruction =
      `You are a silent transcription engine. Do not speak, respond, or produce any ` +
      `audio. The speaker may switch among ${SPEAKER_INPUT_LANGUAGES.join(', ')} ` +
      `mid-sentence. Only listen.`;

    console.log('[stt] connecting model=', config.gemini.sttModel);
    this.session = await ai.live.connect({
      model: config.gemini.sttModel,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        inputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: { disabled: false },
        },
      },
      callbacks: {
        onopen: () => { console.log('[stt] session open'); this.onOpen(); },
        onmessage: (msg) => this._handle(msg),
        onerror: (e) => { console.error('[stt] error', e?.message || e); this.onError(e); },
        onclose: (e) => { console.log('[stt] closed', e?.reason || ''); this.closed = true; this.onClose(); },
      },
    });
    console.log('[stt] connected');
    return this;
  }

  _scheduleSilenceFlush() {
    if (this._silenceTimer) clearTimeout(this._silenceTimer);
    this._silenceTimer = setTimeout(() => this._flushFinal('silence'), SILENCE_FLUSH_MS);
  }

  _flushFinal(reason) {
    if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
    const chunk = this.buffer.trim();
    this.buffer = '';
    if (chunk) {
      console.log(`[stt] FINAL (${reason}):`, chunk);
      this.onFinal(chunk);
    }
  }

  _handle(msg) {
    // Debug: log the shape of the first handful of messages so we can see
    // exactly what the Live API emits for this model/config.
    if (this._dbg < 25) {
      this._dbg++;
      try {
        const sc = msg.serverContent || {};
        console.log('[stt] msg keys=', Object.keys(msg), 'serverContent keys=', Object.keys(sc),
          'inputT=', JSON.stringify(sc.inputTranscription || null),
          'turnComplete=', sc.turnComplete || false);
      } catch { /* noop */ }
    }

    const sc = msg.serverContent;
    if (!sc) return;

    const t = sc.inputTranscription?.text;
    if (t) {
      this.buffer += t;
      const partial = this.buffer.trim();
      this.onPartial(partial);
      this._scheduleSilenceFlush();
    }

    if (sc.turnComplete || sc.inputTranscription?.finished) {
      this._flushFinal('turnComplete');
    }
  }

  /** Push raw 16-bit PCM @ 16 kHz mono (base64) from the speaker's mic. */
  sendAudio(base64Pcm) {
    if (this.closed || !this.session) return;
    this.session.sendRealtimeInput({
      audio: { data: base64Pcm, mimeType: `audio/pcm;rate=${AUDIO.sttInputRate}` },
    });
  }

  flush() {
    if (this.closed || !this.session) return;
    try { this.session.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* noop */ }
  }

  close() {
    this.closed = true;
    if (this._silenceTimer) clearTimeout(this._silenceTimer);
    try { this.session?.close(); } catch { /* noop */ }
  }
}
