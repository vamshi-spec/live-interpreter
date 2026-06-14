import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { SttSession } from './gemini/stt.js';
import { interpretChunk } from './gemini/interpret.js';
import { synthesize } from './gemini/tts.js';
import { LiveTranslateSession } from './gemini/liveTranslate.js';
import { SessionBroadcaster } from './livekit/publisher.js';

/**
 * A single live broadcast session.
 *
 * mode === 'cascade' (default): STT -> per-language interpret -> TTS -> publish.
 * mode === 'direct'  (A/B only): raw audio -> per-language Live Translate -> publish.
 *
 * One session at a time is the Phase-1 scope.
 */
export class BroadcastSession {
  constructor({ mode = 'cascade' } = {}) {
    this.id = randomUUID().slice(0, 8);
    this.roomName = `bc-${this.id}`;
    this.mode = mode;
    this.broadcaster = new SessionBroadcaster(this.roomName);
    this.stt = null;
    this.directSessions = new Map(); // langCode -> LiveTranslateSession (direct mode)
    this.recentContext = new Map(config.languageCodes.map((c) => [c, '']));
    this.liveTranscript = '';
    this.partialTranscript = '';
    this.onTranscript = () => {};
    this.onStatus = () => {};
    this.startedAt = Date.now();
    this.stopped = false;
  }

  async start() {
    await this.broadcaster.start();
    this.broadcaster.onParticipantChange(() => this.onStatus());

    if (this.mode === 'direct') {
      // One Live Translate session per language; we'll fan the same mic audio to each.
      for (const lang of config.languages) {
        const s = new LiveTranslateSession({
          targetLanguageCode: lang.bcp47,
          onAudio: (buf) => this.broadcaster.pushAudio(lang.code, buf),
          onError: (e) => console.error(`[direct:${lang.code}]`, e?.message || e),
        });
        await s.connect();
        this.directSessions.set(lang.code, s);
      }
    }

    // STT always runs: in cascade it drives interpretation; in direct mode we still
    // run it to show the speaker their live transcript on the console.
    this.stt = new SttSession({
      onPartial: (t) => {
        this.partialTranscript = t;
        this.onTranscript({ partial: t, final: this.liveTranscript });
      },
      onFinal: (chunk) => {
        this.liveTranscript = chunk;
        this.partialTranscript = '';
        this.onTranscript({ partial: '', final: chunk });
        if (this.mode === 'cascade') this._interpretAndSpeak(chunk);
      },
      onError: (e) => console.error('[stt]', e?.message || e),
    });
    await this.stt.connect();
    return this;
  }

  /** Fan one transcript chunk to every language: interpret -> TTS -> publish. */
  async _interpretAndSpeak(chunk) {
    console.log('[pipeline] interpreting chunk for', config.languages.length, 'languages:', chunk);
    await Promise.all(
      config.languages.map(async (lang) => {
        try {
          const text = await interpretChunk({
            chunk,
            targetLanguage: lang,
            recentContext: this.recentContext.get(lang.code),
          });
          console.log(`[interpret:${lang.code}] ->`, text || '(empty)');
          if (!text) return;

          // Send the caption immediately (cheap, low-bandwidth fallback) ...
          this.broadcaster.pushCaption(lang.code, text);

          // ... then synthesize and stream the audio.
          const pcm = await synthesize({ text });
          console.log(`[tts:${lang.code}] bytes=`, pcm?.length || 0);
          this.broadcaster.pushAudio(lang.code, pcm);

          // Update rolling context (bounded).
          const merged = `${this.recentContext.get(lang.code)} ${text}`.trim();
          this.recentContext.set(lang.code, merged.slice(-config.gemini.interpretContextChars));
        } catch (e) {
          console.error(`[interpret:${lang.code}]`, e?.stack || e?.message || e);
        }
      })
    );
  }

  /** Raw mic audio in (base64 PCM16 @ 16 kHz) from the speaker's browser. */
  pushSpeakerAudio(base64Pcm) {
    if (this.stopped) return;
    this.stt?.sendAudio(base64Pcm);
    if (this.mode === 'direct') {
      for (const s of this.directSessions.values()) s.sendAudio(base64Pcm);
    }
  }

  pauseInput() {
    this.stt?.flush();
  }

  status() {
    return {
      sessionId: this.id,
      room: this.roomName,
      mode: this.mode,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      totalListeners: this.broadcaster.totalListeners(),
      byLanguage: this.broadcaster.listenerCountsByLang(),
      transcript: { final: this.liveTranscript, partial: this.partialTranscript },
    };
  }

  async stop() {
    this.stopped = true;
    this.stt?.close();
    for (const s of this.directSessions.values()) s.close();
    await this.broadcaster.stop();
  }
}
