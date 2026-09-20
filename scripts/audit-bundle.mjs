import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {readBundle} from '../src/bundle-reader.js';
import {ObjectResolver, references} from '../src/object-resolver.js';
import {decompress} from '../src/lz4.js';
import '../runtime/cgss_skel_parser.js';

// Inspect the complete object table, including unnamed and unreachable objects.
// Keep reports local: shader programs and asset metadata belong to the game.
const [input, output, exportDirectory] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/audit-bundle.mjs <bundle> <output.json> [export-directory]');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(input);
const bundle = readBundle(bytes);
const resolver = new ObjectResolver(bundle);
const objects = [];
const shaderPrograms = [];
const textAssets = new Map();
for (const object of resolver.objects.values()) {
  const entry = {id:object.pathId, type:object.type, classId:object.classId, bytes:object.byteSize};
  try {
    const data = resolver.data(object);
    entry.name = data.m_Name || data.m_ParsedForm?.m_Name || '';
    entry.references = [...references(data)].map(pointer => {
      try { return {id:resolver.resolve(object, pointer).pathId}; }
      catch (error) { return {pointer, error:error.message}; }
    });
    entry.data = data;
    if (object.type === 'TextAsset') {
      textAssets.set(data.m_Name, data.m_Script);
      entry.payloadSha256 = hash(data.m_Script);
      if (data.m_Name.endsWith('.skel')) {
        const b = data.m_Script;
        entry.skeleton = globalThis.CGSSSkelParser.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      }
    }
    if (object.type === 'Shader') {
      // Shader platform payloads are LZ4-compressed independently of UnityFS.
      entry.platformPrograms = data.platforms.flatMap((platform, i) => {
        // Newer serialized shaders store one length/offset per variant inside
        // each platform entry. Older bundles store scalar values instead.
        const asList = value => Array.isArray(value) ? value : [value];
        const offsets = asList(data.offsets[i]);
        const lengths = asList(data.compressedLengths[i]);
        const sizes = asList(data.decompressedLengths[i]);
        if (offsets.length !== lengths.length || offsets.length !== sizes.length)
          throw new Error(`Mismatched shader program ranges for platform ${platform}`);
        return offsets.map((offset, variant) => {
          const packed = new Uint8Array(data.compressedBlob).subarray(offset, offset + lengths[variant]);
          const unpacked = decompress(packed, sizes[variant], 2);
          const text = new TextDecoder().decode(unpacked);
          shaderPrograms.push(text);
          return {platform, variant, sha256:hash(unpacked), bytes:unpacked.length, text};
        });
      });
    }
  } catch (error) { entry.error = error.message; }
  objects.push(entry);
}

// Exported JSON uses a different shape than TypeTree data. Record its full content,
// but only claim byte equality for raw TextAssets. PNG/OBJ are converted formats.
const exports = [];
function visit(directory, relative = '') {
  for (const item of fs.readdirSync(directory, {withFileTypes:true})) {
    const file = path.join(directory, item.name), name = path.posix.join(relative, item.name);
    if (item.isDirectory()) { visit(file, name); continue; }
    const content = fs.readFileSync(file), extension = path.extname(file);
    const entry = {file:name, bytes:content.length, sha256:hash(content)};
    // Preserve 64-bit PathIDs verbatim rather than rounding them through JSON.parse.
    if (extension === '.json') entry.text = content.toString();
    else if (extension === '.asset') {
      const raw = textAssets.get(item.name.replace(/\.asset$/, ''));
      entry.matchesBundlePayload = !!raw && Buffer.from(raw).equals(content);
    } else if (extension === '.shader') {
      const text = content.toString();
      // Compare each exported GLES program against decompressed source, independent
      // of CRLF and disassembler wrapper text. Empty fragment wrappers aren't code.
      const programs = [...text.matchAll(/"\/\/ hash:[^\n]*\n([\s\S]*?)"\s*\}/g)].map(match => match[1].trim());
      const normalize = value => value.replace(/\s+/g, '');
      entry.programs = programs.map(program => ({matchesBundle:shaderPrograms.some(source => normalize(source).includes(normalize(program)))}));
      entry.text = text;
    } else if (extension === '.obj') {
      const lines = content.toString().split(/\r?\n/);
      entry.geometry = Object.fromEntries(['v', 'vt', 'vn', 'f'].map(prefix => [prefix, lines.filter(line => line.startsWith(prefix + ' ')).length]));
      entry.text = content.toString();
    } else if (extension === '.png') {
      entry.dimensions = {width:content.readUInt32BE(16), height:content.readUInt32BE(20)};
    }
    exports.push(entry);
  }
}
if (exportDirectory) visit(exportDirectory);
const counts = {};
for (const object of objects) counts[object.type] = (counts[object.type] || 0) + 1;
const report = {
  bundle:{name:path.basename(input), sha256:hash(bytes), bytes:bytes.length, unityVersion:bundle.unityVersion,
    files:[...bundle.files.values()].map(file => ({path:file.path, bytes:file.bytes.length, flags:file.flags})),
    externals:[...resolver.files.values()].flatMap(file => file.externals)},
  counts, objects, exports
};
fs.mkdirSync(path.dirname(output), {recursive:true});
fs.writeFileSync(output, JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString()
  : ArrayBuffer.isView(value) ? {binaryBytes:value.byteLength, sha256:hash(value)} : value, 2) + '\n');
const errors = objects.filter(object => object.error || object.references?.some(reference => reference.error));
console.log(JSON.stringify({counts, objects:objects.length, exports:exports.length, errors:errors.map(object => ({id:object.id,error:object.error})),
  textAssets:exports.filter(file => 'matchesBundlePayload' in file).map(file => ({file:file.file,match:file.matchesBundlePayload})),
  shaders:exports.filter(file => file.programs).map(file => ({file:file.file,programs:file.programs}))}, null, 2));
if (errors.length) process.exitCode = 1;
