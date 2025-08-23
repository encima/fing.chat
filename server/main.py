#!/usr/bin/env python3
import argparse
import sys
import asyncio
import json
import threading
import mlx_whisper
import pyaudio
import numpy as np
import requests

# Model configuration
# MODEL_NAME="mlx-community/whisper-large-v3-turbo"
MODEL_NAME = "mlx-community/whisper-tiny"  # Smaller model for faster processing

# PyAudio configuration
FORMAT = pyaudio.paInt16   # Audio format (16-bit int)
CHANNELS = 1               # Number of audio channels (mono)
RATE = 16000               # Sampling rate (16 kHz)
CHUNK = 1024               # Buffer size
SILENCE_THRESHOLD = 500    # Amplitude threshold for detecting silence
SILENCE_CHUNKS = 30        # Number of consecutive chunks of silence before stopping

# WebSocket defaults
WS_HOST = "100.127.47.73"
WS_PORT = 8765

def transcribe_audio(single_mode=False, interactive_mode=False, output_file=None, copy_to_clipboard=False):
    # Initialize PyAudio
    audio = pyaudio.PyAudio()
    stream = audio.open(format=FORMAT, channels=CHANNELS, rate=RATE,
                        input=True, frames_per_buffer=CHUNK)

    while True:
        # print("Listening...", file=sys.stderr)
        
        frames = []  # List to store audio chunks
        silent_chunks = 0

        # print("Waiting for speech...", file=sys.stderr)

        # Listen until we detect speech
        while True:
            # Read audio data from the microphone
            data = stream.read(CHUNK, exception_on_overflow=False)
            audio_data = np.frombuffer(data, dtype=np.int16)

            # Check if audio_data exceeds the silence threshold
            if np.max(np.abs(audio_data)) < SILENCE_THRESHOLD:
                silent_chunks += 1
            else:
                silent_chunks = 0

            # If we have enough silence chunks, consider it the end of the speech
            if silent_chunks > SILENCE_CHUNKS:
                break

            # Accumulate frames if we detect sound above the threshold
            frames.append(audio_data.astype(np.float32) / 32768.0)

        # Concatenate all audio data in frames for a single transcription
        if frames:
            audio_data = np.concatenate(frames)

            # Process audio with mlx_whisper
            result = mlx_whisper.transcribe(audio_data, path_or_hf_repo=MODEL_NAME)

            # Get the transcribed text
            transcription = result["text"].strip().lower()  # Normalize text for comparison

            # Output to stdout for piping
            if len(transcription) > 0:
                print(transcription)
                # lang = api.detect(transcription)
                resp = requests.post(
                    "http://100.127.47.73:5000/translate",
                    data={
                        "q": transcription,
                        "source": "en",
                        "target": "fi",
                    }
                )
                print(resp.json()['translatedText'])

                # Write transcription to file if specified
                if output_file:
                    with open(output_file, 'w') as f:
                        f.write(transcription)
                    print(f"Transcription saved to {output_file}", file=sys.stderr)  # Notify to stderr

                # Check for "exit" command to stop in interactive mode
                if transcription == "exit":
                    print("Exit command received. Stopping program.", file=sys.stderr)
                    stream.stop_stream()
                    stream.close()
                    audio.terminate()
                    return False  # Signal to stop the loop

        # Stop if in single mode or if exit command was given
        if single_mode or not interactive_mode:
            stream.stop_stream()
            stream.close()
            audio.terminate()
            break


# ---------- WebSocket server/client implementation ----------

async def _server_transcribe_from_chunks(websocket):
    """Receive binary PCM16 chunks over WS, detect speech with simple silence gating, transcribe, and send JSON back."""
    frames = []
    silent_chunks = 0
    try:
        async for message in websocket:
            if isinstance(message, (bytes, bytearray)):
                audio_data = np.frombuffer(message, dtype=np.int16)
                # Silence detection
                if np.max(np.abs(audio_data)) < SILENCE_THRESHOLD:
                    silent_chunks += 1
                else:
                    silent_chunks = 0
                frames.append(audio_data.astype(np.float32) / 32768.0)

                # End of segment
                if silent_chunks > SILENCE_CHUNKS:
                    if frames:
                        segment = np.concatenate(frames)
                        result = mlx_whisper.transcribe(segment, path_or_hf_repo=MODEL_NAME)
                        text = result.get("text", "").strip().lower()
                        translated = ""
                        if text:
                            try:
                                resp = requests.post(
                                    "http://100.127.47.73:5000/translate",
                                    data={"q": text, "source": "en", "target": "fi"},
                                    timeout=5,
                                )
                                translated = resp.json().get("translatedText", "")
                            except Exception:
                                translated = ""
                            await websocket.send(json.dumps({"text": text, "translated": translated}))
                        frames = []
                        silent_chunks = 0
            else:
                # Control text messages (optional future use)
                cmd = (message or "").strip().lower()
                if cmd == "eos" and frames:
                    segment = np.concatenate(frames)
                    result = mlx_whisper.transcribe(segment, path_or_hf_repo=MODEL_NAME)
                    text = result.get("text", "").strip().lower()
                    translated = ""
                    if text:
                        try:
                            resp = requests.post(
                                "http://100.127.47.73:5000/translate",
                                data={"q": text, "source": "en", "target": "fi"},
                                timeout=5,
                            )
                            translated = resp.json().get("translatedText", "")
                        except Exception:
                            translated = ""
                        await websocket.send(json.dumps({"text": text, "translated": translated}))
                    frames = []
                    silent_chunks = 0
    except Exception as e:
        print(f"[ws server] error: {e}", file=sys.stderr)


async def ws_server(host: str = WS_HOST, port: int = WS_PORT):
    import websockets
    async def handler(websocket):
        await _server_transcribe_from_chunks(websocket)
    print(f"[ws server] Listening on ws://{host}:{port}")
    async with websockets.serve(handler, host, port, max_size=None, ping_interval=20):
        await asyncio.Future()  # run forever


async def ws_client_stream_mic(host: str = WS_HOST, port: int = WS_PORT, copy_to_clipboard: bool = False):
    """Capture mic and stream PCM16 chunks to server; print transcriptions returned as JSON."""
    import websockets
    uri = f"ws://{host}:{port}"
    audio = pyaudio.PyAudio()
    stream = audio.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)
    async with websockets.connect(uri, max_size=None, ping_interval=20) as ws:
        print(f"[ws client] Connected to {uri}")
        async def recv_task():
            try:
                async for msg in ws:
                    try:
                        data = json.loads(msg)
                        text = data.get("text", "")
                        translated = data.get("translated", "")
                        if text:
                            print(text)
                        if translated:
                            print(translated)
                        if copy_to_clipboard and text:
                            pyperclip.copy(text)
                    except Exception as e:
                        print(f"[ws client] bad message: {e}", file=sys.stderr)
            except Exception as e:
                print(f"[ws client] recv error: {e}", file=sys.stderr)

        async def send_task():
            try:
                while True:
                    data = stream.read(CHUNK, exception_on_overflow=False)
                    await ws.send(data)
            except Exception as e:
                print(f"[ws client] send error: {e}", file=sys.stderr)

        receiver = asyncio.create_task(recv_task())
        sender = asyncio.create_task(send_task())
        done, pending = await asyncio.wait({receiver, sender}, return_when=asyncio.FIRST_EXCEPTION)
        for task in pending:
            task.cancel()
    stream.stop_stream()
    stream.close()
    audio.terminate()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Real-time speech-to-text transcription program.")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--single", action="store_true", help="Capture a single speech input and exit (local mode).")
    modes.add_argument("--interactive", action="store_true", help="Local mic mode, continuously listening for speech.")
    modes.add_argument("--server", action="store_true", help="Run as WebSocket server only.")
    modes.add_argument("--client", action="store_true", help="Run as WebSocket client (mic -> server).")
    parser.add_argument("--ws-host", default=WS_HOST, help="WebSocket host (server/client)")
    parser.add_argument("--ws-port", type=int, default=WS_PORT, help="WebSocket port (server/client)")
    parser.add_argument("--output-file", type=str, help="Save the last transcription to a file (local single mode)")
    parser.add_argument("--copy", action="store_true", help="Copy transcribed text to clipboard")
    args = parser.parse_args()

    # Default: local interactive mode if nothing specified
    if not any([args.single, args.interactive, args.server, args.client]):
        args.interactive = True

    if args.server:
        asyncio.run(ws_server(args.ws_host, args.ws_port))
    elif args.client:
        asyncio.run(ws_client_stream_mic(args.ws_host, args.ws_port, copy_to_clipboard=args.copy))
    elif args.single:
        transcribe_audio(single_mode=True, output_file=args.output_file, copy_to_clipboard=args.copy)
    elif args.interactive:
        while True:
            if not transcribe_audio(interactive_mode=True, copy_to_clipboard=args.copy):
                break
            print("Press Enter to start listening again...", file=sys.stderr)
            input()