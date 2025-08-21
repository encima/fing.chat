import asyncio
import json
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from vosk import Model, KaldiRecognizer

APP_HOST = os.getenv("STT_HOST", "0.0.0.0")
APP_PORT = int(os.getenv("STT_PORT", "8001"))
SAMPLE_RATE = int(os.getenv("STT_SAMPLE_RATE", "16000"))
MODEL_PATH = os.getenv("VOSK_MODEL_PATH", "server/vosk-model")
LANG = os.getenv("VOSK_LANG", "en-us")

app = FastAPI(title="Fing Chat STT Server", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_model: Optional[Model] = None


def load_model() -> Model:
    global _model
    if _model is not None:
        return _model
    model_dir = Path(MODEL_PATH)
    if not model_dir.exists():
        raise RuntimeError(
            f"Vosk model not found at '{model_dir}'. Download a model (e.g., 'vosk-model-small-{LANG}-0.15') "
            "and set VOSK_MODEL_PATH to its directory. See server/README.md."
        )
    _model = Model(str(model_dir))
    return _model


@app.get("/health")
async def health():
    try:
        load_model()
        return JSONResponse({"ok": True})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        model = load_model()
        rec = KaldiRecognizer(model, SAMPLE_RATE)
        rec.SetWords(True)

        # Notify client of expected format
        await ws.send_text(json.dumps({
            "type": "ready",
            "sampleRate": SAMPLE_RATE,
            "format": "pcm_s16le_mono"
        }))

        # Stream loop: receive binary PCM16LE chunks
        while True:
            try:
                data = await ws.receive_bytes()
            except WebSocketDisconnect:
                break
            except Exception:
                # Clients may also send text control messages
                msg = await ws.receive_text()
                if msg == "stop":
                    break
                continue

            if len(data) == 0:
                await asyncio.sleep(0)
                continue

            if rec.AcceptWaveform(data):
                result = rec.Result()
                await ws.send_text(json.dumps({"type": "result", **json.loads(result)}))
            else:
                partial = rec.PartialResult()
                await ws.send_text(json.dumps({"type": "partial", **json.loads(partial)}))

    except WebSocketDisconnect:
        pass
    finally:
        try:
            # Flush final result if any
            final = rec.FinalResult() if 'rec' in locals() else None
            if final:
                await ws.send_text(json.dumps({"type": "final", **json.loads(final)}))
        except Exception:
            pass
        try:
            await ws.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("stt_server:app", host=APP_HOST, port=APP_PORT, reload=False)
