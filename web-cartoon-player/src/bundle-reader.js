import {Reader, safeNumber, MAX_BYTES} from './binary-reader.js';
import {decompress} from './lz4.js';

export function readBundle(input) {
  // UnityFS stores compressed block metadata separately from its file directory.
  const reader = new Reader(input);
  if (reader.bytes.length > MAX_BYTES) throw new Error('Bundle exceeds 512 MB');
  if (reader.cstring() !== 'UnityFS') throw new Error('Expected a UnityFS bundle');
  const version = reader.u32();
  if (version !== 6 && version !== 7) throw new Error(`Unsupported UnityFS version ${version}`);
  const playerVersion = reader.cstring(), unityVersion = reader.cstring();
  const size = safeNumber(reader.i64()), compressedSize = reader.u32(), infoSize = reader.u32(), flags = reader.u32();
  if (size !== reader.bytes.length) throw new Error('Bundle size does not match its header');
  if (!(flags & 0x40)) throw new Error('Separate bundle directories are not supported');
  if (version >= 7) reader.align(16);
  // Keep the data start because newer bundles may place directory data at the end.
  const dataStart = reader.pos;
  if (flags & 0x80) reader.pos = size - compressedSize;
  const info = new Reader(decompress(reader.take(compressedSize), infoSize, flags & 0x3f));
  if (flags & 0x80) reader.pos = dataStart;
  if (flags & 0x200) reader.align(16);
  const dataEnd = flags & 0x80 ? size - compressedSize : size;
  info.skip(16);
  const blocks = Array.from({length: info.count()}, () => ({size: info.u32(), packed: info.u32(), flags: info.u16()}));
  const nodes = Array.from({length: info.count()}, () => ({offset: safeNumber(info.i64()), size: safeNumber(info.i64()), flags: info.u32(), path: info.cstring()}));
  const total = blocks.reduce((sum, block) => sum + block.size, 0);
  if (total > MAX_BYTES) throw new Error('Expanded bundle exceeds 512 MB');
  // Reassemble storage blocks before slicing the named files from the directory.
  const unpacked = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    if (reader.pos + block.packed > dataEnd) throw new Error('Storage block extends outside bundle data');
    unpacked.set(decompress(reader.take(block.packed), block.size, block.flags & 0x3f), offset);
    offset += block.size;
  }
  const files = new Map();
  for (const node of nodes) {
    if (node.offset + node.size > total || files.has(node.path)) throw new Error('Invalid bundle directory');
    files.set(node.path, {...node, bytes: unpacked.subarray(node.offset, node.offset + node.size)});
  }
  return {version, playerVersion, unityVersion, files};
}
