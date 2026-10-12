-- Equivalente relacional do store em memória de src/adapters/fake/store.js.
-- PostgreSQL. Nada neste repositório executa este arquivo; ele está aqui porque é no
-- formato das tabelas que várias das decisões de design de fato moram.

CREATE SCHEMA IF NOT EXISTS reminders;

-- Uma linha por lembrete: por aparelho, por data de agendamento. A constraint unique em
-- group_key é a garantia de idempotência — um segundo envio é impedido pelo banco, e
-- não pelo scanner lembrando o que já fez.
CREATE TABLE reminders.reminder (
  id                BIGSERIAL PRIMARY KEY,
  group_key         TEXT        NOT NULL UNIQUE,
  phone_e164        TEXT,                 -- forma canônica (moderna); NULL numa linha sem telefone
  local_date        DATE        NOT NULL, -- data do agendamento no fuso da clínica, não UTC
  appointment_ids   TEXT[]      NOT NULL,
  patient_ids       TEXT[]      NOT NULL,
  slots             TEXT[]      NOT NULL DEFAULT '{}',  -- HH:mm local, sem duplicatas
  shared            BOOLEAN     NOT NULL DEFAULT FALSE, -- mais de uma paciente neste aparelho
  earliest_starts_at TIMESTAMPTZ NOT NULL,

  -- Nenhum status aqui descreve configuração. Uma allowlist de piloto ou uma flag de
  -- dry-run é lida na hora do envio e registrada como evento, nunca como estado: um
  -- status que significa "a allowlist estava ligada quando passei por aqui" é um fato
  -- sobre o deploy, e guardá-lo como estado terminal fez o dado mentir. Ver modo de
  -- falha 3.
  status            TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','confirmed','cancelled',
                                        'send_failed','no_phone','unreachable')),
  slice_name        TEXT,
  sent_at           TIMESTAMPTZ,          -- repassado ao provedor; NÃO significa entregue
  provider_message_id TEXT,

  reply_verdict     TEXT CHECK (reply_verdict IN ('confirm','cancel')),
  reply_reason      TEXT,                 -- por que foi lida assim; nunca o texto
  replied_at        TIMESTAMPTZ,

  written_back      TEXT[]      NOT NULL DEFAULT '{}',  -- agendamentos gravados
  write_refused     TEXT[]      NOT NULL DEFAULT '{}',  -- recusados: permanente, por agendamento
  write_attempts    INTEGER     NOT NULL DEFAULT 0,
  write_error       TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A correlação da resposta é pelo número de telefone, porque a resposta do provedor
-- não traz referência à mensagem que responde. As duas grafias de um celular
-- brasileiro são tentadas, então este índice é consultado com qualquer uma delas.
CREATE INDEX reminder_phone_status_idx ON reminders.reminder (phone_e164, status);
CREATE INDEX reminder_local_date_idx   ON reminders.reminder (local_date);
-- A fila de write-back: respondidos, e com algum agendamento ainda não resolvido.
CREATE INDEX reminder_pending_write_idx ON reminders.reminder (replied_at)
  WHERE replied_at IS NOT NULL;

-- Memória de alertas. Um alerta cuja condição é uma consulta de estado dispara de novo
-- a cada passada até o estado mudar; a chave identifica o caso, não a condição.
-- O retry continua rodando — só a notificação é silenciada. Ver modo de falha 4.
CREATE TABLE reminders.alert_sent (
  alert_key   TEXT        PRIMARY KEY,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ids de eventos de entrada já tratados. Pega o replay legítimo de uma mesma entrega.
-- NÃO pega a entrega dupla do provedor, que chega com ids diferentes — essa é barrada
-- pela guarda de estado no receiver. Ver modo de falha 7.
CREATE TABLE reminders.provider_event (
  event_id    TEXT        PRIMARY KEY,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fatos operacionais. Identificadores, não pessoas: sem nomes, sem telefones, sem
-- corpo de mensagem. Um payload de um número sem lembrete aguardando resposta é
-- descartado antes de chegar a esta tabela. Ver docs/security-and-privacy.md.
CREATE TABLE reminders.event (
  id          BIGSERIAL   PRIMARY KEY,
  type        TEXT        NOT NULL,
  reminder_id BIGINT      REFERENCES reminders.reminder(id) ON DELETE SET NULL,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX event_type_created_idx ON reminders.event (type, created_at DESC);
