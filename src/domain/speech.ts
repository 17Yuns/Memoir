export type SpeechModel = "small" | "base";
export const MAX_RECORDING_SECONDS = 300;
export type SpeechLanguage = "auto" | "zh" | "en" | "ja" | "ko" | "fr" | "de" | "es";
export type SpeechModelStatus = { ready: boolean; model: string; bytes: number };
export type SpeechTranscript = { text: string; segments: { startMs: number; endMs: number; text: string }[] };
export type SpeechProgress = { requestId: string; stage: "downloading" | "transcribing"; progress: number };
export type SpeechTarget = { root: string; path: string; content: string; from: number };
