/**
 * Provedor de mensagens em memória.
 *
 * `sendTemplate` responde "aceito" e nada mais forte, porque é só isso que o
 * provedor real oferece. Não existe helper `markDelivered`, de propósito: um fake
 * capaz de reportar entrega deixaria um teste afirmar algo que o adapter de
 * produção nunca tem como saber.
 *
 * `inboundPayload` monta o formato que o webhook do painel do provedor realmente
 * envia, para que o receiver seja testado contra o envelope real:
 *
 *   { contact: { id, name, phone, channel }, content: { id, type, action, message } }
 *
 * Repare no telefone em `contact.phone` e no texto em `content.message` — e no
 * fato de o payload não dizer absolutamente nada sobre qual lembrete está
 * respondendo.
 */

export function createFakeMessaging({ networkFailuresFor = [] } = {}) {
  const sent = [];
  const failing = new Set(networkFailuresFor);
  let sequence = 0;

  return {
    async sendTemplate({ to, templateId, variables }) {
      if (failing.has(to)) {
        throw Object.assign(new Error('gateway timeout'), { code: 'ETIMEDOUT' });
      }
      const providerMessageId = `msg-${++sequence}`;
      sent.push({ to, templateId, variables, providerMessageId });
      return { accepted: true, providerMessageId };
    },

    /** Controles e inspeção, não fazem parte do port. */
    sentMessages: () => sent.map((message) => ({ ...message })),
    sentCount: () => sent.length,
    sentTo: (phone) => sent.filter((message) => message.to === phone).length,
    stopFailing: (phone) => failing.delete(phone),
  };
}

/**
 * O provedor envia toda mensagem de entrada duas vezes — uma como `all` e outra
 * como `queue_wait`, com segundos de diferença e `content.id` diferentes. As duas
 * são entregas reais da mesma mensagem, e é por isso que o receiver reivindica o
 * `eventId` para garantir idempotência (modo de falha 7).
 */
export function inboundPayload({
  from,
  text,
  eventId,
  action = 'all',
  name = 'Paciente',
  channel = 'whatsapp',
}) {
  return {
    contact: { id: `contact-${from}`, name, phone: from, channel },
    content: { id: eventId, type: 'text', action, message: text },
  };
}
