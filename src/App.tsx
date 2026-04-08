import { useEffect, useRef, useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { AudioService } from "./services/audio_service";
import "./App.css";

function formatSecondsToMmSs(totalSeconds: number): string {
  const minutes: number = Math.floor(totalSeconds / 60);
  const seconds: number = totalSeconds % 60;
  const formattedMinutes: string = String(minutes).padStart(2, "0");
  const formattedSeconds: string = String(seconds).padStart(2, "0");
  return `${formattedMinutes}:${formattedSeconds}`;
}

function formatTimestampSegment(value: number): string {
  return String(value).padStart(2, "0");
}

function buildAudioFileName(now: Date): string {
  const year: number = now.getFullYear();
  const month: string = formatTimestampSegment(now.getMonth() + 1);
  const day: string = formatTimestampSegment(now.getDate());
  const hours: string = formatTimestampSegment(now.getHours());
  const minutes: string = formatTimestampSegment(now.getMinutes());
  const seconds: string = formatTimestampSegment(now.getSeconds());
  return `recording_${year}${month}${day}_${hours}${minutes}${seconds}.webm`;
}

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [selectedDirectory, setSelectedDirectory] = useState("");
  const [savedFilePath, setSavedFilePath] = useState("");
  const [saveError, setSaveError] = useState("");
  const [opusSupportText, setOpusSupportText] = useState("Проверка поддержки...");
  const audioServiceRef = useRef<AudioService>(new AudioService());

  async function greet() {
    setGreetMsg(await invoke("greet", { name }));
    await writeTextFile("test.txt", "hello");
  }

  async function startRecording(): Promise<void> {
    await audioServiceRef.current.start();
    setRecordingSeconds(0);
    setIsRecording(true);
  }

  function pauseRecording(): void {
    audioServiceRef.current.pause();
    setIsRecording(false);
  }

  async function stopRecording(): Promise<void> {
    await audioServiceRef.current.stop();
    setIsRecording(false);
  }

  useEffect((): (() => void) | void => {
    if (!isRecording) {
      return;
    }
    const intervalId: number = window.setInterval((): void => {
      setRecordingSeconds((previousSeconds: number): number => previousSeconds + 1);
    }, 1000);
    return (): void => {
      window.clearInterval(intervalId);
    };
  }, [isRecording]);

  useEffect((): (() => void) => {
    return (): void => {
      audioServiceRef.current.stopWaveformLoop();
    };
  }, []);

  useEffect((): void => {
    const support = audioServiceRef.current.getPreferredAudioSupport();
    setOpusSupportText(`${support.mimeType}: ${support.isSupported ? "supported" : "not supported"}`);
  }, []);

  const formattedTimer: string = formatSecondsToMmSs(recordingSeconds);

  async function handleStartRecording(): Promise<void> {
    try {
      await startRecording();
    } catch (error: unknown) {
      console.error(error);
    }
  }

  function handlePauseRecording(): void {
    try {
      pauseRecording();
    } catch (error: unknown) {
      console.error(error);
    }
  }

  async function handleStopRecording(): Promise<void> {
    try {
      await stopRecording();
    } catch (error: unknown) {
      console.error(error);
    }
  }

  async function selectOutputDirectory(): Promise<void> {
    const directoryPath: string | null = await open({
      directory: true,
      multiple: false,
      title: "Выберите папку для сохранения записи",
    });
    if (directoryPath === null) {
      return;
    }
    setSelectedDirectory(directoryPath);
    setSaveError("");
  }

  async function saveRecordingToDisk(): Promise<void> {
    if (selectedDirectory.length === 0) {
      throw new Error("Невозможно сохранить запись: сначала выберите директорию.");
    }
    const audioBlob: Blob = audioServiceRef.current.getBlob();
    const audioBuffer: ArrayBuffer = await audioBlob.arrayBuffer();
    const audioBytes: Uint8Array<ArrayBuffer> = new Uint8Array(audioBuffer);
    const fileName: string = buildAudioFileName(new Date());
    const filePath: string = await join(selectedDirectory, fileName);
    await writeFile(filePath, audioBytes);
    setSavedFilePath(filePath);
    setSaveError("");
  }

  async function handleSaveRecording(): Promise<void> {
    try {
      await saveRecordingToDisk();
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : "Неизвестная ошибка сохранения записи.";
      setSaveError(errorMessage);
      console.error(error);
    }
  }

  return (
    <main className="container">
      <h1>Welcome to Tauri + React</h1>

      <div className="row">
        <a href="https://vite.dev" target="_blank">
          <img src="/vite.svg" className="logo vite" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank">
          <img src="/tauri.svg" className="logo tauri" alt="Tauri logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <p>Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit">Greet</button>
      </form>
      <p>{greetMsg}</p>
      <div className="row">
        <button type="button" onClick={handleStartRecording} disabled={isRecording}>Start</button>
        <button type="button" onClick={handlePauseRecording} disabled={!isRecording}>Pause</button>
        <button type="button" onClick={handleStopRecording}>Stop</button>
      </div>
      <p>Recording timer: {formattedTimer}</p>
      <div className="row">
        <button type="button" onClick={selectOutputDirectory}>Choose directory</button>
        <button type="button" onClick={handleSaveRecording}>Save recording</button>
      </div>
      <p>Selected directory: {selectedDirectory.length > 0 ? selectedDirectory : "not selected"}</p>
      <p>Saved file: {savedFilePath.length > 0 ? savedFilePath : "not saved"}</p>
      <p>Save error: {saveError.length > 0 ? saveError : "none"}</p>
      <p>MediaRecorder support: {opusSupportText}</p>
    </main>
  );
}

export default App;
