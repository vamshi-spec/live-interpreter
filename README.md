# Live Interpreter — "interpret, don't translate"

A live multilingual speech-broadcast app for a single speaker addressing many students.
You speak in **Telugu / English / Hindi / Tamil** (code-switching is fine). Each student
opens a link on their phone, picks one of **English, Telugu, Tamil, Kannada, Hindi,
Malayalam**, and hears you in near real-time as a **natural human-style interpretation** —
not a stiff word-for-word translation — with live captions underneath.

---

## 1. Architecture — and why a cascade, not direct Live Translate

> **Decision: cascade.** Confirmed against the June 2026 model surface.

Google's `models/gemini-3.5-live-translate-preview` does fixed **audio-to-audio**
translation. In translation mode it accepts **audio input only and ignores system
instructions and tools** — so there is *no hook* to inject an "interpret, convey the
meaning" prompt. It will give you faithful but **literal** output. That fails your core
requirement. (An A/B toggle to hear this for yourself is built in — see §6.)

So we run a **cascaded pipeline** that puts the interpretation style under our control:

```
                                         ┌─────────────────────────────────────────┐
  Speaker mic                            │             SERVER (key stays here)       │
  (browser)                              │                                           │
   16 kHz PCM ──WebSocket──▶  STT (Gemini Live API, native audio)                    │
                             auto-detect Telugu/English/Hindi/Tamil, code-switch     │
                                          │  transcript chunk                         │
                                          ▼                                           │
                          ┌──── for EACH of the 6 target languages (once each) ────┐  │
                          │  Interpret  (Gemini 3.1 Pro text + interpreter prompt)  │  │
                          │     meaning, not words · localize · drop filler         │  │
                          │            │ interpreted text                           │  │
                          │            ├──────────────▶ caption (data channel)      │  │
                          │            ▼                                            │  │
                          │  TTS  (Gemini 3.1 Flash TTS, warm voice)  ──▶ PCM audio │  │
                          └────────────────────────────┬───────────────────────────┘  │
                                                        ▼                              │
                                   LiveKit room: ONE audio track per language          │
                                                        │                              │
                                                        ▼                              │
   Listeners (phones) ◀── subscribe to just their language's track + captions ─────────┘
```

**Translate once per language, fan out to all listeners of that language.** Cost scales
with the number of **languages (6)**, never with the number of listeners. Hundreds of
students on one language all share a single interpreted audio stream.

### Component choices
| Stage | Model / tech | Why |
|---|---|---|
| Streaming STT | `gemini-2.5-flash-native-audio-preview-12-2025` (Live API) | Native audio, sub-second, 90+ langs, handles mid-sentence code-switching |
| Interpret (text) | `gemini-3.1-pro-preview` | Meaning-based re-expression steered by the interpreter system prompt |
| TTS | `gemini-3.1-flash-tts-preview` | Expressive, 70+ langs incl. Kannada/Malayalam/Telugu/Tamil, audio-tag style control |
| Fan-out | **LiveKit Cloud** (WebRTC SFU) | Sub-second 1-to-many, mobile/patchy-network friendly, instant language switch |
| Direct A/B | `models/gemini-3.5-live-translate-preview` | Side-by-side reference only (literal) |

> All model IDs are environment variables (`STT_MODEL`, `INTERPRET_MODEL`, `TTS_MODEL`,
> `LIVE_TRANSLATE_MODEL`) — swap them when Google ships revisions, no code change.
> Tip: set `INTERPRET_MODEL=gemini-3.1-flash-preview` to cut interpret cost/latency
> (~5×) at a small quality cost.

---

## 2. Prerequisites

- **Node.js 20+**
- A **Gemini API key** (you have this) — https://aistudio.google.com/apikey
- A free **LiveKit Cloud** project (2 minutes — steps below)

### Get your LiveKit keys
1. Sign up at https://cloud.livekit.io (free tier is plenty for Phase 1).
2. Create a project. Note the **WebSocket URL** (looks like `wss://yourproj.livekit.cloud`).
3. **Settings → Keys → Create Key.** Copy the **API Key** and **API Secret**.

---

## 3. Run locally

```bash
cd live-interpreter
cp .env.example .env          # then edit .env and paste your keys
npm install
npm start
```

Open **http://localhost:8080** → that's your **Speaker Console**.

To let students on real phones reach a `localhost` server, expose it over HTTPS with a
tunnel (mic access and WebRTC require a secure origin):

```bash
# in another terminal
npx ngrok http 8080
# copy the https URL it prints, then set in .env and restart:
#   PUBLIC_BASE_URL=https://<your-id>.ngrok-free.app
```

The QR / share link the console generates will then point at the tunnel URL.

---

## 4. Deploy to the cloud (recommended for real broadcasts)

This repo ships a `Dockerfile` and `render.yaml`.

**Render (one-click blueprint):**
1. Push this folder to a GitHub repo.
2. Render → **New + → Blueprint** → pick the repo (it reads `render.yaml`).
3. In the dashboard set the secret env vars: `GEMINI_API_KEY`, `LIVEKIT_URL`,
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
4. After the first deploy, set `PUBLIC_BASE_URL` to your `https://<service>.onrender.com`
   URL and redeploy (so the QR/share link is correct).

Works the same on Railway, Fly.io, or any Docker host. The app is one small stateless
Node service; LiveKit Cloud does the heavy media fan-out.

---

## 5. Using it

**Speaker (you):**
1. Open the deployed URL → **Start Broadcast** → allow mic.
2. A **QR code + share link** appear — send to students.
3. Watch your **live transcript**, **per-language listener counts**, and uptime.
4. **Stop** when done.

**Student:**
1. Open the link (mobile-first).
2. Tap a language (shown in its own script).
3. Tap **Listen** → live interpreted audio + a **live caption** below (low-bandwidth
   fallback — readable even if audio stutters).
4. **Change language** anytime mid-stream.

---

## 6. The A/B: cascade vs. direct Live Translate

On the Speaker Console, tick **"Use direct Live Translate"** before starting to run the
**same broadcast** through the fixed audio-to-audio path instead of the cascade. Listen on
two phones (one per mode) and compare. What you'll hear:

| | **Cascade (default)** | **Direct Live Translate** |
|---|---|---|
| Style | Conveys *meaning*; reworded like a human interpreter | Literal, word-for-word |
| Idioms / examples | Localized to the target language | Translated literally, often awkward |
| Filler / false starts | Dropped | Carried through |
| Tone control | Warm/motivating, steerable via prompt | Fixed, not steerable |
| Latency | A few seconds (see §7) | Lower (single model) |
| Steerable? | **Yes** (interpreter prompt) | **No** (no system instructions in translation mode) |

**Verdict:** direct mode is *not* "good enough" on the interpretation requirement — it's
structurally incapable of meaning-based rewording. The cascade is the default.

---

## 7. Latency vs. naturalness — the tradeoff we landed on

A broadcast tolerates lag, so we **optimized for naturalness over instant**, targeting a
**few seconds** end-to-end. Rough budget per chunk:

- STT finalize (wait for an utterance boundary so the interpreter gets a complete thought): **~0.8–1.5 s**
- Interpret (text, `thinkingBudget: 0` to stay fast): **~0.6–1.2 s**
- TTS synth + first audio out: **~0.7–1.5 s**
- LiveKit transport: **~0.1–0.3 s**
- **Total: ~2.5–4.5 s** behind the speaker.

Choices that favor naturalness:
- We interpret on **utterance boundaries**, not every word, so the interpreter sees a
  whole thought and produces fluent, complete sentences (literal streamers sound choppy).
- A small **rolling context window** per language keeps continuity across chunks without
  re-greeting or losing pronoun references.
- Captions are pushed **before** audio synthesis finishes — students reading along see text
  a beat earlier, which hides synthesis latency.

If you ever need lower latency, the levers are: switch `INTERPRET_MODEL` to a flash model,
and shorten utterance segmentation. The default trades ~1–2 s for noticeably more natural
output, which is the right call for a lecture-style broadcast.

---

## 8. Cost per session

**Cost scales with the number of target languages (6), not the number of listeners.**
A session with 6 listeners and a session with 600 listeners cost the same in Gemini calls;
only LiveKit bandwidth grows with listeners.

Illustrative estimate for **one hour, 6 languages** (assumes ~130 wpm of speech; FX ≈ ₹86/USD —
*verify current Gemini/LiveKit pricing, these are planning figures, not a quote*):

| Item | Basis | Per hour (approx) |
|---|---|---|
| STT (shared, 1×) | audio-in to Live API | ₹15 |
| Interpret ×6 langs | `gemini-3.1-pro-preview` text | ₹330 (≈ ₹55/lang) |
| TTS ×6 langs | `gemini-3.1-flash-tts-preview` | ₹460 (≈ ₹77/lang) |
| **Gemini subtotal** | | **≈ ₹805 / hour** |
| LiveKit egress | ~40 kbps/listener; e.g. 200 listeners ≈ 3.6 GB/hr | ₹0 on free tier, then ~₹40/hr |
| **Total** | | **≈ ₹800–850 / hour** |

For comparison, **direct Live Translate** (the reference path) at ~$0.023/min/language ×
6 ≈ **₹712/hour** — similar ballpark, but without interpretation control.

**Levers to cut cost:** set `INTERPRET_MODEL` to a flash model (interpret drops to ~₹70/hr
total); drop unused languages from `LISTENER_LANGUAGES`.

---

## 9. Robustness (handled)

- **Mic drop / speaker pause:** worklet stops sending; STT flushes the pending utterance;
  the room stays up so listeners aren't kicked.
- **Network blips:** LiveKit auto-reconnects listeners; captions resume on reconnect.
- **Listener switches language mid-stream:** "Change language" disconnects and rejoins on
  the new track with a fresh identity (keeps per-language counts accurate); near-instant.
- **Autoplay blocked on mobile:** an explicit "Tap to enable sound" button appears.
- **API key safety:** the Gemini key lives only on the server; listeners get short-lived,
  **subscribe-only** LiveKit tokens (they can never publish/broadcast).

---

## 10. Phase 2 (out of scope now)

- Session recording & playback / on-demand replay
- Multiple simultaneous speakers / multiple concurrent sessions
- Accounts, login, roles
- Analytics dashboard (engagement, drop-off, per-language quality)
- Speaker glossary / do-not-translate term list (brand names, course names)
- Per-language voice picker and speaking-rate control

---

## 11. Project layout

```
live-interpreter/
├── server/
│   ├── index.js            HTTP + WebSocket, session lifecycle, token endpoints
│   ├── config.js           env + language catalogue
│   ├── pipeline.js         per-session orchestration (STT → interpret → TTS → publish)
│   ├── gemini/
│   │   ├── client.js       shared Gemini client (holds the API key)
│   │   ├── stt.js          Live API streaming transcription
│   │   ├── interpret.js    interpreter system prompt + text step
│   │   ├── tts.js          text-to-speech
│   │   └── liveTranslate.js  direct audio-to-audio (A/B reference)
│   └── livekit/
│       ├── tokens.js       subscribe-only listener tokens, publisher token
│       └── publisher.js    one audio track per language + caption data channel
├── public/
│   ├── index.html / speaker.js   Speaker Console
│   ├── listen.html / listen.js   Listener page (mobile-first)
│   ├── pcm-worklet.js            mic → 16 kHz PCM downsampler
│   └── styles.css
├── Dockerfile · render.yaml · .env.example · .gitignore
```
