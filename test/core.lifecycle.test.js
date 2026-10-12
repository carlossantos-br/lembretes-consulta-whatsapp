import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANCELLED,
  CONFIRMED,
  NO_PHONE,
  PENDING,
  RETRYABLE,
  SENT,
  SEND_FAILED,
  STATES,
  TERMINAL,
  UNREACHABLE,
  assertTransition,
  canTransition,
} from '../src/core/lifecycle.js';

test('só a passagem do tempo é terminal', () => {
  assert.deepEqual([...TERMINAL], [UNREACHABLE]);
});

test('falhas ficam na fila em vez de virarem desfecho', () => {
  assert.ok(RETRYABLE.has(SEND_FAILED), 'uma falha de rede merece outra tentativa');
  assert.ok(RETRYABLE.has(NO_PHONE), '"sem telefone" muitas vezes é "ainda não consultado"');
  assert.equal(canTransition(SEND_FAILED, SENT), true);
  assert.equal(canTransition(NO_PHONE, SENT), true);
});

test('um lembrete enviado só pode ser respondido', () => {
  assert.equal(canTransition(SENT, CONFIRMED), true);
  assert.equal(canTransition(SENT, CANCELLED), true);
  assert.equal(canTransition(SENT, PENDING), false, 'não tem volta para a fila de envio');
});

test('pacientes mudam de ideia nas duas direções', () => {
  assert.equal(canTransition(CONFIRMED, CANCELLED), true);
  assert.equal(canTransition(CANCELLED, CONFIRMED), true);
});

test('nada sai de unreachable', () => {
  for (const state of STATES) {
    assert.equal(canTransition(UNREACHABLE, state), false);
  }
});

test('uma transição ilegal lança exceção em vez de corromper a linha em silêncio', () => {
  assert.throws(() => assertTransition(UNREACHABLE, SENT), /transição ilegal de lembrete/);
  assert.equal(assertTransition(PENDING, SENT), SENT);
});

test('nenhum estado tem nome de configuração de deploy', () => {
  // Modo de falha 3: um estado que significa "a allowlist do piloto estava ligada
  // quando passei por esta linha" é um fato sobre configuração, não sobre o
  // lembrete. As palavras ficam em inglês porque os nomes de estado são
  // identificadores em inglês.
  const configWords = ['pilot', 'allowlist', 'dry', 'enabled', 'flag', 'config'];
  for (const state of STATES) {
    for (const word of configWords) {
      assert.ok(!state.includes(word), `o estado "${state}" descreve configuração`);
    }
  }
});
