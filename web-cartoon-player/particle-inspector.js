const ns = 'http://www.w3.org/2000/svg';

const pairs = entries => Object.fromEntries((entries || []).map(({Key, Value}) => [Key, Value]));
const object = (plan, id) => plan.objects[String(id)];
const point = (fit, value) => [value[0] * fit.scale + fit.tx, -value[1] * fit.scale + fit.ty];

function rotate(quaternion, value) {
  const {x, y, z, w} = quaternion, [vx, vy, vz] = value;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
}

function rotateEuler(value, degrees = {}) {
  let result = value;
  for (const axis of ['z', 'x', 'y']) {
    const angle = (Number(degrees[axis]) || 0) * Math.PI / 360;
    const quaternion = {x:0, y:0, z:0, w:Math.cos(angle)};
    quaternion[axis] = Math.sin(angle);
    result = rotate(quaternion, result);
  }
  return result;
}

function transform(value, data) {
  const scale = data.m_LocalScale || {x:1, y:1, z:1}, position = data.m_LocalPosition || {x:0, y:0, z:0};
  const scaled = value.map((item, index) => item * (scale[['x', 'y', 'z'][index]] ?? 1));
  const rotated = rotate(data.m_LocalRotation || {x:0, y:0, z:0, w:1}, scaled);
  return rotated.map((item, index) => item + (position[['x', 'y', 'z'][index]] ?? 0));
}

function world(plan, node, value) {
  // Apply the node transform and each ancestor from prefab root to child.
  return [node.transformId, ...node.ancestorTransformIds.slice().reverse()]
    .reduce((result, id) => transform(result, object(plan, id).data), value);
}

function hull(points) {
  // A two-dimensional convex hull gives an inexpensive visible source-volume outline.
  const sorted = [...new Map(points.map(item => [`${item[0]},${item[1]}`, item])).values()]
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const cross = (origin, left, right) => (left[0] - origin[0]) * (right[1] - origin[1]) - (left[1] - origin[1]) * (right[0] - origin[0]);
  const half = items => {
    const result = [];
    for (const item of items) {
      while (result.length > 1 && cross(result.at(-2), result.at(-1), item) <= 0) result.pop();
      result.push(item);
    }
    return result.slice(0, -1);
  };
  return sorted.length < 3 ? sorted : [...half(sorted), ...half([...sorted].reverse())];
}

function emittersFrom(plan, fit) {
  // Extract inspectable emitter data and convert it to canvas coordinates.
  const emitters = [];
  for (const prefab of plan.effectPrefabs || []) for (const node of prefab.nodes || []) {
    const components = Object.fromEntries((node.componentIds || []).map(id => [object(plan, id)?.type, object(plan, id)]));
    const system = components.ParticleSystem?.data, renderer = components.ParticleSystemRenderer?.data;
    if (!node.active || !system?.EmissionModule?.enabled || !renderer) continue;
    const materialId = renderer.m_Materials?.[0]?.m_PathID, material = object(plan, materialId)?.data;
    const textureId = material && pairs(material.m_SavedProperties?.m_TexEnvs)._MainTex?.m_Texture?.m_PathID;
    if (!textureId) continue;
    const shape = system.ShapeModule || {}, scale = shape.m_Scale || {x:0, y:0, z:0}, position = shape.m_Position || {x:0, y:0, z:0};
    const corners = [];
    for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
      const local = rotateEuler([x * scale.x, y * scale.y, z * scale.z], shape.m_Rotation);
      corners.push(point(fit, world(plan, node, local.map((item, index) => item + position[['x', 'y', 'z'][index]]))));
    }
    const initial = system.InitialModule || {}, textureObject = object(plan, textureId), materialObject = object(plan, materialId);
    emitters.push({
      name:node.name, id:components.ParticleSystem.pathId, textureId, textureName:textureObject?.name || 'Unknown texture', material:materialObject?.name || 'Unknown material',
      position:world(plan, node, [0, 0, 0]), screen:point(fit, world(plan, node, [0, 0, 0])), polygon:hull(corners),
      sortingOrder:renderer.m_SortingOrder, duration:system.lengthInSec, prewarm:system.prewarm, playOnAwake:system.playOnAwake,
      delay:system.startDelay?.scalar, life:[initial.startLifetime?.minScalar, initial.startLifetime?.scalar], size:[initial.startSize?.minScalar, initial.startSize?.scalar],
      rate:{minMaxState:system.EmissionModule.rateOverTime?.minMaxState, minScalar:system.EmissionModule.rateOverTime?.minScalar, scalar:system.EmissionModule.rateOverTime?.scalar},
      shape:{type:shape.type, position:shape.m_Position, rotation:shape.m_Rotation, scale:shape.m_Scale},
      uvTiles:system.UVModule?.enabled ? [system.UVModule.tilesX, system.UVModule.tilesY] : [1, 1],
      modules:Object.entries(system).filter(([name, value]) => name.endsWith('Module') && value?.enabled).map(([name]) => name)
    });
  }
  return emitters;
}

function svg(tag, attributes) {
  const result = document.createElementNS(ns, tag);
  for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, value);
  return result;
}

function field(label, value) {
  const row = document.createElement('div');
  const name = document.createElement('dt'); name.textContent = label;
  const data = document.createElement('dd'); data.textContent = value;
  row.append(name, data);
  return row;
}

export function mountParticleInspector({plan, fit, images, canvas, viewport, panel}) {
  // Build a static SVG overlay and detail panel independent of particle playback.
  const emitters = emittersFrom(plan, fit);
  panel.replaceChildren();
  if (!emitters.length) {
    panel.append(Object.assign(document.createElement('p'), {textContent:'This card has no active particle emitters.'}));
    return {count:0, setVisible() {}, dispose() { panel.replaceChildren(); }};
  }

  viewport.style.position = 'relative';
  const overlay = svg('svg', {class:'particle-inspector__overlay', viewBox:`0 0 ${canvas.width} ${canvas.height}`, 'aria-label':'Particle emitter positions'});
  viewport.append(overlay);
  const root = document.createElement('section'); root.className = 'particle-inspector';
  const note = document.createElement('p'); note.className = 'particle-inspector__note'; note.textContent = 'Markers show authored emitter centres and ShapeModule volumes. They are not the positions of individual particles in a frame.';
  const filters = document.createElement('div'); filters.className = 'particle-inspector__filters';
  const makeFilter = (label, checked) => { const control = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked; control.append(input, ` ${label}`); filters.append(control); return input; };
  const circles = makeFilter('Circular effects', true), other = makeFilter('Other emitters', true), volumes = makeFilter('Show all volumes', false);
  const layout = document.createElement('div'); layout.className = 'particle-inspector__layout';
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Particle emitter');
  emitters.forEach((emitter, index) => select.add(new Option(emitter.name, String(index))));
  const details = document.createElement('dl'); details.className = 'particle-inspector__details';
  const thumbnail = document.createElement('canvas'); thumbnail.width = thumbnail.height = 128; thumbnail.className = 'particle-inspector__thumbnail';
  const info = document.createElement('div'); info.append(thumbnail, details); layout.append(select, info); root.append(note, filters, layout); panel.append(root);
  let selected = 0, visible = false;

  const redraw = () => {
    overlay.replaceChildren();
    for (const [index, emitter] of emitters.entries()) {
      const circular = emitter.name.startsWith('eff_circle');
      if (!(circular ? circles.checked : other.checked)) continue;
      const color = circular ? '#60dbff' : '#ffd36a', group = svg('g', {class:'particle-inspector__marker'});
      if (volumes.checked || index === selected) group.append(svg('polygon', {points:emitter.polygon.map(item => item.join(',')).join(' '), fill:color, stroke:color}));
      group.append(svg('circle', {cx:emitter.screen[0], cy:emitter.screen[1], r:index === selected ? 11 : 7, fill:color, stroke:'#17202b', 'stroke-width':2}));
      const label = svg('text', {x:emitter.screen[0] + 12, y:emitter.screen[1] - 10}); label.textContent = emitter.name; group.append(label);
      group.addEventListener('click', () => selectEmitter(index)); overlay.append(group);
    }
  };
  const selectEmitter = index => {
    selected = index; select.value = String(index);
    const emitter = emitters[index], source = images[emitter.textureId], context = thumbnail.getContext('2d');
    context.clearRect(0, 0, thumbnail.width, thumbnail.height); context.fillStyle = '#000'; context.fillRect(0, 0, thumbnail.width, thumbnail.height);
    if (source) { const factor = Math.min(thumbnail.width / source.width, thumbnail.height / source.height); const width = source.width * factor, height = source.height * factor; context.drawImage(source, (thumbnail.width - width) / 2, (thumbnail.height - height) / 2, width, height); }
    details.replaceChildren(
      field('Texture', emitter.textureName), field('Material', emitter.material), field('World centre', emitter.position.map(value => value.toFixed(2)).join(', ')),
      field('Lifetime', `${emitter.life.join(' – ')} s`), field('Start size', emitter.size.join(' – ')), field('Emission rate', JSON.stringify(emitter.rate)),
      field('Sorting order', String(emitter.sortingOrder)), field('Duration', `${emitter.duration} s`), field('Prewarm', String(emitter.prewarm)),
      field('Play on awake', String(emitter.playOnAwake)), field('Start delay', `${emitter.delay} s`), field('UV tiles', emitter.uvTiles.join(' × ')),
      field('Shape', JSON.stringify(emitter.shape)), field('Active modules', emitter.modules.join(', ')), field('ParticleSystem ID', String(emitter.id))
    );
    redraw();
  };
  select.addEventListener('change', event => selectEmitter(Number(event.target.value)));
  [circles, other, volumes].forEach(input => input.addEventListener('change', redraw));
  selectEmitter(0);
  return {count:emitters.length, setVisible(next) { visible = Boolean(next); root.hidden = !visible; overlay.hidden = !visible; }, dispose() { overlay.remove(); panel.replaceChildren(); }};
}
