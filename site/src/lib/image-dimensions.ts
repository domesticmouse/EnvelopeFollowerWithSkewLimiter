import fs from 'node:fs';

/** Intrinsic pixel dimensions of a raster image. */
export interface ImageDimensions {
  width: number;
  height: number;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parsePngDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24) {
    return null;
  }
  if (!buf.subarray(0, 8).equals(PNG_SIG)) {
    return null;
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    return null;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function parseWebpDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 30) {
    return null;
  }
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }

  const chunkType = buf.toString('ascii', 12, 16);
  if (chunkType === 'VP8X' && buf.length >= 30) {
    const width = 1 + (buf.readUIntLE(24, 3));
    const height = 1 + (buf.readUIntLE(27, 3));
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (chunkType === 'VP8 ' && buf.length >= 30) {
    // Key-frame start code 0x9d 0x01 0x2a sits at bytes 23..25
    if (buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }

  if (chunkType === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
    const b0 = buf[21] ?? 0;
    const b1 = buf[22] ?? 0;
    const b2 = buf[23] ?? 0;
    const b3 = buf[24] ?? 0;
    const width = 1 + (b0 | ((b1 & 0x3f) << 8));
    const height = 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
    return width > 0 && height > 0 ? { width, height } : null;
  }

  return null;
}

/**
 * Read exact PNG or WebP pixel dimensions directly from file header bytes at build time
 * without reading entire payloads into memory or relying on external image binaries.
 */
export function readImageDimensions(absFilePath: string): ImageDimensions | null {
  let fd: number;
  try {
    fd = fs.openSync(absFilePath, 'r');
  } catch {
    return null;
  }

  try {
    const header = Buffer.alloc(48);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    const slice = header.subarray(0, bytesRead);
    return parsePngDimensions(slice) ?? parseWebpDimensions(slice);
  } finally {
    fs.closeSync(fd);
  }
}
