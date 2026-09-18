import {readBundle} from './bundle-reader.js';
import {ObjectResolver, pairs} from './object-resolver.js';
import {decodeTexture} from './texture-decoder.js';

const slots = ['bg', 'eff2', 'chara', 'fg', 'eff1'];
const textDecoder = new TextDecoder();

function hierarchy(resolver, root) {
  // Flatten a prefab hierarchy while keeping transform ancestry for particle placement.
  const nodes = [], seen = new Set();
  function walk(gameObject, ancestors, parentActive) {
    if (seen.has(gameObject.key)) throw new Error('Cyclic prefab hierarchy');
    seen.add(gameObject.key);
    const data = resolver.data(gameObject);
    const components = data.m_Component.map(entry => resolver.resolve(gameObject, entry.component));
    const transforms = components.filter(entry => entry?.type === 'Transform');
    if (transforms.length !== 1) throw new Error('Expected one Transform per GameObject');
    const transform = transforms[0], active = parentActive && !!data.m_IsActive;
    nodes.push({gameObjectId:gameObject.key, name:data.m_Name, active, layer:data.m_Layer, transformId:transform.key, ancestorTransformIds:ancestors, componentIds:components.filter(Boolean).map(entry => entry.key)});
    for (const pointer of resolver.data(transform).m_Children) {
      const child = resolver.resolve(transform, pointer);
      walk(resolver.resolve(child, resolver.data(child).m_GameObject), [...ancestors, transform.key], active);
    }
  }
  walk(root, [], true);
  return nodes;
}

function planData(resolver, owner, value) {
  // Convert decoded Unity values to a transferable plan without copying binary buffers.
  if (typeof value === 'bigint') return value.toString();
  if (!value || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return undefined;
  if ('m_PathID' in value && 'm_FileID' in value) {
    return {m_FileID:value.m_FileID, m_PathID:resolver.resolve(owner, value)?.key || '0'};
  }
  if (Array.isArray(value)) return value.map(child => planData(resolver, owner, child));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, planData(resolver, owner, child)]));
}

export function loadCard(bytes, progress = () => {}) {
  // Extract named Spine resource slots and optional effect prefabs.
  progress('Reading bundle…');
  const bundle = readBundle(bytes), resolver = new ObjectResolver(bundle);
  progress('Resolving card assets…');
  const entries = [];
  for (const object of resolver.objects.values()) if (object.type === 'AssetBundle') {
    for (const {Key:path, Value:entry} of resolver.data(object).m_Container) {
      const match = path.match(/\/card\/(\d+)\/cartoon\//i);
      if (match) entries.push({path, cardId:match[1], object:resolver.resolve(object, entry.asset)});
    }
  }
  const ids = new Set(entries.map(entry => entry.cardId));
  if (ids.size !== 1) throw new Error(`Expected one card in the bundle; found ${ids.size}`);
  const cardId = [...ids][0], roots = [], skeletons = [], atlases = new Map(), effectPrefabs = [];
  for (const entry of entries) {
    const object = entry.object;
    if (!object) continue;
    if (object.type === 'MonoBehaviour') {
      const data = resolver.data(object);
      if (!data.skeletonJSON) continue;
      const skeleton = resolver.resolve(object, data.skeletonJSON), skeletonData = resolver.data(skeleton);
      const match = skeletonData.m_Name.match(/_(bg|eff2|chara|eff1|fg)\.skel(?:\.asset)?$/i);
      if (!match) throw new Error(`Unknown card skeleton layer: ${skeletonData.m_Name}`);
      const layer = match[1].toLowerCase();
      if (skeletons.some(item => item.layer === layer)) throw new Error(`Duplicate ${layer} skeleton`);
      skeletons.push({layer, name:skeletonData.m_Name, bytes:skeletonData.m_Script.slice(), scale:data.scale, defaultMix:data.defaultMix});
      roots.push(object);
      for (const pointer of data.atlasAssets) { const atlas = resolver.resolve(object, pointer); if (atlas) atlases.set(atlas.key, atlas); }
    } else if (object.type === 'GameObject') {
      const nodes = hierarchy(resolver, object);
      const particleSystemIds = nodes.flatMap(node => node.componentIds.filter(id => resolver.objects.get(id).type === 'ParticleSystem'));
      if (particleSystemIds.length) {
        roots.push(object);
        effectPrefabs.push({assetPath:entry.path, rootId:object.key, groupHint:entry.path.match(/\/effect\/([^/]+)\//)?.[1] || null, nodes, particleSystemIds});
      }
    }
  }
  if (!skeletons.length) throw new Error('Card has no supported Spine skeletons');
  if (atlases.size !== 1) throw new Error('This preview supports one shared Spine atlas');
  skeletons.sort((a,b) => slots.indexOf(a.layer) - slots.indexOf(b.layer));
  const atlasObject = [...atlases.values()][0], atlasData = resolver.data(atlasObject);
  if (atlasData.materials.length !== 1) throw new Error('Multi-page Spine atlases are not yet supported');
  const atlasText = textDecoder.decode(resolver.data(resolver.resolve(atlasObject, atlasData.atlasFile)).m_Script);
  const material = resolver.resolve(atlasObject, atlasData.materials[0]);
  const environments = pairs(resolver.data(material).m_SavedProperties.m_TexEnvs);
  const rgb = resolver.resolve(material, environments._MainTex?.m_Texture), alpha = resolver.resolve(material, environments._AlphaTex?.m_Texture);
  if (!rgb || !alpha) throw new Error('Spine material must reference RGB and alpha textures');
  // One closure covers layer textures and particle-prefab dependencies.
  const closure = resolver.closure(roots), textures = [], objects = Object.create(null);
  let textureBytes = 0;
  for (const object of closure.values()) {
    if (object.type === 'Texture2D') {
      const data = resolver.data(object);
      textureBytes += data.m_Width * data.m_Height * 4;
      if (textureBytes > 256 * 1024 * 1024) throw new Error('Card textures exceed 256 MB');
      progress(`Decoding ${data.m_Name}…`);
      textures.push(decodeTexture(resolver, object));
    }
    if (object.type === 'Shader') {
      // Keep render states without transferring compiled GPU programs.
      const parsed = resolver.data(object).m_ParsedForm;
      objects[object.key] = {pathId:object.pathId, type:object.type, name:parsed.m_Name,
        data:{states:parsed.m_SubShaders.flatMap(sub=>sub.m_Passes.map(pass=>pass.m_State))}};
      continue;
    }
    objects[object.key] = {pathId:object.pathId, type:object.type, name:object.name || '', file:object.file};
    if (object.data && !['TextAsset','Texture2D'].includes(object.type)) objects[object.key].data = planData(resolver, object, object.data);
  }
  const summary = {cardId, bundleVersion:bundle.version, files:[...resolver.files.values()].map(file => ({unityVersion:file.unityVersion, version:file.version, objects:file.objects.size})), textureFormats:[...new Set(textures.map(texture => texture.format))]};
  return {cardId, skeletons, atlasText, rgbId:rgb.key, alphaId:alpha.key, textures, plan:{schema:'cgss-card-load-plan/2', cardId, objects, effectPrefabs}, summary};
}
