/**
 * A máquina de estados do lembrete.
 *
 * Duas regras fazem a maior parte do trabalho aqui, e as duas foram aprendidas
 * do jeito difícil.
 *
 * **1. Nenhum estado pode descrever configuração.** Uma versão anterior tinha um
 * estado que significava "a allowlist do piloto estava ligada quando passei por
 * esta linha". Isso é um fato sobre o *deploy naquele momento*, não sobre o
 * lembrete, e foi gravado como terminal — então desligar o piloto não trouxe
 * ninguém de volta e cerca de 80% da agenda de um dia foi pulada em silêncio
 * (modo de falha 3). Filtros que vêm da configuração são aplicados na hora do
 * envio e nunca persistidos. Os estados abaixo descrevem todos o próprio
 * lembrete.
 *
 * **2. Falha não é desfecho.** `send_failed` e `no_phone` podem ser retentados:
 * um erro de rede merece outra tentativa, e "sem telefone" muitas vezes quer
 * dizer "o telefone nunca foi consultado", e não "esta paciente não tem"
 * (modo de falha 12). Só `unreachable` é terminal, e é terminal porque o tempo
 * passou, não porque um componente falhou.
 *
 * `confirmed` e `cancelled` alcançam um ao outro de propósito: pacientes
 * confirmam e depois cancelam, cancelam e depois confirmam, e a agenda tem que
 * acompanhar.
 */

export const PENDING = 'pending';
export const SENT = 'sent';
export const CONFIRMED = 'confirmed';
export const CANCELLED = 'cancelled';
export const SEND_FAILED = 'send_failed';
export const NO_PHONE = 'no_phone';
export const UNREACHABLE = 'unreachable';

export const STATES = [PENDING, SENT, CONFIRMED, CANCELLED, SEND_FAILED, NO_PHONE, UNREACHABLE];

const TRANSITIONS = {
  [PENDING]: [SENT, SEND_FAILED, NO_PHONE, UNREACHABLE],
  [SEND_FAILED]: [SENT, SEND_FAILED, UNREACHABLE],
  [NO_PHONE]: [PENDING, SENT, UNREACHABLE],
  [SENT]: [CONFIRMED, CANCELLED],
  [CONFIRMED]: [CANCELLED],
  [CANCELLED]: [CONFIRMED],
  [UNREACHABLE]: [],
};

/** Estados dos quais nenhuma transição sai. */
export const TERMINAL = Object.freeze(
  new Set(STATES.filter((state) => TRANSITIONS[state].length === 0)),
);

/** Estados que a fila de envio volta a pegar num scan posterior. */
export const RETRYABLE = Object.freeze(new Set([PENDING, SEND_FAILED, NO_PHONE]));

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`transição ilegal de lembrete: ${from} -> ${to}`);
  }
  return to;
}
