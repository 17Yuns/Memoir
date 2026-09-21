use super::{AppError, ErrorCode};
use serde::{Deserialize, Serialize};

pub const MAX_RECORDING_SECONDS: u64 = 300;
pub const SAMPLE_RATE: u32 = 16_000;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpeechModel {
    #[default]
    Small,
    Base,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelStatus {
    pub ready: bool,
    pub model: &'static str,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTranscript {
    pub text: String,
    pub segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechProgress {
    pub request_id: String,
    pub stage: &'static str,
    pub progress: u32,
}

pub fn speech_error(key: &str) -> AppError {
    AppError::new(ErrorCode::Io, format!("speech.{key}"))
}
