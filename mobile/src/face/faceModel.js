import { Image as RNImage } from 'react-native';
import { loadTensorflowModel } from 'react-native-fast-tflite';
import { Asset } from 'expo-asset';
import { RNMLKitFaceDetector } from '@infinitered/react-native-mlkit-face-detection';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Skia, ColorType, AlphaType } from '@shopify/react-native-skia';

// Shared on-device face-embedding pipeline (used by both registration and
// verification): detect -> crop to the single detected face -> resize to
// the model's expected 112x112 input -> decode to raw RGB pixels -> run
// MobileFaceNet -> L2-normalize the 192-dim output. Confirmed at
// implementation time (not assumed) by loading the actual bundled
// mobilefacenet.tflite and logging its real input/output tensor shapes:
// input float32 [1,112,112,3], output float32 [1,192] named "embeddings".
// Pixel normalization ((pixel - 128) / 128) matches the preprocessing this
// same model file uses in its source project (MCarlomagno/FaceRecognitionAuth).
const MODEL_INPUT_SIZE = 112;
const EMBEDDING_LENGTH = 192;
const CROP_MARGIN_RATIO = 0.15; // extra padding around the detected face box

// Capture-quality gates (2026-09-14) — added after real production data
// (backend's face_identify_log, 18 logged attempts) showed the SAME
// person's own registered face scoring anywhere from 0.37 to 0.92 against
// live captures — far too wide a spread to be a threshold-calibration
// problem, and the matching math itself was already verified correct.
// Nothing upstream of the embedding model was ever checking whether a capture was
// even usable (in frame at a reasonable distance, not blown-out/underlit,
// not motion-blurred) before feeding it to MobileFaceNet — a bad capture
// silently produced a bad embedding with no signal to the user to retake it.
// These thresholds are deliberately generous (reject only the clear
// offenders, e.g. the 0.37-collapse attempt in the logged data) so a normal
// capture isn't second-guessed — tune against face_identify_log's real
// score distribution if genuine attempts still get rejected too often.
const MIN_FACE_FRACTION = 0.15; // face too small in frame -> too far away
const MAX_FACE_FRACTION = 0.9; // face fills almost the whole frame -> too close
const MIN_MEAN_BRIGHTNESS = 45; // 0-255 scale; below this is too dark to trust
const MAX_MEAN_BRIGHTNESS = 225; // above this is blown-out/backlit
const MIN_SHARPNESS = 15; // variance of Laplacian on 112x112 grayscale; below this is motion-blurred

// react-native-fast-tflite resolves a bare require(...) via
// Image.resolveAssetSource(...).uri, then hands that string straight to
// java.net.URL(path).readBytes() on Android with no fallback. That works in
// dev (Metro serves assets over http://) and on iOS release builds (bundled
// resources get a real file:// path), but in an Android RELEASE build a
// bundled non-image asset resolves to a bare resource name like
// "assets_models_mobilefacenet" — no scheme at all — which URL() rejects
// with "no protocol". Confirmed via a real crash on a physical device
// during face registration. expo-asset's Asset.downloadAsync() is the
// documented Expo fix for this exact class of problem: it resolves (and
// copies, if needed) any bundled asset to a genuine file:// localUri on
// every platform and build type, which we then pass as an explicit
// { url } source instead of the raw require() result.
let modelPromise = null;
function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const asset = Asset.fromModule(require('../../assets/models/mobilefacenet.tflite'));
      await asset.downloadAsync();
      return loadTensorflowModel({ url: asset.localUri || asset.uri }, []);
    })();
  }
  return modelPromise;
}

let detector = null;
function getDetector() {
  if (!detector) {
    detector = new RNMLKitFaceDetector();
  }
  return detector;
}

function getImageSize(uri) {
  return new Promise((resolve, reject) => {
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

function l2Normalize(embedding) {
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return embedding;
  return embedding.map((v) => v / norm);
}

/**
 * Runs the full pipeline on one captured photo. Throws a FaceEmbeddingError
 * with a `reason` of 'no-face' | 'multiple-faces' | 'too-far' | 'too-close' |
 * 'too-dark' | 'too-bright' | 'too-blurry' | 'detector-error' when the photo
 * isn't usable, so callers can show a clear "retake" prompt instead of a
 * generic failure.
 */
export class FaceEmbeddingError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// Mean 0-255 brightness over the RGBA_8888 buffer, standard luminance
// weighting (matches how humans perceive brightness across channels).
function meanBrightness(pixels, pixelCount) {
  let total = 0;
  for (let i = 0; i < pixelCount; i++) {
    total += 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
  }
  return total / pixelCount;
}

// Variance of the Laplacian (standard, cheap blur heuristic) over a
// grayscale version of the same buffer — a sharp image has a lot of
// high-frequency edge content (high variance); a blurred one is smoothed
// out (low variance). Cheap enough to run on every capture at 112x112.
function laplacianVariance(pixels, width, height) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
  }

  const laplacian = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const value =
        4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - width] - gray[idx + width];
      laplacian.push(value);
    }
  }

  const mean = laplacian.reduce((sum, v) => sum + v, 0) / laplacian.length;
  return laplacian.reduce((sum, v) => sum + (v - mean) ** 2, 0) / laplacian.length;
}

export async function getFaceEmbedding(photoUri) {
  const [model, imageSize] = await Promise.all([getModel(), getImageSize(photoUri)]);

  const detectionResult = await getDetector().detectFaces(photoUri);
  if (!detectionResult || detectionResult.success === false) {
    throw new FaceEmbeddingError('detector-error', 'Could not analyze the photo. Please try again.');
  }
  const faces = detectionResult.faces || [];
  if (faces.length === 0) {
    throw new FaceEmbeddingError('no-face', 'No face detected. Please center your face and try again.');
  }
  if (faces.length > 1) {
    throw new FaceEmbeddingError('multiple-faces', 'More than one face detected. Make sure only you are in frame.');
  }

  const { origin, size } = faces[0].frame;

  const faceFraction = size.x / imageSize.width;
  if (faceFraction < MIN_FACE_FRACTION) {
    throw new FaceEmbeddingError('too-far', 'Your face is too far from the camera. Move closer and try again.');
  }
  if (faceFraction > MAX_FACE_FRACTION) {
    throw new FaceEmbeddingError('too-close', 'Your face is too close to the camera. Move back a little and try again.');
  }

  const marginX = size.x * CROP_MARGIN_RATIO;
  const marginY = size.y * CROP_MARGIN_RATIO;
  const originX = Math.max(0, Math.round(origin.x - marginX));
  const originY = Math.max(0, Math.round(origin.y - marginY));
  const cropWidth = Math.min(imageSize.width - originX, Math.round(size.x + marginX * 2));
  const cropHeight = Math.min(imageSize.height - originY, Math.round(size.y + marginY * 2));

  const cropped = await ImageManipulator.manipulate(photoUri)
    .crop({ originX, originY, width: cropWidth, height: cropHeight })
    .resize({ width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE })
    .renderAsync();
  const saved = await cropped.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });

  const skData = await Skia.Data.fromURI(saved.uri);
  const skImage = Skia.Image.MakeImageFromEncoded(skData);
  if (!skImage) {
    throw new FaceEmbeddingError('detector-error', 'Could not process the captured photo. Please try again.');
  }
  const pixels = skImage.readPixels(0, 0, {
    width: MODEL_INPUT_SIZE,
    height: MODEL_INPUT_SIZE,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!pixels) {
    throw new FaceEmbeddingError('detector-error', 'Could not read the captured photo. Please try again.');
  }

  const brightness = meanBrightness(pixels, MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
  if (brightness < MIN_MEAN_BRIGHTNESS) {
    throw new FaceEmbeddingError('too-dark', 'This photo is too dark. Find better lighting and try again.');
  }
  if (brightness > MAX_MEAN_BRIGHTNESS) {
    throw new FaceEmbeddingError('too-bright', 'This photo is too bright/backlit. Face a light source instead of your back to it, and try again.');
  }

  const sharpness = laplacianVariance(pixels, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  if (sharpness < MIN_SHARPNESS) {
    throw new FaceEmbeddingError('too-blurry', 'This photo is blurry. Hold the phone steady and try again.');
  }

  const input = new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 3);
  let inputIndex = 0;
  for (let i = 0; i < MODEL_INPUT_SIZE * MODEL_INPUT_SIZE; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    input[inputIndex++] = (r - 128) / 128;
    input[inputIndex++] = (g - 128) / 128;
    input[inputIndex++] = (b - 128) / 128;
  }

  const outputs = await model.run([input.buffer]);
  const rawEmbedding = Array.from(new Float32Array(outputs[0]));
  if (rawEmbedding.length !== EMBEDDING_LENGTH) {
    throw new FaceEmbeddingError('detector-error', 'Unexpected model output. Please try again.');
  }

  return l2Normalize(rawEmbedding);
}
