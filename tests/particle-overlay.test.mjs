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

test('unknown material rules identify the emitter instead of silently falling back', async () => {
  const card=plan({m_RenderMode:0,m_Materials:[{m_PathID:'material'}]});
  card.objects.material={type:'Material',data:{m_Shader:{m_PathID:'shader'},m_SavedProperties:{
    m_TexEnvs:[{Key:'_MainTex',Value:{m_Texture:{m_PathID:'texture'}}}],m_Colors:[],m_Floats:[]}}};
  card.objects.shader={type:'Shader',name:'Unknown/Particle',data:{}};
  await assert.rejects(window.CGSSParticleOverlay.create({plan:card,config:{
    particleImages:{texture:{width:1,height:1}},textureFormats:{texture:4}
  }}),/Particle controller: Unsupported particle shader/);
});
