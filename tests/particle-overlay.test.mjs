import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
await import('../web/particle-overlay.js');

function plan(renderer) {
  return {effectPrefabs:[{nodes:[{active:true, name:'controller', transformId:'transform', ancestorTransformIds:[],
    componentIds:['system', 'renderer']}]}], objects:{
    system:{type:'ParticleSystem', data:{EmissionModule:{enabled:true}}},
    renderer:{type:'ParticleSystemRenderer', data:renderer}
  }};
}

test('mesh particle renderers without embedded geometry do not fall back to a billboard texture', async () => {
  const overlay = await window.CGSSParticleOverlay.create({plan:plan({m_RenderMode:4, m_Materials:[]}), config:{particleImages:{}}});
  assert.equal(overlay.count, 0);
});

test('material-less particle controller nodes do not block the card', async () => {
  const overlay = await window.CGSSParticleOverlay.create({plan:plan({m_RenderMode:0, m_Materials:[{m_PathID:'0'}]}), config:{particleImages:{}}});
  assert.equal(overlay.count, 0);
});
