// Finds faces in small frames, on this computer, with MediaPipe's BlazeFace (a ~230 KB model).
// The detector looks at a 128×128 picture, so a wide frame is checked as three overlapping
// squares (left, middle, right). That keeps faces in wide shots big enough to be found.
// The app serves these from clipshaper://faces; the web version from its own folder.
const BASE = (window.cs && window.cs.facesBase) || 'clipshaper://faces';

let detector = null;
async function ready() {
  if (detector) return detector;
  const { FilesetResolver, FaceDetector } = await import(`${BASE}/vision_bundle.mjs`);
  const files = await FilesetResolver.forVisionTasks(BASE);
  detector = await FaceDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath: `${BASE}/model.tflite`, delegate: 'CPU' },
    runningMode: 'IMAGE', minDetectionConfidence: 0.5, minSuppressionThreshold: 0.3,
  });
  return detector;
}

const tile = document.createElement('canvas');
const tg = tile.getContext('2d', { willReadFrequently: true });

function iou(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = x * y; return i / (a.w * a.h + b.w * b.h - i || 1);
}

// Faces in one image as 0..1 boxes { x, y, w, h, score }.
async function detect(img) {
  const d = await ready();
  const W = img.width; const H = img.height;
  const S = Math.min(W, H);
  tile.width = S; tile.height = S;
  const offs = W > H * 1.2 ? [0, (W - S) / 2, W - S] : H > W * 1.2 ? [0, (H - S) / 2, H - S] : [0];
  const found = [];
  for (const o of offs) {
    const ox = W > H ? o : 0; const oy = W > H ? 0 : o;
    tg.drawImage(img, ox, oy, S, S, 0, 0, S, S);
    for (const det of d.detect(tile).detections) {
      const b = det.boundingBox;
      found.push({ x: (b.originX + ox) / W, y: (b.originY + oy) / H, w: b.width / W, h: b.height / H, score: det.categories[0].score });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const f of found) if (!kept.some((k) => iou(k, f) > 0.3)) kept.push(f);
  return kept;
}

// frames: [{ t, jpg }] from the main process. Returns [{ t, faces }].
export async function scan(frames, onProgress = () => {}) {
  await ready();
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    const bmp = await createImageBitmap(new Blob([frames[i].jpg], { type: 'image/jpeg' }));
    out.push({ t: frames[i].t, faces: (await detect(bmp)).map((f) => ({ x: +f.x.toFixed(4), y: +f.y.toFixed(4), w: +f.w.toFixed(4), h: +f.h.toFixed(4), score: +f.score.toFixed(2) })) });
    bmp.close();
    if (i % 8 === 0) { onProgress(i / frames.length); await new Promise((r) => setTimeout(r, 0)); }
  }
  return out;
}
