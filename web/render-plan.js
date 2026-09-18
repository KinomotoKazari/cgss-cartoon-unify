// Cross-object offsets from the reference game's native playback pipeline.
export const SPINE_ORDERS = Object.freeze({bg:0, eff2:10, chara:30, fg:40, eff1:50});

export function createRenderPlan(skeletons, emitters = []) {
  const groups = skeletons.map(item => {
    if (!Object.hasOwn(SPINE_ORDERS, item.layer)) throw new Error(`Unknown Spine slot: ${item.layer}`);
    return {kind:'spine', id:item.layer, layer:0, order:SPINE_ORDERS[item.layer], item};
  });
  for (const emitter of emitters) groups.push({kind:'particle', id:emitter.id,
    layer:emitter.renderer.m_SortingLayer ?? 0,
    order:60 + (emitter.renderer.m_SortingOrder ?? 0), item:emitter});
  groups.forEach((group, index) => { group.ordinal = index; });
  groups.sort((a,b) => a.layer-b.layer || a.order-b.order || a.ordinal-b.ordinal);
  const ties = [];
  for (let start=0; start<groups.length;) {
    let end=start+1;
    while (end<groups.length && groups[end].layer===groups[start].layer && groups[end].order===groups[start].order) end++;
    if (end-start>1) ties.push({layer:groups[start].layer, order:groups[start].order,
      ids:groups.slice(start,end).map(g=>g.id), policy:'stable-preview-order'});
    start=end;
  }
  return {groups, diagnostics:{ties, policy:'native-cross-object-offsets / stable-preview-ties',
    limitations:['queue-distance-state-ties', 'particle-local-sort', 'camera-bone-binding', 'native-startup-policy']}};
}
