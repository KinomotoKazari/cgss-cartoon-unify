const channels = ['r', 'g', 'b', 'a'];
const white = {r:1, g:1, b:1, a:1};
const mix = (a, b, t) => Object.fromEntries(channels.map(c => [c, a[c] + (b[c]-a[c])*t]));

// Color and alpha have independent key times. Unused serialized keys are not stops.
export function gradientColor(gradient, time) {
  if (!gradient) return {...white};
  const result = {...white};
  for (const channel of channels) {
    const alpha = channel === 'a';
    const count = gradient[alpha ? 'm_NumAlphaKeys' : 'm_NumColorKeys'] || 0;
    const prefix = alpha ? 'atime' : 'ctime';
    if (!count) continue;
    result[channel] = gradient.key0[channel];
    for (let i=1; i<count; i++) {
      const start = gradient[`${prefix}${i-1}`]/65535, end = gradient[`${prefix}${i}`]/65535;
      const a = gradient[`key${i-1}`][channel], b = gradient[`key${i}`][channel];
      if (time < end) {
        result[channel] = gradient.m_Mode === 1 ? a : a + (b-a)*Math.max(0,(time-start)/(end-start || 1));
        break;
      }
      result[channel] = b;
    }
  }
  return result;
}

// The random value belongs to the particle and must remain stable over its life.
export function sampleColor(value, random, time) {
  if (!value) return {...white};
  switch (value.minMaxState) {
    case 1: return gradientColor(value.maxGradient, time);
    case 2: return mix(value.minColor, value.maxColor, random);
    case 3: return mix(gradientColor(value.minGradient,time), gradientColor(value.maxGradient,time),random);
    case 4: return gradientColor(value.maxGradient, random);
    default: return value.maxColor || {...white};
  }
}

export function multiplyColors(...colors) {
  return Object.fromEntries(channels.map(c => [c, colors.reduce((value,color)=>value*(color?.[c] ?? 1),1)]));
}

// Apply the recovered fragment equation before Canvas supplies SrcAlpha blending.
export function shadePixels(source, target, color, gain) {
  for (let i=0; i<source.length; i+=4) {
    for (let c=0; c<4; c++) target[i+c] = Math.min(255,Math.max(0,source[i+c]*color[channels[c]]*gain));
  }
}
