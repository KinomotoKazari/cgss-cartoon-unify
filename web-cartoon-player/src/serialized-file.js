import {Reader, safeNumber} from './binary-reader.js';
import {readTree, readValue} from './type-tree.js';

export const classes = {1:'GameObject', 4:'Transform', 21:'Material', 28:'Texture2D', 48:'Shader', 49:'TextAsset', 114:'MonoBehaviour', 115:'MonoScript', 142:'AssetBundle', 198:'ParticleSystem', 199:'ParticleSystemRenderer'};

// Read one serialized asset file and retain the TypeTree for lazy object decoding.
export function readSerializedFile(file) {
  const reader = new Reader(file.bytes);
  let metadataSize = reader.u32(), size = reader.u32();
  const version = reader.u32();
  let dataOffset = reader.u32();
  if (![17,22].includes(version)) throw new Error(`Unsupported serialized file version ${version} in ${file.path}`);
  const endian = reader.u8(); reader.skip(3);
  if (version >= 22) { metadataSize = reader.u32(); size = safeNumber(reader.i64()); dataOffset = safeNumber(reader.i64()); reader.skip(8); }
  if (size !== file.bytes.length || dataOffset > size || metadataSize > size) throw new Error('Invalid serialized file header');
  reader.le = endian === 0;
  const unityVersion = reader.cstring(), platform = reader.i32(), hasTypeTree = reader.u8() !== 0;
  if (!hasTypeTree) throw new Error(`Missing TypeTree in ${file.path}; stripped bundles are not supported`);
  // Type records describe object layouts; reference records have a slightly different header.
  const readType = (isReference = false) => {
    const classId = reader.i32(), stripped = reader.u8(), scriptIndex = reader.i16();
    if ((isReference && scriptIndex >= 0) || (!isReference && classId === 114)) reader.skip(16);
    reader.skip(16);
    const tree = readTree(reader, version);
    if (classId === 49) for (const child of tree.children) if (child.name === 'm_Script') child.binaryScript = true;
    if (version >= 21) {
      if (isReference) { reader.cstring(); reader.cstring(); reader.cstring(); }
      else reader.skip(reader.count() * 4);
    }
    return {classId, stripped, scriptIndex, tree};
  };
  const types = Array.from({length: reader.count(10000)}, () => readType());
  const objects = new Map();
  const count = reader.count();
  for (let i = 0; i < count; i++) {
    reader.align();
    const pathId = reader.i64().toString();
    const start = safeNumber(version >= 22 ? reader.i64() : reader.u32()) + dataOffset;
    const length = reader.u32(), typeIndex = reader.i32(), type = types[typeIndex];
    if (!type || start + length > size || objects.has(pathId)) throw new Error('Invalid object table');
    objects.set(pathId, {pathId, file: file.path, type: classes[type.classId] || `Class${type.classId}`, classId: type.classId, byteSize: length, bytes: file.bytes.subarray(start, start + length), tree: type.tree});
  }
  const scripts = reader.count();
  for (let i = 0; i < scripts; i++) { reader.i32(); reader.align(); reader.i64(); }
  const externals = Array.from({length: reader.count(10000)}, () => {
    reader.cstring(); reader.skip(16); reader.i32(); return reader.cstring();
  });
  if (version >= 20) { const references = reader.count(10000); for (let i = 0; i < references; i++) readType(true); }
  reader.cstring();
  if (reader.pos > dataOffset) throw new Error('Metadata overlaps object data');
  return {path: file.path, version, unityVersion, platform, types, objects, externals, littleEndian: reader.le};
}

export function decodeObject(file, object) {
  // Cache decoded data because prefab traversal revisits the same Unity objects.
  if (object.data) return object.data;
  const reader = new Reader(object.bytes, file.littleEndian);
  try {
    const data = readValue(reader, object.tree);
    if (reader.pos !== object.byteSize) throw new Error(`Read ${reader.pos} of ${object.byteSize} bytes`);
    object.data = data;
    object.name = data.m_Name || '';
    return object.data;
  } catch (error) { throw new Error(`${object.type} ${object.pathId}: ${error.message}`); }
}
