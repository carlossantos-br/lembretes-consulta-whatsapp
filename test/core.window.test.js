import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SLICES,
  HOUR_MS,
  dueSlice,
  inSlice,
  isTooEarly,
  isUnreachable,
  leadTime,
} from '../src/core/window.js';

const NOW = new Date('2026-03-10T12:00:00.000Z');
const at = (hoursAhead) => new Date(NOW.getTime() + hoursAhead * HOUR_MS);

test('a antecedência é a distância de agora até o agendamento', () => {
  assert.equal(leadTime(NOW, at(24)), 24 * HOUR_MS);
  assert.ok(leadTime(NOW, at(-1)) < 0);
});

test('uma fatia exclui o limite inferior e inclui o superior', () => {
  const primary = DEFAULT_SLICES[0];
  assert.equal(inSlice(24 * HOUR_MS, primary), false, 'exatamente 24h não está em (24,25]');
  assert.equal(inSlice(24 * HOUR_MS + 1, primary), true);
  assert.equal(inSlice(25 * HOUR_MS, primary), true, 'exatamente 25h está em (24,25]');
  assert.equal(inSlice(25 * HOUR_MS + 1, primary), false);
});

test('as fatias não se sobrepõem, então um scan por hora vê cada agendamento uma vez por fatia', () => {
  const leads = [24.5, 12.5, 20, 30, 1];
  for (const lead of leads) {
    const matches = DEFAULT_SLICES.filter((slice) => inSlice(lead * HOUR_MS, slice));
    assert.ok(matches.length <= 1, `antecedência de ${lead}h casou com ${matches.length} fatias`);
  }
});

test('dueSlice dá o nome da fatia, ou nada entre fatias', () => {
  assert.equal(dueSlice(NOW, at(24.5))?.name, 'primary');
  assert.equal(dueSlice(NOW, at(12.5))?.name, 'recovery');
  assert.equal(dueSlice(NOW, at(20)), null, 'entre fatias: espere, não envie');
});

test('unreachable significa que nenhum scan futuro consegue pegá-lo', () => {
  assert.equal(isUnreachable(NOW, at(11)), true);
  assert.equal(isUnreachable(NOW, at(12)), true, 'no piso já é tarde demais');
  assert.equal(isUnreachable(NOW, at(12.000_1)), false);
  assert.equal(isUnreachable(NOW, at(-2)), true, 'o agendamento já aconteceu');
});

test('cedo demais não é o mesmo que unreachable', () => {
  assert.equal(isTooEarly(NOW, at(30)), true);
  assert.equal(isUnreachable(NOW, at(30)), false);
  assert.equal(isTooEarly(NOW, at(25)), false);
});
