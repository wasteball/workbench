import { mkdirSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'public/icon');
mkdirSync(outputDirectory, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    rows[rowStart] = 0;
    pixels.copy(rows, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + amount * dx), py - (ay + amount * dy));
}

function insideRoundedSquare(x, y, size, radius) {
  const edge = size - 1;
  const closestX = Math.max(radius, Math.min(edge - radius, x));
  const closestY = Math.max(radius, Math.min(edge - radius, y));
  return Math.hypot(x - closestX, y - closestY) <= radius;
}

function drawIcon(size) {
  const scale = 4;
  const canvasSize = size * scale;
  const source = new Uint8Array(canvasSize * canvasSize * 4);
  const ink = [13, 37, 61, 255];
  const indigo = [83, 58, 253, 255];
  const white = [255, 255, 255, 255];
  const transparent = [0, 0, 0, 0];
  const radius = canvasSize * 0.2;
  const points = [[0.27, 0.29], [0.4, 0.73], [0.54, 0.49], [0.68, 0.73], [0.83, 0.29]];
  const stroke = canvasSize * 0.075;

  for (let y = 0; y < canvasSize; y += 1) {
    for (let x = 0; x < canvasSize; x += 1) {
      const offset = (y * canvasSize + x) * 4;
      let color = insideRoundedSquare(x, y, canvasSize, radius) ? ink : transparent;
      if (color === ink && x >= canvasSize * 0.13 && x <= canvasSize * 0.19 && y >= canvasSize * 0.2 && y <= canvasSize * 0.8) color = indigo;
      for (let index = 0; index < points.length - 1; index += 1) {
        const [ax, ay] = points[index];
        const [bx, by] = points[index + 1];
        if (distanceToSegment(x, y, ax * canvasSize, ay * canvasSize, bx * canvasSize, by * canvasSize) <= stroke) color = white;
      }
      source.set(color, offset);
    }
  }

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const sourceOffset = (((y * scale + sy) * canvasSize) + x * scale + sx) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += source[sourceOffset + channel];
        }
      }
      const targetOffset = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) pixels[targetOffset + channel] = Math.round(sums[channel] / (scale * scale));
    }
  }
  return encodePng(size, size, pixels);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(outputDirectory, `${size}.png`), drawIcon(size));
}
