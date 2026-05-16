# heartlib API surface (music generation + lyrics transcription)

This document reverse-engineers the callable API surface from:

- `heartlib/examples/run_music_generation.py`
- `heartlib/examples/run_lyrics_transcription.py`
- all Python modules in `heartlib/src/heartlib/`
- `heartlib/pyproject.toml`

## 1) Music Generation API

### 1.1 Entry points

- Public import: `from heartlib import HeartMuLaGenPipeline`
- Example entrypoint: `heartlib/examples/run_music_generation.py`
- Core pipeline class: `heartlib/src/heartlib/pipelines/music_generation.py`

### 1.2 Class and constructor surface

`class HeartMuLaGenPipeline` constructor:

```python
HeartMuLaGenPipeline(
    heartmula_path: str,
    heartcodec_path: str,
    heartmula_device: torch.device,
    heartcodec_device: torch.device,
    heartmula_dtype: torch.dtype,
    heartcodec_dtype: torch.dtype,
    lazy_load: bool,
    muq_mulan: Optional[Any],
    text_tokenizer: Tokenizer,
    config: HeartMuLaGenConfig,
)
```

Factory constructor:

```python
@classmethod
from_pretrained(
    pretrained_path: str,
    device: Union[torch.device, Dict[str, torch.device]],
    dtype: Union[torch.dtype, Dict[str, torch.dtype]],
    version: str,
    lazy_load: bool = False,
)
```

`from_pretrained()` resolves required files/subdirs and instantiates `HeartMuLa` + `HeartCodec` eagerly or lazily.

### 1.3 Call/generation surface

Pipeline call surface used by example:

```python
pipe(
    {"lyrics": <str_or_path>, "tags": <str_or_path>},
    max_audio_length_ms: int = 120_000,
    topk: int = 50,
    temperature: float = 1.0,
    cfg_scale: float = 1.5,
    save_path: str = "output.mp3",
)
```

Internals:

- `preprocess(inputs, cfg_scale)`:
  - `inputs["tags"]`: text string or file path
  - `inputs["lyrics"]`: text string or file path
  - lowercases both; wraps tags with `<tag>...</tag>` if missing
  - tokenizes via `tokenizer.json`
- `_forward(model_inputs, max_audio_length_ms, temperature, topk, cfg_scale)`:
  - iterative frame generation with `HeartMuLa.generate_frame(...)`
  - stops on `audio_eos_id` or max frames (`max_audio_length_ms // 80`)
- `postprocess(model_outputs, save_path)`:
  - decodes codes via `HeartCodec.detokenize(...)`
  - writes audio via `torchaudio.save(save_path, wav, 48000)`

Model-level generation method actually used:

```python
HeartMuLa.generate_frame(
    tokens: torch.Tensor,
    tokens_mask: torch.Tensor,
    input_pos: torch.Tensor,
    temperature: float,
    topk: int,
    cfg_scale: float,
    continuous_segments: torch.Tensor = None,
    starts=None,
) -> torch.Tensor
```

### 1.4 Input format (adapter-relevant)

- Prompting format is split in source into:
  - `tags` string (style/instrument/etc.)
  - `lyrics` string
- `duration` is exposed as `max_audio_length_ms` (int, milliseconds)
- `seed` is **not** surfaced by heartlib pipeline; adapter must set global RNG state itself (`torch.manual_seed`, etc.) before invoking pipeline
- `device` can be single `torch.device` or dict:
  - `{"mula": torch.device(...), "codec": torch.device(...)}`

### 1.5 Output format

- `_forward()` returns dict with:
  - `frames: torch.Tensor` shape `[8, T]` (8 codebooks, T audio-frame steps)
- `postprocess()` decodes to waveform tensor and saves to disk at 48kHz:
  - `wav` is passed to `torchaudio.save(..., sample_rate=48000)`
  - expected channel-first waveform for save (`[channels, samples]`)
- For adapter returning bytes, convert waveform to in-memory WAV bytes instead of writing fixed file path.

### 1.6 Device handling (macOS vs Win/Linux)

Code facts:

- Example hardcodes CUDA defaults (`--mula_device cuda --codec_device cuda`)
- Pipeline accepts any `torch.device` and uses `torch.autocast(device_type=self.mula_device.type, ...)`

Adapter policy:

- macOS Apple Silicon: set both devices to `torch.device("mps")` when available
- Win/Linux GPU: set CUDA (`torch.device("cuda")` or split GPUs)
- CPU fallback should remain possible but will be slow

### 1.7 Memory cleanup/lifecycle pattern

- `lazy_load=True` triggers on-demand loading and explicit unload in `_unload()`
- `_unload()` does:
  - `del model`
  - `gc.collect()`
  - `torch.cuda.empty_cache()`
- If model components are on different devices, lazy loading is forcibly disabled.

Note: cleanup path currently assumes CUDA memory introspection/empty-cache calls.

### 1.8 Hardcoded paths to make configurable

Pipeline-level strict layout requirements under `pretrained_path`:

- `HeartMuLa-oss-{version}`
- `HeartCodec-oss`
- `tokenizer.json`
- `gen_config.json`

Example defaults that should be adapter-configurable:

- `./assets/lyrics.txt`
- `./assets/tags.txt`
- `./assets/output.mp3`

## 2) Lyrics Transcription API

### 2.1 Entry points

- Public import: `from heartlib import HeartTranscriptorPipeline`
- Example: `heartlib/examples/run_lyrics_transcription.py`
- Core class: `heartlib/src/heartlib/pipelines/lyrics_transcription.py`

### 2.2 Class and constructor surface

`HeartTranscriptorPipeline` subclasses `transformers.AutomaticSpeechRecognitionPipeline` and keeps inherited call semantics.

Factory constructor:

```python
@classmethod
from_pretrained(
    pretrained_path: str,
    device: torch.device,
    dtype: torch.dtype,
)
```

Behavior:

- Requires `pretrained_path/HeartTranscriptor-oss`
- Loads:
  - `WhisperForConditionalGeneration.from_pretrained(..., torch_dtype=dtype, low_cpu_mem_usage=True)`
  - `WhisperProcessor.from_pretrained(...)`
- Initializes pipeline with:
  - `chunk_length_s=30`
  - `batch_size=16`

### 2.3 Transcription call surface

There is no custom `transcribe()` method in heartlib; usage is `pipe(...)` from inherited ASR pipeline.

Example call:

```python
result = pipe(
    music_path,
    max_new_tokens=256,
    num_beams=2,
    task="transcribe",
    condition_on_prev_tokens=False,
    compression_ratio_threshold=1.8,
    temperature=(0.0, 0.1, 0.2, 0.4),
    logprob_threshold=-1.0,
    no_speech_threshold=0.4,
)
```

Input format observed in heartlib examples:

- string path to music/audio file (`music_path`)

Output format:

- inherited transformers ASR output object; in default use, includes transcribed text (printed directly in example)
- adapter should normalize to plain string lyrics output.

## 3) Model File Requirements (HF repos + expected layout)

### 3.1 Required Hugging Face repos

Music generation path requires:

1. `HeartMuLa/HeartMuLaGen`
2. `HeartMuLa/HeartMuLa-oss-3B-happy-new-year`
3. `HeartMuLa/HeartCodec-oss-20260123`

Lyrics transcription path requires:

4. `HeartMuLa/HeartTranscriptor-oss`

### 3.2 Expected local directory layout

`HeartMuLaGenPipeline.from_pretrained(pretrained_path, ...)` expects:

```text
{pretrained_path}/
├── HeartMuLa-oss-3B/            # from HeartMuLa/HeartMuLa-oss-3B-happy-new-year
├── HeartCodec-oss/              # from HeartMuLa/HeartCodec-oss-20260123
├── tokenizer.json               # from HeartMuLa/HeartMuLaGen
└── gen_config.json              # from HeartMuLa/HeartMuLaGen
```

`HeartTranscriptorPipeline.from_pretrained(pretrained_path, ...)` expects:

```text
{pretrained_path}/
└── HeartTranscriptor-oss/       # from HeartMuLa/HeartTranscriptor-oss
```

## 4) mmgp Decision

### Observed in source

- No `mmgp` import/use in `heartlib/src/heartlib/**`
- No `mmgp` dependency in `heartlib/pyproject.toml`
- Existing memory control is already present via:
  - lazy load toggling
  - explicit unload + GC + `torch.cuda.empty_cache()`
  - split-device placement (`mula` vs `codec`)

### Decision

**Decision: skip mmgp integration for adapter phase (do not vendor).**

Rationale:

1. Not part of current heartlib runtime dependency graph.
2. Core memory-pressure controls already exist in pipeline.
3. Vendoring adds maintenance risk without direct code-level dependency.

Replacement approach (if needed later):

- Keep adapter-side memory policy knobs (`lazy_load`, split devices, dtype controls)
- Add optional adapter-level lifecycle helpers before introducing any external memory manager.

## 5) Adapter Interface Pseudocode

```python
from io import BytesIO
import tempfile
import torch
import torchaudio
from heartlib import HeartMuLaGenPipeline, HeartTranscriptorPipeline


def _pick_devices() -> dict:
    # deterministic adapter policy
    if torch.backends.mps.is_available():
        # macOS Apple Silicon
        return {"mula": torch.device("mps"), "codec": torch.device("mps")}
    if torch.cuda.is_available():
        return {"mula": torch.device("cuda"), "codec": torch.device("cuda")}
    return {"mula": torch.device("cpu"), "codec": torch.device("cpu")}


def generate_music(
    prompt: str,
    lyrics: str,
    duration: float,
    seed: int,
    model_root: str,
    version: str = "3B",
    topk: int = 50,
    temperature: float = 1.0,
    cfg_scale: float = 1.5,
    lazy_load: bool = True,
) -> bytes:
    # prompt -> tags in heartlib vocabulary
    tags = prompt

    # seed control is adapter responsibility (heartlib pipeline has no seed arg)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)

    devices = _pick_devices()
    dtypes = {
        "mula": torch.bfloat16 if devices["mula"].type != "cpu" else torch.float32,
        "codec": torch.float32,
    }

    pipe = HeartMuLaGenPipeline.from_pretrained(
        pretrained_path=model_root,
        device=devices,
        dtype=dtypes,
        version=version,
        lazy_load=lazy_load,
    )

    max_audio_length_ms = int(duration * 1000)

    # heartlib postprocess writes to path; wrap with temp file then return bytes
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        with torch.no_grad():
            pipe(
                {"lyrics": lyrics, "tags": tags},
                max_audio_length_ms=max_audio_length_ms,
                topk=topk,
                temperature=temperature,
                cfg_scale=cfg_scale,
                save_path=tmp.name,
            )
        audio_bytes = open(tmp.name, "rb").read()
    return audio_bytes


def transcribe_lyrics(
    audio_bytes: bytes,
    model_root: str,
    dtype: torch.dtype = torch.float16,
) -> str:
    # HeartTranscriptorPipeline expects standard ASR pipeline input; safest path is temp file
    device = (
        torch.device("mps") if torch.backends.mps.is_available()
        else torch.device("cuda") if torch.cuda.is_available()
        else torch.device("cpu")
    )

    pipe = HeartTranscriptorPipeline.from_pretrained(
        pretrained_path=model_root,
        device=device,
        dtype=dtype,
    )

    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        tmp.write(audio_bytes)
        tmp.flush()
        result = pipe(
            tmp.name,
            max_new_tokens=256,
            num_beams=2,
            task="transcribe",
            condition_on_prev_tokens=False,
            compression_ratio_threshold=1.8,
            temperature=(0.0, 0.1, 0.2, 0.4),
            logprob_threshold=-1.0,
            no_speech_threshold=0.4,
        )

    # normalize inherited ASR output to plain string
    if isinstance(result, dict):
        return str(result.get("text", "")).strip()
    return str(result).strip()
```
