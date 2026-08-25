import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inflateSync } from "node:zlib";

const assetPath = new URL("../assets/storage/piles/coins.png", import.meta.url);

function parsePng(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  let offset = 8;
  let header;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  return { header, idat: Buffer.concat(idat) };
}

function unfilterRows(data, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const rows = [];
  let offset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = data[offset];
    offset += 1;
    const row = Buffer.from(data.subarray(offset, offset + stride));
    offset += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 0xff;
      else if (filter === 2) row[x] = (row[x] + up) & 0xff;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
      } else assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
    }
    rows.push(row);
    previous = row;
  }
  return rows;
}

test("mixed coin pile is a square PNG with real alpha transparency", async () => {
  const png = await readFile(assetPath);
  const { header, idat } = parsePng(png);

  assert.ok(header);
  assert.ok([4, 6].includes(header.colorType));
  assert.equal(header.bitDepth, 8);
  assert.equal(header.interlace, 0);
  assert.equal(header.width, header.height);

  const bytesPerPixel = header.colorType === 6 ? 4 : 2;
  const rows = unfilterRows(inflateSync(idat), header.width, header.height, bytesPerPixel);
  const alphaOffset = bytesPerPixel - 1;
  const alpha = rows.flatMap((row) => Array.from({ length: header.width }, (_, x) => row[x * bytesPerPixel + alphaOffset]));
  const cornerAlpha = [
    rows[0][alphaOffset],
    rows[0][(header.width - 1) * bytesPerPixel + alphaOffset],
    rows[header.height - 1][alphaOffset],
    rows[header.height - 1][(header.width - 1) * bytesPerPixel + alphaOffset],
  ];

  assert.ok(alpha.some((value) => value < 255));
  assert.ok(alpha.some((value) => value > 0));
  assert.equal(cornerAlpha.some((value) => value === 0), true);
});

for (const denomination of ["cp", "sp", "gp", "pp"]) {
  test(`${denomination} coin icon is a square PNG with real alpha transparency`, async () => {
    const png = await readFile(new URL(`../assets/storage/coins/${denomination}.png`, import.meta.url));
    const { header, idat } = parsePng(png);

    assert.ok(header);
    assert.ok([4, 6].includes(header.colorType));
    assert.equal(header.bitDepth, 8);
    assert.equal(header.interlace, 0);
    assert.equal(header.width, header.height);

    const bytesPerPixel = header.colorType === 6 ? 4 : 2;
    const rows = unfilterRows(inflateSync(idat), header.width, header.height, bytesPerPixel);
    const alphaOffset = bytesPerPixel - 1;
    const alpha = rows.flatMap((row) => Array.from({ length: header.width }, (_, x) => row[x * bytesPerPixel + alphaOffset]));
    assert.ok(alpha.some((value) => value === 0));
    assert.ok(alpha.some((value) => value > 0));
  });
}

for (const file of ["journal-note.png", "journal-notes.png"]) {
  test(`${file} is a square PNG with real alpha transparency`, async () => {
    const png = await readFile(new URL(`../assets/storage/piles/${file}`, import.meta.url));
    const { header, idat } = parsePng(png);
    assert.ok(header);
    assert.ok([4, 6].includes(header.colorType));
    assert.equal(header.bitDepth, 8);
    assert.equal(header.interlace, 0);
    assert.equal(header.width, header.height);
    const bytesPerPixel = header.colorType === 6 ? 4 : 2;
    const rows = unfilterRows(inflateSync(idat), header.width, header.height, bytesPerPixel);
    const alphaOffset = bytesPerPixel - 1;
    const alpha = rows.flatMap((row) => Array.from(
      { length: header.width }, (_, x) => row[x * bytesPerPixel + alphaOffset]
    ));
    assert.ok(alpha.some((value) => value === 0));
    assert.ok(alpha.some((value) => value > 0));
  });
}
