import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {loadCard} from '../src/card-loader.js';
import {sampleShape,motionHooks,effectiveVelocity} from '../web/particle-motion.js';
import {ParticleSimulation,randomSequence} from '../web/particle-simulation.js';
import {particleMeshExtent} from '../web/particle-math.js';

const folder = process.env.CGSS_BUNDLE_DIR;
const pixels = JSON.parse(fs.readFileSync(new URL('./reference-pixels.json',import.meta.url),'utf8'));
for (const [id,objects,particleCount,textureCount] of [['201389',120,22,7],['300599',19,0,2]]) {
  test(`card ${id}: metadata, referenced assets and reference RGBA hashes`, {skip:!folder}, () => {
    const card = loadCard(fs.readFileSync(path.join(folder,`card_cartoon_${id}.unity3d`)));
    assert.equal(card.cardId,id); assert.equal(card.summary.files[0].objects,objects);
    assert.equal(card.skeletons.length,5); assert.equal(card.textures.length,textureCount);
    assert.equal(card.plan.effectPrefabs.reduce((n,prefab) => n+prefab.particleSystemIds.length,0),particleCount);
    for (const texture of card.textures) {
      assert.deepEqual({width:texture.width,height:texture.height,sha256:createHash('sha256').update(texture.rgba).digest('hex')},pixels[texture.name]);
    }
    const material = Object.values(card.plan.objects).find(object => object.name === `SP3S${id}_tex_Material`);
    const main = material.data.m_SavedProperties.m_TexEnvs.find(entry => entry.Key === '_MainTex');
    assert.equal(main.Value.m_Texture.m_PathID,card.rgbId);
  });
}

test('card 100369 omits unused external meshes in billboard modes', {skip:!folder}, () => {
  const card = loadCard(fs.readFileSync(path.join(folder,'card_cartoon_100369.unity3d')));
  const renderers = Object.values(card.plan.objects).filter(object => object.type === 'ParticleSystemRenderer');
  assert.ok(renderers.length > 0);
  assert.ok(renderers.every(object => object.data.m_RenderMode === 4 || !object.data.m_Mesh));
});

test('card 100448 preserves its built-in Quad mesh particles', {skip:!folder}, () => {
  const card = loadCard(fs.readFileSync(path.join(folder,'card_cartoon_100448.unity3d')));
  const renderers = Object.values(card.plan.objects).filter(object => object.type === 'ParticleSystemRenderer' && object.data.m_RenderMode === 4);
  assert.equal(renderers.length, 4);
  for (const renderer of renderers) {
    const mesh = card.plan.objects[renderer.data.m_Mesh.m_PathID]?.data.particleMesh;
    assert.deepEqual(mesh?.indices, [0,1,2,0,2,3]);
  }
});

test('card 200674 keeps UTF-8 attachment names aligned with its atlas', {skip:!folder}, () => {
  const card = loadCard(fs.readFileSync(path.join(folder,'card_cartoon_200674.unity3d')));
  const context = {TextDecoder};
  runInNewContext(fs.readFileSync(new URL('../runtime/cgss_skel_parser.js',import.meta.url),'utf8'),context);
  const background = card.skeletons.find(layer => layer.slot === 'bg');
  const json = context.CGSSSkelParser.parse(background.bytes.buffer.slice(
    background.bytes.byteOffset, background.bytes.byteOffset + background.bytes.byteLength));
  const paths = Object.values(json.skins).flatMap(skin => Object.values(skin).flatMap(slot =>
    Object.entries(slot).map(([name,attachment]) => attachment.path || name)));
  assert.ok(paths.includes('monitor_ｈl1'));
  assert.ok(card.atlasText.includes('monitor_ｈl1'));
});

test('card plans retain the Unity version from each bundle', {skip:!folder}, () => {
  for(const [id,version] of [['100108','2018.3.8f1'],['201389','2020.3.8f1']]) {
    const card=loadCard(fs.readFileSync(path.join(folder,`card_cartoon_${id}.unity3d`)));
    assert.equal(card.plan.unityVersion,version);
  }
});

test('card 100108 sleeve stars use a spreading ConeVolume shape', {skip:!folder}, () => {
  const plan=loadCard(fs.readFileSync(path.join(folder,'card_cartoon_100108.unity3d'))).plan;
  for(const name of ['star_handR','star_handL']) {
    const node=plan.effectPrefabs.flatMap(prefab=>prefab.nodes).find(node=>node.name===name);
    const system=node.componentIds.map(id=>plan.objects[String(id)]).find(object=>object?.type==='ParticleSystem').data;
    assert.equal(system.ShapeModule.type,8);
    assert.equal(system.ShapeModule.length,8);
    const random=randomSequence(108);
    const positions=Array.from({length:300},()=>sampleShape(system.ShapeModule,random).position);
    assert.ok(Math.max(...positions.map(p=>p.z))-Math.min(...positions.map(p=>p.z))>5);
    assert.ok(Math.max(...positions.map(p=>p.x))-Math.min(...positions.map(p=>p.x))>2);
  }
});

test('cards 100107 and 100108 preserve normalized maple-leaf mesh scale', {skip:!folder}, () => {
  for (const id of ['100107','100108']) {
    const plan=loadCard(fs.readFileSync(path.join(folder,`card_cartoon_${id}.unity3d`))).plan;
    const leaves=plan.effectPrefabs.flatMap(prefab=>prefab.nodes).flatMap(node=>{
      if (!node.name.startsWith('leaf_')) return [];
      const renderer=node.componentIds.map(componentId=>plan.objects[String(componentId)])
        .find(object=>object?.type==='ParticleSystemRenderer')?.data;
      const mesh=plan.objects[String(renderer?.m_Mesh?.m_PathID)]?.data?.particleMesh;
      return renderer?.m_RenderMode===4 && mesh ? [{renderer,mesh}] : [];
    });
    assert.ok(leaves.length>=4);
    assert.ok(leaves.every(({mesh})=>particleMeshExtent(mesh)<.02));
  }
});

test('card 201291 fireworks launch radially from Circle shapes', {skip:!folder}, () => {
  const plan=loadCard(fs.readFileSync(path.join(folder,'card_cartoon_201291.unity3d'))).plan;
  const node=plan.effectPrefabs.flatMap(prefab=>prefab.nodes)
    .find(node=>node.name==='L_eff_circle_fireworks_1');
  const system=node.componentIds.map(id=>plan.objects[String(id)])
    .find(object=>object?.type==='ParticleSystem').data;
  assert.equal(system.ShapeModule.type,10);
  assert.equal(system.ShapeModule.radiusThickness,0.30000001192092896);
  const random=randomSequence(201291);
  for(let i=0;i<100;i++) {
    const {position,direction}=sampleShape(system.ShapeModule,random);
    assert.ok(Math.hypot(position.x,position.y)>=279);
    assert.ok(position.x*direction.x+position.y*direction.y>0);
    assert.equal(direction.z,0);
  }
});

test('card 201291 rise and burst systems expose Stretch and Trail inputs', {skip:!folder}, () => {
  const plan=loadCard(fs.readFileSync(path.join(folder,'card_cartoon_201291.unity3d'))).plan;
  const entries=plan.effectPrefabs.flatMap(prefab=>prefab.nodes).flatMap(node=>{
    const components=node.componentIds.map(id=>plan.objects[String(id)]).filter(Boolean);
    const system=components.find(object=>object.type==='ParticleSystem')?.data;
    const renderer=components.find(object=>object.type==='ParticleSystemRenderer')?.data;
    return system && renderer ? [{name:node.name,system,renderer}] : [];
  });
  const stretch=entries.filter(entry=>entry.renderer.m_RenderMode===1);
  const trails=entries.filter(entry=>entry.system.TrailModule.enabled);
  assert.equal(stretch.length,5);
  assert.equal(trails.length,20);
  assert.ok(stretch.every(entry=>entry.system.InitialModule.startSpeed.scalar===0));
  assert.ok(stretch.every(entry=>entry.system.VelocityModule.y.scalar>0));
  assert.equal(stretch.filter(entry=>entry.renderer.m_MaxParticleSize===.5).length,2);
  assert.ok(trails.every(entry=>entry.renderer.m_Materials.length>=2));
  assert.ok(trails.every(entry=>entry.system.TrailModule.minVertexDistance===10));
  const particle={seed:201291,phase:0,lifetime:5};
  const hooks=motionHooks(stretch[0].system);hooks.initialize(particle);
  assert.ok(effectiveVelocity(stretch[0].system,particle,1).local.y>0);
  const launch=stretch.find(entry=>entry.name==='L_eff_circle_fireworks_8');
  assert.equal(launch.system.EmissionModule.m_Bursts[0].time,5.5);
  assert.equal(launch.system.InitialModule.startLifetime.scalar,5);
  const nodes=plan.effectPrefabs.flatMap(prefab=>prefab.nodes);
  for(const [launchName,burstName,burstTime] of [
    ['L_eff_circle_fireworks_8','L_eff_circle_fireworks_5',10],
    ['L2_eff_circle_fireworks_8','L2_eff_circle_fireworks_5',4.5],
    ['R_eff_circle_fireworks_8','R_eff_circle_fireworks_7',11.1],
    ['R2_eff_circle_fireworks_8','R2_eff_circle_fireworks_7',7.5],
    ['R3_eff_circle_fireworks_8','R3_eff_circle_fireworks_7',6]
  ]) {
    const launchNode=nodes.find(node=>node.name===launchName);
    const burstNode=nodes.find(node=>node.name===burstName);
    const launchSystem=launchNode.componentIds.map(id=>plan.objects[String(id)])
      .find(object=>object?.type==='ParticleSystem').data;
    const simulation=new ParticleSimulation(launchSystem,1,motionHooks(launchSystem));
    simulation.advance(burstTime/launchSystem.simulationSpeed);
    const birth=launchSystem.EmissionModule.m_Bursts[0].time;
    const rocket=simulation.particles.find(entry=>Math.abs(entry.birth-birth)<1e-6);
    const launchPosition=plan.objects[String(launchNode.transformId)].data.m_LocalPosition;
    const burstPosition=plan.objects[String(burstNode.transformId)].data.m_LocalPosition;
    assert.ok(Math.hypot(
      launchPosition.x+rocket.motion.position.x-burstPosition.x,
      launchPosition.y+rocket.motion.position.y-burstPosition.y) < 60,
    `${launchName} must terminate near ${burstName}`);
  }
  const trailParticle={seed:201291,phase:0,lifetime:4};
  const trailHooks=motionHooks(trails[0].system);trailHooks.initialize(trailParticle);
  trailHooks.initializeTrail(trailParticle);
  assert.equal(trailParticle.trail.lifetime,4);
});
