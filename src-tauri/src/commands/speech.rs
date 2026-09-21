use crate::domain::speech::speech_error;
use crate::domain::{
    speech::{SpeechModel, SpeechModelStatus, SpeechProgress, SpeechTranscript},
    AiSettings, AppError,
};
use crate::services::speech::SpeechService;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn speech_model_status(
    service: State<'_, SpeechService>,
    model: Option<SpeechModel>,
) -> SpeechModelStatus {
    service.status(model.unwrap_or_default())
}

#[tauri::command]
pub async fn install_speech_model(
    app: AppHandle,
    service: State<'_, SpeechService>,
    request_id: String,
    source: Option<String>,
    model: Option<SpeechModel>,
) -> Result<SpeechModelStatus, AppError> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.install_model(
            &request_id.clone(),
            source.map(PathBuf::from),
            model.unwrap_or_default(),
            move |progress| {
                let _ = app.emit(
                    "speech-progress",
                    SpeechProgress {
                        request_id: request_id.clone(),
                        stage: "downloading",
                        progress,
                    },
                );
            },
        )
    })
    .await
    .map_err(|_| speech_error("downloadError"))?
}

#[tauri::command]
pub async fn start_speech_recording(
    service: State<'_, SpeechService>,
    request_id: String,
    model: Option<SpeechModel>,
) -> Result<(), AppError> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.start(&request_id, model.unwrap_or_default())
    })
    .await
    .map_err(|_| speech_error("microphoneError"))?
}

#[tauri::command]
pub async fn stop_speech_recording(
    app: AppHandle,
    service: State<'_, SpeechService>,
    request_id: String,
    language: String,
) -> Result<SpeechTranscript, AppError> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.stop(&request_id.clone(), language, move |progress| {
            let _ = app.emit(
                "speech-progress",
                SpeechProgress {
                    request_id: request_id.clone(),
                    stage: "transcribing",
                    progress,
                },
            );
        })
    })
    .await
    .map_err(|_| speech_error("transcribeError"))?
}

#[tauri::command]
pub fn cancel_speech(service: State<'_, SpeechService>, request_id: String) {
    service.cancel(&request_id);
}

#[tauri::command]
pub async fn format_speech_transcript(
    settings: AiSettings,
    text: String,
) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::infrastructure::ai::ChatCompletionClient::new(&settings)?.format_transcript(&text)
    })
    .await
    .map_err(|_| speech_error("formatError"))?
}
