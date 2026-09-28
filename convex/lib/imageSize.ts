// Reading an image's pixel size from its header (13-cms-and-website.md, Content endpoint). The website needs width and
// height to lay an image out without the page jumping once it loads, and nothing else in the OS records them.
//
// Only the header is read, never the pixels: every format below puts its dimensions in the first few dozen bytes, so
// this is cheap and does not need a decoder. Anything unrecognised returns null, and the caller carries on without
// dimensions rather than failing an upload over them.

export type ImageSize = { width: number; height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** PNG: the IHDR chunk is always first, and its two big-endian 32-bit numbers start at byte 16. */
function png(bytes: Uint8Array, view: DataView): ImageSize | null {
  if (bytes.length < 24 || !startsWith(bytes, PNG_SIGNATURE)) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** GIF: the logical screen descriptor follows the six-byte version, little-endian. */
function gif(bytes: Uint8Array, view: DataView): ImageSize | null {
  if (bytes.length < 10) return null;
  const version = ascii(bytes, 0, 6);
  if (version !== 'GIF87a' && version !== 'GIF89a') return null;
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

/**
 * JPEG: the size lives in a start-of-frame segment, which sits after any number of other segments, so the markers have
 * to be walked. SOF0 to SOF15 carry it, except the three in that range that mean something else.
 */
function jpeg(bytes: Uint8Array, view: DataView): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    // Padding between segments, and the standalone markers that carry no length.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

/** WebP, in its three shapes: a lossy frame, a lossless frame, or an extended header that states the canvas size. */
function webp(bytes: Uint8Array, view: DataView): ImageSize | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(bytes, 12, 4);

  if (chunk === 'VP8 ') {
    // The dimensions follow the three-byte start code, and the top two bits of each are scaling, not size.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    // Fourteen bits each, minus one, packed little-endian across the next four bytes.
    const packed = view.getUint32(21, true);
    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Twenty-four bits each, minus one, after the four-byte feature flags.
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return { width, height };
  }
  return null;
}

/**
 * The pixel size of an image, or null when it cannot be read. SVG is deliberately not attempted: it often has no pixel
 * size at all, and guessing one from a viewBox would be worse than saying nothing.
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = png(bytes, view) ?? gif(bytes, view) ?? jpeg(bytes, view) ?? webp(bytes, view);
  // A zero or a negative is a header that did not mean what was read; better nothing than a wrong number.
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return size;
}
