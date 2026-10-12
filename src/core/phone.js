/**
 * Identidade de telefone entre dois sistemas que discordam sobre o mesmo
 * assinante.
 *
 * Os celulares brasileiros ganharam um nono dígito há anos. Sistemas de agenda
 * em geral guardam a forma moderna (`55 65 9 9000 0000`), enquanto o WhatsApp
 * ainda reporta alguns números antigos na forma legada (`55 65 9000 0000`).
 * O webhook de resposta, portanto, traz um número que *não* é byte a byte igual
 * àquele para o qual o lembrete foi enviado.
 *
 * Este é o modo de falha 11: quando a única chave de correlação entre a mensagem
 * enviada e a resposta recebida é o número de telefone, normalizar esse número
 * não é detalhe — é a correlação inteira. Sem casar as variantes, nenhuma
 * resposta casa com lembrete algum e a funcionalidade simplesmente não faz nada,
 * em silêncio.
 *
 * Telefones fixos ficam de fora da regra de variantes de propósito: inserir um
 * nono dígito num fixo inventa um número que pertence a outra pessoa. No plano
 * legado, números de celular começam em 6 e os fixos vão até 5.
 */

const BR_COUNTRY = '55';
const BR_AREA_LENGTH = 2;
const LEGACY_MOBILE_FIRST_DIGIT = 6;

/** Remove a formatação e adiciona o código do país padrão quando ele falta. */
export function normalize(raw, { defaultCountry = BR_COUNTRY } = {}) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  // 10 dígitos = DDD + fixo, 11 = DDD + celular moderno. Nenhum dos dois traz código do país.
  if (digits.length === 10 || digits.length === 11) return `${defaultCountry}${digits}`;
  return digits;
}

function splitBrazilian(e164) {
  if (!e164.startsWith(BR_COUNTRY)) return null;
  const national = e164.slice(BR_COUNTRY.length);
  if (national.length !== 10 && national.length !== 11) return null;
  return {
    area: national.slice(0, BR_AREA_LENGTH),
    subscriber: national.slice(BR_AREA_LENGTH),
  };
}

function isMobileSubscriber(subscriber) {
  if (subscriber.length === 9) return subscriber.startsWith('9');
  if (subscriber.length === 8) return Number(subscriber[0]) >= LEGACY_MOBILE_FIRST_DIGIT;
  return false;
}

/**
 * Todas as formas em que o mesmo assinante pode aparecer, a canônica primeiro.
 *
 * A canônica é a forma de nove dígitos (moderna), porque é o que a fonte da
 * verdade dos agendamentos guarda — acompanhar o *sistema de registro* mantém as
 * linhas de lembrete legíveis ao lado dos dados de agenda de onde vieram.
 */
export function variants(raw) {
  const e164 = normalize(raw);
  if (!e164) return [];
  const parts = splitBrazilian(e164);
  if (!parts || !isMobileSubscriber(parts.subscriber)) return [e164];

  const { area, subscriber } = parts;
  const modern = subscriber.length === 9 ? subscriber : `9${subscriber}`;
  const legacy = subscriber.length === 9 ? subscriber.slice(1) : subscriber;
  return [`${BR_COUNTRY}${area}${modern}`, `${BR_COUNTRY}${area}${legacy}`];
}

/** A forma usada como chave de agrupamento e como valor armazenado. */
export function canonical(raw) {
  return variants(raw)[0] ?? '';
}

/** Verdadeiro quando dois números formatados de jeitos diferentes são o mesmo assinante. */
export function sameSubscriber(a, b) {
  const left = variants(a);
  const right = new Set(variants(b));
  return left.some((form) => right.has(form));
}
