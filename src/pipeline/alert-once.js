/**
 * Alerta um humano no máximo uma vez por caso.
 *
 * O modo de falha 4 numa função só. Um alerta cujo gatilho é uma consulta de
 * estado dispara de novo a cada passada enquanto o estado persiste — um grupo
 * recancelado virou doze mensagens idênticas durante a madrugada, e uma queda de
 * rede longa transformou "a gravação de volta está atrasada" em seis mensagens
 * por hora. A condição sobrevive ao alerta, então quem precisa de memória é o
 * *alerta*.
 *
 * A retentativa em si não é tocada: só a notificação fica quieta. Silenciar o
 * trabalho e silenciar o ruído são decisões diferentes, e isto só toma a segunda.
 *
 * `key` precisa identificar o caso, não a condição — `write_overdue:rem-42`, e
 * não `write_overdue`.
 */
export async function alertOnce({ store, alerts }, key, message) {
  if (await store.hasAlerted(key)) return false;
  await alerts.notify(message);
  await store.markAlerted(key);
  await store.recordEvent('alert', { key });
  return true;
}
