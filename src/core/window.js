/**
 * Tempo do lembrete: fatias estritas de antecedência.
 *
 * Uma fatia é o intervalo semiaberto `(lower, lower + width]` medido em
 * *antecedência* — quanto falta de agora até o início do agendamento. O limite
 * inferior é exclusivo e o superior é inclusivo, então fatias consecutivas cobrem
 * a linha do tempo sem sobreposição, e um lembrete nunca pode ser enviado duas
 * vezes pela mesma fatia em dois scans seguidos.
 *
 * Por que fatias em vez de "enviar assim que a antecedência cair abaixo de N"?
 * Porque o scanner roda em horário fixo (de hora em hora). Com uma fatia de uma
 * hora de largura e um scan por hora, cada agendamento é examinado exatamente uma
 * vez por fatia. Com um piso em vez de uma fatia, um agendamento abaixo do piso
 * fica elegível em *todo* scan, e a idempotência vira a única coisa entre a
 * paciente e uma mensagem repetida.
 *
 * O custo das fatias estritas é o buraco documentado como modo de falha 6: um
 * agendamento marcado *depois* que a sua fatia passou nunca é pego por aquela
 * fatia. A fatia de recuperação existe para diminuir esse buraco, não para
 * fechá-lo — ver `docs/decisions/0004-strict-window-plus-second-slice.md`.
 */

export const HOUR_MS = 3_600_000;

/** Fatia principal em 24h, fatia de recuperação em 12h, ambas com uma hora de largura. */
export const DEFAULT_SLICES = [
  { name: 'primary', lowerHours: 24, widthHours: 1 },
  { name: 'recovery', lowerHours: 12, widthHours: 1 },
];

/** Milissegundos de `now` até `startsAt`. Negativo depois que o agendamento passou. */
export function leadTime(now, startsAt) {
  return new Date(startsAt).getTime() - new Date(now).getTime();
}

/** Verdadeiro quando `leadMs` cai em `(lowerHours, lowerHours + widthHours]`. */
export function inSlice(leadMs, slice) {
  const lower = slice.lowerHours * HOUR_MS;
  const upper = (slice.lowerHours + slice.widthHours) * HOUR_MS;
  return leadMs > lower && leadMs <= upper;
}

/** A fatia em que este agendamento vence agora, ou `null` se nenhuma. */
export function dueSlice(now, startsAt, slices = DEFAULT_SLICES) {
  const lead = leadTime(now, startsAt);
  return slices.find((slice) => inSlice(lead, slice)) ?? null;
}

/**
 * Verdadeiro quando nenhum scan futuro consegue mais enviar este lembrete: a
 * antecedência já caiu abaixo da fatia mais baixa.
 *
 * Este é o lado contábil do modo de falha 6. Um lembrete inalcançável é uma
 * decisão ("não mandamos mensagem tão em cima"), e uma decisão que não é contada
 * é indistinguível de um bug — por isso o pipeline a registra como um estado
 * terminal explícito, em vez de deixar a linha `pending` para sempre.
 */
export function isUnreachable(now, startsAt, slices = DEFAULT_SLICES) {
  const floors = slices.map((slice) => slice.lowerHours * HOUR_MS);
  return leadTime(now, startsAt) <= Math.min(...floors);
}

/**
 * A antecedência *ainda não* está dentro de nenhuma fatia — o agendamento só está
 * longe demais. Distinguir isto de `isUnreachable` é o que impede que "espere"
 * seja reportado como "pulamos".
 */
export function isTooEarly(now, startsAt, slices = DEFAULT_SLICES) {
  const ceilings = slices.map((slice) => (slice.lowerHours + slice.widthHours) * HOUR_MS);
  return leadTime(now, startsAt) > Math.max(...ceilings);
}
