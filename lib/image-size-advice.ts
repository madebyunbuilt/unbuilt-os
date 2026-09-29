// What to say about the weight of an image going on the public website (13-cms-and-website.md, Editing).
//
// The limits are the reader's rather than ours: a case study carrying a five megabyte screenshot is a page somebody on
// a Lagos connection gives up on. Over the warning line is a warning and not a refusal, because a large photograph is
// sometimes the right picture, and the person choosing it is better placed to judge that than a number is.

export const IMAGE_WARN_BYTES = 500 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type SizeAdvice = { level: 'ok' | 'warn' | 'refuse'; message?: string };

export function readableSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function sizeAdvice(bytes: number): SizeAdvice {
  if (bytes > IMAGE_MAX_BYTES) {
    return {
      level: 'refuse',
      message: `This image is ${readableSize(bytes)}. ${readableSize(IMAGE_MAX_BYTES)} is the most the website takes — shrink it to use it.`,
    };
  }
  if (bytes > IMAGE_WARN_BYTES) {
    return {
      level: 'warn',
      message: `This image is ${readableSize(bytes)}. Anything over ${readableSize(IMAGE_WARN_BYTES)} slows the page down on a phone.`,
    };
  }
  return { level: 'ok' };
}

/** The width an oversized image is brought down to. Wide enough for a full-width screenshot on a large display. */
export const SHRINK_TO_WIDTH = 2000;
