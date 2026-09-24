export function selectBackgroundBounds(candidates) {
  const valid=candidates.filter(item => item.bounds?.width>0 && item.bounds?.height>0)
    .map(item => ({...item,area:item.bounds.width*item.bounds.height,
      ratio:item.bounds.width/item.bounds.height}));
  const exact=valid.find(item => item.name.toLowerCase()==='bg');
  if(exact) return exact.bounds;
  const framed=valid.filter(item => item.normal && item.ratio>=1.2 && item.ratio<=2.2);
  const normal=valid.filter(item => item.normal);
  return (framed.length ? framed : normal.length ? normal : valid)
    .sort((a,b)=>b.area-a.area)[0]?.bounds || null;
}
