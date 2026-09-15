const utf8 = new TextDecoder();
export const MAX_BYTES = 512 * 1024 * 1024;

// Convert offsets read as 64-bit values without losing JavaScript precision.
export function safeNumber(value, label = 'offset') {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${label}: ${value}`);
  return number;
}

export class Reader {
  // Small bounds-checked reader shared by UnityFS and serialized-file parsers.
  constructor(bytes, littleEndian = false) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.pos = 0;
    this.le = littleEndian;
  }
  need(count) {
    if (!Number.isSafeInteger(this.pos) || this.pos < 0 || !Number.isSafeInteger(count) || count < 0 || this.pos + count > this.bytes.length) {
      throw new Error(`Truncated data at ${this.pos}: need ${count} bytes`);
    }
  }
  // Return a view into the source buffer and advance the cursor.
  take(count) { this.need(count); const start = this.pos; this.pos += count; return this.bytes.subarray(start, this.pos); }
  skip(count) { this.take(count); }
  align(size = 4) { this.skip((size - this.pos % size) % size); }
  read(method, size) { this.need(size); const result = this.view[method](this.pos, this.le); this.pos += size; return result; }
  u8() { return this.read('getUint8', 1); }
  i8() { return this.read('getInt8', 1); }
  u16() { return this.read('getUint16', 2); }
  i16() { return this.read('getInt16', 2); }
  u32() { return this.read('getUint32', 4); }
  i32() { return this.read('getInt32', 4); }
  u64() { return this.read('getBigUint64', 8); }
  i64() { return this.read('getBigInt64', 8); }
  f32() { return this.read('getFloat32', 4); }
  f64() { return this.read('getFloat64', 8); }
  count(limit = 1_000_000) {
    const count = this.i32();
    if (count < 0 || count > limit) throw new Error(`Invalid collection size: ${count}`);
    return count;
  }
  // Unity strings are NUL-terminated in headers and aligned length-prefixed in values.
  cstring(limit = 16384) {
    const start = this.pos;
    while (this.u8() !== 0) if (this.pos - start > limit) throw new Error('Unterminated string');
    return utf8.decode(this.bytes.subarray(start, this.pos - 1));
  }
  string() { const value = utf8.decode(this.take(this.count(MAX_BYTES))); this.align(); return value; }
}
