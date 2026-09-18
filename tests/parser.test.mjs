import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Reader, safeNumber} from '../src/binary-reader.js';
import {decompress} from '../src/lz4.js';
import {readBundle} from '../src/bundle-reader.js';
import {readValue} from '../src/type-tree.js';
import {readSerializedFile, decodeObject} from '../src/serialized-file.js';
import {ObjectResolver} from '../src/object-resolver.js';
import {decodePixels} from '../src/texture-decoder.js';

test('int64 object IDs retain all bits', () => {
  const data = new Uint8Array(8), view = new DataView(data.buffer);
  view.setBigInt64(0,-7269900352577466325n,true);
  assert.equal(new Reader(data,true).i64(),-7269900352577466325n);
  assert.throws(() => safeNumber(9007199254740993n));
});
test('binary bounds and alignment reject malformed data', () => {
  const reader = new Reader(new Uint8Array(4));
  reader.pos = -1;
  assert.throws(() => reader.take(1), /Truncated/);
  assert.throws(() => new Reader(new Uint8Array(3)).u32(),/Truncated/);
  assert.throws(() => new Reader(Uint8Array.of(65,65,65)).cstring(1),/Unterminated/);
});
test('failed object decoding does not cache partial data', () => {
  const object = {bytes: Uint8Array.of(1, 2), byteSize: 2, type: 'Example', pathId: '1',
    tree: {type: 'UInt8', meta: 0, children: []}};
  const file = {littleEndian: true};
  assert.throws(() => decodeObject(file, object), /Read 1 of 2/);
  assert.equal(object.data, undefined);
  assert.throws(() => decodeObject(file, object), /Read 1 of 2/);
});
test('LZ4 literals and overlapping matches', () => {
  const packed = Uint8Array.of(0x32,97,98,99,3,0,0x10,33);
  assert.equal(new TextDecoder().decode(decompress(packed,10,3)),'abcabcabc!');
  assert.throws(() => decompress(Uint8Array.of(0,0,0),4,2),/Invalid LZ4/);
  assert.throws(() => decompress(Uint8Array.of(0xf0),12,2),/Truncated/);
  assert.throws(() => decompress(new Uint8Array(),1,1),/Unsupported/);
});
test('bundle reader rejects unsupported signatures and truncation', () => {
  assert.throws(() => readBundle(new TextEncoder().encode('UnityWeb\0')),/Expected a UnityFS/);
  assert.throws(() => readBundle(new TextEncoder().encode('UnityFS\0')),/Truncated/);
});
test('UnityFS 8 reaches normal header parsing', () => {
  const bytes = new Uint8Array(12);
  bytes.set(new TextEncoder().encode('UnityFS\0'));
  new DataView(bytes.buffer).setUint32(8, 8);
  assert.throws(() => readBundle(bytes), /Truncated/);
});
test('serialized reader rejects stripped TypeTrees', () => {
  const bytes = new Uint8Array(64), view = new DataView(bytes.buffer);
  view.setUint32(0,30); view.setUint32(4,64); view.setUint32(8,17); view.setUint32(12,64);
  bytes.set(new TextEncoder().encode('2018.3.8f1\0'),20);
  assert.throws(() => readSerializedFile({path:'test',bytes}),/Missing TypeTree/);
});
test('TypeTree alignment, byte arrays and signed PPtrs', () => {
  const leaf = (type,name,meta=0) => ({type,name,meta,children:[]});
  const tree = {type:'Example',meta:0,children:[leaf('bool','enabled',0x4000),leaf('SInt64','m_PathID')]};
  const bytes = new Uint8Array(12); bytes[0]=1;
  new DataView(bytes.buffer).setBigInt64(4,-9007199254740993n,true);
  const value = readValue(new Reader(bytes,true),tree);
  assert.equal(value.enabled,true); assert.equal(value.m_PathID,-9007199254740993n);
});
test('uncompressed texture formats decode and flip rows', () => {
  assert.deepEqual([...decodePixels(Uint8Array.of(0,248,224,7),1,2,7)],[0,255,0,255,255,0,0,255]);
  assert.deepEqual([...decodePixels(Uint8Array.of(0,255),1,2,1)],[255,255,255,255,255,255,255,0]);
  assert.deepEqual([...decodePixels(Uint8Array.of(1,2,3,4,5,6),1,2,3)],[4,5,6,255,1,2,3,255]);
  assert.deepEqual([...decodePixels(Uint8Array.of(1,2,3,4,5,6,7,8),1,2,4)],[5,6,7,8,1,2,3,4]);
  assert.throws(() => decodePixels(new Uint8Array(),8,8,34),/Truncated/);
  assert.throws(() => decodePixels(new Uint8Array(),8,8,99),/Unsupported/);
});
test('ETC1 individual mode and non-multiple-of-four dimensions', () => {
  const bytes = Uint8Array.of(0xf0,0,0,0,0,0,0,0);
  const decoded = decodePixels(bytes,3,2,34);
  assert.equal(decoded.length,24);
  assert.deepEqual([...decoded.subarray(0,4)],[255,2,2,255]);
  assert.deepEqual([...decoded.subarray(8,12)],[2,2,2,255]);
});
test('PPtr resolution includes serialized-file identity', () => {
  const resolver = Object.create(ObjectResolver.prototype);
  const a = {file:'a',pathId:'1'}, b = {file:'b',pathId:'1'};
  resolver.files = new Map([['a',{path:'a',externals:['b'],objects:new Map([['1',a]])}],['b',{path:'b',objects:new Map([['1',b]])}]]);
  assert.equal(resolver.resolve(a,{m_FileID:0,m_PathID:1n}),a);
  assert.equal(resolver.resolve(a,{m_FileID:1,m_PathID:1n}),b);
  assert.equal(resolver.resolve(a,{m_FileID:0,m_PathID:0n}),null);
  assert.throws(() => resolver.resolve(a,{m_FileID:2,m_PathID:1n}),/dependency/);
});
test('billboard particle renderers do not resolve their dormant built-in mesh', () => {
  const renderer={key:'a:1',file:'a',pathId:'1',type:'ParticleSystemRenderer'};
  const material={key:'a:2',file:'a',pathId:'2',type:'Material'};
  const resolver=Object.create(ObjectResolver.prototype);
  resolver.files=new Map([['a',{path:'a',externals:['Library/unity default resources'],objects:new Map([['1',renderer],['2',material]])}]]);
  resolver.data=object=>object===renderer?{m_RenderMode:0,m_Materials:[{m_FileID:0,m_PathID:2n}],m_Mesh:{m_FileID:1,m_PathID:10202n}}:{};
  const closure=resolver.closure([renderer]);
  assert.deepEqual([...closure.keys()],['a:1','a:2']);
});
