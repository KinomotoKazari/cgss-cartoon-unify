/* Draw Spine triangles in WebGL to avoid Canvas clipping seams. */
(function (global) {
  'use strict';

  var VERT_SRC =
    'attribute vec2 aPos;' +
    'attribute vec2 aUV;' +
    'attribute vec4 aColor;' +
    'varying vec2 vUV;' +
    'varying vec4 vColor;' +
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); vUV = aUV; vColor = aColor; }';

  var FRAG_SRC =
    'precision mediump float;' +
    'varying vec2 vUV;' +
    'varying vec4 vColor;' +
    'uniform sampler2D uTex;' +
    'uniform float uParticle;' +
    'uniform float uParticleMask;' +
    'uniform float uParticleMultiply;' +
    'uniform float uParticleLuma;' +
    'uniform float uGain;' +
    // Match the canvas compositor's premultiplied alpha.
    'void main(){ vec4 t = texture2D(uTex, vUV);' +
    'if(uParticle > 0.5 && uParticleMultiply > 0.5){ vec4 c = clamp(t * vColor * uGain, 0.0, 1.0);' +
    'gl_FragColor = vec4(1.0) + c.a * (c - vec4(1.0)); return; }' +
    'if(uParticle > 0.5 && uParticleLuma > 0.5){ vec3 c = clamp(t.rgb * vColor.rgb * uGain, 0.0, 1.0);' +
    'float a = dot(c, vec3(0.3, 0.59, 0.11)) * t.a; gl_FragColor = vec4(c, a); return; }' +
    'if(uParticle > 0.5 && uParticleMask > 0.5){ float a = max(t.r, max(t.g, t.b)) * vColor.a;' +
    'vec3 c = clamp(t.rgb * vColor.rgb * uGain, 0.0, 1.0); gl_FragColor = vec4(c, a); return; }' +
    'if(uParticle > 0.5){ vec4 c = clamp(t * vColor * uGain, 0.0, 1.0);' +
    'gl_FragColor = c; return; }' +
    'float a = t.a * vColor.a;' +
    'gl_FragColor = vec4(t.rgb * vColor.rgb * a, a); }';

  function compileShader(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var message = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('shader compile: ' + message);
    }
    return sh;
  }

  function CGSSWebGLRenderer(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
      antialias: false
    }) || canvas.getContext('experimental-webgl', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
      antialias: false
    });
    if (!this.gl) throw new Error('WebGL is unavailable');
    var gl = this.gl;
    this.program = gl.createProgram();
    var vertex, fragment;
    try {
      vertex = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
      fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      gl.attachShader(this.program, vertex);
      gl.attachShader(this.program, fragment);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        throw new Error('program link: ' + gl.getProgramInfoLog(this.program));
      }
    } catch (error) {
      gl.deleteProgram(this.program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      throw error;
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
    this.aPos = gl.getAttribLocation(this.program, 'aPos');
    this.aUV = gl.getAttribLocation(this.program, 'aUV');
    this.aColor = gl.getAttribLocation(this.program, 'aColor');
    this.uTex = gl.getUniformLocation(this.program, 'uTex');
    this.uParticle = gl.getUniformLocation(this.program, 'uParticle');
    this.uParticleMask = gl.getUniformLocation(this.program, 'uParticleMask');
    this.uParticleMultiply = gl.getUniformLocation(this.program, 'uParticleMultiply');
    this.uParticleLuma = gl.getUniformLocation(this.program, 'uParticleLuma');
    this.uGain = gl.getUniformLocation(this.program, 'uGain');

    this.vbo = gl.createBuffer();
    this.texCache = new Map();
    this.width = canvas.width || 1;
    this.height = canvas.height || 1;
    this._scale = 1; this._tx = 0; this._ty = 0;
    this._batch = [];
  }

  CGSSWebGLRenderer.prototype.resize = function (w, h) {
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  };

  CGSSWebGLRenderer.prototype.setTransform = function (scale, tx, ty) {
    this._scale = scale; this._tx = tx; this._ty = ty;
  };

  CGSSWebGLRenderer.prototype.clear = function (r, g, b, a) {
    var gl = this.gl;
    // Discard unfinished geometry left by a failed frame before retrying.
    this._batch.length = 0;
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  CGSSWebGLRenderer.prototype._texture = function (img) {
    if (!img) return null;
    if (this.texCache.has(img)) return this.texCache.get(img);
    // Uploading binds a new texture. Submit pending geometry with its old binding first.
    this._flush();
    var gl = this.gl;
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } catch (error) {
      gl.deleteTexture(tex);
      throw error;
    }
    this.texCache.set(img, tex);
    return tex;
  };

  CGSSWebGLRenderer.prototype._push = function (tex, x, y, u, v, cr, cg, cb, ca) {
    var sx = x * this._scale + this._tx;
    var sy = y * this._scale + this._ty;
    // Canvas pixels to clip space; canvas Y points down.
    var nx = sx / this.width * 2 - 1;
    var ny = 1 - sy / this.height * 2;
    this._batch.push(nx, ny, u, v, cr, cg, cb, ca);
  };

  CGSSWebGLRenderer.prototype._flush = function () {
    if (!this._batch.length) return;
    var gl = this.gl;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this._batch), gl.DYNAMIC_DRAW);
    var stride = 8 * 4;
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.aUV);
    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(this.aColor);
    gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, stride, 16);
    gl.uniform1i(this.uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this._batch.length / 8);
    this._batch.length = 0;
  };

  CGSSWebGLRenderer.prototype._setBlend = function (mode) {
    var gl = this.gl;
    if (mode === 1) { // additive
      gl.blendFunc(gl.ONE, gl.ONE);
    } else if (mode === 2) { // multiply
      gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    } else if (mode === 3) { // screen
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    } else {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  };

  CGSSWebGLRenderer.prototype._setParticleBlend = function (sprite) {
    var gl = this.gl;
    var factors = {0:gl.ZERO, 1:gl.ONE, 3:gl.SRC_COLOR, 5:gl.SRC_ALPHA,
      6:gl.ONE_MINUS_SRC_COLOR, 7:gl.DST_ALPHA, 10:gl.ONE_MINUS_SRC_ALPHA};
    var src = sprite.blendSrc ?? 5, dst = sprite.blendDst ?? (sprite.additive ? 1 : 10);
    if (factors[src] === undefined || factors[dst] === undefined) throw new Error('Unsupported particle blend factor');
    gl.blendFunc(factors[src], factors[dst]);
  };

  CGSSWebGLRenderer.prototype.draw = function (skeleton) {
    var gl = this.gl;
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.blendEquation(gl.FUNC_ADD);
    gl.colorMask(true, true, true, true);
    gl.uniform1f(this.uParticle, 0);
    gl.uniform1f(this.uParticleMask, 0);
    gl.uniform1f(this.uParticleMultiply, 0);
    gl.uniform1f(this.uParticleLuma, 0);
    gl.uniform1f(this.uGain, 1);

    var skeletonColor = skeleton.color;
    var drawOrder = skeleton.drawOrder;
    var currentTex = null, currentBlend = -1;
    var self = this;

    function beginTex(tex, blend) {
      if (currentTex === tex && currentBlend === blend) return;
      self._flush();
      currentTex = tex;
      currentBlend = blend;
      if (tex) gl.bindTexture(gl.TEXTURE_2D, tex);
      self._setBlend(blend);
    }

    for (var i = 0, n = drawOrder.length; i < n; i++) {
      var slot = drawOrder[i];
      var attachment = slot.attachment;
      if (!attachment) continue;
      var slotColor = slot.color;
      var attachmentColor = attachment.color;
      if (!attachmentColor) attachmentColor = { r: 1, g: 1, b: 1, a: 1 };
      var cr = skeletonColor.r * slotColor.r * attachmentColor.r;
      var cg = skeletonColor.g * slotColor.g * attachmentColor.g;
      var cb = skeletonColor.b * slotColor.b * attachmentColor.b;
      var ca = skeletonColor.a * slotColor.a * attachmentColor.a;
      var blend = slot.data.blendMode || 0;

      if (attachment instanceof spine.MeshAttachment) {
        var mesh = attachment;
        if (!mesh.region || !mesh.region.renderObject) continue;
        var tex = this._texture(mesh.region.renderObject.texture.getImage());
        if (!tex) continue;
        var wl = mesh.worldVerticesLength || mesh.vertices.length;
        var world = this._world || new Float32Array(0);
        var need = wl;
        if (world.length < need) world = new Float32Array(need);
        this._world = world;
        mesh.computeWorldVertices(slot, 0, wl, world, 0, 2);
        var uvs = mesh.uvs, tris = mesh.triangles;
        beginTex(tex, blend);
        for (var t = 0; t < tris.length; t++) {
          var vi = tris[t] * 2;
          this._push(tex, world[vi], world[vi + 1], uvs[tris[t] * 2], uvs[tris[t] * 2 + 1], cr, cg, cb, ca);
        }
      } else if (attachment instanceof spine.RegionAttachment) {
        var region = attachment;
        if (!region.region || !region.region.renderObject) continue;
        var tex2 = this._texture(region.region.renderObject.texture.getImage());
        if (!tex2) continue;
        var world4 = this._world4 || new Float32Array(8);
        this._world4 = world4;
        region.computeWorldVertices(slot.bone, world4, 0, 2);
        var uvs2 = region.uvs;
        beginTex(tex2, blend);
        var quad = [0, 1, 2, 0, 2, 3];
        for (var q = 0; q < quad.length; q++) {
          var qi = quad[q] * 2;
          this._push(tex2, world4[qi], world4[qi + 1], uvs2[qi], uvs2[qi + 1], cr, cg, cb, ca);
        }
      }
    }
    this._flush();
  };

  CGSSWebGLRenderer.prototype.drawParticle = function (image, sprite) {
    var gl = this.gl;
    this._flush();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texture(image));
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.blendEquation(gl.FUNC_ADD);
    this._setParticleBlend(sprite);
    var mask = sprite.colorMask ?? 14;
    gl.colorMask(!!(mask & 8), !!(mask & 4), !!(mask & 2), !!(mask & 1));
    gl.uniform1f(this.uParticle, 1);
    gl.uniform1f(this.uParticleMask, sprite.maskAlpha ? 1 : 0);
    gl.uniform1f(this.uParticleMultiply, sprite.multiply ? 1 : 0);
    gl.uniform1f(this.uParticleLuma, sprite.lumaAlpha ? 1 : 0);
    gl.uniform1f(this.uGain, sprite.gain);
    var c = Math.cos(sprite.angle), s = Math.sin(sprite.angle);
    var corners = [[-.5,-.5,0,0],[.5,-.5,1,0],[.5,.5,1,1],[-.5,.5,0,1]];
    var indices = [0,1,2,0,2,3], color = sprite.color, uv = sprite.region;
    for (var i = 0; i < indices.length; i++) {
      var p = corners[indices[i]], x = p[0]*sprite.width, y = p[1]*sprite.height;
      this._push(null, sprite.x+x*c-y*s, sprite.y+x*s+y*c,
        uv.u+p[2]*uv.width, uv.v+p[3]*uv.height, color.r, color.g, color.b, color.a);
    }
    this._flush();
    gl.colorMask(true, true, true, true);
  };

  CGSSWebGLRenderer.prototype.drawParticleMesh = function (image, sprite) {
    var gl = this.gl;
    this._flush();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texture(image));
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.blendEquation(gl.FUNC_ADD);
    this._setParticleBlend(sprite);
    var mask = sprite.colorMask ?? 14;
    gl.colorMask(!!(mask & 8), !!(mask & 4), !!(mask & 2), !!(mask & 1));
    gl.uniform1f(this.uParticle, 1);
    gl.uniform1f(this.uParticleMask, sprite.maskAlpha ? 1 : 0);
    gl.uniform1f(this.uParticleMultiply, sprite.multiply ? 1 : 0);
    gl.uniform1f(this.uParticleLuma, sprite.lumaAlpha ? 1 : 0);
    gl.uniform1f(this.uGain, sprite.gain);
    var rotation = sprite.rotation || {x:0, y:0, z:-sprite.angle};
    var cz = Math.cos(rotation.z), sz = Math.sin(rotation.z);
    var cx = Math.cos(rotation.x), sx = Math.sin(rotation.x);
    var cy = Math.cos(rotation.y), sy = Math.sin(rotation.y);
    var color = sprite.color, uv = sprite.region;
    for (var i = 0; i < sprite.mesh.indices.length; i++) {
      var p = sprite.mesh.vertices[sprite.mesh.indices[i]];
      // Unity's Euler order is Z, X, Y. Project the rotated mesh after the
      // particle's local rotation so X/Y motion changes its visible silhouette.
      var x1 = p.x*cz - p.y*sz, y1 = p.x*sz + p.y*cz;
      var y2 = y1*cx - p.z*sx, z2 = y1*sx + p.z*cx;
      var x3 = x1*cy + z2*sy, y3 = y2;
      this._push(null, sprite.x + x3*sprite.width, sprite.y - y3*sprite.height,
        uv.u + p.u*uv.width, uv.v + p.v*uv.height, color.r, color.g, color.b, color.a);
    }
    this._flush();
    gl.colorMask(true, true, true, true);
  };

  CGSSWebGLRenderer.prototype.dispose = function () {
    if (this.disposed) return;
    this.disposed = true;
    for (var texture of this.texCache.values()) this.gl.deleteTexture(texture);
    this.texCache.clear();
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  };

  global.CGSSWebGLRenderer = CGSSWebGLRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
