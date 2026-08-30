import { Image as RNImage } from 'react-native';
import { loadTensorflowModel } from 'react-native-fast-tflite';
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

let modelPromise = null;
function getModel() {
  if (!modelPromise) {
    modelPromise = loadTensorflowModel(require('../../assets/models/mobilefacenet.tflite'), []);
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
 * with a `reason` of 'no-face' | 'multiple-faces' | 'detector-error' when
 * the photo isn't usable, so callers can show a clear "retake" prompt
 * instead of a generic failure.
 */
export class FaceEmbeddingError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
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
