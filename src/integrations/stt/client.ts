/*
  Simple client-side microphone streamer to a Vosk STT server over WebSocket.
  - Captures mic via Web Audio API
  - Downsamples to 16k mono
  - Encodes to PCM16LE
  - Streams binary frames over WebSocket
*/

export type STTEvent = {
  type: 'ready' | 'partial' | 'result' | 'final';
  text?: string;
  partial?: string;
  result?: unknown;
  sampleRate?: number;
  format?: string;
};

export class STTStreamer {
  private wsUrl: string;
  private audioCtx?: AudioContext;
  private mediaStream?: MediaStream;
  private sourceNode?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode; // Using ScriptProcessor for broad compatibility
  private socket?: WebSocket;
  private running = false;
  private desiredSampleRate = 16000;

  // Callbacks
  onPartial?: (text: string) => void;
  onResult?: (text: string) => void;
  onFinal?: (text: string) => void;
  onReady?: (info: STTEvent) => void;
  onError?: (err: Error) => void;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Prepare audio
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }, video: false });

    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Prefer 16k output; we will resample if needed
    this.desiredSampleRate = 16000;

    this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);

    // Buffer size: 2048 gives ~46ms @ 44.1k; small enough for low latency
    const bufferSize = 2048;
    this.processor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);

    this.processor.onaudioprocess = (event) => {
      if (!this.running || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);

      // Resample to 16k
      const resampled = this.downsampleBuffer(input, this.audioCtx!.sampleRate, this.desiredSampleRate);
      // Convert to PCM16LE
      const pcm16 = this.floatTo16BitPCM(resampled);
      this.socket.send(pcm16);
    };

    this.sourceNode.connect(this.processor);
    this.processor.connect(this.audioCtx.destination); // keep processor alive

    // Open WebSocket
    await this.openSocket();

    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;

    try {
      if (this.processor) {
        this.processor.disconnect();
      }
      if (this.sourceNode) {
        this.sourceNode.disconnect();
      }
      if (this.audioCtx && this.audioCtx.state !== 'closed') {
        await this.audioCtx.close();
      }
    } catch {}

    try {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        // Graceful close; server will flush final
        this.socket.close(1000, 'stop');
      }
    } catch {}

    try {
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(t => t.stop());
      }
    } catch {}
  }

  private async openSocket(): Promise<void> {
    this.socket = new WebSocket(this.wsUrl);
    this.socket.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (e: Event) => {
        cleanup();
        reject(new Error('WebSocket error'));
      };
      const cleanup = () => {
        this.socket?.removeEventListener('open', onOpen);
        this.socket?.removeEventListener('error', onError);
      };
      this.socket!.addEventListener('open', onOpen);
      this.socket!.addEventListener('error', onError);
    });

    this.socket.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const msg: STTEvent = JSON.parse(ev.data);
          if (msg.type === 'ready') {
            if (msg.sampleRate && msg.sampleRate !== this.desiredSampleRate) {
              // The server expects 16k by default; keep client at 16k
              this.desiredSampleRate = msg.sampleRate;
            }
            this.onReady?.(msg);
          } else if (msg.type === 'partial') {
            if (msg.partial) this.onPartial?.(msg.partial);
          } else if (msg.type === 'result') {
            if (msg.text) this.onResult?.(msg.text);
          } else if (msg.type === 'final') {
            if (msg.text) this.onFinal?.(msg.text);
          }
        } catch (e) {
          // ignore malformed
        }
      }
    });

    this.socket.addEventListener('close', () => {
      // no-op; final is sent before close
    });

    this.socket.addEventListener('error', () => {
      this.onError?.(new Error('WebSocket error'));
    });
  }

  private downsampleBuffer(buffer: Float32Array, inSampleRate: number, outSampleRate: number): Int16Array {
    if (outSampleRate === inSampleRate) {
      // Direct convert float->int16
      return this.floatTo16BitPCM(buffer);
    }
    const ratio = inSampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      // Simple average for anti-aliasing
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = accum / (count || 1);
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return this.floatTo16BitPCM(result);
  }

  private floatTo16BitPCM(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
  }
}
