import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const iconPath = path.join(rootDir, "assets", "icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const superSample = 3;

function createIcon(iconSizes) {
  const images = iconSizes.map((size) => createBitmapIconImage(size));
  const headerSize = 6 + images.length * 16;
  const totalSize = headerSize + images.reduce((sum, image) => sum + image.length, 0);
  const output = Buffer.alloc(totalSize);

  output.writeUInt16LE(0, 0);
  output.writeUInt16LE(1, 2);
  output.writeUInt16LE(images.length, 4);

  let imageOffset = headerSize;
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const size = iconSizes[index];
    const entryOffset = 6 + index * 16;

    output.writeUInt8(size === 256 ? 0 : size, entryOffset);
    output.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    output.writeUInt8(0, entryOffset + 2);
    output.writeUInt8(0, entryOffset + 3);
    output.writeUInt16LE(1, entryOffset + 4);
    output.writeUInt16LE(32, entryOffset + 6);
    output.writeUInt32LE(image.length, entryOffset + 8);
    output.writeUInt32LE(imageOffset, entryOffset + 12);

    image.copy(output, imageOffset);
    imageOffset += image.length;
  }

  return output;
}

function createBitmapIconImage(size) {
  const xorStride = size * 4;
  const xorBytes = xorStride * size;
  const maskStride = Math.ceil(size / 32) * 4;
  const maskBytes = maskStride * size;
  const image = Buffer.alloc(40 + xorBytes + maskBytes);

  image.writeUInt32LE(40, 0);
  image.writeInt32LE(size, 4);
  image.writeInt32LE(size * 2, 8);
  image.writeUInt16LE(1, 12);
  image.writeUInt16LE(32, 14);
  image.writeUInt32LE(0, 16);
  image.writeUInt32LE(xorBytes, 20);
  image.writeInt32LE(0, 24);
  image.writeInt32LE(0, 28);
  image.writeUInt32LE(0, 32);
  image.writeUInt32LE(0, 36);

  let offset = 40;
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const pixel = renderPixel(x, y, size);
      image.writeUInt8(pixel.b, offset);
      image.writeUInt8(pixel.g, offset + 1);
      image.writeUInt8(pixel.r, offset + 2);
      image.writeUInt8(pixel.a, offset + 3);
      offset += 4;
    }
  }

  return image;
}

function renderPixel(x, y, size) {
  let alphaSum = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  const sampleCount = superSample * superSample;

  for (let sy = 0; sy < superSample; sy += 1) {
    for (let sx = 0; sx < superSample; sx += 1) {
      const px = (x + (sx + 0.5) / superSample) / size;
      const py = (y + (sy + 0.5) / superSample) / size;
      const sample = renderSample(px, py);

      alphaSum += sample.a;
      redSum += sample.r * sample.a;
      greenSum += sample.g * sample.a;
      blueSum += sample.b * sample.a;
    }
  }

  const alpha = alphaSum / sampleCount;
  if (alpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: Math.round(redSum / alphaSum),
    g: Math.round(greenSum / alphaSum),
    b: Math.round(blueSum / alphaSum),
    a: Math.round(alpha * 255)
  };
}

function renderSample(x, y) {
  const rounded = insideRoundedRect(x, y, 0.211);
  if (!rounded) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  let color = backgroundColor(x, y);
  color = composite(color, { r: 255, g: 255, b: 255, a: shineAlpha(x, y) });

  if (distanceToPolyline(x, y, sPath) < 0.054) {
    color = composite(color, { r: 255, g: 255, b: 255, a: 0.96 });
  }

  if (distanceToPolyline(x, y, arrowPath) < 0.031) {
    color = composite(color, { r: 191, g: 248, b: 255, a: 0.94 });
  }

  return { ...color, a: 1 };
}

function insideRoundedRect(x, y, radius) {
  const dx = Math.abs(x - 0.5) - (0.5 - radius);
  const dy = Math.abs(y - 0.5) - (0.5 - radius);
  const outsideX = Math.max(dx, 0);
  const outsideY = Math.max(dy, 0);
  const outsideDistance = Math.hypot(outsideX, outsideY);
  const insideDistance = Math.min(Math.max(dx, dy), 0);

  return outsideDistance + insideDistance <= radius;
}

function backgroundColor(x, y) {
  const t = clamp((x * 0.52 + y * 0.48 - 0.04) / 0.92, 0, 1);
  const first = { r: 18, g: 100, b: 216 };
  const second = { r: 15, g: 143, b: 189 };
  const third = { r: 20, g: 178, b: 122 };

  if (t < 0.58) {
    return mix(first, second, t / 0.58);
  }

  return mix(second, third, (t - 0.58) / 0.42);
}

function shineAlpha(x, y) {
  const dx = (x - 0.38) / 0.52;
  const dy = (y - 0.2) / 0.7;
  const value = 1 - Math.hypot(dx, dy);

  return clamp(value * 0.24, 0, 0.24);
}

function composite(base, top) {
  return {
    r: Math.round(top.r * top.a + base.r * (1 - top.a)),
    g: Math.round(top.g * top.a + base.g * (1 - top.a)),
    b: Math.round(top.b * top.a + base.b * (1 - top.a))
  };
}

function distanceToPolyline(x, y, points) {
  let min = Number.POSITIVE_INFINITY;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    min = Math.min(min, distanceToSegment(x, y, start.x, start.y, end.x, end.y));
  }

  return min;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : clamp((wx * vx + wy * vy) / lengthSquared, 0, 1);
  const x = ax + t * vx;
  const y = ay + t * vy;

  return Math.hypot(px - x, py - y);
}

function sampleCubicPath(segments, steps) {
  const points = [];

  for (const segment of segments) {
    for (let index = points.length === 0 ? 0 : 1; index <= steps; index += 1) {
      points.push(cubic(segment, index / steps));
    }
  }

  return points;
}

function cubic(segment, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  return {
    x:
      mt2 * mt * segment[0].x +
      3 * mt2 * t * segment[1].x +
      3 * mt * t2 * segment[2].x +
      t2 * t * segment[3].x,
    y:
      mt2 * mt * segment[0].y +
      3 * mt2 * t * segment[1].y +
      3 * mt * t2 * segment[2].y +
      t2 * t * segment[3].y
  };
}

function point(x, y) {
  return { x: x / 256, y: y / 256 };
}

function mix(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t)
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const sPath = sampleCubicPath(
  [
    [point(172, 71), point(147, 53), point(99, 57), point(83, 83)],
    [point(83, 83), point(69, 106), point(87, 129), point(124, 136)],
    [point(124, 136), point(156, 142), point(169, 153), point(159, 171)],
    [point(159, 171), point(147, 192), point(104, 194), point(73, 173)]
  ],
  24
);

const arrowPath = [
  point(179, 157),
  point(179, 190),
  point(146, 190)
];

mkdirSync(path.dirname(iconPath), { recursive: true });
writeFileSync(iconPath, createIcon(sizes));

console.log(`Generated ${path.relative(rootDir, iconPath)} (${sizes.join(", ")} px)`);
