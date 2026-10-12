# 0006 — O payload do webhook é chave de busca, nunca verdade

**Status:** aceita · **Relevante para segurança**

## Contexto

A API do provedor de mensagens não tem webhook de resposta. O caminho de volta é um
webhook configurado no painel do provedor, então **um caminho precisa ser acessível
publicamente** — não dá para manter o serviço inteiramente privado.

Esse caminho consegue gravar nos agendamentos das pacientes. Os identificadores de
agendamento no sistema de agenda são **sequenciais**, visíveis nos próprios exemplos
da documentação da API.

## Ameaça

Qualquer um que descubra a URL percorre o espaço de identificadores em ordem
crescente e cancela consultas reais. Sem credencial, sem técnica sofisticada — um
loop.

## Decisão

Duas defesas, aplicadas juntas.

**1. Um segredo compartilhado num header customizado.** A etapa de integração do
provedor aceita headers customizados. A comparação é em tempo constante, com
verificação de tamanho antes, para que a comparação não vaze o tamanho do segredo.

**2. O payload contribui com exatamente uma coisa: um número de telefone para
buscar.** Todo identificador no corpo é ignorado. Só podem ser afetados lembretes que
*este próprio serviço enviou* e que ainda aguardam resposta. O corpo é uma chave para
um estado que o serviço já possui, nunca uma afirmação sobre o mundo.

## Por que as duas

Nenhuma basta sozinha:

- Segredo vazado mais um handler que confia no payload significa gravação arbitrária
  em qualquer agendamento.
- Só a busca, sem segredo, ainda deixa qualquer um que saiba o telefone de uma
  paciente responder em nome dela.

Juntas, o atacante precisa do segredo *e* do número de uma paciente específica, e
mesmo assim só afeta o lembrete pendente daquela paciente. Esse risco residual está
declarado em `docs/security-and-privacy.md`, em vez de ser descrito como resolvido.

## Generalização

A regra sobrevive à integração específica: **entrada vinda de canal não confiável
pode selecionar, nunca afirmar.** Tratar um identificador do payload como autoritativo
é o mesmo erro que confiar num id de usuário enviado pelo cliente — só chega vestido
de integração em vez de campo de formulário.
