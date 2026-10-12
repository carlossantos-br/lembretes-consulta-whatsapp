import { DEFAULT_SLICES, HOUR_MS } from './core/window.js';

/**
 * Tudo o que o pipeline precisa saber e que não é um port.
 *
 * `allowlist` e `dryRun` são as duas configurações que antes vazavam para o
 * estado gravado. Elas moram aqui, são lidas na hora do envio e nunca são
 * escritas numa linha de lembrete — desligar qualquer uma delas basta para que os
 * lembretes pulados voltem para a fila no próximo scan (modo de falha 3).
 */
export const DEFAULT_CONFIG = {
  /** Fuso IANA da clínica. Agrupamento e relatórios são locais, não UTC. */
  timeZone: 'America/Sao_Paulo',
  slices: DEFAULT_SLICES,
  templateId: 'appointment-confirmation',

  /** Números de telefone autorizados a receber mensagens, ou `null` para todos. */
  allowlist: null,
  dryRun: false,
  /** Pausa entre consultas de telefone. A API real tolera ~40 requisições por minuto. */
  throttleMs: 0,

  /** Status gravados de volta no sistema de agenda. */
  confirmedStatus: 'confirmed',
  cancelledStatus: 'cancelled',

  webhookSecretHeader: 'x-reminder-secret',
  webhookSecret: null,

  /**
   * Respostas escaladas são gravadas como motivo, não como texto, a menos que o
   * deploy opte pelo contrário. A fila humana fica mais útil com o texto e mais
   * perigosa também; o padrão é o seguro.
   */
  storeEscalatedText: false,

  /** Quanto tempo uma resposta não gravada pode ficar parada antes de avisar quem opera. */
  writeBackOverdueMs: HOUR_MS,

  /** Repassado para `interpretReply`. */
  interpret: {},
};

export const withDefaults = (config = {}) => ({ ...DEFAULT_CONFIG, ...config });
