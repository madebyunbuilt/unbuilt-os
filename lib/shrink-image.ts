import { SHRINK_TO_WIDTH } from '@/lib/image-size-advice';

// Shrinking an image in the browser, offered rather than done quietly: the file that goes to the website should be the
// one somebody chose, unless they ask for a smaller one.
//
// The result is WebP, which is what makes the difference for a screenshot — the same picture at a fraction of the
// weight — and is one of the types the website accepts.

export async function shrinkImage(file: File, maxWidth = SHRINK_TO_WIDTH): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot resize images');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
  if (!blob) throw new Error('The image could not be resized');
  const name = file.name.replace(/\.[^.]+$/, '') + '.webp';
  return new File([blob], name, { type: 'image/webp' });
}
