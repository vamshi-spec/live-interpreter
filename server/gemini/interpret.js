import { ai } from './client.js';
import { config } from '../config.js';

/**
 * The interpreter system prompt. This is where "interpret, don't translate" lives.
 * Refined from the project spec.
 */
export function interpreterSystemPrompt(targetLanguageName) {
  return (
    `You are a live interpreter for a speaker addressing students. You receive a ` +
    `transcript chunk of what the speaker just said (the speaker may have been mixing ` +
    `Telugu, English, Hindi, and Tamil). Re-express its MEANING in ${targetLanguageName} ` +
    `as a skilled human interpreter would — convey intent, not words.\n\n` +
    `Rules:\n` +
    `- Capture the sense and gist; never transliterate or go word-for-word.\n` +
    `- Localize idioms, examples, and cultural references so they land naturally for a ` +
    `${targetLanguageName}-speaking student.\n` +
    `- Remove filler words, false starts, stutters, and repetition.\n` +
    `- Preserve the speaker's warm, direct, motivating tone and energy.\n` +
    `- Prefer fluent, complete sentences over literal accuracy.\n` +
    `- If a chunk is incomplete, interpret what's there without inventing content.\n` +
    `- Output ONLY the interpreted speech text in ${targetLanguageName}. No quotes, no ` +
    `notes, no commentary, no explanation, no language labels.`
  );
}

/**
 * Interpret one transcript chunk into one target language.
 *
 * `recentContext` is a short rolling window of the previous interpreted/spoken
 * material so the interpreter keeps continuity across chunks (pronoun reference,
 * not re-greeting, etc.). Kept small to bound latency + cost.
 */
export async function interpretChunk({ chunk, targetLanguage, recentContext = '' }) {
  const systemInstruction = interpreterSystemPrompt(targetLanguage.name);

  const contextBlock = recentContext
    ? `Recent context (already interpreted, do not repeat it — only continue):\n"""${recentContext}"""\n\n`
    : '';

  const userText =
    `${contextBlock}New transcript chunk from the speaker:\n"""${chunk}"""\n\n` +
    `Interpret this chunk into natural ${targetLanguage.name}:`;

  const res = await ai.models.generateContent({
    model: config.gemini.interpretModel,
    contents: userText,
    config: {
      systemInstruction,
      // Interpretation wants fluency + a little creative license, but not rambling.
      temperature: 0.6,
      maxOutputTokens: 512,
      // Low latency: we don't need extended thinking for a short re-expression.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  return (res.text || '').trim();
}
