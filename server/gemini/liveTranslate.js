import { Modality } from '@google/genai';
import { ai } from './client.js';
import { config, AUDIO } from '../config.js';

/**
 * DIRECT MODE — Gemini 3.5 Live Translate, audio-to-audio.
 *
 * This is here ONLY for the side-by-side A/B comparison required by the spec.
 * It is fixed translation, not steerable interpretation: in translation mode the
 * model accepts audio input only and ignores system instructions and tools, so
 * there is no hook to inject the interpreter prompt. Expect faithful but
 * literal, word-for-word output. The cascade is the default for real broadcasts.
 *
 * One session per target language. Audio in (16 kHz PCM), audio out (24 kHz PCM)
 * delivered to onAudio(buffer).
 */
export class LiveTranslateSession {
  constructor({ targetLanguageCode, onAudio, onError, onClose }) {
    this.targetLanguageCode = targetLanguageCode;
    this.onAudio = onAudio || (() => {});
    this.onError = onError || (() => {});
    this.onClose = onClose || (() => {});
    this.session = null;
    this.closed = false;
  }

  async connect() {
    this.session = await ai.live.connect({
      model: config.gemini.liveTranslateModel,
      config: {
        responseModalities: [Modality.AUDIO],
        // The defining knob for direct mode — no system instructions allowed here.
        translationConfig: {
          targetLanguageCode: this.targetLanguageCode, // e.g. "te-IN"
          echoTargetLanguage: true, // if the speaker is already in the target language, pass it through
        },
      },
      callbacks: {
        onmessage: (msg) => {
          const parts = msg.serverContent?.modelTurn?.parts || [];
          for (const p of parts) {
            if (p.inlineData?.data) this.onAudio(Buffer.from(p.inlineData.data, 'base64'));
          }
        },
        onerror: (e) => this.onError(e),
        onclose: () => { this.closed = true; this.onClose(); },
      },
    });
    return this;
  }

  sendAudio(base64Pcm) {
    if (this.closed || !this.session) return;
    this.session.sendRealtimeInput({
      audio: { data: base64Pcm, mimeType: `audio/pcm;rate=${AUDIO.sttInputRate}` },
    });
  }

  close() {
    this.closed = true;
    try { this.session?.close(); } catch { /* noop */ }
  }
}
