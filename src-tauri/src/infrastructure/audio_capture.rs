use crate::domain::speech::{speech_error, MAX_RECORDING_SECONDS, SAMPLE_RATE};
use crate::domain::AppResult;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};

pub struct RecordedAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

#[derive(Default)]
struct Capture {
    samples: Vec<f32>,
    failed: bool,
}

// The stream lives entirely on this worker thread (CPAL streams are not Send on all hosts).
pub fn record(
    stop: mpsc::Receiver<()>,
    cancelled: Arc<AtomicBool>,
    ready: mpsc::SyncSender<AppResult<()>>,
) -> AppResult<RecordedAudio> {
    let capture = Arc::new(Mutex::new(Capture::default()));
    let setup = (|| {
        let device = cpal::default_host()
            .default_input_device()
            .ok_or_else(|| speech_error("microphoneError"))?;
        let supported = device
            .default_input_config()
            .map_err(|_| speech_error("microphoneError"))?;
        let format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        if config.channels == 0 || !(8_000..=192_000).contains(&config.sample_rate.0) {
            return Err(speech_error("microphoneError"));
        }
        let stream = match format {
            cpal::SampleFormat::F32 => input_stream::<f32>(&device, &config, capture.clone()),
            cpal::SampleFormat::F64 => input_stream::<f64>(&device, &config, capture.clone()),
            cpal::SampleFormat::I8 => input_stream::<i8>(&device, &config, capture.clone()),
            cpal::SampleFormat::I16 => input_stream::<i16>(&device, &config, capture.clone()),
            cpal::SampleFormat::I32 => input_stream::<i32>(&device, &config, capture.clone()),
            cpal::SampleFormat::I64 => input_stream::<i64>(&device, &config, capture.clone()),
            cpal::SampleFormat::U8 => input_stream::<u8>(&device, &config, capture.clone()),
            cpal::SampleFormat::U16 => input_stream::<u16>(&device, &config, capture.clone()),
            cpal::SampleFormat::U32 => input_stream::<u32>(&device, &config, capture.clone()),
            cpal::SampleFormat::U64 => input_stream::<u64>(&device, &config, capture.clone()),
            _ => return Err(speech_error("microphoneError")),
        }
        .map_err(|_| speech_error("microphoneError"))?;
        stream.play().map_err(|_| speech_error("microphoneError"))?;
        Ok((stream, config.sample_rate.0))
    })();
    let (stream, sample_rate) = match setup {
        Ok(value) => {
            let _ = ready.send(Ok(()));
            value
        }
        Err(error) => {
            let _ = ready.send(Err(error.clone()));
            return Err(error);
        }
    };
    let started = Instant::now();
    loop {
        if cancelled.load(Ordering::Relaxed) || started.elapsed().as_secs() >= MAX_RECORDING_SECONDS
        {
            break;
        }
        if capture
            .lock()
            .map_err(|_| speech_error("microphoneError"))?
            .failed
        {
            break;
        }
        match stop.recv_timeout(Duration::from_millis(50)) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
    drop(stream); // Always release the microphone before resampling/inference.
    if cancelled.load(Ordering::Relaxed) {
        return Err(speech_error("cancelled"));
    }
    let mut capture = capture
        .lock()
        .map_err(|_| speech_error("microphoneError"))?;
    if capture.failed {
        return Err(speech_error("microphoneError"));
    }
    Ok(RecordedAudio {
        samples: std::mem::take(&mut capture.samples),
        sample_rate,
    })
}

fn input_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    capture: Arc<Mutex<Capture>>,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = usize::from(config.channels);
    let limit = config.sample_rate.0 as usize * MAX_RECORDING_SECONDS as usize;
    let errors = capture.clone();
    device.build_input_stream(
        config,
        move |data: &[T], _| {
            if let Ok(mut capture) = capture.lock() {
                let remaining = limit.saturating_sub(capture.samples.len());
                capture
                    .samples
                    .extend(data.chunks_exact(channels).take(remaining).map(|frame| {
                        let mono = frame
                            .iter()
                            .map(|sample| sample.to_sample::<f32>())
                            .sum::<f32>()
                            / channels as f32;
                        if mono.is_finite() {
                            mono.clamp(-1.0, 1.0)
                        } else {
                            0.0
                        }
                    }));
            }
        },
        move |_| {
            if let Ok(mut capture) = errors.lock() {
                capture.failed = true;
            }
        },
        None,
    )
}

// Windowed-sinc low-pass resampling avoids aliasing when devices capture at 44.1/48 kHz.
pub fn resample(audio: RecordedAudio, cancelled: &AtomicBool) -> AppResult<Vec<f32>> {
    if audio.sample_rate == SAMPLE_RATE {
        return Ok(audio.samples);
    }
    let ratio = f64::from(audio.sample_rate) / f64::from(SAMPLE_RATE);
    let length = (audio.samples.len() as f64 / ratio).floor() as usize;
    let cutoff = (1.0 / ratio).min(1.0) * 0.95;
    let radius = (16.0 / cutoff).ceil() as i64;
    // Cache polyphase filter coefficients: there are at most 160 phases for common rates.
    let gcd = gcd(audio.sample_rate, SAMPLE_RATE);
    let phases = (SAMPLE_RATE / gcd) as usize;
    let kernels: Vec<Vec<f64>> = (0..phases)
        .map(|phase| {
            let fraction = (phase as f64 * ratio).fract();
            (-radius..=radius)
                .map(|tap| {
                    let distance = tap as f64 - fraction;
                    let x = std::f64::consts::PI * distance * cutoff;
                    let sinc = if x.abs() < 1e-9 { 1.0 } else { x.sin() / x };
                    let window =
                        0.5 + 0.5 * (std::f64::consts::PI * distance / (radius + 1) as f64).cos();
                    sinc * cutoff * window
                })
                .collect()
        })
        .collect();
    let mut output = Vec::with_capacity(length);
    for i in 0..length {
        if i % 4096 == 0 && cancelled.load(Ordering::Relaxed) {
            return Err(speech_error("cancelled"));
        }
        let center = (i as u64 * u64::from(audio.sample_rate) / u64::from(SAMPLE_RATE)) as i64;
        let kernel = &kernels[i % phases];
        let mut total = 0.0;
        let mut weight = 0.0;
        for (j, coefficient) in kernel.iter().enumerate() {
            let index = center + j as i64 - radius;
            if index >= 0 && (index as usize) < audio.samples.len() {
                total += f64::from(audio.samples[index as usize]) * coefficient;
                weight += coefficient;
            }
        }
        output.push((total / weight.max(1e-9)) as f32);
    }
    Ok(output)
}

fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resamples_duration_and_rejects_out_of_band_audio() {
        let cancelled = AtomicBool::new(false);
        for rate in [44_100, 48_000] {
            let dc = resample(
                RecordedAudio {
                    samples: vec![0.3; rate],
                    sample_rate: rate as u32,
                },
                &cancelled,
            )
            .unwrap();
            assert_eq!(dc.len(), 16_000);
            assert!(dc.iter().all(|v| (*v - 0.3).abs() < 0.001));
            let samples = (0..rate)
                .map(|i| (2.0 * std::f32::consts::PI * 12_000.0 * i as f32 / rate as f32).sin())
                .collect();
            let filtered = resample(
                RecordedAudio {
                    samples,
                    sample_rate: rate as u32,
                },
                &cancelled,
            )
            .unwrap();
            let rms = (filtered[100..15900].iter().map(|x| x * x).sum::<f32>() / 15800.0).sqrt();
            assert!(rms < 0.02, "alias energy: {rms}");
        }
    }
    #[test]
    fn cancellation_interrupts_resampling() {
        assert!(resample(
            RecordedAudio {
                samples: vec![0.0; 48000],
                sample_rate: 48000
            },
            &AtomicBool::new(true)
        )
        .is_err());
    }
}
