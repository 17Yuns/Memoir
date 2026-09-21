use crate::domain::{
    speech::{speech_error, SpeechModel, SpeechModelStatus, SpeechTranscript},
    AppResult,
};
use crate::infrastructure::{
    audio_capture::{self, RecordedAudio},
    speech_model,
    speech_worker::SpeechWorker,
};
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
};

struct Job {
    id: String,
    model: SpeechModel,
    cancelled: Arc<AtomicBool>,
    stop: Mutex<Option<mpsc::Sender<()>>>,
    audio: Mutex<Option<mpsc::Receiver<AppResult<RecordedAudio>>>>,
}

#[derive(Clone)]
pub struct SpeechService {
    directory: PathBuf,
    recognizers: [Arc<SpeechWorker>; 2],
    current: Arc<Mutex<Option<Arc<Job>>>>,
    cancelled_ids: Arc<Mutex<VecDeque<String>>>,
}

struct JobGuard {
    service: SpeechService,
    id: String,
}
impl Drop for JobGuard {
    fn drop(&mut self) {
        self.service.release(&self.id);
    }
}

impl SpeechService {
    pub fn new(app_data: PathBuf) -> Self {
        let recognizers = [SpeechModel::Small, SpeechModel::Base].map(|model| {
            Arc::new(SpeechWorker::new(
                app_data
                    .join("speech-models")
                    .join(speech_model::spec(model).file),
            ))
        });
        Self {
            recognizers,
            directory: app_data.join("speech-models"),
            current: Arc::new(Mutex::new(None)),
            cancelled_ids: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    fn recognizer(&self, model: SpeechModel) -> &SpeechWorker {
        &self.recognizers[model as usize]
    }

    pub fn status(&self, model: SpeechModel) -> SpeechModelStatus {
        speech_model::status(&self.directory, model)
    }

    fn reserve(&self, id: &str, model: SpeechModel) -> AppResult<Arc<Job>> {
        if id.is_empty() || id.len() > 128 {
            return Err(speech_error("busy"));
        }
        let mut current = self.current.lock().map_err(|_| speech_error("busy"))?;
        if self
            .cancelled_ids
            .lock()
            .map_err(|_| speech_error("busy"))?
            .iter()
            .any(|cancelled| cancelled == id)
        {
            return Err(speech_error("cancelled"));
        }
        if current.is_some() {
            return Err(speech_error("busy"));
        }
        let job = Arc::new(Job {
            id: id.to_string(),
            model,
            cancelled: Arc::new(AtomicBool::new(false)),
            stop: Mutex::new(None),
            audio: Mutex::new(None),
        });
        *current = Some(job.clone());
        Ok(job)
    }

    fn release(&self, id: &str) {
        if let Ok(mut current) = self.current.lock() {
            if current.as_ref().is_some_and(|job| job.id == id) {
                self.recognizer(current.as_ref().unwrap().model).release(id);
                *current = None;
            }
        }
    }

    pub fn install_model(
        &self,
        id: &str,
        source: Option<PathBuf>,
        model: SpeechModel,
        report: impl Fn(u32),
    ) -> AppResult<SpeechModelStatus> {
        let job = self.reserve(id, model)?;
        let _guard = JobGuard {
            service: self.clone(),
            id: id.into(),
        };
        if let Some(source) = source {
            speech_model::import(&self.directory, &source, model, &job.cancelled, report)?;
        } else {
            speech_model::download(&self.directory, model, &job.cancelled, report)?;
        }
        self.recognizer(model).invalidate();
        Ok(self.status(model))
    }

    pub fn start(&self, id: &str, model: SpeechModel) -> AppResult<()> {
        if !self.status(model).ready {
            return Err(speech_error("modelMissing"));
        }
        let job = self.reserve(id, model)?;
        self.recognizer(model).prepare(id, job.cancelled.clone());
        let (stop_tx, stop_rx) = mpsc::channel();
        let (audio_tx, audio_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        *job.stop.lock().map_err(|_| speech_error("busy"))? = Some(stop_tx);
        *job.audio.lock().map_err(|_| speech_error("busy"))? = Some(audio_rx);
        let worker = job.clone();
        let service = self.clone();
        if std::thread::Builder::new()
            .name("memoir-microphone".into())
            .spawn(move || {
                let audio = audio_capture::record(stop_rx, worker.cancelled.clone(), ready_tx);
                let _ = audio_tx.send(audio);
                if worker.cancelled.load(Ordering::Relaxed)
                    && worker.audio.lock().is_ok_and(|audio| audio.is_some())
                {
                    service.release(&worker.id);
                }
            })
            .is_err()
        {
            self.release(id);
            return Err(speech_error("microphoneError"));
        }
        let result = ready_rx
            .recv()
            .unwrap_or_else(|_| Err(speech_error("microphoneError")));
        if result.is_err() {
            self.release(id);
        }
        result
    }

    pub fn stop(
        &self,
        id: &str,
        language: String,
        report: impl Fn(u32) + Send + 'static,
    ) -> AppResult<SpeechTranscript> {
        let job = self
            .current
            .lock()
            .map_err(|_| speech_error("busy"))?
            .as_ref()
            .filter(|job| job.id == id)
            .cloned()
            .ok_or_else(|| speech_error("cancelled"))?;
        let audio_rx = job
            .audio
            .lock()
            .map_err(|_| speech_error("busy"))?
            .take()
            .ok_or_else(|| speech_error("busy"))?;
        let _guard = JobGuard {
            service: self.clone(),
            id: id.into(),
        };
        if let Some(stop) = job.stop.lock().map_err(|_| speech_error("busy"))?.take() {
            let _ = stop.send(());
        }
        let audio = audio_rx
            .recv()
            .map_err(|_| speech_error("microphoneError"))??;
        let samples = audio_capture::resample(audio, &job.cancelled)?;
        self.recognizer(job.model)
            .transcribe(samples, language, job.cancelled.clone(), report)
    }

    pub fn cancel(&self, id: &str) {
        // IPC cancellation can arrive before a spawn_blocking task starts.
        if let Ok(mut ids) = self.cancelled_ids.lock() {
            if ids.len() == 32 {
                ids.pop_front();
            }
            ids.push_back(id.to_string());
        }
        let job = self
            .current
            .lock()
            .ok()
            .and_then(|current| current.as_ref().filter(|job| job.id == id).cloned());
        if let Some(job) = job {
            job.cancelled.store(true, Ordering::Relaxed);
            if let Ok(stop) = job.stop.lock() {
                if let Some(stop) = stop.as_ref() {
                    let _ = stop.send(());
                }
            }
            // An already-finished recording has no worker left to release it.
            // Inference/download keeps its reservation until it actually terminates.
            let finished_recording = job.audio.lock().is_ok_and(|audio| {
                audio
                    .as_ref()
                    .is_some_and(|receiver| receiver.try_recv().is_ok())
            });
            if finished_recording {
                self.release(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_before_worker_start_is_remembered() {
        let directory = tempfile::tempdir().unwrap();
        let service = SpeechService::new(directory.path().into());
        service.cancel("queued");
        assert!(service.reserve("queued", SpeechModel::Small).is_err());
        assert!(service.reserve("new", SpeechModel::Small).is_ok());
    }
    #[test]
    fn jobs_are_exclusive_and_stale_cancellation_does_not_affect_current_job() {
        let directory = tempfile::tempdir().unwrap();
        let service = SpeechService::new(directory.path().into());
        let first = service.reserve("first", SpeechModel::Small).unwrap();
        assert!(service.reserve("second", SpeechModel::Small).is_err());
        service.cancel("stale");
        assert!(!first.cancelled.load(Ordering::Relaxed));
        service.cancel("first");
        assert!(first.cancelled.load(Ordering::Relaxed));
        service.release("first");
        let second = service.reserve("second", SpeechModel::Small).unwrap();
        service.release("first");
        assert!(service.reserve("third", SpeechModel::Small).is_err());
        assert!(!second.cancelled.load(Ordering::Relaxed));
    }
}
