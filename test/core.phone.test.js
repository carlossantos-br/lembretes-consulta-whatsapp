import test from 'node:test';
import assert from 'node:assert/strict';

import { canonical, normalize, sameSubscriber, variants } from '../src/core/phone.js';

// Fixtures. A forma legada precisa ser, ela mesma, um celular legado válido —
// tirar o nono dígito tem que deixar um número de assinante começando em 6 ou
// mais, e é por isso que `9 9000 1111` serve de exemplo e `9 0000 1111` não
// serviria.
const MODERN = '5565990001111';
const LEGACY = '556590001111';

test('normalize remove a formatação e completa o código do país', () => {
  assert.equal(normalize('(65) 99000-1111'), MODERN);
  assert.equal(normalize('+55 65 99000 1111'), MODERN);
  assert.equal(normalize(''), '');
  assert.equal(normalize(null), '');
});

test('um celular tem a forma moderna e a forma legada', () => {
  assert.deepEqual(variants(MODERN), [MODERN, LEGACY]);
  assert.deepEqual(variants(LEGACY), [MODERN, LEGACY], 'a forma legada se expande para as duas');
});

test('a canônica é a forma moderna, a mesma que o sistema de agenda guarda', () => {
  assert.equal(canonical(LEGACY), MODERN);
  assert.equal(canonical(MODERN), MODERN);
});

test('telefone fixo não ganha nono dígito inventado', () => {
  const landline = '556533334444';
  assert.deepEqual(variants(landline), [landline]);
});

test('o mesmo assinante casa entre os dois formatos', () => {
  assert.equal(sameSubscriber(MODERN, LEGACY), true);
  assert.equal(sameSubscriber('+55 (65) 99000-1111', LEGACY), true);
});

test('assinantes diferentes não casam', () => {
  assert.equal(sameSubscriber(MODERN, '5565990002222'), false);
  assert.equal(sameSubscriber(MODERN, '5511990001111'), false, 'mesmo assinante, outro DDD');
});
