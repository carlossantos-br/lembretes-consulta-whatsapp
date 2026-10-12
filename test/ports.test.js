import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrchestrator } from '../src/index.js';
import { ALERTS_METHODS } from '../src/ports/alerts.js';
import { MESSAGING_METHODS } from '../src/ports/messaging.js';
import { SCHEDULING_API_METHODS } from '../src/ports/scheduling-api.js';
import { STORE_METHODS } from '../src/ports/store.js';
import { harness } from './helpers.js';

test('os fakes incluídos satisfazem todos os ports', () => {
  const { ports } = harness();
  const expected = {
    schedulingApi: SCHEDULING_API_METHODS,
    messaging: MESSAGING_METHODS,
    store: STORE_METHODS,
    alerts: ALERTS_METHODS,
  };
  for (const [name, methods] of Object.entries(expected)) {
    for (const method of methods) {
      assert.equal(typeof ports[name][method], 'function', `${name}.${method}`);
    }
  }
});

test('um adapter incompleto falha na montagem, não no meio do scan', () => {
  const { ports } = harness();
  const crippled = { ...ports.store };
  delete crippled.upsertGroup;

  assert.throws(
    () => createOrchestrator({ ...ports, store: crippled }),
    /store: método\(s\) ausente\(s\) upsertGroup/,
  );
});

test('os padrões de config são aplicados e podem ser sobrescritos', () => {
  const { ports } = harness();
  const orchestrator = createOrchestrator(ports, { templateId: 'custom' });
  assert.equal(orchestrator.config.templateId, 'custom');
  assert.equal(orchestrator.config.dryRun, false);
  assert.ok(orchestrator.config.slices.length >= 1);
});
