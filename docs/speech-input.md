# Voice input

Memoir records the default microphone and transcribes it **locally** with
whisper.cpp through `whisper-rs`. Optional cleanup sends only the transcript to
the AI provider and chat model already selected in Settings. Audio is never sent
to that provider. Turn off **Clean up after transcription** for offline use.

## Using it

1. In **Settings → Voice input**, choose **Fast · Whisper base** (about 57 MiB)
   or **Accurate · Whisper small** (about 181 MiB, the existing default). Download
   the selected multilingual Q5_1 model or import its official file. Base trades
   some recognition accuracy for speed. Choose the recognition language and whether to clean
   up transcripts automatically. These preferences are saved across restarts.
2. Open a note in Edit or Split mode and click the microphone in the header.
   You can also press **Ctrl+Shift+M** (**⌘+Shift+M** on macOS) to start recording,
   then press it again to stop and transcribe. Change or disable this binding in
   **Settings → Shortcuts**. Once a transcript is ready, the shortcut focuses it
   for review without starting another recording.
   A compact floating panel appears beside the insertion point without dimming or
   blocking the editor. It follows editor scrolling and stays inside the window;
   transcription results expand in the same panel. Recording starts immediately
   when the model is ready. If it is missing, use
   the link to Voice input settings to prepare it first.
3. Stop recording to transcribe. Each recording is limited to five minutes in
   both the UI and the native recorder.
4. If AI cleanup is enabled, wait for paragraph/punctuation cleanup, or cancel
   cleanup and use the original transcript. Cloud errors preserve the original.
5. Review/edit either version and insert it at the original cursor position.
   Insertion is one undo step. If the note changed meanwhile, copy the text from
   the result field instead; Memoir will not insert at a stale location.
   Clicking outside the panel keeps recording; close it with its × button, or
   press Escape while focused inside it, to discard the session. The info button
   explains local transcription and optional cloud cleanup.

Chinese transcripts use Simplified Chinese, including when automatic language
detection identifies Chinese. Conversion runs locally before preview and AI cleanup,
so it also works offline. Selecting Chinese explicitly additionally gives Whisper
a Simplified Chinese prompt; automatic detection and other languages are not prompted
in Chinese. Other detected languages keep their original writing system.
AI cleanup preserves the transcript's writing system and may correct homophone or
proper-name recognition errors only when the transcript provides strong context.
Short or ambiguous phrases still need review; script conversion alone does not
correct a misheard word.

The browser demo reports that voice input requires the desktop app. No Python,
external Whisper executable, or separate model server is needed by users.

## Model storage and privacy

- Small: `ggml-small-q5_1.bin`, 190,085,487 bytes; SHA-256
  `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb`.
- Base: `ggml-base-q5_1.bin`, 59,707,625 bytes; SHA-256
  `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898`.
- Both models come from <https://huggingface.co/ggerganov/whisper.cpp>.
  The selected model determines the download URL, filename and checksum; a file
  for another model is rejected. Each model has its own installation status.
- Stored in `speech-models/` inside Tauri's application data directory, outside
  note workspaces and cloud sync. Download/import verifies size and SHA-256 before
  renaming a temporary file. Interrupted files are not treated as installed models.
- Recordings and transcript previews are held in memory for the session. They are
  not persisted as audio attachments. Closing the dialog discards its preview.
- Cleanup uses the existing API URL, credentials, and chat model. It is a separate
  text-only request with no note retrieval, workspace content, or editing tools.
  Cancellation discards late cloud replies; an already-sent provider request can
  still finish remotely. Normal provider billing/data handling applies.
- AI cleanup preserves originals for comparison; it cannot guarantee correction of
  recognition errors or exact preservation of meaning. Review names and numbers.

## Implementation

`SpeechDialog -> SpeechSession -> SpeechGateway -> Tauri commands -> SpeechService -> SpeechWorker`

CPAL owns microphone capture on a dedicated native thread, avoiding WebView media
permissions and codec differences. Input is downmixed to mono, limited to five
minutes, and resampled with a windowed-sinc low-pass filter to 16 kHz. Empty and
near-silent recordings are rejected. This initial implementation transcribes after
recording stops; it does not provide live dictation or speaker diarization.

A dedicated worker preloads the model while recording starts and reuses its weights
for subsequent recordings. Active recordings keep the model loaded; after a session
ends, two idle minutes release the weights. Reinstalling the model clears the cache.
Each transcription uses fresh inference state, so earlier transcript text is not
retained in the cache. The existing attention mode is preserved: local CPU tests
did not show a Flash Attention speed benefit. Progress and cancellation callbacks
use scoped data rather than whisper-rs 0.16’s leaking/mismatched closure helpers.
macOS builds enable Metal; Windows/Linux use CPU inference. Cancellation is checked
while resampling and via Whisper's abort callback. Model loading and an in-flight
network read may take time to finish; native jobs remain exclusive until then.
The recording stream is released before inference begins.

`SpeechSession` keeps a session generation and native request ID so stale results
cannot replace a newer session or trigger a cloud request after cancellation.
The editor also checks workspace, note path, and document content before insertion.

## Building and testing

In addition to Tauri prerequisites, native speech requires a C/C++ compiler and
CMake. Linux needs ALSA development headers (`libasound2-dev` on Debian/Ubuntu).
Cargo uses the bindings shipped with whisper-rs and disables host-specific native
CPU optimization for distributable builds. macOS microphone usage text is in
`src-tauri/Info.plist`. The CI Linux build/test dependency lists include audio and
CMake requirements.

Run the normal checks:

```bash
bun run style:check
bun run test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

An optional real-inference smoke test uses local copies of the official model and
[Whisper's JFK sample](https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav).
It does not download anything or contact an AI provider:

```bash
MEMOIR_WHISPER_MODEL=/path/ggml-small-q5_1.bin \
MEMOIR_WHISPER_SAMPLE=/path/jfk.wav \
cargo test --manifest-path src-tauri/Cargo.toml transcribes_official_audio_sample -- --ignored --nocapture
```

Manual release checks: microphone permission granted/denied, disconnected device,
record/stop/cancel/close, silence, multilingual speech, model download interruption,
cloud failure, and insertion/undo on each supported OS. A sample-file inference
test does not validate physical microphone access or OS permission dialogs.

For a local comparison of model loading, Flash Attention, and repeated inference
using the same fixtures, run the ignored `benchmarks_local_transcription` test with
`--ignored --nocapture`. It prints three alternating baseline/optimized runs; it
does not assert a hardware-dependent speed threshold. Compare loading + inference
for the previous cold path with inference alone when recording has already allowed
preloading to finish. The English sample checks basic correctness, not Chinese
recognition quality or performance on other devices.

Local reference measurement (Linux x86_64, AMD Ryzen AI 9 H 365, CPU only,
8 inference threads, Q5_1 models): the same 11-second English JFK sample took a
median **2.669 s with small** and **0.839 s with base** over three warm runs with
Flash Attention off. This is about **3.2× throughput / 69% less inference time**
for this sample. Median model loading was 60 ms for small and 32 ms for base;
preloading mainly hides that cost. These figures do not predict Chinese accuracy
or performance on other devices. Flash Attention did not improve small-model
inference on this host, so it remains disabled. Both models also passed repeated
transcription and cancellation/retry checks using the real worker.
