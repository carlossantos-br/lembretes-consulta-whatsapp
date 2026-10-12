/**
 * Store em memória. Completo o bastante para rodar o pipeline inteiro e a suíte
 * de testes inteira; o schema relacional equivalente está em `docs/schema.sql`.
 *
 * O store é o único que escreve campos do lembrete, e é por isso que a máquina de
 * estados é imposta aqui, e não em cada ponto de chamada: uma transição ilegal
 * lança exceção em vez de deixar, calada, uma linha num estado que o pipeline não
 * consegue interpretar.
 */

import { PENDING, NO_PHONE, assertTransition } from '../../core/lifecycle.js';

const clone = (value) => (value === undefined ? value : structuredClone(value));

/** União que mantém a ordem do scan atual e preserva os ids que ele não vê mais. */
const union = (fresh, stored) => [...fresh, ...stored.filter((item) => !fresh.includes(item))];

export function createMemoryStore() {
  const reminders = new Map();
  const idsByGroupKey = new Map();
  const alerted = new Set();
  const providerEvents = new Set();
  const events = [];
  let sequence = 0;

  const nextId = (prefix) => `${prefix}-${++sequence}`;

  const blank = (now) => ({
    status: PENDING,
    sentAt: null,
    providerMessageId: null,
    sliceName: null,
    reply: null,
    writtenBack: [],
    // Uma recusa é definitiva só para *aquele* agendamento, então as recusas são
    // controladas por id, e não como uma flag única sobre o grupo inteiro.
    writeRefused: [],
    writeAttempts: 0,
    writeError: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  });

  async function upsertGroup(group, { now, sliceName = null }) {
    const existingId = idsByGroupKey.get(group.key);
    if (existingId) {
      const stored = reminders.get(existingId);
      const added = group.appointmentIds.filter((id) => !stored.appointmentIds.includes(id));
      stored.appointmentIds = union(group.appointmentIds, stored.appointmentIds);
      stored.patientIds = union(group.patientIds, stored.patientIds);
      stored.slots = group.slots;
      stored.shared = stored.patientIds.length > 1;
      stored.earliestStartsAt = group.earliestStartsAt;
      stored.updatedAt = new Date(now).toISOString();
      return { reminder: clone(stored), created: false, addedAppointmentIds: added };
    }

    const reminder = {
      id: nextId('rem'),
      groupKey: group.key,
      phone: group.phone,
      localDate: group.localDate,
      appointmentIds: [...group.appointmentIds],
      patientIds: [...group.patientIds],
      slots: [...group.slots],
      shared: group.shared,
      earliestStartsAt: group.earliestStartsAt,
      ...blank(now),
      sliceName,
    };
    reminders.set(reminder.id, reminder);
    idsByGroupKey.set(reminder.groupKey, reminder.id);
    return { reminder: clone(reminder), created: true, addedAppointmentIds: [] };
  }

  /**
   * Placeholder de um agendamento cuja paciente não tem telefone no cadastro.
   *
   * Criado só pela fase de resolução de telefone, nunca pela descoberta — a ideia
   * toda é que esta linha afirma "olhamos e não havia nada", que é uma afirmação
   * diferente do null que a listagem devolve (modo de falha 12).
   */
  async function createNoPhoneRow(appointment, { localDate, now }) {
    const key = `no-phone:${appointment.id}|${localDate}`;
    const existingId = idsByGroupKey.get(key);
    if (existingId) return clone(reminders.get(existingId));

    const reminder = {
      id: nextId('rem'),
      groupKey: key,
      phone: null,
      localDate,
      appointmentIds: [appointment.id],
      patientIds: [appointment.patientId],
      slots: [],
      shared: false,
      earliestStartsAt: appointment.startsAt,
      ...blank(now),
      status: NO_PHONE,
    };
    reminders.set(reminder.id, reminder);
    idsByGroupKey.set(key, reminder.id);
    return clone(reminder);
  }

  async function dropNoPhoneRows(appointmentIds) {
    let dropped = 0;
    for (const [id, reminder] of reminders) {
      if (reminder.status !== NO_PHONE) continue;
      if (!reminder.appointmentIds.some((each) => appointmentIds.includes(each))) continue;
      reminders.delete(id);
      idsByGroupKey.delete(reminder.groupKey);
      dropped += 1;
    }
    return dropped;
  }

  async function update(id, patch, now) {
    const stored = reminders.get(id);
    if (!stored) throw new Error(`lembrete desconhecido: ${id}`);
    if (patch.status && patch.status !== stored.status) {
      assertTransition(stored.status, patch.status);
    }
    Object.assign(stored, patch);
    stored.updatedAt = new Date(now ?? stored.updatedAt).toISOString();
    return clone(stored);
  }

  return {
    upsertGroup,
    createNoPhoneRow,
    dropNoPhoneRows,
    update,

    async getById(id) {
      return clone(reminders.get(id)) ?? null;
    },
    async getByGroupKey(key) {
      const id = idsByGroupKey.get(key);
      return id ? clone(reminders.get(id)) : null;
    },
    async findBySubscriber(phoneVariants, statuses) {
      const wanted = new Set(phoneVariants);
      return [...reminders.values()]
        .filter((reminder) => reminder.phone && wanted.has(reminder.phone))
        .filter((reminder) => statuses.includes(reminder.status))
        .map(clone);
    },
    async listByDate(localDate) {
      return [...reminders.values()]
        .filter((reminder) => reminder.localDate === localDate)
        .map(clone);
    },
    async pendingWriteBacks() {
      return [...reminders.values()]
        .filter((reminder) => reminder.reply)
        .filter(
          (reminder) =>
            reminder.writtenBack.length + reminder.writeRefused.length <
            reminder.appointmentIds.length,
        )
        .map(clone);
    },

    async hasAlerted(key) {
      return alerted.has(key);
    },
    async markAlerted(key) {
      alerted.add(key);
    },
    async claimProviderEvent(eventId) {
      if (!eventId) return true;
      if (providerEvents.has(eventId)) return false;
      providerEvents.add(eventId);
      return true;
    },

    async recordEvent(type, data = {}) {
      events.push({ type, ...data });
    },
    async listEvents(type) {
      return events.filter((event) => !type || event.type === type).map(clone);
    },

    /** Conveniência para teste e demo, não faz parte do port. */
    all() {
      return [...reminders.values()].map(clone);
    },
  };
}
