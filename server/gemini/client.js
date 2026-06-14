import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

// One shared client for the whole process. The API key lives here, server-side,
// and is never sent to any browser.
export const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
