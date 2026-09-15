import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readBundle} from '../src/bundle-reader.js';
import {ObjectResolver} from '../src/object-resolver.js';
import {loadCard} from '../src/card-loader.js';

const [bundlePath, referenceFolder] = process.argv.slice(2);
if (!bundlePath || !referenceFolder) throw new Error('Usage: node tests/compare-reference.mjs <bundle> <prepared-reference-folder>');
const readJSON = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const bytes = fs.readFileSync(bundlePath), resolver = new ObjectResolver(readBundle(bytes));
const inventory = readJSON(path.join(referenceFolder,'scene','objects.json'));
let checked = 0;
function compare(actual, expected, label) {
  if (typeof actual === 'bigint') actual = actual.toString();
  if (typeof expected === 'number' && typeof actual === 'string' && /^-?\d+$/.test(actual)) {
    // Reference JSON uses numeric int64s; IDs are checked separately as strings.
    assert.equal(Number(actual),expected,label); return;
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    assert.ok(Object.is(actual,expected) || Math.abs(actual-expected) <= 1e-6 * Math.max(1,Math.abs(expected)),label); return;
  }
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object',label);
    assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),label);
    for (const key of Object.keys(expected)) compare(actual[key],expected[key],label+'.'+key);
  } else assert.equal(actual,expected,label);
}
assert.equal(resolver.objects.size,inventory.length);
for (const entry of inventory) {
  const candidates = [...resolver.objects.values()].filter(object => object.pathId === entry.pathId);
  assert.equal(candidates.length,1);
  const object = candidates[0]; assert.equal(object.type,entry.type);
  if (entry.dataFile) { compare(resolver.data(object),readJSON(path.join(referenceFolder,'scene',entry.dataFile)),entry.pathId); checked++; }
}
const card = loadCard(bytes);
const textFiles = fs.readdirSync(path.join(referenceFolder,'assets','TextAsset'));
for (const entry of card.skeletons) {
  const filename = textFiles.find(name => name === entry.name || name === entry.name+'.asset');
  assert.ok(filename,`Missing reference skeleton ${entry.name}`);
  assert.deepEqual(Buffer.from(entry.bytes),fs.readFileSync(path.join(referenceFolder,'assets','TextAsset',filename)));
}
const atlasFile = textFiles.find(name => /\.atlas(?:\.asset)?$/.test(name));
assert.equal(card.atlasText,fs.readFileSync(path.join(referenceFolder,'assets','TextAsset',atlasFile),'utf8'));
console.log(`Compared ${inventory.length} objects, ${checked} object bodies, five skeletons and atlas against the AssetStudio reference.`);
