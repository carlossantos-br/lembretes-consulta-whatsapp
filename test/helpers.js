import { createOrchestrator } from '../src/index.js';
import { createFakeAlerts } from '../src/adapters/fake/alerts.js';
import { createFakeMessaging } from '../src/adapters/fake/messaging.js';
import { createFakeSchedulingApi } from '../src/adapters/fake/scheduling-api.js';
import { createMemoryStore } from '../src/adapters/fake/store.js';

export const TZ = 'America/Sao_Paulo';

/** Amanhã às 09:00 locais (UTC-3). */
export const APPOINTMENT = '2026-03-11T12:00:00.000Z';
/** Antecedência de 24,5h — dentro da fatia principal. */
export const SCAN_IN_PRIMARY = '2026-03-10T11:30:00.000Z';

export const MODERN_PHONE = '5565990001111';
export const LEGACY_PHONE = '556590001111';
export const OTHER_PHONE = '5565990002222';

export function appointment(overrides = {}) {
  return {
    id: 'a1',
    patientId: 'p1',
    patientName: 'Paciente Um',
    startsAt: APPOINTMENT,
    ...overrides,
  };
}

/**
 * Liga o pipeline a adapters em memória e devolve tanto o orquestrador quanto os
 * adapters, para que o teste possa inspecionar o que o mundo lá fora viu.
 */
export function harness({
  appointments = [appointment()],
  phones = { p1: MODERN_PHONE },
  config = {},
  refuse = [],
  networkFailures = [],
  messagingFailures = [],
} = {}) {
  const schedulingApi = createFakeSchedulingApi({
    appointments,
    phones,
    timeZone: TZ,
    refuse,
    networkFailures,
  });
  const messaging = createFakeMessaging({ networkFailuresFor: messagingFailures });
  const store = createMemoryStore();
  const alerts = createFakeAlerts();
  const ports = { schedulingApi, messaging, store, alerts };

  return {
    ports,
    schedulingApi,
    messaging,
    store,
    alerts,
    // Os testes que não tratam de autenticação dispensam o segredo; o 13 e o de
    // falha fechada configuram o seu.
    orchestrator: createOrchestrator(ports, { timeZone: TZ, allowUnauthenticatedWebhook: true, ...config }),
    /** Um redeploy com outras configurações e os mesmos dados. */
    redeploy: (overrides) =>
      createOrchestrator(ports, { timeZone: TZ, allowUnauthenticatedWebhook: true, ...config, ...overrides }),
  };
}

export const hoursAfter = (instant, hours) =>
  new Date(new Date(instant).getTime() + hours * 3_600_000).toISOString();
