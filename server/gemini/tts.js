import { Modality } from '@google/genai';
import { ai } from './client.js';
import { config, AUDIO } from '../config.js';

/**
 * Text-to-speech for one interpreted chunk.
 * Returns raw 16-bit PCM @ 24 kHz mono (a Node Buffer) ready to push into a
 * LiveKit AudioSource.
 *
 * We prepend a light style direction (an "audio tag") so the voice keeps the
 * speaker's warm, encouraging energy across languages.
 */
export async function synthesize({ text, voiceName = config.gemini.ttsVoice }) {
  if (!text || !text.trim()) return Buffer.alloc(0);

  const styled = `Say warmly and encouragingly, like a motivating teacher: ${text}`;

  const res = await ai.models.generateContent({
    model: config.gemini.ttsModel,
    contents: styled,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName } },
      },
    },
  });

  const inline = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline?.data) return Buffer.alloc(0);

  return Buffer.from(inline.data, 'base64'); // PCM16 @ AUDIO.ttsOutputRate
}

export const TTS_OUTPUT_RATE = AUDIO.ttsOutputRate;
