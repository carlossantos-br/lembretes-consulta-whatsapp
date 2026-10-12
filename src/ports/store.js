/**
 * Estado durável de lembretes, alertas e eventos.
 *
 * Três coisas que este port existe para tornar possíveis:
 *
 * **Idempotência por construção.** `upsertGroup` tem como chave `telefone + data
 * local` e informa se criou a linha. Um envio, portanto, é protegido pelo banco,
 * e não pelo scanner lembrando o que já fez.
 *
 * **Alertas que conseguem dizer "já te avisei".** Um alerta cuja condição é uma
 * consulta de estado dispara de novo a cada scan até o estado mudar, o que
 * transforma um problema em uma mensagem por hora (modo de falha 4).
 * `hasAlerted`/`markAlerted` são o jeito de uma condição que sobrevive ao próprio
 * alerta parar de gritar.
 *
 * **Retenção mínima.** `recordEvent` serve para fatos operacionais, não para
 * corpo de mensagem. O receiver descarta payloads de entrada de números sem
 * lembrete aguardando resposta *antes* de gravar qualquer coisa, então conteúdo
 * de mensagem de terceiros nunca chega aqui. Ver `docs/security-and-privacy.md`.
 *
 * @typedef {object} Reminder
 * @property {string} id
 * @property {string} groupKey
 * @property {string} phone            Forma canônica.
 * @property {string} localDate
 * @property {string[]} appointmentIds
 * @property {string[]} patientIds
 * @property {string[]} slots          Horários locais `HH:mm`, ordenados.
 * @property {boolean} shared          Mais de uma paciente neste aparelho.
 * @property {string} earliestStartsAt
 * @property {string} status           Ver `src/core/lifecycle.js`.
 * @property {string|null} sentAt
 * @property {object|null} reply       `{ verdict, reason, at }` — nunca o texto cru.
 * @property {string[]} writtenBack    Ids de agendamento já gravados.
 * @property {string[]} writeRefused   Ids de agendamento que o sistema de agenda recusou, em definitivo.
 * @property {number} writeAttempts
 * @property {string|null} writeError
 */

import { assertImplements } from './contract.js';

export const STORE_METHODS = [
  /**
   * `(group, { now, sliceName }) => Promise<{reminder, created, addedAppointmentIds}>`
   *
   * Chave em `groupKey`. `addedAppointmentIds` é como a herança funciona: um
   * agendamento marcado depois que o grupo já foi respondido simplesmente entra
   * na linha, e a fila de gravação de volta o pega porque ele ainda não está em
   * `writtenBack`.
   */
  'upsertGroup',
  /** `(appointment, { localDate, now }) => Promise<Reminder>` — só depois que uma consulta de telefone rodou. */
  'createNoPhoneRow',
  /** `(appointmentIds) => Promise<number>` — apareceu um telefone; o placeholder ficou obsoleto. */
  'dropNoPhoneRows',
  'getById',
  'getByGroupKey',
  /** `(phoneVariants: string[], statuses: string[]) => Promise<Reminder[]>` — correlação da resposta. */
  'findBySubscriber',
  'listByDate',
  /** `(id, patch, now?) => Promise<Reminder>` — o único que escreve campos do lembrete. */
  'update',
  /** `() => Promise<Reminder[]>` — lembretes respondidos com agendamentos ainda não gravados. */
  'pendingWriteBacks',
  'hasAlerted',
  'markAlerted',
  /** `(providerEventId) => Promise<boolean>` — true só na primeira vez. */
  'claimProviderEvent',
  /** `(type, data) => Promise<void>` — fatos operacionais, nunca corpo de mensagem. */
  'recordEvent',
  'listEvents',
];

export const assertStore = (adapter) => assertImplements('store', adapter, STORE_METHODS);
