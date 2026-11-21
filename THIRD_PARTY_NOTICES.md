# Third-party software in Clipshaper

Captionshaper is free software under the GNU GPL v3 or later (see LICENSE). It bundles:

| Component | Licence | Source |
|---|---|---|
| whisper.cpp and ggml (speech recognition engine) | MIT | https://github.com/ggml-org/whisper.cpp |
| OpenAI Whisper models (downloaded on first use, ggml format) | MIT | https://github.com/openai/whisper · https://huggingface.co/ggerganov/whisper.cpp |
| Silero VAD v5.1.2 (voice activity detection, ggml format) | MIT | https://github.com/snakers4/silero-vad |
| FFmpeg (static build with libx264 and libass) | GPL v3 | https://ffmpeg.org · build: https://github.com/eugeneware/ffmpeg-static |
| LLVM OpenMP runtime (libomp, macOS) | Apache 2.0 with LLVM exception | https://openmp.llvm.org |
| Geist font | SIL Open Font License 1.1 | https://github.com/vercel/geist-font |
| Montserrat, Poppins, Anton, Bebas Neue and Bangers fonts | SIL Open Font License 1.1 | https://github.com/google/fonts |
| Electron | MIT | https://www.electronjs.org |

The full licence texts are in each project's repository. The Geist licence is in assets/fonts/OFL.txt.

## Added in Clipshaper

- **llama.cpp** (MIT), https://github.com/ggml-org/llama.cpp: runs the moment finder on this computer.
- **Qwen3.5-4B** (Apache-2.0), by the Qwen team, GGUF by Unsloth: the moment finder model, downloaded on first use.
- **MediaPipe Tasks Vision and BlazeFace** (Apache-2.0), Google: face detection for the vertical framing.
- **yt-dlp** (Unlicense), https://github.com/yt-dlp/yt-dlp: downloaded from its official release the first time a link is pasted.
- Web version only: **transformers.js** (Apache-2.0, Hugging Face), **Whisper base** (MIT, OpenAI), **WebLLM** (Apache-2.0, MLC) and **Qwen2.5-1.5B-Instruct** (Apache-2.0).
