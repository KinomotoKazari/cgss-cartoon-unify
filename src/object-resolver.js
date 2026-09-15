import {decodeObject, readSerializedFile} from './serialized-file.js';

export const basename = path => path.replaceAll('\\', '/').split('/').at(-1);
export const pairs = list => Object.fromEntries((list || []).map(({Key, Value}) => [Key, Value]));

export function* references(value) {
  // Walk decoded data and yield non-null PPtr values for closure collection.
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return;
  if ('m_PathID' in value && 'm_FileID' in value) {
    if (String(value.m_PathID) !== '0') yield value;
  } else for (const child of Object.values(value)) yield* references(child);
}

export class ObjectResolver {
  constructor(bundle) {
    // Index every serialized object once so PPtr resolution stays constant-time.
    this.bundle = bundle;
    this.files = new Map();
    this.objects = new Map();
    for (const entry of bundle.files.values()) {
      if (!(entry.flags & 4)) continue;
      const file = readSerializedFile(entry);
      this.files.set(file.path, file);
      for (const object of file.objects.values()) {
        object.key = `${file.path}:${object.pathId}`;
        this.objects.set(object.key, object);
      }
    }
    if (!this.files.size) throw new Error('No serialized files found in bundle');
  }
  data(object) { return decodeObject(this.files.get(object.file), object); }
  resolve(owner, pointer) {
    if (!pointer || String(pointer.m_PathID) === '0') return null;
    let file = this.files.get(owner.file);
    if (pointer.m_FileID !== 0) {
      const target = file.externals[pointer.m_FileID - 1];
      const candidates = [...this.files.values()].filter(entry => entry.path === target || basename(entry.path) === basename(target || ''));
      if (candidates.length !== 1) throw new Error(`Missing or ambiguous dependency: ${target || pointer.m_FileID}`);
      file = candidates[0];
    }
    const result = file.objects.get(String(pointer.m_PathID));
    if (!result) throw new Error(`Missing ${file.path} object ${pointer.m_PathID}`);
    return result;
  }
  closure(roots) {
    // Include prefabs, textures, materials, and transforms reachable from selected roots.
    const seen = new Map(), pending = [...roots];
    while (pending.length) {
      const object = pending.pop();
      if (seen.has(object.key)) continue;
      seen.set(object.key, object);
      // Shader bytecode isn't needed by the browser renderer.
      if (object.type === 'Shader') continue;
      for (const pointer of references(this.data(object))) pending.push(this.resolve(object, pointer));
    }
    return seen;
  }
  resource(path) {
    // Texture streams usually use an exact path, with basename fallback for renamed bundles.
    const exact = this.bundle.files.get(path);
    if (exact) return exact.bytes;
    const candidates = [...this.bundle.files.values()].filter(file => basename(file.path) === basename(path));
    if (candidates.length !== 1) throw new Error(`Missing or ambiguous texture resource: ${path}`);
    return candidates[0].bytes;
  }
}
