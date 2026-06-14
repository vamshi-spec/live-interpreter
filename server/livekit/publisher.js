import {
  Room,
  RoomEvent,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  AudioFrame,
  DataPacketKind,
} from '@livekit/rtc-node';
import { config, AUDIO } from '../config.js';
import { createPublisherToken } from './tokens.js';

const FRAME_MS = 10; // push audio in 10 ms frames for smooth playout
const SAMPLES_PER_FRAME = (AUDIO.ttsOutputRate * FRAME_MS) / 1000; // 240 @ 24 kHz

/**
 * Server-side broadcaster for ONE session.
 *
 * Joins the session's LiveKit room once as "interpreter-bot" and publishes one
 * audio track per target language (track name === language code). Every listener
 * of a given language subscribes to that single track — we interpret + synthesize
 * once per language and fan the audio out to all listeners. Cost scales with the
 * number of languages, not the number of listeners.
 *
 * Captions are sent over the LiveKit data channel, tagged by language topic, so a
 * listener only renders captions for the language they picked.
 */
export class SessionBroadcaster {
  constructor(roomName) {
    this.roomName = roomName;
    this.room = new Room();
    this.sources = new Map(); // langCode -> AudioSource
    this.queues = new Map();  // langCode -> Promise chain (serializes playout)
    this.connected = false;
  }

  async start() {
    const token = await createPublisherToken({ room: this.roomName });
    await this.room.connect(config.livekit.url, token, { autoSubscribe: false, dynacast: true });
    this.connected = true;

    for (const lang of config.languages) {
      const source = new AudioSource(AUDIO.ttsOutputRate, AUDIO.channels);
      const track = LocalAudioTrack.createAudioTrack(lang.code, source);
      const opts = new TrackPublishOptions();
      opts.source = TrackSource.SOURCE_MICROPHONE;
      // name the publication after the language so the client can pick it deterministically
      opts.name = lang.code;
      await this.room.localParticipant.publishTrack(track, opts);
      this.sources.set(lang.code, source);
      this.queues.set(lang.code, Promise.resolve());
    }
    console.log('[broadcaster] connected; published tracks:', [...this.sources.keys()].join(','));
    return this;
  }

  /**
   * Enqueue interpreted PCM audio for a language. Chunks for the same language
   * play back-to-back (no overlap); different languages play independently.
   */
  pushAudio(langCode, pcm16Buffer) {
    const source = this.sources.get(langCode);
    if (!source || !pcm16Buffer?.length) return;
    console.log(`[broadcaster:${langCode}] pushAudio bytes=`, pcm16Buffer.length);

    const prev = this.queues.get(langCode) || Promise.resolve();
    const next = prev.then(() => this._captureBuffer(source, pcm16Buffer)).catch((e) => {
      console.error(`[broadcaster:${langCode}] playout error`, e);
    });
    this.queues.set(langCode, next);
  }

  async _captureBuffer(source, buf) {
    // Buffer is little-endian PCM16. View it as Int16 samples.
    const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
    for (let i = 0; i < samples.length; i += SAMPLES_PER_FRAME) {
      const slice = samples.subarray(i, i + SAMPLES_PER_FRAME);
      // Pad the final short frame so the AudioFrame length is consistent.
      const data = slice.length === SAMPLES_PER_FRAME ? slice : (() => {
        const padded = new Int16Array(SAMPLES_PER_FRAME);
        padded.set(slice);
        return padded;
      })();
      const frame = new AudioFrame(data, AUDIO.ttsOutputRate, AUDIO.channels, data.length);
      // captureFrame resolves as the frame drains from the source's buffer,
      // which paces us to real time automatically.
      await source.captureFrame(frame);
    }
  }

  /** Broadcast a live caption for one language to its listeners. */
  pushCaption(langCode, text) {
    if (!this.connected || !text) return;
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'caption', lang: langCode, text }));
    this.room.localParticipant
      .publishData(payload, { reliable: true, topic: `caption:${langCode}` })
      .catch((e) => console.error('[broadcaster] caption publish failed', e));
  }

  /** Count current subscribers per language (remote participants in the room). */
  listenerCountsByLang() {
    const counts = Object.fromEntries(config.languageCodes.map((c) => [c, 0]));
    for (const p of this.room.remoteParticipants.values()) {
      // Listener identity is encoded as "listener:<lang>:<rand>" (see index.js).
      const lang = (p.identity || '').split(':')[1];
      if (lang && counts[lang] !== undefined) counts[lang] += 1;
    }
    return counts;
  }

  totalListeners() {
    return this.room.remoteParticipants.size;
  }

  onParticipantChange(cb) {
    this.room.on(RoomEvent.ParticipantConnected, cb);
    this.room.on(RoomEvent.ParticipantDisconnected, cb);
  }

  async stop() {
    this.connected = false;
    try { await this.room.disconnect(); } catch { /* noop */ }
    this.sources.clear();
    this.queues.clear();
  }
}

export { DataPacketKind };
