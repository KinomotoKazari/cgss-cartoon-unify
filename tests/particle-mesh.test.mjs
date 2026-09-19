import test from 'node:test';
import assert from 'node:assert/strict';
import {particleMesh, builtInParticleMesh} from '../src/particle-mesh.js';

function floats(values) {
  return new Uint8Array(new Float32Array(values).buffer);
}

test('particle mesh keeps authored triangle shape and UV coordinates', () => {
  // Three vertices in Unity's XZ plane, with position then UV at byte offset 12.
  const vertexData = floats([-2, 0, -1, 0, 0, 2, 0, -1, 1, 0, 0, 0, 2, 0, 1]);
  const indices = new Uint8Array(new Uint16Array([0, 1, 2]).buffer);
  const mesh = particleMesh({m_VertexData:{m_VertexCount:3, m_DataSize:vertexData,
    m_Channels:[{stream:0, offset:0, format:0, dimension:3}, {}, {}, {}, {stream:0, offset:12, format:0, dimension:2}]},
    m_IndexBuffer:indices, m_SubMeshes:[{firstByte:0, indexCount:3, baseVertex:0}]});
  assert.deepEqual(mesh.indices, [0, 1, 2]);
  assert.deepEqual(mesh.vertices.map(({x,y,z,u,v}) => ({x,y,z,u,v})), [
    {x:-2, y:0, z:-1, u:0, v:0}, {x:2, y:0, z:-1, u:1, v:0}, {x:0, y:0, z:2, u:0, v:1}
  ]);
});

test('particle mesh rejects incomplete vertex layouts', () => {
  assert.equal(particleMesh({m_VertexData:{m_VertexCount:3, m_Channels:[]}}), null);
});

test('only the observed Unity default Quad has built-in particle geometry', () => {
  const mesh = builtInParticleMesh(10210n);
  assert.equal(mesh.vertices.length, 4);
  assert.deepEqual(mesh.indices, [0,1,2,0,2,3]);
  assert.deepEqual(mesh.vertices[0], {x:-0.5,y:-0.5,z:0,u:0,v:0});
  assert.equal(builtInParticleMesh(10202n), null);
});
