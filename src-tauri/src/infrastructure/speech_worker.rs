use super::speech_recognition;
use crate::domain::{
    speech::{speech_error, SpeechTranscript},
    AppResult,
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};

const IDLE_TIMEOUT: Duration = Duration::from_secs(120);

struct Inference {
    samples: Vec<f32>,
    language: String,
    cancelled: Arc<AtomicBool>,
    progress: Box<dyn Fn(u32) + Send>,
}

enum Command {
    Prepare {
        id: String,
        cancelled: Arc<AtomicBool>,
    },
    Transcribe(Inference, mpsc::SyncSender<AppResult<SpeechTranscript>>),
    Release(String),
    Invalidate,
}

/// A single worker owns the model. Loading never blocks microphone startup or cancellation.
/// Only model weights are cached; each inference creates fresh state so no previous text remains.
pub struct SpeechWorker {
    model: PathBuf,
    sender: Mutex<Option<mpsc::Sender<Command>>>,
}

impl SpeechWorker {
    pub fn new(model: PathBuf) -> Self {
        Self {
            model,
            sender: Mutex::new(None),
        }
    }

    fn send(&self, mut command: Command) -> AppResult<()> {
        let mut sender = self
            .sender
            .lock()
            .map_err(|_| speech_error("transcribeError"))?;
        // Restart on the next request if a previous worker exited unexpectedly.
        for _ in 0..2 {
            if sender.is_none() {
                let (tx, rx) = mpsc::channel();
                let model = self.model.clone();
                std::thread::Builder::new()
                    .name("memoir-speech-model".into())
                    .spawn(move || {
                        run_worker(
                            rx,
                            IDLE_TIMEOUT,
                            || speech_recognition::load_model(&model),
                            |context, request| {
                                speech_recognition::transcribe_with_context(
                                    context,
                                    &request.samples,
                                    &request.language,
                                    request.cancelled,
                                    request.progress,
                                )
                            },
                        );
                    })
                    .map_err(|_| speech_error("transcribeError"))?;
                *sender = Some(tx);
            }
            match sender.as_ref().unwrap().send(command) {
                Ok(()) => return Ok(()),
                Err(error) => {
                    command = error.0;
                    *sender = None;
                }
            }
        }
        Err(speech_error("transcribeError"))
    }

    pub fn prepare(&self, id: &str, cancelled: Arc<AtomicBool>) {
        // Optional preloading: stop() retries loading if preparation failed.
        let _ = self.send(Command::Prepare {
            id: id.into(),
            cancelled,
        });
    }

    pub fn release(&self, id: &str) {
        let _ = self.send(Command::Release(id.into()));
    }

    pub fn invalidate(&self) {
        let _ = self.send(Command::Invalidate);
    }

    pub fn transcribe(
        &self,
        samples: Vec<f32>,
        language: String,
        cancelled: Arc<AtomicBool>,
        progress: impl Fn(u32) + Send + 'static,
    ) -> AppResult<SpeechTranscript> {
        speech_recognition::validate_input(&samples, &language, &cancelled)?;
        let (tx, rx) = mpsc::sync_channel(1);
        self.send(Command::Transcribe(
            Inference {
                samples,
                language,
                cancelled,
                progress: Box::new(progress),
            },
            tx,
        ))?;
        rx.recv().map_err(|_| speech_error("transcribeError"))?
    }
}

fn run_worker<T>(
    receiver: mpsc::Receiver<Command>,
    idle_timeout: Duration,
    mut load: impl FnMut() -> AppResult<T>,
    mut infer: impl FnMut(&T, Inference) -> AppResult<SpeechTranscript>,
) {
    let mut model = None;
    let mut active = None;
    loop {
        // A recording pins the model, including recordings longer than the idle timeout.
        let command = if active.is_some() || model.is_none() {
            receiver
                .recv()
                .map_err(|_| mpsc::RecvTimeoutError::Disconnected)
        } else {
            receiver.recv_timeout(idle_timeout)
        };
        match command {
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                model = None;
            }
            Ok(Command::Prepare { id, cancelled }) => {
                if cancelled.load(Ordering::Relaxed) {
                    continue;
                }
                active = Some(id);
                if model.is_none() {
                    model = load().ok();
                }
                if cancelled.load(Ordering::Relaxed) {
                    active = None;
                }
            }
            Ok(Command::Transcribe(request, reply)) => {
                let result = (|| {
                    if request.cancelled.load(Ordering::Relaxed) {
                        return Err(speech_error("cancelled"));
                    }
                    if model.is_none() {
                        model = Some(load()?);
                    }
                    if request.cancelled.load(Ordering::Relaxed) {
                        return Err(speech_error("cancelled"));
                    }
                    infer(model.as_ref().unwrap(), request)
                })();
                let _ = reply.send(result);
            }
            Ok(Command::Release(id)) => {
                if active.as_ref() == Some(&id) {
                    active = None;
                }
            }
            Ok(Command::Invalidate) => {
                model = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    const TEST_IDLE: Duration = Duration::from_millis(30);
    const DEADLINE: Duration = Duration::from_secs(3);

    struct Model {
        number: usize,
        dropped: mpsc::Sender<usize>,
    }
    impl Drop for Model {
        fn drop(&mut self) {
            let _ = self.dropped.send(self.number);
        }
    }

    fn fixture() -> (
        mpsc::Sender<Command>,
        mpsc::Receiver<usize>,
        std::thread::JoinHandle<()>,
    ) {
        let (tx, rx) = mpsc::channel();
        let (dropped, drops) = mpsc::channel();
        let handle = std::thread::spawn(move || {
            let mut loads = 0;
            run_worker(
                rx,
                TEST_IDLE,
                || {
                    loads += 1;
                    Ok(Model {
                        number: loads,
                        dropped: dropped.clone(),
                    })
                },
                |model, _| {
                    Ok(SpeechTranscript {
                        text: model.number.to_string(),
                        segments: vec![],
                    })
                },
            );
        });
        (tx, drops, handle)
    }

    fn prepare(tx: &mpsc::Sender<Command>, id: &str) {
        tx.send(Command::Prepare {
            id: id.into(),
            cancelled: Arc::new(AtomicBool::new(false)),
        })
        .unwrap();
    }

    fn request(
        tx: &mpsc::Sender<Command>,
        cancelled: Arc<AtomicBool>,
    ) -> mpsc::Receiver<AppResult<SpeechTranscript>> {
        let (reply, result) = mpsc::sync_channel(1);
        tx.send(Command::Transcribe(
            Inference {
                samples: vec![0.1; 16000],
                language: "en".into(),
                cancelled,
                progress: Box::new(|_| {}),
            },
            reply,
        ))
        .unwrap();
        result
    }

    fn transcribe(tx: &mpsc::Sender<Command>) -> String {
        request(tx, Arc::new(AtomicBool::new(false)))
            .recv_timeout(DEADLINE)
            .unwrap()
            .unwrap()
            .text
    }

    #[test]
    fn preload_and_repeated_recordings_share_weights_until_idle() {
        let (tx, drops, handle) = fixture();
        prepare(&tx, "first");
        assert_eq!(transcribe(&tx), "1");
        // Even a recording longer than the timeout must keep its model ready.
        assert!(matches!(
            drops.recv_timeout(TEST_IDLE * 3),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        tx.send(Command::Release("first".into())).unwrap();
        prepare(&tx, "second");
        assert_eq!(transcribe(&tx), "1");
        // A delayed release from an earlier recording cannot unpin this recording.
        tx.send(Command::Release("first".into())).unwrap();
        assert!(matches!(
            drops.recv_timeout(TEST_IDLE * 3),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        tx.send(Command::Release("second".into())).unwrap();
        assert_eq!(drops.recv_timeout(DEADLINE).unwrap(), 1);
        assert_eq!(transcribe(&tx), "2");
        drop(tx);
        handle.join().unwrap();
        assert_eq!(drops.recv_timeout(DEADLINE).unwrap(), 2);
    }

    #[test]
    fn reinstall_invalidates_cached_weights() {
        let (tx, drops, handle) = fixture();
        prepare(&tx, "first");
        assert_eq!(transcribe(&tx), "1");
        tx.send(Command::Release("first".into())).unwrap();
        tx.send(Command::Invalidate).unwrap();
        assert_eq!(drops.recv_timeout(DEADLINE).unwrap(), 1);
        assert_eq!(transcribe(&tx), "2");
        drop(tx);
        handle.join().unwrap();
    }

    #[test]
    fn cancellation_during_loading_skips_inference_and_releases_weights() {
        let (tx, rx) = mpsc::channel();
        let (loading, started) = mpsc::sync_channel(1);
        let (resume, wait) = mpsc::sync_channel(1);
        let (dropped, drops) = mpsc::channel();
        let calls = Arc::new(AtomicUsize::new(0));
        let inferred = calls.clone();
        let handle = std::thread::spawn(move || {
            run_worker(
                rx,
                TEST_IDLE,
                || {
                    loading.send(()).unwrap();
                    wait.recv_timeout(DEADLINE).unwrap();
                    Ok(Model {
                        number: 1,
                        dropped: dropped.clone(),
                    })
                },
                move |_, _| {
                    inferred.fetch_add(1, Ordering::Relaxed);
                    Ok(SpeechTranscript {
                        text: "unexpected".into(),
                        segments: vec![],
                    })
                },
            )
        });
        let cancelled = Arc::new(AtomicBool::new(false));
        let result = request(&tx, cancelled.clone());
        started.recv_timeout(DEADLINE).unwrap();
        cancelled.store(true, Ordering::Relaxed);
        resume.send(()).unwrap();
        assert_eq!(
            result.recv_timeout(DEADLINE).unwrap().unwrap_err().message,
            "speech.cancelled"
        );
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        assert_eq!(drops.recv_timeout(DEADLINE).unwrap(), 1);
        drop(tx);
        handle.join().unwrap();
    }

    #[test]
    fn failed_preload_is_retried_when_transcription_is_requested() {
        let (tx, rx) = mpsc::channel();
        let handle = std::thread::spawn(move || {
            let mut attempts = 0;
            run_worker(
                rx,
                TEST_IDLE,
                || {
                    attempts += 1;
                    if attempts == 1 {
                        Err(speech_error("transcribeError"))
                    } else {
                        Ok(())
                    }
                },
                |_, _| {
                    Ok(SpeechTranscript {
                        text: "recovered".into(),
                        segments: vec![],
                    })
                },
            );
        });
        prepare(&tx, "first");
        assert_eq!(transcribe(&tx), "recovered");
        drop(tx);
        handle.join().unwrap();
    }
}
