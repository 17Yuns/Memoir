use crate::domain::speech::speech_error;
use crate::domain::{
    speech::{SpeechModel, SpeechModelStatus},
    AppResult,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

pub struct ModelSpec {
    pub file: &'static str,
    pub name: &'static str,
    pub bytes: u64,
    pub sha: &'static str,
}

pub fn spec(model: SpeechModel) -> ModelSpec {
    match model {
        SpeechModel::Small => ModelSpec {
            file: "ggml-small-q5_1.bin",
            name: "Whisper small · Q5_1",
            bytes: 190_085_487,
            sha: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
        },
        SpeechModel::Base => ModelSpec {
            file: "ggml-base-q5_1.bin",
            name: "Whisper base · Q5_1",
            bytes: 59_707_625,
            sha: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
        },
    }
}

pub fn status(directory: &Path, model: SpeechModel) -> SpeechModelStatus {
    let spec = spec(model);
    SpeechModelStatus {
        ready: fs::metadata(directory.join(spec.file))
            .is_ok_and(|m| m.is_file() && m.len() == spec.bytes),
        model: spec.name,
        bytes: spec.bytes,
    }
}

struct PartialFile(PathBuf);
impl Drop for PartialFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub fn download(
    directory: &Path,
    model: SpeechModel,
    cancelled: &AtomicBool,
    report: impl Fn(u32),
) -> AppResult<()> {
    fs::create_dir_all(directory).map_err(|_| speech_error("downloadError"))?;
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|_| speech_error("downloadError"))?;
    let response = client
        .get(format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
            spec(model).file
        ))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|_| speech_error("downloadError"))?;
    install(directory, model, response, cancelled, report)
}

pub fn import(
    directory: &Path,
    source: &Path,
    model: SpeechModel,
    cancelled: &AtomicBool,
    report: impl Fn(u32),
) -> AppResult<()> {
    let file = fs::File::open(source).map_err(|_| speech_error("modelInvalid"))?;
    if file
        .metadata()
        .map_err(|_| speech_error("modelInvalid"))?
        .len()
        != spec(model).bytes
    {
        return Err(speech_error("modelInvalid"));
    }
    fs::create_dir_all(directory).map_err(|_| speech_error("downloadError"))?;
    install(directory, model, file, cancelled, report)
}

fn install(
    directory: &Path,
    model: SpeechModel,
    mut input: impl Read,
    cancelled: &AtomicBool,
    report: impl Fn(u32),
) -> AppResult<()> {
    let spec = spec(model);
    let partial = PartialFile(directory.join(format!("{}.part", spec.file)));
    let mut output = fs::File::create(&partial.0).map_err(|_| speech_error("downloadError"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut received = 0_u64;
    let mut last = u32::MAX;
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err(speech_error("cancelled"));
        }
        let count = input
            .read(&mut buffer)
            .map_err(|_| speech_error("downloadError"))?;
        if count == 0 {
            break;
        }
        received += count as u64;
        if received > spec.bytes {
            return Err(speech_error("modelInvalid"));
        }
        output
            .write_all(&buffer[..count])
            .map_err(|_| speech_error("downloadError"))?;
        hash.update(&buffer[..count]);
        let percent = (received * 100 / spec.bytes) as u32;
        if percent != last {
            report(percent);
            last = percent;
        }
    }
    if !valid_digest(model, received, &hex::encode(hash.finalize())) {
        return Err(speech_error("modelInvalid"));
    }
    output
        .sync_all()
        .map_err(|_| speech_error("downloadError"))?;
    drop(output);
    if cancelled.load(Ordering::Relaxed) {
        return Err(speech_error("cancelled"));
    }
    // Both files are complete here. rename replaces atomically on supported desktop hosts.
    fs::rename(&partial.0, directory.join(spec.file)).map_err(|_| speech_error("downloadError"))?;
    Ok(())
}

fn valid_digest(model: SpeechModel, size: u64, digest: &str) -> bool {
    let spec = spec(model);
    size == spec.bytes && digest == spec.sha
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_status_and_import_validation_follow_the_selected_model() {
        let dir = tempfile::tempdir().unwrap();
        let small = spec(SpeechModel::Small);
        let base = spec(SpeechModel::Base);
        fs::File::create(dir.path().join(base.file))
            .unwrap()
            .set_len(base.bytes)
            .unwrap();
        assert!(status(dir.path(), SpeechModel::Base).ready);
        assert!(!status(dir.path(), SpeechModel::Small).ready);
        assert_eq!(status(dir.path(), SpeechModel::Base).bytes, base.bytes);
        let error = import(
            dir.path(),
            &dir.path().join(base.file),
            SpeechModel::Small,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap_err();
        assert_eq!(error.message, "speech.modelInvalid");
        assert!(!dir.path().join(small.file).exists());
    }

    #[test]
    fn rejects_truncated_and_wrong_model_files_and_cleans_partial_downloads() {
        let model = SpeechModel::Small;
        let spec = spec(model);
        assert!(!valid_digest(model, spec.bytes - 1, spec.sha));
        assert!(!valid_digest(model, spec.bytes, "wrong"));
        assert!(!valid_digest(SpeechModel::Base, spec.bytes, spec.sha));
        let dir = tempfile::tempdir().unwrap();
        assert!(install(
            dir.path(),
            model,
            &b"not a model"[..],
            &AtomicBool::new(false),
            |_| {}
        )
        .is_err());
        assert!(!status(dir.path(), model).ready);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
