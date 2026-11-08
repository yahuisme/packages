'use strict';
// Complete node view and native LuCI validation/Add; only transport is a fixture.
const assert = require('assert/strict');
const { test } = require('node:test');
process.env.PACKAGES_ROOT = require('path').resolve(__dirname, '..');
const { pageBoot } = require('./helpers/test_page_lifecycle.cjs');
const { walk } = require('./homeproxy-editor-parity.cjs');

async function withCreation(fn) {
 const h = await pageBoot('node');
 try {
  // Observe the real bound validator returned by native ui.addValidator().
  const addValidator = h.mods.ui.addValidator;
  let validate;
  h.mods.ui.addValidator = function(field, ...args) {
   const result = addValidator.call(this, field, ...args);
   if (field.classList.contains('cbi-section-create-name')) validate = result;
   return result;
  };
  await h.map.reset();
  const input = h.root().querySelector('.cbi-section-create-name');
  const button = h.root().querySelector('.cbi-section-create > .cbi-button-add');
  const grid = walk(h.map).find(o => o.option === 'type' && o.section.sectiontype === 'node').section;
  assert(input && button && validate, 'native creation field, Add button and validator mounted');
  const enter = (value, event = 'keyup') => {
   input.value = value;
   input.dispatchEvent(new h.w.Event(event, { bubbles: true }));
   return validate();
  };
  await fn({ h, input, button, grid, enter });
 } finally { h.w.close(); }
}

for (const id of ['nil', 'urltest']) {
 test('manual creation rejects reserved main_node identifier ' + id, async () => {
  await withCreation(async ({ h, input, button, grid, enter }) => {
   assert.equal(h.mods.uci.get('homeproxy', id), null, 'not a duplicate section');
   assert.equal(enter(id), false, id + ' must fail the actual native validator');
   assert(input.classList.contains('cbi-input-invalid'));
   assert.equal(input.getAttribute('data-tooltip'), 'Expecting: unique UCI identifier');
   assert.equal(button.disabled, true, id + ' cannot enable native Add');
   button.click();
   assert.equal(grid.getActiveModalMap(), null, 'disabled Add cannot open an editor');
   assert.equal(h.mods.uci.get('homeproxy', id), null, 'disabled Add creates no reserved node');
   assert.equal(h.mods.uci.get('homeproxy', 'config', 'main_node'), 'n1', 'selection unchanged');
   assert.equal(enter(id, 'blur'), false, 'blur also rejects reserved identifiers');
  });
 });
}

test('manual creation preserves blank/duplicate validation and allows other UCI identifiers', async () => {
 await withCreation(async ({ h, input, button, grid, enter }) => {
  for (const id of ['manual_node', 'nil_node', 'urltest_node', 'Nil', 'URLTest']) {
   assert.equal(enter(id), true, id + ' remains valid');
   assert.equal(button.disabled, false, id + ' enables Add');
   assert(!input.classList.contains('cbi-input-invalid'));
  }
  assert.equal(enter(''), true, 'optional empty input is not a validation error');
  assert.equal(button.disabled, true, 'empty input still disables Add');
  for (const id of ['n1', 'config']) {
   assert.equal(enter(id), false, 'existing node and non-node sections remain duplicates');
   assert.equal(button.disabled, true);
   assert.equal(input.getAttribute('data-tooltip'), 'Expecting: unique UCI identifier');
  }
  assert.equal(enter('manual_node'), true, 'valid input recovers after rejection');
  button.click();
  const deadline = performance.now() + 3000;
  while (!grid.getActiveModalMap() && performance.now() < deadline)
   await new Promise(resolve => setTimeout(resolve, 1));
  assert(grid.getActiveModalMap(), 'allowed identifier opens the native node editor');
  assert.equal(h.mods.uci.get('homeproxy', 'manual_node')['.type'], 'node');
  await grid.handleModalCancel(null, { target: button });
  assert.equal(h.mods.uci.get('homeproxy', 'manual_node'), null, 'Cancel retains native draft cleanup');
 });
});
