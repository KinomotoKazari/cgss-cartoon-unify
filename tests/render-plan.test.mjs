import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderPlan} from '../web/render-plan.js';

test('partial skeleton sets and signed particle orders compose without mutating input', () => {
  const skeletons = Object.freeze([{layer:'fg'}, {layer:'chara'}, {layer:'bg'}]);
  const emitters = Object.freeze([-55,-40,0].map(order => ({id:String(order), renderer:{m_SortingOrder:order}})));
  const plan = createRenderPlan(skeletons, emitters);
  assert.deepEqual(plan.groups.map(g => [g.id,g.order]), [['bg',0],['-55',5],['-40',20],['chara',30],['fg',40],['0',60]]);
  assert.equal(plan.groups[1].item, emitters[0]);
  assert.deepEqual(skeletons.map(s => s.layer), ['fg','chara','bg']);
  assert.deepEqual(createRenderPlan([{layer:'chara'}]).groups.map(g => g.id), ['chara']);
  assert.throws(() => createRenderPlan([{layer:'unknown'}]), /Unknown Spine slot/);
});

test('equal-order fallback is stable and sorting-layer IDs are not priorities', () => {
  const emitters = [
    {id:'second-layer', renderer:{m_SortingLayer:1,m_SortingLayerID:-100,m_SortingOrder:-100}},
    {id:'first', renderer:{m_SortingLayer:0,m_SortingLayerID:999,m_SortingOrder:-30}},
    {id:'second', renderer:{m_SortingLayer:0,m_SortingLayerID:-999,m_SortingOrder:-30}}
  ];
  const plan = createRenderPlan([{layer:'chara'}], emitters);
  assert.deepEqual(plan.groups.map(g => g.id), ['chara','first','second','second-layer']);
  assert.deepEqual(plan.diagnostics.ties, [{layer:0,order:30,ids:['chara','first','second'],policy:'stable-preview-order'}]);
});

test('numbered skeleton variants retain their base-slot render order', () => {
  const plan = createRenderPlan([
    {layer:'chara2', slot:'chara'},
    {layer:'fg2', slot:'fg'},
    {layer:'chara', slot:'chara'},
    {layer:'fg', slot:'fg'}
  ]);
  assert.deepEqual(plan.groups.map(group => [group.id, group.order]), [
    ['chara2',30], ['chara',30], ['fg2',40], ['fg',40]
  ]);
});

test('the optional eff3 skeleton layer sorts between eff2 and chara', () => {
  const plan = createRenderPlan([{layer:'chara'}, {layer:'eff3'}, {layer:'eff2'}, {layer:'bg'}]);
  assert.deepEqual(plan.groups.map(group => [group.id, group.order]), [
    ['bg',0], ['eff2',10], ['eff3',20], ['chara',30]
  ]);
});
