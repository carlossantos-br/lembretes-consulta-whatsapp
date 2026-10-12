# Notas de integração

Comportamento reproduzível das duas APIs contra as quais este desenho foi
construído, escrito como fatos e contornos. Registrado porque cada item custou tempo
real para descobrir e nenhum deles está na documentação.

Escopo: **Belle** (agenda da clínica) e **RD Station Conversas** (canal oficial de
WhatsApp, servido pela plataforma Tallos). Observado em meados de 2026; APIs mudam.

---

## RD Station Conversas

### Um template aprovado pela Meta ainda não está disponível pela API

Este é o central, e custa uma tarde na primeira vez e outra tarde na segunda.

Um template aprovado **não** aparece em `GET /v2/template/all` até ter sido
transformado numa *mensagem* dentro da integração. É essa mensagem — não o
template — que é dona do ObjectId que o `template_message_id` exige.

O caminho no painel:

1. Tela de templates → o card no topo, *"selecione para qual integração deseja
   sincronizar as mensagens aprovadas"*.
2. Escolha a integração de WhatsApp.
3. **Clique no card do template aprovado** — isso abre o fluxo de criar mensagem.
4. Defina a categoria e mapeie `{{1}} {{2}} {{3}}` para quaisquer variáveis que o
   seletor oferecer.
5. Salve. O identificador é criado e a listagem da API cresce.

**Sintoma quando o passo falta:** o painel diz "Aprovado" e a API continua
devolvendo a contagem antiga indefinidamente. Assim que o registro existe, ele
aparece na API **em segundos** — não há atraso de sincronização; se não apareceu, o
formulário não foi salvo.

### O mapeamento de variáveis do painel não afeta envios pela API

Esse mapeamento vale quando um atendente humano envia o template à mão pelo chat.
Pela API, os três valores viajam separados, no array `variables`, e são eles que
preenchem `{{1}}/{{2}}/{{3}}`. Ao criar a mensagem, dá para escolher qualquer
variável só para o formulário aceitar salvar.

### Só o ObjectId identifica uma mensagem

O endpoint de envio declara `format: hash` e não existe envio por nome. O campo
*Descrição* do template não é o identificador, por mais que pareça.

### Identificadores podem ser datados, mas não deduzidos

Os identificadores são ObjectIds do Mongo: os quatro primeiros bytes são o epoch de
criação, e o sufixo do título repete o mesmo epoch. Útil para ordenar e datar
registros numa API que não expõe campo de data — mas os oito bytes restantes são
aleatórios, então o identificador de um template novo não pode ser adivinhado.

### A listagem de templates é tudo ou nada

Nove rotas foram sondadas; só `/v2/template/all` e sua gêmea `megasac-api`
respondem, e são a mesma rota com o mesmo resultado. O schema não tem campo de
status, a rota não recebe parâmetros e não pagina.

### A listagem do próprio painel é outra API, atrás da sessão da equipe

O frontend chama uma rota interna `brokers-templates`, que devolve o registro
completo que a SPA mantém em memória. O token público gerado nas configurações da
API funciona em `/v2/template/all`, mas recebe `401` ali. São dois tokens
diferentes; não os confunda, e não espere que o público alcance rotas internas.

### A API não tem webhooks; o painel tem

O documento OpenAPI oficial completo tem **zero ocorrências de "webhook"**. Todo
webhook documentado do RD Station pertence ao Marketing ou ao CRM, não ao
Conversas — inclusive o artigo da central de ajuda sobre integração por webhook
customizado, que é um artigo de Marketing.

O **painel**, por outro lado, tem webhooks: um campo de URL, headers customizados e
um filtro de eventos (*Todos / Automação / Fila / Em atendimento*). É uma
funcionalidade da plataforma **sem contrato de payload publicado**. Consequência: o
caminho de volta é configuração, não código. Isso tira trabalho do repositório e o
leva para um runbook.

Formato de payload observado para um evento de automação:

```json
{
  "contact": { "id": "…", "name": "…", "phone": "…", "channel": "…" },
  "content": { "id": "…", "type": "text", "action": "all", "message": "…" }
}
```

Telefone em `contact.phone`, texto em `content.message`, e nada que identifique a
qual mensagem enviada aquilo responde.

### Toda mensagem recebida é entregue duas vezes

Com o filtro em *Todos*, cada resposta chega como `action: "all"` e de novo como
`action: "queue_wait"`, de um a vinte segundos de diferença, com valores de
`content.id` diferentes. As duas são entregas reais da mesma mensagem. Ver
[modo de falha 7](failure-modes.md#7-o-provedor-entrega-toda-mensagem-recebida-duas-vezes).

### Com o filtro aberto, todo o tráfego chega ao endpoint

Toda mensagem de WhatsApp que a clínica recebe passa pelo webhook — centenas por
dia, com picos acima de cem por hora. Vale testar restringir o filtro a *Automação*
justamente por isso.

### A resposta não tem vínculo com a mensagem que responde

Da documentação: um envio pela API não cria conversa, e a resposta "iniciará uma
nova conversa, sem vínculo com a mensagem original". O telefone é, portanto, a única
chave de correlação disponível.

### `201` não significa entregue

Falhas de template e de entrega aparecem só na plataforma. Não há callback nem
endpoint de status.

### Dois botões de resposta rápida é o teto

É por isso que *Confirmo* e *Não irei* são todo o vocabulário, e por isso que
remarcar é uma mensagem digitada e, portanto, trabalho de um humano.

---

## Belle

### A listagem de agendamentos não traz telefone

`GET /agendamentos` devolve um objeto `cliente` só com identificador e nome. O
telefone fica no recurso de cliente, então um dia de lembretes custa uma chamada
extra por paciente. Com uns 40 agendamentos por dia, são ~41 chamadas — folgado
dentro do limite observado de **40 requisições por minuto**, mas só em sequência,
não em paralelo.

Os telefones *estão* presentes nas coleções de finalizados e cancelados, o que é
fácil de induzir ao erro.

### `PUT /agenda/status` responde 200 quando falha

O corpo traz `{"sucesso": false, "msg": ...}`. Código que olha o status code
acredita que gravou. Leia o corpo. Ver
[modo de falha 8](failure-modes.md#8-http-200-com-a-falha-no-corpo).

### "Só agendamentos em aberto podem ser alterados" é ambíguo na documentação

Existem três coleções separadas (`/agendamentos`, `/agendamentos/finalizados`,
`/agendamentos/cancelados`), o que sugere que "em aberto" significa nem finalizado
nem cancelado — e, portanto, que um agendamento *confirmado* continua gravável. A
documentação não diz isso. É a primeira coisa a verificar com um agendamento de
teste, porque, se for verdade, um problema inteiro de máquina de estados desaparece.

### Os identificadores de agendamento são sequenciais

Visível nos próprios exemplos da documentação. É isso que torna o endpoint público
do webhook um alvo de enumeração. Ver
[modo de falha 13](failure-modes.md#13-endpoint-público-mais-identificadores-sequenciais).

### Não existe classificação por linha de produto

O catálogo de serviços é grande (milhares de entradas) e suas categorias são
grosseiras — só rótulos genéricos de tipo. O que um serviço realmente *é* só pode ser
lido pelo nome, que a recepção digita livremente e que traz promoções, preços e
condições de pagamento embutidos, então o mesmo produto aparece muitas vezes com
nomes diferentes.

Duas consequências para qualquer coisa construída em cima disso:

- **Fixe pelo código do serviço**, nunca pelo texto. O payload do agendamento já o
  devolve.
- Cuidado com palavras que parecem nome de produto mas são convenções de promoção.
  Uma triagem por regex chega perto e ainda precisa de revisão humana.

Não é usado pelo pipeline de lembretes; registrado porque é a primeira pergunta que
qualquer pessoa faz ao ver o catálogo.

### A documentação é uma coleção pública do Postman, não uma referência oficial

Cobre mais de 90 endpoints e inclui exemplos de resposta, o que é mais que
suficiente, mas não é um contrato e nada nela é versionado.
