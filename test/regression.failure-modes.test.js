/**
 * Um teste por entrada de `docs/failure-modes.md`.
 *
 * Cada um destes aconteceu de verdade em produção. A numeração bate com a do
 * documento, então um achado e o teste que o fixa estão a uma busca de distância.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { inboundPayload } from '../src/adapters/fake/messaging.js';
import { CANCELLED, CONFIRMED, NO_PHONE, PENDING, SENT } from '../src/core/lifecycle.js';
import { DEFAULT_SLICES } from '../src/core/window.js';
import {
  APPOINTMENT,
  LEGACY_PHONE,
  MODERN_PHONE,
  OTHER_PHONE,
  SCAN_IN_PRIMARY,
  appointment,
  harness,
  hoursAfter,
} from './helpers.js';

// ---------------------------------------------------------------------------
// 1. A granularidade do envio era o procedimento; a da correlação, o aparelho.
// ---------------------------------------------------------------------------
test('1: quatro procedimentos num aparelho geram uma mensagem, não quatro', async () => {
  const { orchestrator, messaging } = harness({
    appointments: [
      appointment({ id: 'a1', startsAt: '2026-03-11T12:00:00.000Z' }),
      appointment({ id: 'a2', startsAt: '2026-03-11T13:00:00.000Z' }),
      appointment({ id: 'a3', startsAt: '2026-03-11T13:30:00.000Z' }),
      appointment({ id: 'a4', startsAt: '2026-03-11T14:30:00.000Z' }),
    ],
  });

  const stats = await orchestrator.scan(SCAN_IN_PRIMARY);

  assert.equal(stats.sent, 1);
  assert.equal(messaging.sentCount(), 1);
  const [message] = messaging.sentMessages();
  // Todos os horários do dia vão na terceira variável, então cobrir quatro
  // procedimentos com uma mensagem não exigiu template novo.
  assert.equal(message.variables[2], '09:00, 10:00, 10:30, 11:30');
});

// ---------------------------------------------------------------------------
// 2. A chave de agrupamento é o canal, não o cadastro da paciente.
// ---------------------------------------------------------------------------
test('2: três pacientes dividindo um aparelho recebem uma mensagem', async () => {
  const { orchestrator, messaging, store } = harness({
    appointments: [
      appointment({ id: 'a1', patientId: 'mother', patientName: 'Mãe' }),
      appointment({ id: 'a2', patientId: 'child-1' }),
      appointment({ id: 'a3', patientId: 'child-2' }),
    ],
    phones: { mother: MODERN_PHONE, 'child-1': MODERN_PHONE, 'child-2': MODERN_PHONE },
  });

  await orchestrator.scan(SCAN_IN_PRIMARY);

  assert.equal(messaging.sentCount(), 1, 'agrupar por id de paciente teria mandado três');
  const [reminder] = store.all();
  assert.equal(reminder.shared, true);
  assert.equal(reminder.patientIds.length, 3);
});

// ---------------------------------------------------------------------------
// 3. Configuração transitória virou estado terminal.
// ---------------------------------------------------------------------------
test('3: remover a allowlist traz de volta os lembretes pulados', async () => {
  const { orchestrator, redeploy, store, messaging } = harness({
    config: { allowlist: [OTHER_PHONE] },
  });

  const blocked = await orchestrator.scan(SCAN_IN_PRIMARY);
  assert.equal(blocked.sent, 0);
  assert.equal(blocked.skippedByConfig, 1);
  assert.equal(store.all()[0].status, PENDING, 'a linha não pode registrar uma configuração do deploy');

  // Mesmos dados, mesma fatia, sem allowlist.
  const open = await redeploy({ allowlist: null }).scan(SCAN_IN_PRIMARY);
  assert.equal(open.sent, 1);
  assert.equal(messaging.sentCount(), 1);
  assert.equal(store.all()[0].status, SENT);
});

// ---------------------------------------------------------------------------
// 4. Um alerta nascido de uma consulta de estado dispara até o estado mudar.
// ---------------------------------------------------------------------------
test('4: uma condição que sobrevive ao alerta é anunciada uma vez, mas segue sendo retentada', async () => {
  const { orchestrator, alerts, store } = harness({ networkFailures: ['a1'] });

  await orchestrator.scan(SCAN_IN_PRIMARY);
  await orchestrator.receiveWebhook(inboundPayload({ from: MODERN_PHONE, text: 'Confirmo', eventId: 'e1' }), {
    now: SCAN_IN_PRIMARY,
  });

  const late = hoursAfter(SCAN_IN_PRIMARY, 2);
  const first = await orchestrator.processWriteBacks(late);
  const second = await orchestrator.processWriteBacks(hoursAfter(late, 1));

  assert.equal(first.overdueAlerts, 1);
  assert.equal(second.overdueAlerts, 0, 'a segunda passada não pode alertar de novo');
  assert.equal(alerts.matching(/não gravada/).length, 1);
  // O trabalho nunca parou, só o barulho: duas passadas, duas tentativas, um alerta.
  assert.equal(store.all()[0].writeAttempts, 2);
});

// ---------------------------------------------------------------------------
// 5. O watchdog verificava execução em vez de efeito.
// ---------------------------------------------------------------------------
test('5: o watchdog pega um dia que rodou e não mandou nada', async () => {
  const { orchestrator, store } = harness({ config: { allowlist: [OTHER_PHONE] } });

  await orchestrator.scan(SCAN_IN_PRIMARY);
  const result = await orchestrator.watchdog(SCAN_IN_PRIMARY);

  const scans = await store.listEvents('scan');
  assert.equal(scans.length, 1, 'uma checagem só de liveness teria dito que estava tudo bem');
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.findings.map((finding) => finding.kind),
    ['silent_day'],
  );
  assert.equal(result.summary.due, 1);
  assert.equal(result.summary.sent, 0);
});

// ---------------------------------------------------------------------------
// 6. Uma janela estrita sem segunda chance perde agendamentos de última hora.
// ---------------------------------------------------------------------------
test('6: a fatia de recuperação alcança um agendamento feito depois que a fatia principal passou', async () => {
  const bookedAt = '2026-03-10T12:00:00.000Z'; // 23h antes da consulta
  const tomorrowMorning = '2026-03-11T11:00:00.000Z';
  const appointments = [appointment({ id: 'a1', startsAt: tomorrowMorning })];

  const withoutRecovery = harness({
    appointments,
    config: { slices: [DEFAULT_SLICES[0]] },
  });
  const missed = await withoutRecovery.orchestrator.scan(bookedAt);
  assert.equal(missed.sent, 0);
  assert.equal(missed.unreachable, 1, 'e é contado, não fica pendente em silêncio');

  const withRecovery = harness({ appointments });
  const early = await withRecovery.orchestrator.scan(bookedAt);
  assert.equal(early.sent, 0);
  assert.equal(early.tooEarly, 1, 'não é inalcançável: a fatia de recuperação ainda está por vir');

  const later = await withRecovery.orchestrator.scan('2026-03-10T22:30:00.000Z'); // lead 12.5h
  assert.equal(later.sent, 1);
  assert.equal(withRecovery.store.all()[0].sliceName, 'recovery');
});

// ---------------------------------------------------------------------------
// 7. O provedor entrega toda mensagem recebida duas vezes.
// ---------------------------------------------------------------------------
test('7: uma mensagem entregue duas vezes é aplicada uma vez', async () => {
  const { orchestrator, store } = harness();
  await orchestrator.scan(SCAN_IN_PRIMARY);

  // O provedor real manda a mesma resposta como dois eventos, com segundos de
  // diferença, ids diferentes e actions diferentes.
  const first = await orchestrator.receiveWebhook(
    inboundPayload({ from: MODERN_PHONE, text: 'Confirmo', eventId: 'e1', action: 'all' }),
    { now: SCAN_IN_PRIMARY },
  );
  const second = await orchestrator.receiveWebhook(
    inboundPayload({ from: MODERN_PHONE, text: 'Confirmo', eventId: 'e2', action: 'queue_wait' }),
    { now: SCAN_IN_PRIMARY },
  );

  assert.equal(first.status, 'applied');
  assert.equal(second.status, 'unchanged', 'quem pega esta é a guarda de estado, não o id do evento');
  assert.equal((await store.listEvents('reply_applied')).length, 1);

  // Um retry legítimo do mesmo evento é barrado uma camada antes.
  const replay = await orchestrator.receiveWebhook(
    inboundPayload({ from: MODERN_PHONE, text: 'Confirmo', eventId: 'e1' }),
    { now: SCAN_IN_PRIMARY },
  );
  assert.equal(replay.status, 'duplicate');
});

// ---------------------------------------------------------------------------
// 8. HTTP 200 com a falha no corpo.
// ---------------------------------------------------------------------------
test('8: uma recusa é lida do corpo e nunca retentada', async () => {
  const { orchestrator, schedulingApi, store } = harness({ refuse: ['a1'] });
  await orchestrator.scan(SCAN_IN_PRIMARY);
  await orchestrator.receiveWebhook(inboundPayload({ from: MODERN_PHONE, text: 'Confirmo', eventId: 'e1' }), {
    now: SCAN_IN_PRIMARY,
  });

  const first = await orchestrator.processWriteBacks(SCAN_IN_PRIMARY);
  assert.equal(first.refused, 1);
  assert.equal(first.written, 0);
  assert.equal(schedulingApi.statusOf('a1'), null, 'nada foi gravado de fato');

  const second = await orchestrator.processWriteBacks(hoursAfter(SCAN_IN_PRIMARY, 1));
  assert.equal(second.considered, 0, 'uma recusa permanente sai da fila');
  assert.deepEqual(store.all()[0].writeRefused, ['a1']);
});

// ---------------------------------------------------------------------------
// 9. Aceito não é entregue.
// ---------------------------------------------------------------------------
test('9: o pipeline nunca afirma entrega, porque o provedor nunca a informa', async () => {
  const { orchestrator, messaging, store } = harness();
  await orchestrator.scan(SCAN_IN_PRIMARY);

  const [reminder] = store.all();
  assert.equal(reminder.status, SENT);
  assert.ok(reminder.sentAt, 'sabemos quando entregamos ao provedor');
  assert.equal('deliveredAt' in reminder, false, 'e nada além disso');
  assert.equal(typeof messaging.markDelivered, 'undefined');
});

// ---------------------------------------------------------------------------
// 10. A resposta não traz referência à mensagem que responde.
// ---------------------------------------------------------------------------
test('10: com dois lembretes num aparelho, a resposta é estruturalmente ambígua', async () => {
  const { orchestrator, store, alerts } = harness({
    appointments: [
      appointment({ id: 'a1', startsAt: '2026-03-11T12:00:00.000Z' }),
      appointment({ id: 'a2', patientId: 'p2', startsAt: '2026-03-12T12:00:00.000Z' }),
    ],
    phones: { p1: MODERN_PHONE, p2: MODERN_PHONE },
  });

  // Dois dias diferentes, logo dois lembretes — ambos aguardando resposta do mesmo aparelho.
  await orchestrator.scan(SCAN_IN_PRIMARY);
  await orchestrator.scan('2026-03-11T11:30:00.000Z');
  assert.equal(store.all().filter((reminder) => reminder.status === SENT).length, 2);

  const result = await orchestrator.receiveWebhook(
    inboundPayload({ from: MODERN_PHONE, text: 'Confirmo', eventId: 'e1' }),
    { now: '2026-03-11T11:35:00.000Z' },
  );

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reminderIds.length, 2);
  assert.equal(alerts.matching(/Precisa de um humano/).length, 1);
  assert.equal(store.all().some((reminder) => reminder.status === CONFIRMED), false);
});

// ---------------------------------------------------------------------------
// 11. O provedor informa um telefone que o sistema de origem não guarda.
// ---------------------------------------------------------------------------
test('11: uma resposta no formato antigo do número ainda encontra seu lembrete', async () => {
  const { orchestrator, store } = harness();
  await orchestrator.scan(SCAN_IN_PRIMARY);
  assert.equal(store.all()[0].phone, MODERN_PHONE);

  const result = await orchestrator.receiveWebhook(
    inboundPayload({ from: LEGACY_PHONE, text: 'Confirmo', eventId: 'e1' }),
    { now: SCAN_IN_PRIMARY },
  );

  assert.equal(result.status, 'applied', 'sem casar variantes, nada jamais casaria');
  assert.equal(store.all()[0].status, CONFIRMED);
});

// ---------------------------------------------------------------------------
// 12. Telefone nulo significava "ainda não consultado" e foi lido como "não tem".
// ---------------------------------------------------------------------------
test('12: "sem telefone" só é registrado depois que uma consulta rodou de fato', async () => {
  const { orchestrator, schedulingApi, store } = harness({ phones: {} });

  await orchestrator.scan(SCAN_IN_PRIMARY);
  assert.ok(schedulingApi.phoneLookupCount() >= 1, 'a afirmação exige ter consultado');
  assert.equal(store.all()[0].status, NO_PHONE);

  // A recepção preenche o número; o placeholder fica obsoleto.
  schedulingApi.setPhone('p1', MODERN_PHONE);
  const second = await orchestrator.scan(SCAN_IN_PRIMARY);

  assert.equal(second.sent, 1);
  assert.equal(store.all().length, 1, 'o placeholder foi descartado, não ficou para contar em dobro');
  assert.equal(store.all()[0].status, SENT);
});

// ---------------------------------------------------------------------------
// 13. Endpoint público mais ids sequenciais é um ataque de enumeração.
// ---------------------------------------------------------------------------
test('13: o payload é chave de busca e nunca fonte de verdade', async () => {
  const { orchestrator, store, schedulingApi } = harness({
    appointments: [
      appointment({ id: 'a1' }),
      appointment({ id: 'a2', patientId: 'p2', patientName: 'Outra Pessoa' }),
    ],
    phones: { p1: MODERN_PHONE, p2: OTHER_PHONE },
    config: { webhookSecret: 'shared-secret' },
  });
  await orchestrator.scan(SCAN_IN_PRIMARY);

  // Um corpo forjado citando o agendamento de outra pessoa, com o segredo correto.
  const forged = {
    ...inboundPayload({ from: MODERN_PHONE, text: 'Não irei', eventId: 'e1' }),
    appointmentId: 'a2',
    codConsulta: 'a2',
  };
  const result = await orchestrator.receiveWebhook(forged, {
    now: SCAN_IN_PRIMARY,
    headers: { 'x-reminder-secret': 'shared-secret' },
  });
  await orchestrator.processWriteBacks(SCAN_IN_PRIMARY);

  assert.equal(result.status, 'applied');
  assert.equal(schedulingApi.statusOf('a1'), 'cancelled', 'só este aparelho foi afetado');
  assert.equal(schedulingApi.statusOf('a2'), null, 'o id do corpo foi ignorado');

  // E sem o segredo nada sequer é consultado.
  const unauthorized = await orchestrator.receiveWebhook(
    inboundPayload({ from: OTHER_PHONE, text: 'Não irei', eventId: 'e2' }),
    { now: SCAN_IN_PRIMARY, headers: { 'x-reminder-secret': 'wrong' } },
  );
  assert.equal(unauthorized.status, 'unauthorized');
  assert.equal(store.all().find((reminder) => reminder.phone === OTHER_PHONE).status, SENT);
});

// ---------------------------------------------------------------------------
// 14. Respostas automáticas de marketing na própria linha da paciente.
// ---------------------------------------------------------------------------
test('14: uma resposta automática é separada das respostas que um humano deve ler', async () => {
  const { orchestrator, store } = harness({
    config: { interpret: { automatedPatterns: [/agradece seu contato/] } },
  });
  await orchestrator.scan(SCAN_IN_PRIMARY);

  const result = await orchestrator.receiveWebhook(
    inboundPayload({
      from: MODERN_PHONE,
      text: 'A agencia agradece seu contato, responderemos em breve',
      eventId: 'e1',
    }),
    { now: SCAN_IN_PRIMARY },
  );

  assert.equal(result.status, 'escalated');
  assert.equal(result.reason, 'automated');
  const [escalated] = await store.listEvents('reply_escalated');
  assert.equal(escalated.reason, 'automated');
  assert.equal('text' in escalated, false, 'o texto da resposta não é guardado por padrão');
  assert.equal(store.all()[0].status, SENT, 'e o lembrete continua aguardando uma resposta de verdade');
});

// ---------------------------------------------------------------------------
// Guarda da assimetria que amarra vários destes casos.
// ---------------------------------------------------------------------------
test('um cancelamento é recusado em aparelho compartilhado, uma confirmação não', async () => {
  const shared = {
    appointments: [
      appointment({ id: 'a1', patientId: 'mother', patientName: 'Mãe' }),
      appointment({ id: 'a2', patientId: 'child-1' }),
    ],
    phones: { mother: MODERN_PHONE, 'child-1': MODERN_PHONE },
  };

  const cancelling = harness(shared);
  await cancelling.orchestrator.scan(SCAN_IN_PRIMARY);
  const refused = await cancelling.orchestrator.receiveWebhook(
    inboundPayload({ from: MODERN_PHONE, text: 'Não irei', eventId: 'e1' }),
    { now: SCAN_IN_PRIMARY },
  );
  assert.equal(refused.status, 'escalated');
  assert.equal(refused.reason, 'shared_handset');
  assert.equal(cancelling.store.all()[0].status, SENT, 'ninguém foi tirado da agenda');

  const confirming = harness(shared);
  await confirming.orchestrator.scan(SCAN_IN_PRIMARY);
  const applied = await confirming.orchestrator.receiveWebhook(
    inboundPayload({ from: MODERN_PHONE, text: 'Confirmo', eventId: 'e1' }),
    { now: SCAN_IN_PRIMARY },
  );
  assert.equal(applied.status, 'applied');
  assert.equal(confirming.store.all()[0].status, CONFIRMED);
});

test('um agendamento feito depois que o grupo respondeu herda a resposta', async () => {
  const { orchestrator, schedulingApi, store } = harness();
  await orchestrator.scan(SCAN_IN_PRIMARY);
  await orchestrator.receiveWebhook(inboundPayload({ from: MODERN_PHONE, text: 'Confirmo', eventId: 'e1' }), {
    now: SCAN_IN_PRIMARY,
  });
  await orchestrator.processWriteBacks(SCAN_IN_PRIMARY);
  assert.equal(schedulingApi.statusOf('a1'), 'confirmed');

  // A recepção acrescenta um segundo procedimento no mesmo dia, mesmo aparelho.
  schedulingApi.addAppointment(appointment({ id: 'a2', startsAt: '2026-03-11T14:00:00.000Z' }));
  const stats = await orchestrator.scan(hoursAfter(SCAN_IN_PRIMARY, 0.5));
  await orchestrator.processWriteBacks(hoursAfter(SCAN_IN_PRIMARY, 0.5));

  assert.equal(stats.inherited, 1);
  assert.equal(stats.sent, 0, 'nenhuma segunda mensagem para um aparelho que já respondeu');
  assert.equal(schedulingApi.statusOf('a2'), 'confirmed');
  assert.deepEqual(store.all()[0].appointmentIds, ['a1', 'a2']);
});

test('uma paciente que confirma e depois cancela termina cancelada em tudo', async () => {
  const { orchestrator, schedulingApi } = harness({
    appointments: [
      appointment({ id: 'a1', startsAt: '2026-03-11T12:00:00.000Z' }),
      appointment({ id: 'a2', startsAt: '2026-03-11T14:00:00.000Z' }),
    ],
  });
  await orchestrator.scan(SCAN_IN_PRIMARY);
  await orchestrator.receiveWebhook(inboundPayload({ from: MODERN_PHONE, text: 'Confirmo', eventId: 'e1' }), {
    now: SCAN_IN_PRIMARY,
  });
  await orchestrator.processWriteBacks(SCAN_IN_PRIMARY);
  assert.equal(schedulingApi.statusOf('a2'), 'confirmed');

  const later = hoursAfter(SCAN_IN_PRIMARY, 1);
  await orchestrator.receiveWebhook(inboundPayload({ from: MODERN_PHONE, text: 'Não irei', eventId: 'e2' }), {
    now: later,
  });
  await orchestrator.processWriteBacks(later);

  assert.equal(schedulingApi.statusOf('a1'), 'cancelled');
  assert.equal(schedulingApi.statusOf('a2'), 'cancelled', 'a gravação anterior é refeita');
});

test('uma falha de rede no envio é retentada pelo próximo scan na mesma fatia', async () => {
  const { orchestrator, messaging, store } = harness({ messagingFailures: [MODERN_PHONE] });

  const failed = await orchestrator.scan(SCAN_IN_PRIMARY);
  assert.equal(failed.sendFailed, 1);
  assert.equal(store.all()[0].status, 'send_failed');

  messaging.stopFailing(MODERN_PHONE);
  const recovered = await orchestrator.scan(hoursAfter(SCAN_IN_PRIMARY, 0.25));
  assert.equal(recovered.sent, 1, 'falha não é desfecho');
  assert.equal(store.all()[0].status, SENT);
});

test('uma conversa sem relação não deixa rastro', async () => {
  const { orchestrator, store } = harness();
  await orchestrator.scan(SCAN_IN_PRIMARY);

  const result = await orchestrator.receiveWebhook(
    inboundPayload({ from: '5511988887777', text: 'Bom dia, qual o valor da consulta?', eventId: 'e9' }),
    { now: SCAN_IN_PRIMARY },
  );

  assert.equal(result.status, 'discarded');
  const [discarded] = await store.listEvents('webhook_discarded');
  assert.deepEqual(Object.keys(discarded), ['type'], 'nem telefone, nem texto da mensagem');
});
