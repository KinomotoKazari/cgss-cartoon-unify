function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value && typeof value === 'object') return Uint8Array.from(Object.values(value));
  return null;
}

// Unity's default Quad is a one-unit square in the local XY plane. Only this
// observed built-in Mesh is provided here; other IDs must remain explicit.
export function builtInParticleMesh(pathId) {
  if (String(pathId) !== '10210') return null;
  return {
    vertices:[
      {x:-0.5, y:-0.5, z:0, u:0, v:0},
      {x:0.5, y:-0.5, z:0, u:1, v:0},
      {x:0.5, y:0.5, z:0, u:1, v:1},
      {x:-0.5, y:0.5, z:0, u:0, v:1}
    ],
    indices:[0,1,2,0,2,3]
  };
}

// Decode the compact mesh layout used by ParticleSystemRenderer Mesh mode.
// Keep 3D local positions for particle rotation before screen projection.
export function particleMesh(data) {
  const vertexData = data?.m_VertexData, source = bytes(vertexData?.m_DataSize);
  const indexBytes = bytes(data?.m_IndexBuffer), subMesh = data?.m_SubMeshes?.[0];
  const position = vertexData?.m_Channels?.[0], uv = vertexData?.m_Channels?.[4];
  const count = vertexData?.m_VertexCount;
  if (!source || !indexBytes || !subMesh || !Number.isInteger(count) || count < 3 ||
      position?.format !== 0 || position?.dimension < 3 || uv?.format !== 0 || uv?.dimension < 2 ||
      position.stream !== uv.stream || source.byteLength % count !== 0) return null;
  const stride = source.byteLength / count;
  if (position.offset + 12 > stride || uv.offset + 8 > stride) return null;
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const vertices = Array.from({length:count}, (_, index) => {
    const base = index * stride;
    return {x:view.getFloat32(base + position.offset, true), y:view.getFloat32(base + position.offset + 4, true),
      z:view.getFloat32(base + position.offset + 8, true), u:view.getFloat32(base + uv.offset, true), v:view.getFloat32(base + uv.offset + 4, true)};
  });
  if (vertices.some(vertex => !Object.values(vertex).every(Number.isFinite))) return null;
  const bytesPerIndex = data.m_IndexFormat === 1 ? 4 : 2;
  const start = subMesh.firstByte || 0, indexCount = subMesh.indexCount || 0;
  if (start < 0 || indexCount < 3 || start + indexCount * bytesPerIndex > indexBytes.byteLength) return null;
  const indices = [], indexView = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength);
  for (let offset = start; offset < start + indexCount * bytesPerIndex; offset += bytesPerIndex) {
    const index = (bytesPerIndex === 4 ? indexView.getUint32(offset, true) : indexView.getUint16(offset, true)) + (subMesh.baseVertex || 0);
    if (index < 0 || index >= count) return null;
    indices.push(index);
  }
  return {vertices, indices};
}
