use crate::domain::speech::speech_error;
use crate::domain::{
    speech::{SpeechModel, SpeechTranscript, TranscriptSegment, SAMPLE_RATE},
    AppResult,
};
use std::{
    ffi::c_void,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

// whisper-rs 0.16's closure helpers leak their boxes, and its abort trampoline casts
// a boxed trait object to the original closure type. Keep callback data scoped to
// the synchronous full() call and give each trampoline its exact concrete type.
unsafe extern "C" fn abort_callback(data: *mut c_void) -> bool {
    // SAFETY: transcribe_with_context keeps the Arc alive until full() returns.
    unsafe { &*data.cast::<AtomicBool>() }.load(Ordering::Relaxed)
}

type ProgressCallback = Box<dyn Fn(u32) + Send>;

unsafe extern "C" fn progress_callback(
    _: *mut whisper_rs::WhisperSysContext,
    _: *mut whisper_rs::WhisperSysState,
    value: i32,
    data: *mut c_void,
) {
    // SAFETY: data points to the live ProgressCallback below; native progress
    // callbacks execute synchronously on the thread calling full().
    let progress = unsafe { &*data.cast::<ProgressCallback>() };
    // Never allow a Rust panic to unwind through C. Progress is best effort.
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        progress(value.clamp(0, 100) as u32);
    }));
}

pub fn validate_input(samples: &[f32], language: &str, cancelled: &AtomicBool) -> AppResult<()> {
    if !matches!(
        language,
        "auto" | "zh" | "en" | "ja" | "ko" | "fr" | "de" | "es"
    ) {
        return Err(speech_error("languageError"));
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(speech_error("cancelled"));
    }
    // Reject empty / near-silent recordings before inference to avoid silence hallucinations.
    if samples.len() < SAMPLE_RATE as usize / 4
        || samples
            .iter()
            .map(|sample| f64::from(*sample).powi(2))
            .sum::<f64>()
            / (samples.len().max(1) as f64)
            < 1e-8
    {
        return Err(speech_error("noSpeech"));
    }
    Ok(())
}

pub fn load_model(model: &Path) -> AppResult<WhisperContext> {
    static LOGGING: std::sync::Once = std::sync::Once::new();
    LOGGING.call_once(whisper_rs::install_logging_hooks);
    let mut context_params = WhisperContextParameters::default();
    context_params.use_gpu(cfg!(target_os = "macos"));
    // Keep the existing attention path: CPU benchmarks showed no Flash Attention gain.
    WhisperContext::new_with_params(model, context_params)
        .map_err(|_| speech_error("transcribeError"))
}

pub fn transcribe_with_context(
    context: &WhisperContext,
    samples: &[f32],
    language: &str,
    context_hint: &str,
    model: SpeechModel,
    cancelled: Arc<AtomicBool>,
    progress: impl Fn(u32) + Send + 'static,
) -> AppResult<SpeechTranscript> {
    validate_input(samples, language, &cancelled)?;
    let progress: ProgressCallback = Box::new(progress);
    let mut state = context
        .create_state()
        .map_err(|_| speech_error("transcribeError"))?;
    // Prompt tokens borrow our allocation; set_initial_prompt in whisper-rs 0.16
    // leaks its CString. Context is per request and never retained in the worker.
    let prompt = recognition_prompt(language, context_hint);
    let mut prompt_tokens = if !prompt.is_empty() {
        context
            .tokenize(&prompt, prompt.len() + 1)
            .map_err(|_| speech_error("transcribeError"))?
    } else {
        Vec::new()
    };
    // Whisper only keeps half of its text context as a prompt. Bound it explicitly
    // so lengthy notes cannot displace the language hint or inflate decoding work.
    prompt_tokens.truncate(192.min(context.n_text_ctx() as usize / 2));
    let mut params = FullParams::new(match model {
        SpeechModel::Small => SamplingStrategy::BeamSearch {
            beam_size: 3,
            patience: -1.0,
        },
        SpeechModel::Base => SamplingStrategy::Greedy { best_of: 1 },
    });
    if !prompt_tokens.is_empty() {
        params.set_tokens(&prompt_tokens);
    }
    params.set_n_threads(std::thread::available_parallelism().map_or(4, |n| n.get().min(8)) as i32);
    params.set_language(Some(language));
    params.set_translate(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_nst(true);
    // SAFETY: both allocations outlive full() and state. No callback accesses or
    // mutates the native context/state. The abort flag is safe on worker threads.
    unsafe {
        params.set_progress_callback(Some(progress_callback));
        params.set_progress_callback_user_data(
            (&progress as *const ProgressCallback).cast_mut().cast(),
        );
        params.set_abort_callback(Some(abort_callback));
        params.set_abort_callback_user_data(Arc::as_ptr(&cancelled).cast_mut().cast());
    }
    let result = state.full(params, samples);
    if cancelled.load(Ordering::Relaxed) {
        return Err(speech_error("cancelled"));
    }
    result.map_err(|_| speech_error("transcribeError"))?;
    let mut segments = Vec::new();
    for index in 0..state.full_n_segments() {
        let segment = state
            .get_segment(index)
            .ok_or_else(|| speech_error("transcribeError"))?;
        let text = segment
            .to_str_lossy()
            .map_err(|_| speech_error("transcribeError"))?
            .trim()
            .to_string();
        if !text.is_empty() {
            segments.push(TranscriptSegment {
                start_ms: segment.start_timestamp() * 10,
                end_ms: segment.end_timestamp() * 10,
                text,
            });
        }
    }
    let chinese = language == "zh"
        || (language == "auto"
            && Some(state.full_lang_id_from_state()) == whisper_rs::get_lang_id("zh"));
    assemble_transcript(segments, chinese)
}

fn assemble_transcript(
    mut segments: Vec<TranscriptSegment>,
    chinese: bool,
) -> AppResult<SpeechTranscript> {
    // Normalize before preview and optional cloud cleanup, including offline use.
    // Do not convert Japanese kanji or other languages that also use Han characters.
    if chinese {
        for segment in &mut segments {
            segment.text = simplet2s::convert(&segment.text);
        }
    }
    let text = segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        return Err(speech_error("noSpeech"));
    }
    Ok(SpeechTranscript { text, segments })
}

fn recognition_prompt(language: &str, context_hint: &str) -> String {
    // Also bound/sanitize at the native boundary, independently of the UI.
    let hint: String = context_hint
        .chars()
        .take(384)
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect();
    if language == "zh" {
        format!(
            "以下是简体中文的语音记录。{}",
            simplet2s::convert(hint.trim())
        )
    } else {
        hint.trim().to_string()
    }
}

#[cfg(test)]
fn transcribe(
    model: &Path,
    samples: &[f32],
    language: &str,
    cancelled: Arc<AtomicBool>,
    progress: impl Fn(u32) + Send + 'static,
) -> AppResult<SpeechTranscript> {
    validate_input(samples, language, &cancelled)?;
    let context = load_model(model)?;
    transcribe_with_context(
        &context,
        samples,
        language,
        "",
        SpeechModel::Small,
        cancelled,
        progress,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts_bound_native_input_and_preserve_language_choice() {
        assert_eq!(recognition_prompt("auto", ""), "");
        assert_eq!(
            recognition_prompt("en", "Rust\0API\nKubernetes"),
            "Rust API Kubernetes"
        );
        assert_eq!(recognition_prompt("ja", "図書館"), "図書館");
        assert!(
            recognition_prompt("zh", "字節跳動，推理基礎設施").ends_with("字节跳动，推理基础设施")
        );
        let long = recognition_prompt("auto", &"𠮷".repeat(1000));
        assert_eq!(long.chars().count(), 384);
    }

    #[test]
    fn chinese_transcript_and_segments_use_simplified_characters() {
        let result = assemble_transcript(
            vec![
                TranscriptSegment {
                    start_ms: 10,
                    end_ms: 200,
                    text: "字節挑動，軟體開發。".into(),
                },
                TranscriptSegment {
                    start_ms: 210,
                    end_ms: 500,
                    text: "Rust API 2026，乾隆與乾燥。".into(),
                },
            ],
            true,
        )
        .unwrap();
        // Script conversion must not guess a homophone correction.
        assert_eq!(
            result.text,
            "字节挑动，软体开发。\nRust API 2026，乾隆与干燥。"
        );
        assert_eq!(result.segments[0].text, "字节挑动，软体开发。");
        assert_eq!(
            (result.segments[0].start_ms, result.segments[0].end_ms),
            (10, 200)
        );
        assert_eq!(
            (result.segments[1].start_ms, result.segments[1].end_ms),
            (210, 500)
        );
    }

    #[test]
    fn other_languages_keep_their_original_characters() {
        let original = "図書館で勉強する。中文學習 / English 123";
        let result = assemble_transcript(
            vec![TranscriptSegment {
                start_ms: 0,
                end_ms: 100,
                text: original.into(),
            }],
            false,
        )
        .unwrap();
        assert_eq!(result.text, original);
        assert_eq!(result.segments[0].text, original);
    }

    #[test]
    fn empty_transcript_is_still_rejected() {
        assert_eq!(
            assemble_transcript(Vec::new(), true).unwrap_err().message,
            "speech.noSpeech"
        );
    }
    #[test]
    fn abort_callback_reads_the_live_cancellation_flag() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let data = Arc::as_ptr(&cancelled).cast_mut().cast();
        // SAFETY: this is the same owned allocation passed to full().
        assert!(!unsafe { abort_callback(data) });
        cancelled.store(true, Ordering::Relaxed);
        assert!(unsafe { abort_callback(data) });
    }

    #[test]
    fn progress_callback_clamps_values_and_releases_captured_data() {
        let values = Arc::new(std::sync::Mutex::new(Vec::new()));
        {
            let captured = values.clone();
            let callback: ProgressCallback =
                Box::new(move |value| captured.lock().unwrap().push(value));
            let data = (&callback as *const ProgressCallback).cast_mut().cast();
            // SAFETY: callbacks run synchronously while callback is still alive.
            unsafe {
                progress_callback(std::ptr::null_mut(), std::ptr::null_mut(), -1, data);
                progress_callback(std::ptr::null_mut(), std::ptr::null_mut(), 125, data);
            }
        }
        assert_eq!(*values.lock().unwrap(), vec![0, 100]);
        assert_eq!(Arc::strong_count(&values), 1);
    }

    #[test]
    fn silence_does_not_load_model_or_produce_text() {
        let error = transcribe(
            Path::new("missing.bin"),
            &vec![0.0; 16000],
            "zh",
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .unwrap_err();
        assert_eq!(error.message, "speech.noSpeech");
    }
}

// Explicit smoke test; requires locally downloaded official fixtures, never network in unit tests.
#[cfg(test)]
mod smoke {
    use super::*;
    fn fixture() -> (std::path::PathBuf, Vec<f32>) {
        let model = std::env::var("MEMOIR_WHISPER_MODEL").expect("model fixture path");
        let bytes =
            std::fs::read(std::env::var("MEMOIR_WHISPER_SAMPLE").expect("WAV fixture path"))
                .unwrap();
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        let mut offset = 12;
        let mut samples = Vec::new();
        while offset + 8 <= bytes.len() {
            let size =
                u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
            let chunk = &bytes[offset + 8..offset + 8 + size];
            if &bytes[offset..offset + 4] == b"fmt " {
                assert_eq!(u16::from_le_bytes(chunk[0..2].try_into().unwrap()), 1);
                assert_eq!(u16::from_le_bytes(chunk[2..4].try_into().unwrap()), 1);
                assert_eq!(u32::from_le_bytes(chunk[4..8].try_into().unwrap()), 16000);
                assert_eq!(u16::from_le_bytes(chunk[14..16].try_into().unwrap()), 16);
            }
            if &bytes[offset..offset + 4] == b"data" {
                samples = chunk
                    .chunks_exact(2)
                    .map(|sample| {
                        f32::from(i16::from_le_bytes(sample.try_into().unwrap())) / 32768.0
                    })
                    .collect();
            }
            offset += 8 + size + size % 2;
        }
        (model.into(), samples)
    }

    #[test]
    #[ignore = "set MEMOIR_WHISPER_MODEL and MEMOIR_WHISPER_SAMPLE to official model/jfk.wav paths"]
    fn transcribes_official_audio_sample() {
        let (model, samples) = fixture();
        let worker =
            crate::infrastructure::speech_worker::SpeechWorker::new(model, SpeechModel::Small);
        worker.prepare("smoke", Arc::new(AtomicBool::new(false)));
        let progress_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let progress = progress_count.clone();
        let result = worker
            .transcribe(
                samples.clone(),
                "en".into(),
                String::new(),
                Arc::new(AtomicBool::new(false)),
                move |_| {
                    progress.fetch_add(1, Ordering::Relaxed);
                },
            )
            .unwrap();
        assert!(progress_count.load(Ordering::Relaxed) > 0);
        assert_eq!(Arc::strong_count(&progress_count), 1);
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancel_during_inference = cancelled.clone();
        let error = worker
            .transcribe(
                samples.clone(),
                "en".into(),
                String::new(),
                cancelled,
                move |_| {
                    cancel_during_inference.store(true, Ordering::Relaxed);
                },
            )
            .unwrap_err();
        assert_eq!(error.message, "speech.cancelled");
        let repeated = worker
            .transcribe(
                samples,
                "en".into(),
                String::new(),
                Arc::new(AtomicBool::new(false)),
                |_| {},
            )
            .unwrap();
        assert_eq!(result.text, repeated.text);
        worker.release("smoke");
        assert!(
            result.text.to_lowercase().contains("ask not"),
            "{}",
            result.text
        );
        assert!(
            result.text.to_lowercase().contains("country"),
            "{}",
            result.text
        );
        assert!(!result.segments.is_empty());
        assert!(result
            .segments
            .iter()
            .all(|segment| segment.start_ms <= segment.end_ms));
        println!("{}", result.text);
    }

    #[test]
    #[ignore = "local performance comparison; requires MEMOIR_WHISPER_MODEL and MEMOIR_WHISPER_SAMPLE"]
    fn benchmarks_local_transcription() {
        let (model, samples) = fixture();
        println!(
            "audio_seconds={:.2}",
            samples.len() as f64 / f64::from(SAMPLE_RATE)
        );
        for run in 0..3 {
            for flash in if run % 2 == 0 {
                [false, true]
            } else {
                [true, false]
            } {
                let mut params = WhisperContextParameters::default();
                params.use_gpu(cfg!(target_os = "macos"));
                params.flash_attn(flash);
                let started = std::time::Instant::now();
                let context = WhisperContext::new_with_params(&model, params).unwrap();
                let load_ms = started.elapsed().as_secs_f64() * 1000.0;
                for cached in [false, true] {
                    let started = std::time::Instant::now();
                    let result = transcribe_with_context(
                        &context,
                        &samples,
                        "en",
                        "",
                        SpeechModel::Small,
                        Arc::new(AtomicBool::new(false)),
                        |_| {},
                    )
                    .unwrap();
                    assert!(result.text.to_lowercase().contains("ask not"));
                    assert!(result.text.to_lowercase().contains("country"));
                    println!("run={run} flash={flash} cached={cached} load_ms={load_ms:.1} inference_ms={:.1}", started.elapsed().as_secs_f64() * 1000.0);
                }
            }
        }
    }
}
