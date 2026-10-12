/**
 * Por onde um humano fica sabendo que algo precisa de atenção.
 *
 * Um método só, de propósito. A implementação de produção é um bot de chat,
 * escolhido no lugar do provedor de mensagens usado com as pacientes porque
 * alertas operacionais não devem depender do mesmo canal — nem da mesma cobrança
 * por mensagem, nem da mesma fila de aprovação de template — que a coisa que eles
 * monitoram.
 *
 * Alertas vão para quem opera o serviço, nunca para a recepção. A equipe vê os
 * resultados na agenda; só quem opera pode agir sobre "a gravação de volta está
 * falhando há uma hora".
 */

import { assertImplements } from './contract.js';

export const ALERTS_METHODS = [
  /** `(message: string) => Promise<void>` */
  'notify',
];

export const assertAlerts = (adapter) => assertImplements('alerts', adapter, ALERTS_METHODS);
