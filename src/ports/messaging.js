/**
 * O provedor de mensagens: templates de saída, e um webhook de entrada que não
 * faz parte deste port.
 *
 * Três propriedades do provedor real estão embutidas neste contrato, porque o
 * desenho só faz sentido na presença delas.
 *
 * **Aceito não é entregue.** O endpoint de envio responde `201` assim que coloca
 * a mensagem na fila. Não existe callback de entrega nem endpoint de status,
 * então "aceito" é o fato mais forte que este port consegue devolver (modo de
 * falha 9). Qualquer relatório que afirme entrega está afirmando algo que o
 * provedor nunca disse.
 *
 * **A resposta não tem vínculo com a mensagem.** Enviar pela API não abre uma
 * conversa, então a resposta da paciente chega como uma mensagem de entrada
 * totalmente nova, sem referência ao que foi enviado. O número de telefone é,
 * portanto, a *única* chave de correlação disponível, e é isso que torna a
 * ambiguidade estrutural, e não um bug a ser corrigido (modo de falha 10).
 *
 * **A entrada chega por fora.** As respostas são entregues por um webhook
 * configurado no painel do provedor, não por algo que este port expõe — o caminho
 * de volta é configuração, não código. `src/pipeline/receiver.js` é quem consome
 * esse webhook, e trata o payload como entrada não confiável.
 *
 * @typedef {object} SendResult
 * @property {boolean} accepted
 * @property {string} [providerMessageId]
 */

import { assertImplements } from './contract.js';

export const MESSAGING_METHODS = [
  /**
   * `({ to, templateId, variables }) => Promise<SendResult>`
   *
   * `variables` é um array posicional. O mapeamento de variáveis do próprio
   * painel vale para mensagens que um atendente envia à mão e não tem efeito
   * nenhum em envios pela API — uma distinção que custa uma tarde para descobrir.
   */
  'sendTemplate',
];

export const assertMessaging = (adapter) =>
  assertImplements('messaging', adapter, MESSAGING_METHODS);
