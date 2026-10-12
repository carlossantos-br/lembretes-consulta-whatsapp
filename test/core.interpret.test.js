import test from 'node:test';
import assert from 'node:assert/strict';

import { CANCEL, CONFIRM, ESCALATE, interpretReply, normalizeText } from '../src/core/interpret.js';

test('a normalização ignora caixa, acentos e pontuação final', () => {
  assert.equal(normalizeText('  Não  irei. '), 'nao irei');
  assert.equal(normalizeText('CONFIRMO!'), 'confirmo');
});

test('os textos exatos dos botões agem', () => {
  assert.deepEqual(interpretReply('Confirmo'), {
    verdict: CONFIRM,
    reason: 'exact_confirm_button',
  });
  assert.deepEqual(interpretReply('Não irei'), {
    verdict: CANCEL,
    reason: 'exact_cancel_button',
  });
  assert.equal(interpretReply('nao irei').verdict, CANCEL, 'acentos não são obrigatórios');
});

test('linguagem natural é escalada por padrão, não adivinhada', () => {
  for (const text of ['Sim', 'Pode confirmar', 'Eu vou', 'Sim estou indo']) {
    assert.deepEqual(
      interpretReply(text),
      { verdict: ESCALATE, reason: 'unrecognised' },
      `"${text}" não pode agir sozinho`,
    );
  }
});

test('o vocabulário de confirmação pode ser ampliado', () => {
  const options = { confirmVocabulary: ['Sim', 'Pode confirmar', 'Eu vou'] };
  assert.deepEqual(interpretReply('pode confirmar', options), {
    verdict: CONFIRM,
    reason: 'confirm_vocabulary',
  });
  assert.equal(interpretReply('remarcar', options).verdict, ESCALATE);
});

test('o cancelamento é verificado primeiro, então um vocabulário ampliado nunca cancela', () => {
  // Nem uma configuração errada que liste o botão de cancelar como frase de
  // confirmação pode transformar um cancelamento numa confirmação.
  const options = { confirmVocabulary: ['Não irei'] };
  assert.equal(interpretReply('Não irei', options).verdict, CANCEL);
});

test('a comparação é da string inteira, então uma negação não vira concordância', () => {
  const options = { confirmVocabulary: ['confirmo'] };
  assert.equal(interpretReply('não posso confirmar', options).verdict, ESCALATE);
});

test('respostas automáticas ficam separadas da fila humana', () => {
  const options = { automatedPatterns: [/agradece seu contato/, /obrigada pela mensagem/] };
  assert.deepEqual(interpretReply('Agencia Exemplo agradece seu contato', options), {
    verdict: ESCALATE,
    reason: 'automated',
  });
  assert.equal(interpretReply('quero remarcar', options).reason, 'unrecognised');
});

test('uma resposta vazia é escalada com motivo próprio', () => {
  assert.equal(interpretReply('   ').reason, 'empty');
  assert.equal(interpretReply(undefined).reason, 'empty');
});
