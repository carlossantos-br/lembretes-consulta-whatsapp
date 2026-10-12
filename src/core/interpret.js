/**
 * Leitura da resposta da paciente.
 *
 * O provedor oferece no máximo dois botões de resposta rápida, então o
 * vocabulário que dá para *garantir* são duas strings exatas. Todo o resto é
 * texto livre digitado por alguém que pode estar confirmando, cancelando, pedindo
 * para remarcar ou respondendo a outra coisa completamente diferente.
 *
 * A política padrão é conservadora de propósito: só o texto exato do botão age;
 * qualquer outra coisa é escalada para uma fila humana. Essa política foi para
 * produção e tem um custo conhecido — pacientes que responderam "sim, estarei lá"
 * em linguagem natural se consideraram confirmadas enquanto a agenda continuava
 * em branco. A opção `confirmVocabulary` existe para ampliar *só* o lado da
 * confirmação, nunca o do cancelamento, porque os dois erros não custam o mesmo:
 *
 *   - confirmar errado custa um no-show, que já é o resultado padrão quando
 *     ninguém responde;
 *   - cancelar errado tira a paciente da agenda, e ela aparece para um horário
 *     que não existe mais.
 *
 * Erros de custo diferente merecem tolerâncias diferentes. Ver
 * `docs/decisions/0003-asymmetric-tolerance-confirm-vs-cancel.md` e
 * `docs/decisions/0007-exact-button-text-only.md`.
 */

export const CONFIRM = 'confirm';
export const CANCEL = 'cancel';
export const ESCALATE = 'escalate';

/**
 * Ignora caixa, remove diacríticos e pontuação final para que "Não irei" e
 * "nao irei." sejam a mesma string. A comparação continua sendo igualdade da
 * string inteira: casar por substring faria "não posso confirmar" virar uma
 * confirmação.
 */
export function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFD')
    // \p{Mn} é exatamente o que a NFD produz para acentos: marcas combinantes sem espaçamento.
    .replace(/[\p{Mn}\p{Cf}]/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    // Trim antes: a pontuação só fica "no final" depois que os espaços saem.
    .replace(/[.!,;:]+$/g, '');
}

export function interpretReply(text, options = {}) {
  const {
    confirmButton = 'Confirmo',
    cancelButton = 'Não irei',
    // Amplia só o lado da confirmação. Não existe `cancelVocabulary`, por design.
    confirmVocabulary = [],
    // Respostas automáticas de marketing na própria linha da paciente chegam com
    // cara de resposta humana e poluem a fila humana (modo de falha 14).
    automatedPatterns = [],
  } = options;

  const normalized = normalizeText(text);
  if (!normalized) return { verdict: ESCALATE, reason: 'empty' };

  // O cancelamento é verificado primeiro: é o único veredito que tira alguém da
  // agenda, então nunca pode ser alcançado por um vocabulário ampliado.
  if (normalized === normalizeText(cancelButton)) {
    return { verdict: CANCEL, reason: 'exact_cancel_button' };
  }
  if (normalized === normalizeText(confirmButton)) {
    return { verdict: CONFIRM, reason: 'exact_confirm_button' };
  }
  if (confirmVocabulary.some((phrase) => normalizeText(phrase) === normalized)) {
    return { verdict: CONFIRM, reason: 'confirm_vocabulary' };
  }
  if (automatedPatterns.some((pattern) => pattern.test(normalized))) {
    return { verdict: ESCALATE, reason: 'automated' };
  }
  return { verdict: ESCALATE, reason: 'unrecognised' };
}
