type RecorderState = "inactive" | "paused" | "recording";
type WaveformListener = (waveform: Uint8Array<ArrayBuffer>) => void;
const ANALYSER_FFT_SIZE = 2048;
const PREFERRED_AUDIO_MIME_TYPE = "audio/webm;codecs=opus";

type MediaTypeSupport = {
  mimeType: string;
  isSupported: boolean;
};

class AudioService {
  private audioContext: AudioContext | null;
  private mediaRecorder: MediaRecorder | null;
  private mediaStream: MediaStream | null;
  private sourceNode: MediaStreamAudioSourceNode | null;
  private destinationNode: MediaStreamAudioDestinationNode | null;
  private analyserNode: AnalyserNode | null;
  private waveformBuffer: Uint8Array<ArrayBuffer> | null;
  private waveformAnimationFrameId: number | null;
  private waveformListener: WaveformListener | null;
  private chunks: BlobPart[];
  private recordedMimeType: string;

  public constructor() {
    this.audioContext = null;
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.destinationNode = null;
    this.analyserNode = null;
    this.waveformBuffer = null;
    this.waveformAnimationFrameId = null;
    this.waveformListener = null;
    this.chunks = [];
    this.recordedMimeType = "";
  }

  public async start(): Promise<void> {
    if (this.mediaRecorder !== null && this.mediaRecorder.state !== "inactive") {
      throw new Error("Невозможно начать запись: запись уже запущена.");
    }
    this.chunks = [];
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.audioContext = new AudioContext();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.destinationNode = this.audioContext.createMediaStreamDestination();
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = ANALYSER_FFT_SIZE;
    this.waveformBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.sourceNode.connect(this.destinationNode);
    this.sourceNode.connect(this.analyserNode);
    const recorderOptions: MediaRecorderOptions = this.buildRecorderOptions();
    this.mediaRecorder = new MediaRecorder(this.destinationNode.stream, recorderOptions);
    this.recordedMimeType = this.mediaRecorder.mimeType;
    this.mediaRecorder.addEventListener("dataavailable", (event: BlobEvent): void => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });
    this.mediaRecorder.start();
  }

  public pause(): void {
    if (this.mediaRecorder === null) {
      throw new Error("Невозможно поставить запись на паузу: запись не инициализирована.");
    }
    if (this.mediaRecorder.state !== "recording") {
      throw new Error(`Невозможно поставить запись на паузу: текущее состояние ${this.getRecorderState()}.`);
    }
    this.mediaRecorder.pause();
  }

  public async stop(): Promise<void> {
    if (this.mediaRecorder === null) {
      throw new Error("Невозможно остановить запись: запись не инициализирована.");
    }
    if (this.mediaRecorder.state === "inactive") {
      throw new Error("Невозможно остановить запись: запись уже остановлена.");
    }
    const recorder: MediaRecorder = this.mediaRecorder;
    const stopPromise: Promise<void> = new Promise<void>((resolve: () => void, reject: (reason: Error) => void): void => {
      recorder.addEventListener("stop", (): void => resolve(), { once: true });
      recorder.addEventListener("error", (): void => reject(new Error("Ошибка MediaRecorder во время остановки записи.")), {
        once: true,
      });
    });
    recorder.stop();
    await stopPromise;
    this.stopWaveformLoop();
    this.cleanupRecorderResources();
  }

  public getBlob(): Blob {
    if (this.chunks.length === 0) {
      throw new Error("Невозможно получить Blob: аудиоданные отсутствуют.");
    }
    return new Blob(this.chunks, { type: this.recordedMimeType });
  }

  public getPreferredAudioSupport(): MediaTypeSupport {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
      return {
        mimeType: PREFERRED_AUDIO_MIME_TYPE,
        isSupported: false,
      };
    }
    return {
      mimeType: PREFERRED_AUDIO_MIME_TYPE,
      isSupported: MediaRecorder.isTypeSupported(PREFERRED_AUDIO_MIME_TYPE),
    };
  }

  public startWaveformLoop(listener: WaveformListener): void {
    if (this.analyserNode === null || this.waveformBuffer === null) {
      throw new Error("Невозможно запустить waveform loop: AnalyserNode не инициализирован.");
    }
    this.stopWaveformLoop();
    this.waveformListener = listener;
    this.waveformAnimationFrameId = requestAnimationFrame((): void => this.tickWaveformLoop());
  }

  public stopWaveformLoop(): void {
    if (this.waveformAnimationFrameId !== null) {
      cancelAnimationFrame(this.waveformAnimationFrameId);
    }
    this.waveformAnimationFrameId = null;
    this.waveformListener = null;
  }

  public getWaveform(): Uint8Array<ArrayBuffer> {
    if (this.waveformBuffer === null) {
      throw new Error("Невозможно получить waveform: буфер не инициализирован.");
    }
    return new Uint8Array(this.waveformBuffer.buffer.slice(0));
  }

  private getRecorderState(): RecorderState {
    if (this.mediaRecorder === null) {
      return "inactive";
    }
    return this.mediaRecorder.state;
  }

  private buildRecorderOptions(): MediaRecorderOptions {
    const preferredSupport: MediaTypeSupport = this.getPreferredAudioSupport();
    if (preferredSupport.isSupported) {
      return { mimeType: preferredSupport.mimeType };
    }
    return {};
  }

  private cleanupRecorderResources(): void {
    this.stopWaveformLoop();
    if (this.sourceNode !== null) {
      this.sourceNode.disconnect();
    }
    if (this.destinationNode !== null) {
      this.destinationNode.disconnect();
    }
    if (this.analyserNode !== null) {
      this.analyserNode.disconnect();
    }
    if (this.mediaStream !== null) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
    }
    if (this.audioContext !== null) {
      void this.audioContext.close();
    }
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.destinationNode = null;
    this.analyserNode = null;
    this.waveformBuffer = null;
    this.audioContext = null;
  }

  private tickWaveformLoop(): void {
    if (this.analyserNode === null || this.waveformBuffer === null) {
      throw new Error("Waveform loop остановлен: AnalyserNode не инициализирован.");
    }
    if (this.waveformListener === null) {
      return;
    }
    this.analyserNode.getByteTimeDomainData(this.waveformBuffer);
    this.waveformListener(new Uint8Array(this.waveformBuffer.buffer.slice(0)));
    this.waveformAnimationFrameId = requestAnimationFrame((): void => this.tickWaveformLoop());
  }
}

export { AudioService };
