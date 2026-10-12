/**
 * O que conta como *um lembrete*.
 *
 * O sistema de agenda cria uma linha de agendamento por procedimento, então uma
 * paciente marcada para quatro procedimentos amanhã são quatro linhas. Mandar uma
 * mensagem por linha produzia quatro mensagens quase idênticas (modo de falha 1)
 * — e, pior, quebrava o caminho da resposta: o lado de saída era por
 * procedimento, enquanto o lado de entrada só podia ser correlacionado por número
 * de telefone. Duas granularidades diferentes nas duas pontas da mesma conversa
 * não se reconciliam lá na frente; a correção tem que acontecer na origem.
 *
 * A chave de agrupamento é `telefone canônico + data local do agendamento` — o
 * *canal*, não o cadastro da paciente (modo de falha 2). Quem responde é o
 * aparelho, não o cadastro: mãe agenda os filhos, casais e famílias dividem o
 * telefone. Agrupar por id de paciente deixa esses casos como várias mensagens
 * para um mesmo aparelho, que é justamente a ambiguidade que o agrupamento
 * deveria eliminar.
 *
 * Um grupo com mais de um id de paciente é marcado como `shared`. É essa flag
 * que permite ao caminho de cancelamento se recusar a agir pela família inteira
 * — ver `docs/decisions/0003-asymmetric-tolerance-confirm-vs-cancel.md`.
 */

import { canonical } from './phone.js';

/**
 * Formatadores de data e hora locais para um fuso IANA fixo.
 *
 * A data do agendamento tem que ser a data *na clínica*, não em UTC: um
 * agendamento às 08:00 num fuso UTC-4 é 12:00 UTC, e agrupar pela data UTC
 * empurraria um agendamento da noite para o dia seguinte.
 */
export function zonedFormatter(timeZone) {
  const dateFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  return {
    date: (instant) => dateFormat.format(new Date(instant)),
    time: (instant) => timeFormat.format(new Date(instant)),
  };
}

export function groupKey(phone, localDate) {
  return `${canonical(phone)}|${localDate}`;
}

/**
 * Colapsa agendamentos em grupos de lembrete.
 *
 * Agendamentos sem telefone resolvido voltam separados em vez de descartados,
 * porque "sem telefone" e "telefone ainda não consultado" são fatos diferentes, e
 * só quem chama sabe qual dos dois aconteceu (modo de falha 12).
 */
export function groupAppointments(appointments, { timeZone }) {
  const { date, time } = zonedFormatter(timeZone);
  const groups = new Map();
  const withoutPhone = [];

  for (const appointment of appointments) {
    if (!appointment.phone) {
      withoutPhone.push(appointment);
      continue;
    }
    const localDate = date(appointment.startsAt);
    const key = groupKey(appointment.phone, localDate);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        phone: canonical(appointment.phone),
        localDate,
        appointments: [],
      };
      groups.set(key, group);
    }
    group.appointments.push(appointment);
  }

  return { groups: [...groups.values()].map(finalize(time)), withoutPhone };
}

const finalize = (time) => (group) => {
  // Copia antes de ordenar: Array.prototype.toSorted exige Node 20 e isto roda no 18.
  const ordered = [...group.appointments].sort(
    (a, b) => new Date(a.startsAt) - new Date(b.startsAt),
  );
  const patientIds = [...new Set(ordered.map((appointment) => appointment.patientId))];
  return {
    key: group.key,
    phone: group.phone,
    localDate: group.localDate,
    appointmentIds: ordered.map((appointment) => appointment.id),
    patientIds,
    // Aparelho compartilhado significa que um cancelamento falaria por gente que
    // nunca respondeu.
    shared: patientIds.length > 1,
    // A mensagem é endereçada à primeira paciente do grupo. Num aparelho
    // compartilhado isso é impreciso por construção — a alternativa é uma
    // mensagem por paciente, que é a ambiguidade que este agrupamento existe para
    // eliminar.
    primaryName: ordered[0].patientName ?? null,
    // Horários, não agendamentos: duas pessoas no mesmo aparelho marcadas no
    // mesmo horário devem aparecer como um horário só na mensagem, não como uma
    // linha repetida.
    slots: [...new Set(ordered.map((appointment) => time(appointment.startsAt)))],
    // O grupo vence na fatia do seu *primeiro* agendamento, para que ninguém seja
    // lembrado mais tarde do que seria como linha individual.
    earliestStartsAt: ordered[0].startsAt,
  };
};
