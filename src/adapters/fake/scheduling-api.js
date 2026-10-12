/**
 * Sistema de agenda em memória que preserva as duas esquisitices que importam.
 *
 * Ele tira o número de telefone da listagem, obrigando o pipeline a fazer a
 * consulta extra por paciente, e pode recusar uma gravação com um objeto de
 * resultado *bem-sucedido*, obrigando quem chama a ler o corpo. Um fake mais
 * camarada faria os testes passarem e o código de produção ficar errado.
 */

import { zonedFormatter } from '../../core/grouping.js';

export function createFakeSchedulingApi({
  appointments = [],
  phones = {},
  timeZone = 'America/Sao_Paulo',
  /** Ids de agendamento que o sistema se recusa a atualizar (HTTP 200, `ok: false`). */
  refuse = [],
  /** Ids de agendamento cuja atualização lança exceção, simulando falha de rede. */
  networkFailures = [],
} = {}) {
  const { date } = zonedFormatter(timeZone);
  const rows = appointments.map((appointment) => ({ ...appointment }));
  const statuses = new Map();
  const refused = new Set(refuse);
  const failing = new Set(networkFailures);
  let phoneLookups = 0;

  return {
    async listAppointments(localDate) {
      return rows
        .filter((appointment) => date(appointment.startsAt) === localDate)
        .map(({ phone, ...withoutPhone }) => ({ ...withoutPhone, phone: null }));
    },

    async getPatientPhone(patientId) {
      phoneLookups += 1;
      return phones[patientId] ?? null;
    },

    async setAppointmentStatus(appointmentId, status) {
      if (failing.has(appointmentId)) {
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      }
      if (refused.has(appointmentId)) {
        return { ok: false, message: 'agendamento não está em aberto' };
      }
      statuses.set(appointmentId, status);
      return { ok: true };
    },

    /** Controles e inspeção, não fazem parte do port. */
    statusOf: (appointmentId) => statuses.get(appointmentId) ?? null,
    writtenStatuses: () => Object.fromEntries(statuses),
    phoneLookupCount: () => phoneLookups,
    addAppointment: (appointment) => rows.push({ ...appointment }),
    setPhone: (patientId, phone) => {
      phones[patientId] = phone;
    },
    stopRefusing: (appointmentId) => refused.delete(appointmentId),
    stopFailing: (appointmentId) => failing.delete(appointmentId),
  };
}
