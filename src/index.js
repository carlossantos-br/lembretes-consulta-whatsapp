/**
 * Montagem. Os adapters vêm de quem chama — a implementação de referência traz
 * fakes, um deploy fornece clientes para o seu próprio sistema de agenda e
 * provedor de mensagens, e nem o core nem o pipeline sabem a diferença.
 *
 * `now` é parâmetro de todo ponto de entrada, em vez de algo lido do relógio lá
 * dentro. É isso que transforma um dia inteiro de scans num teste síncrono.
 */

import { withDefaults } from './config.js';
import { assertAlerts } from './ports/alerts.js';
import { assertMessaging } from './ports/messaging.js';
import { assertSchedulingApi } from './ports/scheduling-api.js';
import { assertStore } from './ports/store.js';
import { scan } from './pipeline/scanner.js';
import { receiveWebhook } from './pipeline/receiver.js';
import { processWriteBacks } from './pipeline/writer.js';
import { watchdog } from './pipeline/watchdog.js';

export function createOrchestrator({ schedulingApi, messaging, store, alerts }, config = {}) {
  const ports = {
    schedulingApi: assertSchedulingApi(schedulingApi),
    messaging: assertMessaging(messaging),
    store: assertStore(store),
    alerts: assertAlerts(alerts),
  };
  const resolved = withDefaults(config);

  return {
    ports,
    config: resolved,
    scan: (now) => scan({ now, ports, config: resolved }),
    receiveWebhook: (payload, { now, headers } = {}) =>
      receiveWebhook({ payload, headers, now, ports, config: resolved }),
    processWriteBacks: (now) => processWriteBacks({ now, ports, config: resolved }),
    watchdog: (now) => watchdog({ now, ports, config: resolved }),
  };
}

export { DEFAULT_CONFIG, withDefaults } from './config.js';
export * as lifecycle from './core/lifecycle.js';
export * as window from './core/window.js';
export { groupAppointments, zonedFormatter } from './core/grouping.js';
export { interpretReply, CONFIRM, CANCEL, ESCALATE } from './core/interpret.js';
export { canonical, variants, sameSubscriber } from './core/phone.js';
