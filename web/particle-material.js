const shaders = new Map([
  ['CommonParticle/Standard/Blend', {gain:2}],
  ['CommonParticle/TexAlpha/Simple/Blend', {gain:1}],
  ['CommonParticle/Standard/AddtiveMultiply', {gain:2, lumaAlpha:true}],
  ['CommonParticle/Simple/Blend', {gain:1}],
  ['CommonParticle/TexAlpha/Standard/Blend', {gain:2}],
  ['CommonParticle/Standard/Multiply', {gain:2, multiply:true}]
]);

export function particleMaterialState(shader, material) {
  const mode = shaders.get(shader?.name);
  if (!mode) throw new Error(`Unsupported particle shader: ${shader?.name || '(missing)'}`);
  const floats = Object.fromEntries((material?.m_SavedProperties?.m_Floats || []).map(({Key,Value}) => [Key,Value]));
  const state = shader.data?.states?.[0], blend = state?.rtBlend0;
  const binding = field => field?.name in floats ? floats[field.name] : field?.val;
  const src = binding(blend?.srcBlend), dst = binding(blend?.destBlend);
  const supportedBlend = mode.multiply ? src === 0 && dst === 3 :
    (src === 5 && [1,5,6,7,10].includes(dst)) || (src === 1 && dst === 10);
  if (!supportedBlend || binding(blend?.blendOp) !== 0)
    throw new Error(`Unsupported particle blend state for ${shader.name}: ${src}/${dst}`);
  const colorMask = binding(blend?.colMask);
  if (colorMask !== 14 || binding(state?.zWrite) !== 0 || binding(state?.alphaToMask) !== 0 || state?.rtSeparateBlend)
    throw new Error(`Unsupported particle render state for ${shader.name}`);
  return {gain:mode.gain, multiply:!!mode.multiply, lumaAlpha:!!mode.lumaAlpha, src, dst, colorMask};
}
