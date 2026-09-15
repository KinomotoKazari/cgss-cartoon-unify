import {Reader, safeNumber, MAX_BYTES} from './binary-reader.js';

const modifiers = [[2,8,-2,-8],[5,17,-5,-17],[9,29,-9,-29],[13,42,-13,-42],[18,60,-18,-60],[24,80,-24,-80],[33,106,-33,-106],[47,183,-47,-183]];
const clamp = x => Math.min(255, Math.max(0, x));
const sign3 = x => (x & 4) ? x - 8 : x;
const expand5 = x => (x << 3) | (x >>> 2);

function decodeETC(bytes, width, height, output) {
  // Decode ETC1 RGB blocks into the RGBA buffer used by browser canvases.
  const reader = new Reader(bytes);
  reader.need(Math.ceil(width / 4) * Math.ceil(height / 4) * 8);
  for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) {
    const high = reader.u32(), low = reader.u32();
    const flip = high & 1, differential = high & 2;
    const colors = [[], []];
    for (let channel = 0; channel < 3; channel++) {
      const shift = 24 - channel * 8;
      const value = (high >>> shift) & 255;
      if (differential) {
        const first = value >>> 3, second = first + sign3(value & 7);
        if (second < 0 || second > 31) throw new Error('Invalid ETC1 differential block');
        colors[0].push(expand5(first)); colors[1].push(expand5(second));
      } else { colors[0].push((value >>> 4) * 17); colors[1].push((value & 15) * 17); }
    }
    const tables = [modifiers[(high >>> 5) & 7], modifiers[(high >>> 2) & 7]];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      if (bx + x >= width || by + y >= height) continue;
      const bit = x * 4 + y, group = flip ? y >>> 1 : x >>> 1;
      const index = ((low >>> bit) & 1) | (((low >>> (bit + 16)) & 1) << 1);
      const delta = tables[group][index], offset = ((by + y) * width + bx + x) * 4;
      for (let c = 0; c < 3; c++) output[offset + c] = clamp(colors[group][c] + delta);
      output[offset + 3] = 255;
    }
  }
}

export function decodePixels(bytes, width, height, format) {
  // Convert the texture formats observed in supported card bundles to RGBA.
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height * 4 > MAX_BYTES / 2) throw new Error('Invalid or oversized texture dimensions');
  const output = new Uint8Array(width * height * 4);
  if (format === 34) decodeETC(bytes, width, height, output);
  else {
    const pixelSize = {1:1, 3:3, 4:4, 7:2}[format];
    if (!pixelSize) throw new Error(`Unsupported Texture2D format ${format}; supported: Alpha8, RGB24, RGBA32, RGB565, ETC_RGB4`);
    const reader = new Reader(bytes, true);
    reader.need(width * height * pixelSize);
    for (let i = 0; i < width * height; i++) {
      const p = i * 4;
      if (format === 1) { output[p] = output[p+1] = output[p+2] = 255; output[p+3] = reader.u8(); }
      else if (format === 7) {
        const v = reader.u16(), g = (v >>> 5) & 63;
        output[p] = expand5(v >>> 11); output[p+1] = (g << 2) | (g >>> 4); output[p+2] = expand5(v & 31); output[p+3] = 255;
      } else { output[p] = reader.u8(); output[p+1] = reader.u8(); output[p+2] = reader.u8(); output[p+3] = format === 4 ? reader.u8() : 255; }
    }
  }
  // Unity texture rows run bottom to top.
  const flipped = new Uint8Array(output.length), row = width * 4;
  for (let y = 0; y < height; y++) flipped.set(output.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  return flipped;
}

export function decodeTexture(resolver, object) {
  // Texture2D data can be embedded or stored in a streamed resource file.
  const data = resolver.data(object);
  if (data.m_TextureDimension !== 2 || data.m_ImageCount !== 1) throw new Error(`Only 2D textures are supported: ${data.m_Name}`);
  let bytes = data['image data'];
  if (!bytes?.length) {
    const stream = data.m_StreamData;
    if (!stream?.path) throw new Error(`Missing texture pixels: ${data.m_Name}`);
    const resource = resolver.resource(stream.path), start = safeNumber(stream.offset), size = safeNumber(stream.size);
    if (start + size > resource.length) throw new Error(`Texture resource range is invalid: ${data.m_Name}`);
    bytes = resource.subarray(start, start + size);
  }
  return {id: object.key, name: data.m_Name, width: data.m_Width, height: data.m_Height, format: data.m_TextureFormat, rgba: decodePixels(bytes, data.m_Width, data.m_Height, data.m_TextureFormat)};
}
