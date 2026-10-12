/**
 * Um dia simulado, de ponta a ponta, contra adapters em memória.
 *
 * Nada aqui fala com a rede. Todo instante é passado como parâmetro, então o dia
 * inteiro roda em milissegundos e sempre produz a mesma saída.
 *
 *   node examples/demo.mjs
 */

import { createOrchestrator } from '../src/index.js';
import { createFakeAlerts } from '../src/adapters/fake/alerts.js';
import { createFakeMessaging, inboundPayload } from '../src/adapters/fake/messaging.js';
import { createFakeSchedulingApi } from '../src/adapters/fake/scheduling-api.js';
import { createMemoryStore } from '../src/adapters/fake/store.js';

const TZ = 'America/Sao_Paulo';
const ANA = '5565990001111';
const FAMILY = '5565990003333';
const CARLA_LEGACY = '556590004444';
const CARLA_MODERN = '5565990004444';

// Um dia na clínica. Repare que quatro linhas abaixo são uma paciente com quatro
// procedimentos, e três linhas são três pessoas dividindo o mesmo telefone.
const appointments = [
  { id: 'a1', patientId: 'ana', patientName: 'Ana', startsAt: '2026-03-11T12:00:00.000Z' },
  { id: 'a2', patientId: 'ana', patientName: 'Ana', startsAt: '2026-03-11T13:00:00.000Z' },
  { id: 'a3', patientId: 'ana', patientName: 'Ana', startsAt: '2026-03-11T13:30:00.000Z' },
  { id: 'a4', patientId: 'ana', patientName: 'Ana', startsAt: '2026-03-11T14:30:00.000Z' },
  { id: 'b1', patientId: 'mae', patientName: 'Beatriz', startsAt: '2026-03-11T17:00:00.000Z' },
  { id: 'b2', patientId: 'filho-1', patientName: 'Bruno', startsAt: '2026-03-11T17:00:00.000Z' },
  { id: 'b3', patientId: 'filha-2', patientName: 'Bianca', startsAt: '2026-03-11T17:30:00.000Z' },
  { id: 'd1', patientId: 'diego', patientName: 'Diego', startsAt: '2026-03-11T12:00:00.000Z' },
];

const phones = {
  ana: ANA,
  mae: FAMILY,
  'filho-1': FAMILY,
  'filha-2': FAMILY,
  // Diego não tem telefone no cadastro. O lembrete não pode ser enviado, e esse
  // fato só é registrado depois que uma consulta de fato aconteceu.
};

const schedulingApi = createFakeSchedulingApi({ appointments, phones, timeZone: TZ });
const messaging = createFakeMessaging();
const store = createMemoryStore();
const alerts = createFakeAlerts();

const clinic = createOrchestrator(
  { schedulingApi, messaging, store, alerts },
  {
    timeZone: TZ,
    templateId: 'appointment-confirmation',
    webhookSecret: 'demo-secret',
    interpret: { automatedPatterns: [/agradece seu contato/] },
  },
);

const headers = { 'x-reminder-secret': 'demo-secret' };
const local = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  dateStyle: 'short',
  timeStyle: 'short',
  hour12: false,
});

const heading = (text) => console.log(`\n${'─'.repeat(72)}\n${text}\n${'─'.repeat(72)}`);
const step = (now, text) => console.log(`\n[${local.format(new Date(now))}] ${text}`);

const scan = async (now, note) => {
  step(now, `scan — ${note}`);
  const stats = await clinic.scan(now);
  console.log(
    `  ${stats.discovered} agendamento(s) descoberto(s) em ${stats.dates.join(', ')}` +
      `\n  ${stats.phoneLookups} consulta(s) de telefone → ${stats.groups} grupo(s)` +
      `\n  vencidos ${stats.due} · enviados ${stats.sent} · cedo demais ${stats.tooEarly}` +
      ` · sem telefone ${stats.noPhone} · inalcançáveis ${stats.unreachable}` +
      ` · já tratados ${stats.alreadyHandled} · herdados ${stats.inherited}`,
  );
  return stats;
};

const reply = async (now, { from, text, eventId, action, note }) => {
  step(now, `recebida "${text}" ${note ?? ''}`);
  const result = await clinic.receiveWebhook(
    inboundPayload({ from, text, eventId, action }),
    { now, headers },
  );
  console.log(`  → ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
  return result;
};

const writeBack = async (now) => {
  const stats = await clinic.processWriteBacks(now);
  if (stats.considered > 0) {
    console.log(
      `  gravação de volta: ${stats.written} gravado(s) · ${stats.refused} recusado(s) · ${stats.deferred} adiado(s)`,
    );
  }
  return stats;
};

heading('Um dia de lembretes para uma agenda de 8 agendamentos');
console.log(
  'Quatro dessas linhas são uma paciente com quatro procedimentos.\n' +
    'Três delas são três pessoas dividindo o mesmo telefone.\n' +
    'Um paciente não tem número de telefone no cadastro.',
);

// 24,5h antes do primeiro procedimento da Ana.
await scan('2026-03-10T11:30:00.000Z', 'a fatia principal alcança a Ana');
await reply('2026-03-10T12:00:00.000Z', {
  from: ANA,
  text: 'Confirmo',
  eventId: 'evt-1',
  note: '(botão exato)',
});
await writeBack('2026-03-10T12:00:05.000Z');

// O provedor entrega a mesma mensagem uma segunda vez, segundos depois, com outro
// id de evento e outra action.
await reply('2026-03-10T12:00:12.000Z', {
  from: ANA,
  text: 'Confirmo',
  eventId: 'evt-2',
  action: 'queue_wait',
  note: '(a segunda entrega da mesma mensagem pelo provedor)',
});

// A recepção marca um agendamento de última hora para amanhã de manhã. Ele tem 23h
// de antecedência, então a fatia de 24h já passou — é o caso que uma janela estrita
// única perde em silêncio.
step('2026-03-10T12:30:00.000Z', 'a recepção marca a Carla para amanhã às 08:00 (23h de antecedência)');
schedulingApi.addAppointment({
  id: 'c1',
  patientId: 'carla',
  patientName: 'Carla',
  startsAt: '2026-03-11T11:00:00.000Z',
});
schedulingApi.setPhone('carla', CARLA_MODERN);
console.log('  a fatia de 24h já passou para este agendamento');

// 24,5h antes dos agendamentos da família.
await scan('2026-03-10T16:30:00.000Z', 'a fatia principal alcança o aparelho compartilhado');
await reply('2026-03-10T17:00:00.000Z', {
  from: FAMILY,
  text: 'Não irei',
  eventId: 'evt-3',
  note: '(três pacientes neste aparelho)',
});

await scan('2026-03-10T22:30:00.000Z', 'a fatia de recuperação pega a Carla');
// A Carla responde do número no formato legado, sem o nono dígito.
await reply('2026-03-10T23:00:00.000Z', {
  from: CARLA_LEGACY,
  text: 'sim, pode confirmar',
  eventId: 'evt-4',
  note: '(linguagem natural, e do número no formato legado)',
});
await writeBack('2026-03-10T23:05:00.000Z');

step('2026-03-10T23:30:00.000Z', 'watchdog');
const health = await clinic.watchdog('2026-03-10T23:30:00.000Z');
console.log(
  `  ${health.ok ? 'ok' : 'achados: ' + health.findings.map((f) => f.kind).join(', ')}` +
    `\n  vencidos ${health.summary.due} · enviados ${health.summary.sent} · sem telefone ${health.summary.noPhone}` +
    ` · travados ${health.summary.stuck}`,
);

heading('Lembretes');
for (const reminder of store.all()) {
  const who = reminder.shared ? `${reminder.patientIds.length} pacientes` : reminder.patientIds[0];
  console.log(
    `  ${reminder.id.padEnd(6)} ${String(reminder.phone ?? '—').padEnd(14)} ` +
      `${reminder.status.padEnd(11)} ${String(reminder.slots.join(',') || '—').padEnd(24)} ` +
      `${who} · gravados ${reminder.writtenBack.length}/${reminder.appointmentIds.length}`,
  );
}

heading('O que a clínica vê na agenda');
const written = schedulingApi.writtenStatuses();
for (const item of appointments.concat([{ id: 'c1', patientName: 'Carla' }])) {
  console.log(`  ${item.id.padEnd(4)} ${String(item.patientName).padEnd(10)} ${written[item.id] ?? '—'}`);
}

heading('Mensagens realmente enviadas');
console.log(`  ${messaging.sentCount()} mensagem(ns) para 9 agendamentos\n`);
for (const message of messaging.sentMessages()) {
  console.log(`  → ${message.to}  ${JSON.stringify(message.variables)}`);
}

heading('O que foi dito a um humano');
for (const message of alerts.all()) console.log(`  ! ${message}`);
if (alerts.count() === 0) console.log('  (nada)');

heading('Filas de trabalho deixadas para uma pessoa');
for (const type of ['reply_escalated', 'cancel_refused_shared', 'reply_ambiguous']) {
  const events = await store.listEvents(type);
  if (events.length > 0) console.log(`  ${type}: ${JSON.stringify(events)}`);
}

heading('Quanto este dia custou, sem rodeios');
console.log(
  `  ${messaging.sentCount()} mensagens cobriram 9 agendamentos — enviar por agendamento\n` +
    '  teria dado 9, e teria deixado toda resposta ambígua.\n' +
    '\n' +
    '  Três desfechos NÃO foram automatizados, de propósito:\n' +
    '   · o cancelamento da família foi recusado, porque uma resposta não pode falar\n' +
    '     por três pessoas no mesmo aparelho;\n' +
    '   · a Carla escreveu "sim, pode confirmar" e a agenda ficou em branco, porque\n' +
    '     só o texto exato do botão age. Do lado dela, ela confirmou. Essa é a\n' +
    '     política em produção e esse é o custo dela — ver docs/decisions/0007.\n' +
    '   · o Diego não tem número de telefone, então não existe lembrete para enviar.\n' +
    '\n' +
    '  Cada um é uma fila com uma pessoa no fim, e cada um é contado.\n' +
    '  Pular em silêncio é o que transforma uma decisão num bug.',
);
console.log();
