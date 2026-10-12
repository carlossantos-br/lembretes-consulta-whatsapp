/**
 * O scan: quatro fases, rodando em horário fixo.
 *
 *   1. discover  — lista os agendamentos de toda data local que uma fatia alcança
 *   2. resolve   — consulta um telefone por paciente, em sequência
 *   3. send      — agrupa, confere a fatia, envia uma vez por grupo
 *   4. inherit   — agendamentos que entraram num grupo já respondido
 *
 * As fases são separadas porque falham de jeitos diferentes. Falha na descoberta
 * é indisponibilidade; falha numa consulta de telefone custa uma paciente; falha
 * num envio custa uma mensagem. Juntar tudo numa passada só faz toda falha
 * parecer a pior delas.
 */

import { HOUR_MS, dueSlice, isUnreachable } from '../core/window.js';
import { groupAppointments, zonedFormatter } from '../core/grouping.js';
import {
  CANCELLED,
  CONFIRMED,
  RETRYABLE,
  SENT,
  SEND_FAILED,
  UNREACHABLE,
} from '../core/lifecycle.js';

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined);

/**
 * Datas locais que podem conter um agendamento que está agora dentro de uma fatia.
 *
 * Derivadas das fatias em vez de fixadas em "amanhã": uma fatia de recuperação em
 * 12h alcança o dia de hoje, e fixar D+1 é o jeito de uma segunda fatia parar, em
 * silêncio, de encontrar metade dos próprios candidatos.
 */
export function candidateDates(now, slices, timeZone) {
  const { date } = zonedFormatter(timeZone);
  const floor = Math.min(...slices.map((slice) => slice.lowerHours));
  const ceiling = Math.max(...slices.map((slice) => slice.lowerHours + slice.widthHours));
  const start = new Date(now).getTime() + floor * HOUR_MS;
  const end = new Date(now).getTime() + ceiling * HOUR_MS;

  const dates = new Set();
  for (let instant = start; instant <= end; instant += HOUR_MS) {
    dates.add(date(new Date(instant)));
  }
  dates.add(date(new Date(end)));
  return [...dates];
}

/** Variáveis do template: nome, data e todos os horários do aparelho naquele dia. */
export function buildVariables(group) {
  return [group.primaryName ?? '', group.localDate, group.slots.join(', ')];
}

export async function scan({ now, ports, config }) {
  const { schedulingApi, messaging, store } = ports;
  const { timeZone, slices, templateId, allowlist, dryRun, throttleMs } = config;
  const { date } = zonedFormatter(timeZone);

  const stats = {
    localDate: date(now),
    dates: [],
    discovered: 0,
    phoneLookups: 0,
    groups: 0,
    due: 0,
    sent: 0,
    sendFailed: 0,
    skippedByConfig: 0,
    noPhone: 0,
    unreachable: 0,
    tooEarly: 0,
    alreadyHandled: 0,
    inherited: 0,
  };

  // ---- fase 1: descoberta -------------------------------------------------
  const dates = candidateDates(now, slices, timeZone);
  stats.dates = dates;
  const discovered = [];
  for (const localDate of dates) {
    discovered.push(...(await schedulingApi.listAppointments(localDate)));
  }
  stats.discovered = discovered.length;

  // ---- fase 2: resolução de telefones ------------------------------------------
  // Uma consulta por paciente, não por agendamento, e em sequência: a listagem não
  // traz telefone, então um dia cheio custa uma chamada por paciente além da lista.
  const phoneByPatient = new Map();
  for (const patientId of new Set(discovered.map((appointment) => appointment.patientId))) {
    phoneByPatient.set(patientId, await schedulingApi.getPatientPhone(patientId));
    stats.phoneLookups += 1;
    await sleep(throttleMs);
  }
  const resolved = discovered.map((appointment) => ({
    ...appointment,
    phone: phoneByPatient.get(appointment.patientId) ?? null,
  }));

  // ---- fase 3: agrupamento e envio -----------------------------------------
  const { groups, withoutPhone } = groupAppointments(resolved, { timeZone });
  stats.groups = groups.length;

  for (const appointment of withoutPhone) {
    // Registrado só agora, depois que uma consulta de fato aconteceu.
    await store.createNoPhoneRow(appointment, { localDate: date(appointment.startsAt), now });
    stats.noPhone += 1;
  }

  for (const group of groups) {
    await store.dropNoPhoneRows(group.appointmentIds);

    const slice = dueSlice(now, group.earliestStartsAt, slices);
    const { reminder, addedAppointmentIds } = await store.upsertGroup(group, {
      now,
      sliceName: slice?.name ?? null,
    });

    // ---- fase 4: herança ----------------------------------------------
    // Um agendamento marcado depois que o grupo respondeu entra na linha; a fila de
    // gravação de volta o pega porque ele ainda não está em `writtenBack`. Sem caso
    // especial.
    if (addedAppointmentIds.length > 0 && [CONFIRMED, CANCELLED].includes(reminder.status)) {
      stats.inherited += addedAppointmentIds.length;
      await store.recordEvent('inherited', {
        reminderId: reminder.id,
        appointmentIds: addedAppointmentIds,
        verdict: reminder.reply?.verdict ?? null,
      });
    }

    if (!RETRYABLE.has(reminder.status)) {
      stats.alreadyHandled += 1;
      continue;
    }

    if (!slice) {
      if (isUnreachable(now, group.earliestStartsAt, slices)) {
        // Contado, e não deixado `pending` para sempre: uma decisão que ninguém
        // enxerga é indistinguível de um bug.
        await store.update(reminder.id, { status: UNREACHABLE }, now);
        await store.recordEvent('unreachable', {
          reminderId: reminder.id,
          localDate: group.localDate,
        });
        stats.unreachable += 1;
      } else {
        stats.tooEarly += 1;
      }
      continue;
    }

    stats.due += 1;

    // A configuração é lida aqui e nunca escrita na linha. Remover a allowlist
    // basta para este lembrete poder ser enviado no próximo scan.
    if (allowlist && !allowlist.includes(reminder.phone)) {
      await store.recordEvent('send_skipped_by_config', {
        reminderId: reminder.id,
        setting: 'allowlist',
      });
      stats.skippedByConfig += 1;
      continue;
    }
    if (dryRun) {
      await store.recordEvent('send_skipped_by_config', {
        reminderId: reminder.id,
        setting: 'dryRun',
      });
      stats.skippedByConfig += 1;
      continue;
    }

    try {
      const result = await messaging.sendTemplate({
        to: reminder.phone,
        templateId,
        variables: buildVariables(group),
      });
      await store.update(
        reminder.id,
        {
          status: SENT,
          sentAt: new Date(now).toISOString(),
          providerMessageId: result.providerMessageId ?? null,
          sliceName: slice.name,
        },
        now,
      );
      stats.sent += 1;
    } catch (error) {
      // Retentável de propósito: o próximo scan dentro da mesma fatia tenta de novo.
      await store.update(
        reminder.id,
        { status: SEND_FAILED, writeError: null, sendError: error.message },
        now,
      );
      stats.sendFailed += 1;
    }
  }

  await store.recordEvent('scan', stats);
  return stats;
}
