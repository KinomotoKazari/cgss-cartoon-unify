// Shader equations and blend bindings come from the bundled shader and material.
// Texture-format fallbacks are selected separately and labelled when approximate.
const shaders = new Map([
  ['CommonParticle/Standard/Blend', {gain:2, input:'main'}],
  ['CommonParticle/TexAlpha/Simple/Blend', {gain:1, input:'separate-alpha'}],
  ['CommonParticle/Standard/AddtiveMultiply', {gain:2, input:'luminance-multiply'}],
  ['CommonParticle/Simple/Blend', {gain:1, input:'main'}],
  ['CommonParticle/TexAlpha/Standard/Blend', {gain:2, input:'separate-alpha'}],
  ['CommonParticle/Standard/Multiply', {gain:2, input:'multiply'}]
]);
const formats = new Set([1,3,4,7,34]);

export function resolveParticleMaterial(shader, material, texture) {
  const mode = shaders.get(shader?.name);
  if (!mode) throw new Error(`Unsupported particle shader: ${shader?.name || '(missing)'}`);
  if (!formats.has(texture?.mainFormat))
    throw new Error(`Unsupported particle texture format for ${shader.name}: ${texture?.mainFormat ?? '(missing)'}`);
  const floats = Object.fromEntries((material?.m_SavedProperties?.m_Floats || []).map(({Key,Value}) => [Key,Value]));
  const state = shader.data?.states?.[0], blend = state?.rtBlend0;
  const binding = field => field?.name in floats ? floats[field.name] : field?.val;
  const src = binding(blend?.srcBlend), dst = binding(blend?.destBlend);
  const multiply = mode.input === 'multiply', lumaAlpha = mode.input === 'luminance-multiply';
  const supportedBlend = multiply ? src === 0 && dst === 3 :
    (src === 5 && [1,5,6,7,10].includes(dst)) || (src === 1 && dst === 10);
  if (!supportedBlend || binding(blend?.blendOp) !== 0)
    throw new Error(`Unsupported particle blend state for ${shader.name}: ${src}/${dst}`);
  const colorMask = binding(blend?.colMask);
  if (colorMask !== 14 || binding(state?.zWrite) !== 0 || binding(state?.alphaToMask) !== 0 || state?.rtSeparateBlend)
    throw new Error(`Unsupported particle render state for ${shader.name}`);

  if (mode.input === 'separate-alpha' && texture.alphaAssigned && !texture.hasAlphaTexture)
    throw new Error(`Missing particle alpha texture for ${shader.name}`);
  if (lumaAlpha && texture.multiplyAssigned && !texture.hasMultiplyTexture)
    throw new Error(`Missing particle multiply texture for ${shader.name}`);
  const usesAlphaTexture = mode.input === 'separate-alpha' && !!texture.hasAlphaTexture;
  const usesMultiplyTexture = lumaAlpha && !!texture.hasMultiplyTexture;
  if (usesAlphaTexture && !formats.has(texture.alphaFormat))
    throw new Error(`Unsupported particle alpha texture format for ${shader.name}: ${texture.alphaFormat ?? '(missing)'}`);
  if (usesMultiplyTexture && !formats.has(texture.multiplyFormat))
    throw new Error(`Unsupported particle multiply texture format for ${shader.name}: ${texture.multiplyFormat ?? '(missing)'}`);

  let alphaSource = 'main-texture', confidence = 'shader-and-material';
  if (usesAlphaTexture) alphaSource = texture.alphaFormat === 1 ? 'alpha8-texture' : 'alpha-texture-red';
  else if (mode.input === 'separate-alpha') {
    alphaSource = 'shader-default-white';
    confidence = 'approximation';
  }
  else if (lumaAlpha) alphaSource = usesMultiplyTexture ? 'luminance-multiply-texture' : 'luminance-default-white';
  else if (mode.input === 'main' && shader.name.startsWith('CommonParticle/Standard/') && texture.mainFormat === 34 && dst !== 1) {
    alphaSource = 'rgb-mask-approximation';
    confidence = 'approximation';
  } else if (mode.input === 'main' && [3,7,34].includes(texture.mainFormat) && dst !== 1) {
    alphaSource = 'opaque-main-approximation';
    confidence = 'approximation';
  }

  return {gain:mode.gain, multiply, lumaAlpha, src, dst, colorMask, alphaSource, confidence,
    usesAlphaTexture, usesMultiplyTexture, maskAlpha:alphaSource === 'rgb-mask-approximation'};
}
