# Fing Chat STT Server (On-device, no external APIs)

This is a lightweight FastAPI + Vosk server that performs streaming speech-to-text entirely on your server. The client sends microphone PCM16 mono chunks via WebSocket; the server streams back partial/final transcripts.

- Language model: Vosk offline ASR
- Transport: WebSocket `/ws`
- Audio format: 16 kHz, mono, PCM16 (little-endian)

## Setup

1) Create a Python virtualenv and install deps:

```
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
```

2) Download a Vosk model and set `VOSK_MODEL_PATH` to its directory. For English small model:

```
# Example: download and extract
mkdir -p server
cd server
curl -L -o vosk-model-small-en-us-0.15.zip \
  https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip
mv vosk-model-small-en-us-0.15 vosk-model
```

Alternatively, pick a different language/model from https://alphacephei.com/vosk/models and set `VOSK_MODEL_PATH` accordingly.

3) Run the server:

```
# From repo root
STT_HOST=0.0.0.0 STT_PORT=8001 VOSK_MODEL_PATH=server/vosk-model \
  python server/stt_server.py
```

Health check:

```
curl http://localhost:8001/health
```

## WebSocket protocol

- Client connects to: `ws://<host>:8001/ws`
- Server immediately sends a JSON text message:

```json
{"type":"ready","sampleRate":16000,"format":"pcm_s16le_mono"}
```

- Client streams raw binary frames: PCM16LE mono at 16 kHz (use small chunks e.g., 20–40 ms).
- Server responds with text JSON messages interleaved:
  - Partial hypotheses:
    ```json
    {"type":"partial","partial":"hello wor"}
    ```
  - Final segment results:
    ```json
    {"type":"result","text":"hello world","result":[{"word":"hello","start":0.0,"end":0.4}, ...]}
    ```
  - Final flush when socket closes:
    ```json
    {"type":"final","text":"..."}
    ```

## Client-side helper

Use `src/integrations/stt/client.ts` which provides `STTStreamer` to capture mic, resample to 16k PCM16, and stream via WebSocket.

Quick usage in your UI:

```ts
import { STTStreamer } from "@/integrations/stt/client";

const stt = new STTStreamer("ws://localhost:8001/ws");
stt.onPartial = (t) => console.log("partial:", t);
stt.onResult = (t) => console.log("result:", t);
stt.onFinal = (t) => console.log("final:", t);

await stt.start();
// ...when done
await stt.stop();
```

## Notes

- Keep chunks small (~320–960 samples per frame) for low latency.
- Ensure you run server and web app on same LAN or enable CORS/WebSocket access as needed.
- For best accuracy, try larger non-small models if CPU allows.
