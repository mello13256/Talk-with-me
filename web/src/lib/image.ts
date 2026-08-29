export interface PreparedFile {
  file: File;
  previewUrl: string | null;
  width: number | null;
  height: number | null;
  compressed: boolean;
}

const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DIMENSION = 2048;
const COMPRESS_THRESHOLD = 700 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem.'));
    };
    image.src = url;
  });
}

/**
 * Shrinks oversized photos in the browser before upload. A phone camera shot is
 * routinely 4-8 MB; sending 300 KB instead makes the chat feel instant on mobile
 * data and keeps storage costs down. Non-images pass through untouched.
 */
export async function prepareFile(file: File): Promise<PreparedFile> {
  if (!file.type.startsWith('image/')) {
    return { file, previewUrl: null, width: null, height: null, compressed: false };
  }

  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch {
    return { file, previewUrl: null, width: null, height: null, compressed: false };
  }

  const { naturalWidth: width, naturalHeight: height } = image;
  const needsResize = Math.max(width, height) > MAX_DIMENSION;
  const shouldCompress =
    COMPRESSIBLE.has(file.type) && (needsResize || file.size > COMPRESS_THRESHOLD);

  if (!shouldCompress) {
    return { file, previewUrl: URL.createObjectURL(file), width, height, compressed: false };
  }

  const scale = needsResize ? MAX_DIMENSION / Math.max(width, height) : 1;
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return { file, previewUrl: URL.createObjectURL(file), width, height, compressed: false };
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  // PNG screenshots keep their transparency; photos become JPEG.
  const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outputType, 0.82),
  );

  if (!blob || blob.size >= file.size) {
    return { file, previewUrl: URL.createObjectURL(file), width, height, compressed: false };
  }

  const extension = outputType === 'image/png' ? 'png' : 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'imagem';
  const optimized = new File([blob], `${baseName}.${extension}`, { type: outputType });

  return {
    file: optimized,
    previewUrl: URL.createObjectURL(optimized),
    width: targetWidth,
    height: targetHeight,
    compressed: true,
  };
}
