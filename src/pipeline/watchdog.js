/**
 * O dead man's switch.
 *
 * A primeira versão deste watchdog perguntava se o scanner tinha rodado e se algum
 * lembrete estava atrasado. Respondeu "ok" num dia em que o serviço não mandou
 * absolutamente nada para uma agenda cheia, porque o processo *tinha* rodado e as
 * linhas que ele pulou não entravam na consulta de atrasados (modo de falha 5).
 *
 * Um monitor que verifica execução reporta sobre si mesmo. Este verifica efeito, e
 * a pergunta que ele existe para fazer é a segunda abaixo: **havia lembretes para
 * hoje e nenhum saiu?**
 *
 * Ele também é construído de propósito sobre *dados*, e não sobre um ping de
 * uptime. Um health check HTTP responde "o processo está escutando", que é a coisa
 * menos interessante que pode ser verdade sobre um serviço cujo trabalho é mandar
 * mensagens.
 */

import { zonedFormatter } from '../core/grouping.js';
import { NO_PHONE, RETRYABLE, SEND_FAILED } from '../core/lifecycle.js';
import { isUnreachable } from '../core/window.js';
import { alertOnce } from './alert-once.js';
import { candidateDates } from './scanner.js';

export async function watchdog({ now, ports, config }) {
  const { store } = ports;
  const { timeZone, slices } = config;
  const { date } = zonedFormatter(timeZone);
  const today = date(now);

  const findings = [];
  const record = async (kind, key, message) => {
    findings.push({ kind, message });
    await alertOnce(ports, key, message);
  };

  const scans = (await store.listEvents('scan')).filter((event) => event.localDate === today);

  // 1. O scanner rodou? Liveness — necessário, não suficiente.
  if (scans.length === 0) {
    await record('no_scan', `no_scan:${today}`, `Nenhum scan rodou em ${today}.`);
  }

  // 2. A pergunta que a primeira versão não fazia.
  const due = scans.reduce((total, event) => total + (event.due ?? 0), 0);
  const sent = scans.reduce((total, event) => total + (event.sent ?? 0), 0);
  if (due > 0 && sent === 0) {
    await record(
      'silent_day',
      `silent_day:${today}`,
      `${due} lembrete(s) venciam em ${today} e nenhum foi enviado.`,
    );
  }

  // Os lembretes em andamento são os das datas de agendamento que uma fatia ainda
  // alcança — *não* os com data de hoje. Lembretes têm como chave a data do
  // agendamento, e o scan que os cria roda no dia anterior; um watchdog que olhasse
  // a data de hoje inspecionaria um conjunto vazio e diria que estava tudo bem.
  const inFlight = (
    await Promise.all(
      candidateDates(now, slices, timeZone).map((localDate) => store.listByDate(localDate)),
    )
  ).flat();

  // 3. Envios que falharam e estão ficando sem janela.
  const stuck = inFlight.filter(
    (reminder) =>
      RETRYABLE.has(reminder.status) &&
      reminder.status !== NO_PHONE &&
      isUnreachable(now, reminder.earliestStartsAt, slices),
  );
  if (stuck.length > 0) {
    await record(
      'stuck',
      `stuck:${today}:${stuck.length}`,
      `${stuck.length} lembrete(s) de ${today} nunca serão enviados (${stuck
        .map((reminder) => reminder.id)
        .join(', ')}).`,
    );
  }

  // 4. Falhas que o scanner registrou, mas que mais nada olha.
  const failed = inFlight.filter((reminder) => reminder.status === SEND_FAILED);
  if (failed.length > 0) {
    await record(
      'send_failed',
      `send_failed:${today}:${failed.length}`,
      `${failed.length} envio(s) falharam em ${today} e aguardam nova tentativa.`,
    );
  }

  // 5. Ninguém recebe lembrete sem número de telefone, e só uma pessoa consegue corrigir isso.
  const noPhone = inFlight.filter((reminder) => reminder.status === NO_PHONE);
  if (noPhone.length > 0) {
    await record(
      'no_phone',
      `no_phone:${today}:${noPhone.length}`,
      `${noPhone.length} agendamento(s) em andamento sem número de telefone no cadastro.`,
    );
  }

  const summary = {
    localDate: today,
    scans: scans.length,
    due,
    sent,
    stuck: stuck.length,
    sendFailed: failed.length,
    noPhone: noPhone.length,
    findings: findings.map((finding) => finding.kind),
  };
  await store.recordEvent('watchdog', summary);
  return { ok: findings.length === 0, findings, summary };
}
