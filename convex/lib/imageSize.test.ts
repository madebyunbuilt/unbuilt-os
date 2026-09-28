import { describe, expect, it } from 'vitest';
import { imageSize } from './imageSize';

// Reading an image's pixel size from its header (convex/lib/imageSize.ts).
//
// The fixtures are real files, made by real encoders at 7 by 3 pixels, not bytes written by hand to match this parser.
// Hand-made bytes would only prove the parser agrees with itself. Seven by three also catches the transposition this is
// easy to get wrong: JPEG stores height before width, and a square fixture would hide it.

const at7x3 = {
  png:
    'iVBORw0KGgoAAAANSUhEUgAAAAcAAAADCAIAAADQoYKSAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAA' +
    'GgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAB6ADAAQAAAABAAAAAwAAAAAk1nmWAAAAQ0lEQVQIHRWKoREAMQjAoH9XjhEQ' +
    'VUzQYVkNjWMBBPJpZJIPAIjonMPMVYWIYx733sx0dzNT1TGvzCsia629d0R09w/YRRFdE+YUoQAAAABJRU5ErkJggg==',
  jpeg:
    '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQA' +
    'AAABAAAAB6ADAAQAAAABAAAAAwAAAAD/wAARCAADAAcDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL' +
    '/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
    'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
    'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgEC' +
    'BAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZH' +
    'SElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU' +
    '1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwM' +
    'DAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ' +
    'EBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD8W9a8SX2ofCzR9CuLawWDTpSIpYtOs4bsh2kYiS7jhW4lGe0kjYAAHAAH' +
    'kdd7e/8AIjWv/XVf/Z64KgD/2Q==',
  gif:
    'R0lGODdhBwADALMAAAAAAAgICBkZGSEhISgoKDExMZWVldbW1ufn5////wAAAAAAAAAAAAAAAAAAAAAAACH5BAQAAAAAIf8LWE1Q' +
    'IERhdGFYTVD/PHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNi4wLjAiPgogICA8' +
    'cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRm' +
    'OkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczpleGlmPSJodHRwOi8vbnMuYWRvYmUuY29tL2V4aWYv' +
    'MS4wLyI+CiAgICAgICAgIDxleGlmOkNvbG9yU3BhY2U+MTwvZXhpsmY6Q29sb3JTcGFjZT4KICAgICAgICAgPGV4aWY6UGl4ZWxY' +
    'RGltZW5zaW9uPjc8L2V4aWY6UGl4ZWxYRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpQaXhlbFlEaW1lbnNpb24+MzwvZXhpZjpQ' +
    'aXhlbFlEaW1lbnNpb24+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgoALAAAAAAH' +
    'AAMAAAQNEIAhpCzomGHHIAEQAQA7',
  'lossy WebP':
    'UklGRkQAAABXRUJQVlA4IDgAAACQAQCdASoHAAMAAgA0JaQAAlw+liwA/vuhzuzMrZh9ycnhhIPz/+5YkbWg3mCYO9+cqjwGAAAA' + 'AA==',
  'lossless WebP':
    'UklGRmIAAABXRUJQVlA4TFUAAAAvBoAAAGegqG0bONnu3rOQxmWK2raBk+3uPQtpXKaobRs42e7es5DGZfMfAJJUVUiSpLuZGZIy' +
    '0+76f3dHEhgEmGYIIYSRQCiXOMWBDhrR/3DF/eIJAA==',
  'extended WebP':
    'UklGRsAAAABXRUJQVlA4WAoAAAAIAAAABgAAAgAAVlA4TFUAAAAvBoAAAGegqG0bONnu3rOQxmWK2raBk+3uPQtpXKaobRs42e7e' +
    's5DGZfMfAJJUVUiSpLuZGZIy0+76f3dHEhgEmGYIIYSRQCiXOMWBDhrR/3DF/eIJAEVYSUZEAAAATU0AKgAAAAgAAYdpAAQAAAAB' +
    'AAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAB6ADAAQAAAABAAAAAwAAAAA=',
};

const bytesOf = (base64: string) => Uint8Array.from(Buffer.from(base64, 'base64'));

describe('reading a size out of a header', () => {
  for (const [format, base64] of Object.entries(at7x3)) {
    it(`reads a ${format}`, () => {
      expect(imageSize(bytesOf(base64))).toEqual({ width: 7, height: 3 });
    });
  }
});

describe('what it will not guess at', () => {
  it('says nothing for a format it does not know', () => {
    expect(imageSize(new TextEncoder().encode('<svg viewBox="0 0 10 10"></svg>'))).toBeNull();
    expect(imageSize(new TextEncoder().encode('not an image at all'))).toBeNull();
  });

  it('says nothing rather than something wrong when the header is cut short', () => {
    for (const base64 of Object.values(at7x3)) {
      const full = bytesOf(base64);
      // Enough to recognise the format, not enough to hold the size.
      expect(imageSize(full.subarray(0, 8))).toBeNull();
    }
  });

  it('says nothing for an empty file', () => {
    expect(imageSize(new Uint8Array())).toBeNull();
  });

  it('reads the size out of a view into a larger buffer', () => {
    // The bytes come back from storage as a slice, so the parser must respect byteOffset rather than assume zero.
    const full = bytesOf(at7x3.png);
    const padded = new Uint8Array(full.length + 16);
    padded.set(full, 16);
    expect(imageSize(padded.subarray(16))).toEqual({ width: 7, height: 3 });
  });
});
