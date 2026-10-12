/**
 * O caminho de volta: um endpoint público, tratado como entrada hostil.
 *
 * O provedor não tem webhook de resposta na API — o caminho de volta é um webhook
 * configurado no painel, com URL e headers customizados, mas sem contrato de
 * payload publicado. Esse fato sozinho molda tudo aqui:
 *
 * **O payload é chave de busca, nunca verdade.** Os identificadores de
 * agendamento no sistema de origem são sequenciais, e este endpoint é alcançável
 * por qualquer um que descubra a URL. Se o handler confiasse num id vindo do
 * corpo, percorrer a sequência cancelaria agendamentos reais. Então o corpo
 * contribui com exatamente uma coisa — um número de telefone para buscar — e só
 * lembretes que o próprio serviço enviou, aguardando resposta, podem ser afetados
 * (modo de falha 13).
 *
 * **Um segredo compartilhado num header é a outra metade dessa defesa.** Nenhuma
 * das metades basta sozinha: só o segredo ainda deixa um vazamento virar escrita
 * arbitrária, e só a busca ainda deixa um estranho responder por uma paciente
 * cujo número ele conhece.
 *
 * **Toda mensagem chega duas vezes.** O provedor entrega a mesma mensagem como
 * dois eventos com ids diferentes, com segundos de diferença. Vence o primeiro a
 * ser reivindicado (modo de falha 7).
 *
 * **Números sem nada pendente não deixam rastro.** Com o filtro do painel aberto,
 * todo o tráfego de WhatsApp da clínica chega a este endpoint. Payloads de números
 * sem lembrete aguardando resposta são descartados *antes* de qualquer gravação,
 * então conversas que não têm nada a ver com isto nunca são armazenadas.
 */

import { timingSafeEqual } from 'node:crypto';

import { CANCEL, CONFIRM, ESCALATE, interpretReply } from '../core/interpret.js';
import { CANCELLED, CONFIRMED, SENT } from '../core/lifecycle.js';
import { variants } from '../core/phone.js';
import { alertOnce } from './alert-once.js';

/** Comparação em tempo constante que não vaza o tamanho do segredo. */
function secretMatches(expected, provided) {
  const left = Buffer.from(String(expected));
  const right = Buffer.from(String(provided ?? ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const ANSWERABLE = [SENT, CONFIRMED, CANCELLED];

export async function receiveWebhook({ payload, headers = {}, now, ports, config }) {
  const { store } = ports;
  const { webhookSecret, webhookSecretHeader, storeEscalatedText, allowUnauthenticatedWebhook } = config;

  // Falha fechada: sem segredo configurado o endpoint recusa tudo. Esquecer a
  // variável de ambiente no deploy não pode virar um webhook aberto.
  if (!webhookSecret && !allowUnauthenticatedWebhook) {
    await store.recordEvent('webhook_secret_missing', {});
    return { status: 'unauthorized' };
  }
  if (webhookSecret && !secretMatches(webhookSecret, headers[webhookSecretHeader])) {
    await store.recordEvent('webhook_unauthorized', {});
    return { status: 'unauthorized' };
  }

  const from = payload?.contact?.phone;
  const text = payload?.content?.message;
  const eventId = payload?.content?.id;

  if (!(await store.claimProviderEvent(eventId))) {
    await store.recordEvent('webhook_duplicate', { eventId });
    return { status: 'duplicate' };
  }

  const awaiting = await store.findBySubscriber(variants(from), ANSWERABLE);
  if (awaiting.length === 0) {
    // Nem número de telefone, nem texto de mensagem: esta é a conversa de outra pessoa.
    await store.recordEvent('webhook_discarded', {});
    return { status: 'discarded' };
  }

  if (awaiting.length > 1) {
    // Dois lembretes no mesmo aparelho significam que a resposta não pode ser
    // atribuída. Chutar aqui é exatamente o que a mudança da chave de agrupamento
    // quis evitar; quando ainda acontece, quem decide é um humano.
    const ids = [...awaiting.map((reminder) => reminder.id)].sort();
    await store.recordEvent('reply_ambiguous', { reminderIds: ids });
    await alertOnce(
      ports,
      `ambiguous:${ids.join(',')}`,
      `Resposta de um aparelho com ${ids.length} lembretes aguardando resposta (${ids.join(', ')}). Precisa de um humano.`,
    );
    return { status: 'ambiguous', reminderIds: ids };
  }

  const [reminder] = awaiting;
  const { verdict, reason } = interpretReply(text, config.interpret);

  if (verdict === ESCALATE) {
    await store.recordEvent('reply_escalated', {
      reminderId: reminder.id,
      reason,
      ...(storeEscalatedText ? { text } : {}),
    });
    await alertOnce(
      ports,
      `escalated:${eventId ?? reminder.id}`,
      `Resposta em ${reminder.id} não foi um botão exato (${reason}). Precisa de um humano.`,
    );
    return { status: 'escalated', reminderId: reminder.id, reason };
  }

  if (verdict === CANCEL && reminder.shared) {
    // Cancelar aqui seria falar por gente que nunca respondeu. A assimetria é
    // deliberada: uma confirmação errada custa um no-show, um cancelamento errado
    // manda alguém para um horário que não existe mais.
    await store.recordEvent('cancel_refused_shared', {
      reminderId: reminder.id,
      patientCount: reminder.patientIds.length,
    });
    await alertOnce(
      ports,
      `shared_cancel:${reminder.id}`,
      `Cancelamento em ${reminder.id} cobre ${reminder.patientIds.length} pacientes no mesmo aparelho. Não aplicado. Precisa de um humano.`,
    );
    return { status: 'escalated', reminderId: reminder.id, reason: 'shared_handset' };
  }

  const status = verdict === CONFIRM ? CONFIRMED : CANCELLED;
  if (reminder.status === status) {
    await store.recordEvent('reply_repeated', { reminderId: reminder.id, verdict });
    return { status: 'unchanged', reminderId: reminder.id, verdict };
  }

  const updated = await store.update(
    reminder.id,
    {
      status,
      reply: { verdict, reason, at: new Date(now).toISOString() },
      // Uma paciente que confirma e depois cancela precisa do status *novo* gravado
      // em todos os agendamentos, inclusive os que já foram gravados com o antigo.
      writtenBack: [],
      writeRefused: [],
    },
    now,
  );
  await store.recordEvent('reply_applied', {
    reminderId: reminder.id,
    verdict,
    appointmentIds: updated.appointmentIds,
  });

  return { status: 'applied', reminderId: reminder.id, verdict, reminder: updated };
}
