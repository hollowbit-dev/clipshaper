# Clipshaper

**Long video in. Short clips out.** Clipshaper by Hollowbit Studio is a free, open-source AI clip maker. It finds the best moments in a podcast, stream or talk, frames them for phones by following faces, and adds word-by-word captions. No watermark, no account, and your video is never uploaded.

- Website: https://hollowbit.dev/clipshaper/
- Try it in your browser: https://hollowbit.dev/clipshaper/try/

## How it works

1. **Listen:** [whisper.cpp](https://github.com/ggml-org/whisper.cpp) writes down every word with timings.
2. **Pick moments:** a small local language model (Qwen, run with [llama.cpp](https://github.com/ggml-org/llama.cpp)) reads the transcript like an editor and scores each candidate clip.
3. **Frame:** [MediaPipe](https://ai.google.dev/edge/mediapipe) face detection drives a 9:16 crop that holds still, follows the speaker and jumps on cuts.
4. **Export:** ffmpeg burns in the captions and writes 1080×1920 MP4s.

The app can also download from YouTube, TikTok, Instagram, X, Twitch and more via [yt-dlp](https://github.com/yt-dlp/yt-dlp). Only use videos you own or have permission to use.

The web version (`docs/try/`) runs the same window code in the browser, with Whisper via transformers.js, the moment finder via WebLLM, and export by recording a canvas.

## Develop

```
npm install
npm start          # the app (needs vendor/ binaries, see scripts in Captionshaper/Writeshaper)
npm run site       # builds the website into docs/
node test/e2e.mjs  # app end to end
```

## License

GPL-3.0-or-later. See LICENSE and THIRD_PARTY_NOTICES.md.
