import 'dotenv/config';

function req(name) {
  const v = process.env[name];
  if (!v || v.startsWith('your-')) {
    console.warn(`[config] WARNING: ${name} is not set — the app will not work until you add it to .env`);
  }
  return v;
}

// Canonical catalogue of supported LISTENER (output) languages.
// `code` is what the client sends and what we use for LiveKit track names.
// `tts` is the BCP-47 hint we feed the interpreter + TTS step.
export const LANGUAGE_CATALOG = {
  en: { code: 'en', name: 'English',   native: 'English',  bcp47: 'en-IN' },
  te: { code: 'te', name: 'Telugu',    native: 'తెలుగు',   bcp47: 'te-IN' },
  ta: { code: 'ta', name: 'Tamil',     native: 'தமிழ்',    bcp47: 'ta-IN' },
  kn: { code: 'kn', name: 'Kannada',   native: 'ಕನ್ನಡ',    bcp47: 'kn-IN' },
  hi: { code: 'hi', name: 'Hindi',     native: 'हिन्दी',    bcp47: 'hi-IN' },
  ml: { code: 'ml', name: 'Malayalam', native: 'മലയാളം',   bcp47: 'ml-IN' },
};

const enabled = (process.env.LISTENER_LANGUAGES || 'en,te,ta,kn,hi,ml')
  .split(',')
  .map((s) => s.trim())
  .filter((c) => LANGUAGE_CATALOG[c]);

export const config = {
  port: Number(process.env.PORT || 8080),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, ''),

  gemini: {
    apiKey: req('GEMINI_API_KEY'),
    // Half-cascade Live model: supports TEXT output + input transcription.
    // (The native-audio variant only outputs AUDIO and rejects TEXT modality.)
    sttModel: process.env.STT_MODEL || 'gemini-3.1-flash-live-preview',
    interpretModel: process.env.INTERPRET_MODEL || 'gemini-3.1-pro-preview',
    ttsModel: process.env.TTS_MODEL || 'gemini-3.1-flash-tts-preview',
    liveTranslateModel: process.env.LIVE_TRANSLATE_MODEL || 'models/gemini-3.5-live-translate-preview',
    ttsVoice: process.env.TTS_VOICE || 'Charon',
    interpretContextChars: Number(process.env.INTERPRET_CONTEXT_CHARS || 600),
  },

  livekit: {
    url: req('LIVEKIT_URL'),
    apiKey: req('LIVEKIT_API_KEY'),
    apiSecret: req('LIVEKIT_API_SECRET'),
  },

  // Resolved list of enabled listener languages, in display order.
  languages: enabled.map((c) => LANGUAGE_CATALOG[c]),
  languageCodes: enabled,
};

// Speaker input languages (auto-detected; code-switching allowed).
export const SPEAKER_INPUT_LANGUAGES = ['Telugu', 'English', 'Hindi', 'Tamil'];

// Audio formats are fixed by the Gemini Live API contract.
export const AUDIO = {
  sttInputRate: 16000, // 16 kHz, 16-bit PCM mono in to STT
  ttsOutputRate: 24000, // 24 kHz, 16-bit PCM mono out of TTS
  channels: 1,
};
