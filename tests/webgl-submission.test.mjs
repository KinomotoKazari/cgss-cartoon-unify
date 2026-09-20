import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../runtime/spine-webgl.js', import.meta.url), 'utf8');
const white = {r:1,g:1,b:1,a:1};

// Record the GL submission contract. This does not simulate GPU rasterization.
function fixture() {
  let texture, blend, mask, vertices, serial = 0;
  const draws = [], deleted = [], uniforms = {};
  const gl = {
    createProgram:() => ({}), createShader:() => ({}), createBuffer:() => ({}),
    createTexture:() => ({id:++serial}),
    getShaderParameter:() => true, getProgramParameter:() => true,
    getAttribLocation:() => 0, getUniformLocation:(_, name) => name,
    getExtension:() => null,
    bindTexture(_, value) { texture = value; },
    texImage2D(...args) { const image = args.at(-1); if (image.fail) throw new Error('texture upload failed'); texture.image = image; },
    blendFunc(...value) { blend = value; }, colorMask(...value) { mask = value; },
    uniform1f(name,value) { uniforms[name] = value; },
    bufferData(_, data) { vertices = Array.from(data); },
    drawArrays(_, start, count) { draws.push({image:texture.image, blend:[...blend], mask:[...mask],
      particle:uniforms.uParticle, maskAlpha:uniforms.uParticleMask,
      multiply:uniforms.uParticleMultiply, luma:uniforms.uParticleLuma,
      gain:uniforms.uGain, vertices, count}); },
    deleteTexture(value) { deleted.push(value); }
  };
  for (const name of ['shaderSource','compileShader','attachShader','linkProgram','deleteShader',
    'deleteProgram','deleteBuffer','pixelStorei','texParameteri','useProgram','bindBuffer',
    'enableVertexAttribArray','vertexAttribPointer','uniform1i','enable','disable','activeTexture',
    'blendEquation','viewport','clearColor','clear']) gl[name] = () => {};
  for (const name of ['ZERO','ONE','SRC_COLOR','ONE_MINUS_DST_COLOR','SRC_ALPHA','ONE_MINUS_SRC_ALPHA','DST_COLOR','DST_ALPHA','ONE_MINUS_SRC_COLOR','TEXTURE_2D',
    'VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','ARRAY_BUFFER','DYNAMIC_DRAW',
    'FLOAT','TRIANGLES','BLEND','DEPTH_TEST','TEXTURE0','FUNC_ADD','RGBA','UNSIGNED_BYTE','LINEAR',
    'CLAMP_TO_EDGE','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T',
    'UNPACK_PREMULTIPLY_ALPHA_WEBGL','UNPACK_FLIP_Y_WEBGL','SCISSOR_TEST','COLOR_BUFFER_BIT']) gl[name] = name;
  class RegionAttachment {
    constructor(image) { this.region = {renderObject:{texture:{getImage:() => image}}}; this.uvs = [0,0,1,0,1,1,0,1]; }
    computeWorldVertices(bone, world) { world.set([0,0,8,0,8,8,0,8]); }
  }
  const sandbox = {spine:{RegionAttachment, MeshAttachment:class {}}};
  runInNewContext(source, sandbox);
  const renderer = new sandbox.CGSSWebGLRenderer({width:16,height:16,getContext:() => gl});
  const skeleton = entries => ({color:white, drawOrder:entries.map(([image, blendMode=0]) => ({
    color:white, bone:{}, data:{blendMode}, attachment:new RegionAttachment(image)
  }))});
  return {renderer, gl, draws, deleted, skeleton};
}

test('uncached texture upload preserves pending Spine texture and attachment order', t => {
  const f = fixture(); t.after(() => f.renderer.dispose());
  const a = {name:'a'}, b = {name:'b'};
  f.renderer.draw(f.skeleton([[a,0],[b,2],[a,3]]));
  assert.deepEqual(f.draws.map(d => [d.image.name,d.blend,d.count]), [
    ['a',['ONE','ONE_MINUS_SRC_ALPHA'],6], ['b',['DST_COLOR','ONE_MINUS_SRC_ALPHA'],6],
    ['a',['ONE','ONE_MINUS_SRC_COLOR'],6]
  ]);
  assert.equal(f.renderer.texCache.size, 2);
});

test('particle and Spine submissions restore shader, blend, alpha mask and cached texture', t => {
  const f = fixture(); t.after(() => f.renderer.dispose());
  const atlas = {}, particle = {};
  const sprite = {x:8,y:8,width:8,height:8,angle:0,region:{u:.5,v:0,width:.5,height:.5},color:white,gain:2,additive:true};
  f.renderer.draw(f.skeleton([[atlas]]));
  f.renderer.drawParticle(particle,{...sprite,colorMask:14});
  f.renderer.draw(f.skeleton([[atlas]]));
  f.renderer.drawParticle(particle,{...sprite,gain:1,additive:false,maskAlpha:true});
  assert.deepEqual(f.draws.map(d => [d.particle,d.maskAlpha,d.gain,d.mask,d.blend]), [
    [0,0,1,[true,true,true,true],['ONE','ONE_MINUS_SRC_ALPHA']],
    [1,0,2,[true,true,true,false],['SRC_ALPHA','ONE']],
    [0,0,1,[true,true,true,true],['ONE','ONE_MINUS_SRC_ALPHA']],
    [1,1,1,[true,true,true,false],['SRC_ALPHA','ONE_MINUS_SRC_ALPHA']]
  ]);
  assert.equal(f.draws[2].image,atlas);
  assert.deepEqual(f.draws[1].vertices.slice(0,4),[-.5,.5,.5,0]);
  assert.equal(f.renderer.texCache.size,2);
});

test('particle multiply and uncommon blend factors reach WebGL unchanged', t => {
  const f = fixture(); t.after(() => f.renderer.dispose());
  const sprite = {x:8,y:8,width:8,height:8,angle:0,region:{u:0,v:0,width:1,height:1},
    color:white,gain:2,colorMask:14};
  f.renderer.drawParticle({}, {...sprite,blendSrc:0,blendDst:3,multiply:true});
  f.renderer.drawParticle({}, {...sprite,blendSrc:5,blendDst:6,multiply:false});
  f.renderer.drawParticle({}, {...sprite,blendSrc:3,blendDst:1,multiply:false});
  f.renderer.drawParticle({}, {...sprite,blendSrc:4,blendDst:1,multiply:false});
  assert.deepEqual(f.draws.map(d => [d.blend,d.multiply]), [
    [['ZERO','SRC_COLOR'],1], [['SRC_ALPHA','ONE_MINUS_SRC_COLOR'],0],
    [['SRC_COLOR','ONE'],0], [['ONE_MINUS_DST_COLOR','ONE'],0]
  ]);
});

test('luminance-alpha particles select their own fragment equation', t => {
  const f = fixture(); t.after(() => f.renderer.dispose());
  f.renderer.drawParticle({}, {x:8,y:8,width:8,height:8,angle:0,
    region:{u:0,v:0,width:1,height:1},color:white,gain:2,
    blendSrc:1,blendDst:10,lumaAlpha:true,colorMask:14});
  assert.equal(f.draws[0].luma,1);
  assert.deepEqual(f.draws[0].blend,['ONE','ONE_MINUS_SRC_ALPHA']);
});

test('tilted billboard geometry matches the flat quad at zero rotation', t => {
  const f = fixture(); t.after(() => f.renderer.dispose());
  const mesh={vertices:[
    {x:-.5,y:.5,z:0,u:0,v:0},{x:.5,y:.5,z:0,u:1,v:0},
    {x:.5,y:-.5,z:0,u:1,v:1},{x:-.5,y:-.5,z:0,u:0,v:1}
  ],indices:[0,1,2,0,2,3]};
  const sprite={x:8,y:8,width:8,height:8,angle:0,region:{u:0,v:0,width:1,height:1},
    color:white,gain:1,blendSrc:5,blendDst:10,colorMask:14};
  f.renderer.drawParticle({},sprite);
  f.renderer.drawParticleMesh({}, {...sprite,mesh,rotation:{x:0,y:0,z:0}});
  assert.deepEqual(f.draws[1].vertices,f.draws[0].vertices);
  f.renderer.drawParticleMesh({}, {...sprite,mesh,rotation:{x:Math.PI/3,y:0,z:0}});
  assert.ok(Math.abs(f.draws[2].vertices[1]-f.draws[2].vertices[17]) <
    Math.abs(f.draws[1].vertices[1]-f.draws[1].vertices[17]));
});

test('mesh particles project authored 3D rotations into a changing silhouette', t => {
  const f = fixture(); t.after(() => f.renderer.dispose());
  const image = {}, mesh = {vertices:[{x:0,y:0,z:.01,u:0,v:0},{x:.01,y:0,z:0,u:1,v:0},{x:0,y:0,z:0,u:0,v:1}], indices:[0,1,2]};
  const sprite = {x:8,y:8,width:100,height:100,region:{u:0,v:0,width:1,height:1},color:white,gain:1,additive:false,colorMask:14,mesh};
  f.renderer.drawParticleMesh(image,{...sprite,rotation:{x:0,y:0,z:0}});
  f.renderer.drawParticleMesh(image,{...sprite,rotation:{x:Math.PI/2,y:0,z:0}});
  f.renderer.drawParticleMesh(image,{...sprite,rotation:{x:Math.PI/2,y:Math.PI/2,z:0}});
  assert.equal(f.draws.length,3);
  assert.ok(Math.abs(f.draws[0].vertices[1])<1e-6);
  assert.ok(Math.abs(f.draws[1].vertices[1]+.125)<1e-6);
  assert.ok(Math.abs(f.draws[1].vertices[8]-.125)<1e-6);
  assert.ok(Math.abs(f.draws[2].vertices[8])<1e-6);
});

test('failed upload is released, unfinished geometry is discarded, and disposal is idempotent', () => {
  const f = fixture();
  assert.throws(() => f.renderer.draw(f.skeleton([[{fail:true}]])), /texture upload failed/);
  assert.equal(f.deleted.length,1);
  assert.equal(f.renderer.texCache.size,0);
  f.gl.drawArrays = () => { throw new Error('draw failed'); };
  assert.throws(() => f.renderer.draw(f.skeleton([[{}]])), /draw failed/);
  assert.ok(f.renderer._batch.length > 0);
  f.renderer.clear(0,0,0,1);
  assert.equal(f.renderer._batch.length,0);
  f.renderer.dispose(); f.renderer.dispose();
  assert.equal(f.deleted.length,2);
});
