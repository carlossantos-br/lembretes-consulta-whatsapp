import test from 'node:test';
import assert from 'node:assert/strict';

import { groupAppointments, groupKey, zonedFormatter } from '../src/core/grouping.js';

const TZ = 'America/Sao_Paulo'; // UTC-3, sem horário de verão desde 2019
const PHONE = '5565990001111';

const appointment = (overrides) => ({
  id: 'a1',
  patientId: 'p1',
  phone: PHONE,
  startsAt: '2026-03-11T13:00:00.000Z',
  ...overrides,
});

test('quatro procedimentos no mesmo aparelho no mesmo dia viram um lembrete só', () => {
  const { groups } = groupAppointments(
    [
      appointment({ id: 'a1', startsAt: '2026-03-11T13:30:00.000Z' }),
      appointment({ id: 'a2', startsAt: '2026-03-11T12:00:00.000Z' }),
      appointment({ id: 'a3', startsAt: '2026-03-11T14:30:00.000Z' }),
      appointment({ id: 'a4', startsAt: '2026-03-11T13:00:00.000Z' }),
    ],
    { timeZone: TZ },
  );

  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.deepEqual(group.appointmentIds, ['a2', 'a4', 'a1', 'a3'], 'ordenados pelo horário de início');
  assert.deepEqual(group.slots, ['09:00', '10:00', '10:30', '11:30']);
  assert.equal(group.earliestStartsAt, '2026-03-11T12:00:00.000Z');
  assert.equal(group.shared, false);
});

test('pessoas diferentes no mesmo aparelho formam um grupo, marcado como compartilhado', () => {
  const { groups } = groupAppointments(
    [
      appointment({ id: 'a1', patientId: 'mother' }),
      appointment({ id: 'a2', patientId: 'child-1' }),
      appointment({ id: 'a3', patientId: 'child-2' }),
    ],
    { timeZone: TZ },
  );

  assert.equal(groups.length, 1, 'agrupar por id de paciente teria produzido três');
  assert.equal(groups[0].shared, true);
  assert.deepEqual(groups[0].patientIds, ['mother', 'child-1', 'child-2']);
  assert.deepEqual(groups[0].slots, ['10:00'], 'um horário, não o mesmo horário três vezes');
});

test('o mesmo aparelho em dois dias são dois lembretes', () => {
  const { groups } = groupAppointments(
    [
      appointment({ id: 'a1', startsAt: '2026-03-11T13:00:00.000Z' }),
      appointment({ id: 'a2', startsAt: '2026-03-12T13:00:00.000Z' }),
    ],
    { timeZone: TZ },
  );
  assert.equal(groups.length, 2);
});

test('os dois formatos armazenados do mesmo número caem no mesmo grupo', () => {
  const { groups } = groupAppointments(
    [
      appointment({ id: 'a1', phone: '5565990001111' }),
      appointment({ id: 'a2', phone: '556590001111' }),
    ],
    { timeZone: TZ },
  );
  assert.equal(groups.length, 1);
});

test('agendamentos sem telefone são devolvidos, não descartados', () => {
  const { groups, withoutPhone } = groupAppointments(
    [appointment({ id: 'a1' }), appointment({ id: 'a2', phone: null })],
    { timeZone: TZ },
  );
  assert.equal(groups.length, 1);
  assert.deepEqual(
    withoutPhone.map((a) => a.id),
    ['a2'],
  );
});

test('a data de agrupamento é a local da clínica, não UTC', () => {
  const { date } = zonedFormatter(TZ);
  // 02:00 UTC ainda é a noite anterior num fuso UTC-3.
  assert.equal(date('2026-03-12T02:00:00.000Z'), '2026-03-11');
  assert.equal(groupKey(PHONE, '2026-03-11'), `${PHONE}|2026-03-11`);
});
