/**
 * Gravando a resposta de volta na agenda.
 *
 * É este passo que faz a funcionalidade inteira valer a pena: um lembrete sobre o
 * qual ninguém age é só uma notificação, e uma confirmação que nunca chega à agenda
 * é uma confirmação em que só a paciente acredita.
 *
 * Duas regras, ambas aprendidas em produção:
 *
 * **Leia o corpo, não o status code.** O endpoint responde HTTP 200 com
 * `{ ok: false }` quando recusa, então quem só confere o transporte acha que
 * gravou algo que não gravou (modo de falha 8).
 *
 * **Só falha de rede é retentável.** Uma recusa é uma decisão do sistema de origem
 * e vai ser recusa para sempre; retentá-la transforma uma falha permanente num
 * alerta a cada passada. Recusas são registradas por agendamento e saem da fila,
 * enquanto um erro de rede deixa o lote pendente para a próxima execução.
 */

import { CONFIRM } from '../core/interpret.js';
import { alertOnce } from './alert-once.js';

export async function processWriteBacks({ now, ports, config }) {
  const { schedulingApi, store } = ports;
  const { confirmedStatus, cancelledStatus, writeBackOverdueMs } = config;

  const stats = { considered: 0, written: 0, refused: 0, deferred: 0, overdueAlerts: 0 };

  for (const reminder of await store.pendingWriteBacks()) {
    stats.considered += 1;
    const status = reminder.reply.verdict === CONFIRM ? confirmedStatus : cancelledStatus;
    const writtenBack = [...reminder.writtenBack];
    const writeRefused = [...reminder.writeRefused];
    let writeError = null;

    const outstanding = reminder.appointmentIds.filter(
      (id) => !writtenBack.includes(id) && !writeRefused.includes(id),
    );

    for (const appointmentId of outstanding) {
      let result;
      try {
        result = await schedulingApi.setAppointmentStatus(appointmentId, status);
      } catch (error) {
        // Falha de transporte: mantém o resto do lote pendente e para aqui, para não
        // martelar um endpoint fora do ar uma vez por agendamento.
        writeError = error.message;
        break;
      }
      if (result.ok) {
        writtenBack.push(appointmentId);
        stats.written += 1;
      } else {
        writeRefused.push(appointmentId);
        writeError = result.message ?? 'recusado';
        stats.refused += 1;
      }
    }

    const updated = await store.update(
      reminder.id,
      {
        writtenBack,
        writeRefused,
        writeAttempts: reminder.writeAttempts + 1,
        writeError,
      },
      now,
    );

    const stillOutstanding =
      updated.appointmentIds.length - updated.writtenBack.length - updated.writeRefused.length;
    if (stillOutstanding > 0) {
      stats.deferred += 1;
      const waitedMs = new Date(now).getTime() - new Date(reminder.reply.at).getTime();
      if (waitedMs > writeBackOverdueMs) {
        // A retentativa continua; só a notificação fica limitada a uma.
        const alerted = await alertOnce(
          ports,
          `write_overdue:${reminder.id}`,
          `Resposta de ${reminder.id} segue não gravada há mais de uma hora (${stillOutstanding} agendamento(s), último erro: ${writeError ?? 'nenhum'}).`,
        );
        if (alerted) stats.overdueAlerts += 1;
      }
    }
  }

  await store.recordEvent('write_back', stats);
  return stats;
}
