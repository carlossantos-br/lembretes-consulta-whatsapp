/**
 * O sistema de agenda: fonte da verdade dos agendamentos, e o lugar onde a
 * resposta acaba sendo gravada de volta.
 *
 * O contrato espelha de propósito duas restrições reais que moldam o pipeline
 * inteiro. Afrouxe qualquer uma delas num fake e os testes deixam de provar
 * qualquer coisa.
 *
 * **A listagem de agendamentos não traz número de telefone.** Os dados de contato
 * ficam em outro recurso, então lembrar N agendamentos custa N+1 chamadas, e o
 * telefone de um agendamento é *desconhecido* até alguém pedir por ele. Essa é a
 * origem do modo de falha 12: telefone nulo num agendamento recém-descoberto quer
 * dizer "ninguém olhou ainda", e não "esta paciente não tem telefone".
 *
 * **Gravar um status pode falhar com o transporte bem-sucedido.** O endpoint real
 * responde HTTP 200 com `{"success": false, "message": ...}` quando recusa. Um
 * port que devolvesse um booleano, ou que lançasse exceção na recusa, esconderia
 * o erro mais perigoso que quem chama pode cometer aqui — confiar no status code
 * (modo de falha 8). Por isso `setAppointmentStatus` resolve para um *objeto* de
 * resultado, e só um problema de transporte lança exceção.
 *
 * @typedef {object} Appointment
 * @property {string} id            Identificador estável do agendamento.
 * @property {string} patientId     Cadastro de paciente ao qual o agendamento pertence.
 * @property {string} [patientName] Usado só para personalizar a mensagem.
 * @property {string} startsAt      Instante ISO.
 * @property {string|null} [phone]  Ausente na listagem; preenchido depois.
 *
 * @typedef {object} WriteResult
 * @property {boolean} ok
 * @property {string} [message]     Texto do provedor quando `ok` é false.
 */

import { assertImplements } from './contract.js';

export const SCHEDULING_API_METHODS = [
  /** `(localDate: 'YYYY-MM-DD') => Promise<Appointment[]>` — sem números de telefone. */
  'listAppointments',
  /** `(patientId: string) => Promise<string|null>` — uma chamada por paciente. */
  'getPatientPhone',
  /** `(appointmentId: string, status: string) => Promise<WriteResult>` — leia o corpo. */
  'setAppointmentStatus',
];

export const assertSchedulingApi = (adapter) =>
  assertImplements('schedulingApi', adapter, SCHEDULING_API_METHODS);
