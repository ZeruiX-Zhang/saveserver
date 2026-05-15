// Perceptual hash (pHash) computation using DCT-II.
//
// Pipeline: decode image → resize to 32×32 greyscale → 2D DCT → take
// top-left 8×8 low-frequency block (skip DC) → median threshold → 64-bit
// hash, encoded as a 16-char lowercase hex string.
//
// Hamming distance between two hashes is the count of differing bits;
// distance ≤ 10 typically indicates "same image with minor edits".

const sharp = require("sharp");

const SAMPLE_SIZE = 32;
const HASH_SIZE = 8;

function dct1d(input) {
  const N = input.length;
  const out = new Float64Array(N);
  const coef = Math.PI / N;
  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += input[n] * Math.cos(coef * (n + 0.5) * k);
    }
    out[k] = sum;
  }
  return out;
}

function dct2d(matrix, size) {
  const rowResults = new Array(size);
  for (let y = 0; y < size; y++) {
    const row = new Float64Array(size);
    for (let x = 0; x < size; x++) {
      row[x] = matrix[y * size + x];
    }
    rowResults[y] = dct1d(row);
  }
  const out = new Float64Array(size * size);
  for (let x = 0; x < size; x++) {
    const col = new Float64Array(size);
    for (let y = 0; y < size; y++) {
      col[y] = rowResults[y][x];
    }
    const colDct = dct1d(col);
    for (let y = 0; y < size; y++) {
      out[y * size + x] = colDct[y];
    }
  }
  return out;
}

async function computePhash(buffer) {
  const { data } = await sharp(buffer)
    .greyscale()
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const matrix = new Float64Array(SAMPLE_SIZE * SAMPLE_SIZE);
  for (let i = 0; i < matrix.length; i++) {
    matrix[i] = data[i];
  }

  const dct = dct2d(matrix, SAMPLE_SIZE);

  const lowFreq = new Float64Array(HASH_SIZE * HASH_SIZE);
  for (let y = 0; y < HASH_SIZE; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      lowFreq[y * HASH_SIZE + x] = dct[y * SAMPLE_SIZE + x];
    }
  }

  // Median over the 63 non-DC coefficients (skip lowFreq[0]).
  const tail = Array.from(lowFreq.slice(1)).sort((a, b) => a - b);
  const median = tail[Math.floor(tail.length / 2)];

  let hex = "";
  for (let i = 0; i < lowFreq.length; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) {
      nibble = (nibble << 1) | (lowFreq[i + j] > median ? 1 : 0);
    }
    hex += nibble.toString(16);
  }
  return hex;
}

const POPCOUNT = new Uint8Array(16);
for (let i = 0; i < 16; i++) {
  let v = i;
  let c = 0;
  while (v) {
    c += v & 1;
    v >>= 1;
  }
  POPCOUNT[i] = c;
}

function hammingDistance(hexA, hexB) {
  if (typeof hexA !== "string" || typeof hexB !== "string") return Infinity;
  if (hexA.length !== hexB.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < hexA.length; i++) {
    const xor = (parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16)) & 0xf;
    dist += POPCOUNT[xor];
  }
  return dist;
}

function decodeImageInput(input) {
  // Accepts either:
  //   - data URL (data:image/png;base64,...) — but skip SVG (placeholder)
  //   - bare base64 string
  //   - Buffer
  if (Buffer.isBuffer(input)) return input;
  if (typeof input !== "string") return null;
  if (/^data:image\/svg/i.test(input)) return null;
  const match = input.match(/^data:image\/[a-z+.-]+;base64,(.+)$/i);
  const base64 = match ? match[1] : input;
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

module.exports = {
  computePhash,
  hammingDistance,
  decodeImageInput,
};
