import {Reader, MAX_BYTES} from './binary-reader.js';
import {commonStrings} from './common-strings.js';

export function readTree(reader, version) {
  // TypeTree nodes are a compact preorder list in the Unity versions this player supports.
  const count = reader.count(100000), stringSize = reader.count(MAX_BYTES);
  const nodes = Array.from({length: count}, () => {
    const node = {version: reader.u16(), level: reader.u8(), flags: reader.u8(), typeOffset: reader.u32(), nameOffset: reader.u32(), size: reader.i32(), index: reader.i32(), meta: reader.i32(), children: []};
    if (version >= 19) reader.skip(8);
    return node;
  });
  const strings = new Reader(reader.take(stringSize));
  const stringAt = (offset) => {
    if (offset >>> 31) {
      const value = commonStrings[offset & 0x7fffffff];
      if (value === undefined) throw new Error(`Unknown TypeTree shared string ${offset & 0x7fffffff}`);
      return value;
    }
    strings.pos = offset;
    return strings.cstring();
  };
  const stack = [];
  for (const node of nodes) {
    node.type = stringAt(node.typeOffset); node.name = stringAt(node.nameOffset);
    while (stack.length && stack.at(-1).level >= node.level) stack.pop();
    if (stack.length) stack.at(-1).children.push(node);
    else if (node !== nodes[0]) throw new Error('Multiple TypeTree roots');
    stack.push(node);
  }
  if (!nodes.length) throw new Error('Empty TypeTree');
  return nodes[0];
}

const primitive = {
  SInt8:'i8', UInt8:'u8', char:'u8', short:'i16', SInt16:'i16', UInt16:'u16',
  'unsigned short':'u16', int:'i32', SInt32:'i32', UInt32:'u32', 'unsigned int':'u32',
  'Type*':'u32', 'long long':'i64', SInt64:'i64', UInt64:'u64', 'unsigned long long':'u64',
  FileSize:'u64', float:'f32', double:'f64'
};

export function readValue(reader, node, budget = {left: 4_000_000}, depth = 0) {
  // The budget and depth limits keep malformed bundles from allocating unbounded objects.
  if (--budget.left < 0 || depth > 128) throw new Error('Object structure exceeds parser limits');
  const childValue = child => readValue(reader, child, budget, depth + 1);
  let value;
  if (primitive[node.type]) value = reader[primitive[node.type]]();
  else if (node.type === 'bool') value = reader.u8() !== 0;
  else if (node.type === 'string') {
    // TextAsset m_Script is binary even when its TypeTree calls it a string.
    if (node.name === 'm_Script' && node.binaryScript) { value = reader.take(reader.count(MAX_BYTES)); reader.align(); }
    else value = reader.string();
  } else if (node.type === 'TypelessData') value = reader.take(reader.count(MAX_BYTES));
  else if (node.type === 'Array') {
    const count = reader.count(), element = node.children[1];
    if (!element) throw new Error('Missing array element TypeTree');
    if (element.size === 1 && ['UInt8', 'char'].includes(element.type) && !(element.meta & 0x4000)) value = reader.take(count);
    else {
      if (count > budget.left) throw new Error('Array exceeds object budget');
      if (element.size > 0) reader.need(count * element.size);
      value = Array.from({length: count}, () => childValue(element));
    }
  } else if (node.children[0]?.type === 'Array') {
    value = childValue(node.children[0]);
    if (node.type === 'map') value = value.map(pair => ({Key: pair.first, Value: pair.second}));
  } else {
    if (!node.children.length && node.size !== 0) throw new Error(`Unsupported TypeTree leaf ${node.type}`);
    value = Object.create(null);
    for (const child of node.children) value[child.name] = childValue(child);
  }
  if (node.meta & 0x4000) reader.align();
  return value;
}
