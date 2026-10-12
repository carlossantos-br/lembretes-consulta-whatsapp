# Modos de falha

Catorze coisas que deram errado em produção, na ordem em que foram entendidas.
Cada uma tem um teste de regressão em
[`test/regression.failure-modes.test.js`](../test/regression.failure-modes.test.js),
com a mesma numeração.

O mecanismo em si nunca falhou. Dois dias seguidos auditados enviaram 100% dos
lembretes que venceram, com zero erro de envio e 100% das confirmações e
cancelamentos gravados de volta na agenda. **Tudo abaixo é erro de modelagem, não
de infraestrutura** — e essa é a parte útil, porque erro de infraestrutura faz
barulho e erro de modelagem reporta sucesso.

---

## 1. A granularidade do envio era o procedimento; a da correlação, o aparelho

**Sintoma.** Uma paciente agendada para quatro procedimentos recebeu quatro
mensagens quase idênticas. Num dos dias, 13 de 188 pacientes receberam mais de uma;
uma paciente recebeu quatro, idênticas byte a byte exceto pelo horário.

**Sintoma pior.** Isso quebrou o caminho da *resposta*. Com dois ou mais lembretes
aguardando resposta no mesmo número, a busca devolvia várias linhas, a política se
recusava a adivinhar e a resposta ia para a fila humana. Cerca de **13% dos números
que aguardavam resposta estavam nessa situação.** A paciente recebia mais mensagens
e tinha menos automação.

**Causa raiz.** O sistema de agenda cria uma linha de agendamento por procedimento,
então o lado de saída era por procedimento. O lado de entrada só pode ser
correlacionado pelo telefone, porque a resposta não traz referência à mensagem.
**Duas granularidades diferentes nas duas pontas da mesma conversa não se
reconciliam mais adiante.**

**Correção.** Unificar a granularidade na origem: um lembrete por aparelho por dia,
com todos os horários daquele dia na terceira variável da mensagem. Tratar a
ambiguidade no interpretador foi considerado e descartado — trata o sintoma.

**Teste.** `1: quatro procedimentos num aparelho geram uma mensagem, não quatro`

---

## 2. A chave de agrupamento era o cadastro da paciente, não o aparelho

**Sintoma.** Depois de agrupar por id de paciente, as respostas ambíguas
continuaram.

**Causa raiz.** De doze números ambíguos em dois dias, **sete eram pessoas
diferentes dividindo um aparelho**: quatro pacientes num número, todas agendadas no
mesmo horário (uma mãe cadastrando os filhos), três familiares no mesmo horário,
dois casais, dois pares de mãe e filho. Agrupar por id de paciente não junta nenhum
desses.

**Correção.** A chave passa a ser `telefone canônico + data local do agendamento`.
Quem responde é o aparelho, não o cadastro. Um grupo com mais de um id de paciente é
marcado como `shared` (compartilhado), e é isso que permite ao caminho de
cancelamento se recusar a falar por uma família.

**Lição.** Ao correlacionar através de um canal, a chave tem que ser a identidade do
canal, não a sua.

**Teste.** `2: três pacientes dividindo um aparelho recebem uma mensagem`

---

## 3. Configuração transitória foi gravada como estado terminal

**Sintoma.** Num dos dias, **187 de 231 agendamentos não receberam nada**, em
silêncio. O piloto tinha sido desligado na noite anterior.

**Causa raiz.** Enquanto a allowlist do piloto estava ativa, os lembretes fora dela
eram marcados com um status que significava "fora do piloto". A fila de envio só
pega `pending`, e aquele status era terminal, então **desligar o piloto não trouxe
ninguém de volta**. O status registrava um fato sobre o deploy no momento em que o
scanner passou pela linha, e o guardava como fato sobre o lembrete.

**Correção.** A configuração é lida na hora do envio e nunca persistida. Um envio
pulado registra um *evento* (`send_skipped_by_config`) e deixa a linha em `pending`,
de modo que basta remover a configuração para ela voltar a ser enviável no próximo
scan.

**Lição.** Estado derivado de configuração faz o dado mentir, e ele mente no sentido
de parecer concluído.

**Teste.** `3: remover a allowlist traz de volta os lembretes pulados`

---

## 4. Um alerta derivado de uma consulta de estado dispara para sempre

**Sintoma.** Doze mensagens no Telegram durante a madrugada sobre o *mesmo*
agendamento. Outro alerta ("resposta não gravada há mais de uma hora") gerou seis
mensagens por hora durante uma queda de rede longa.

**Causa raiz.** A condição do alerta era uma consulta sobre o estado atual, e o
estado que ela descrevia continuava lá na passada seguinte. A condição sobrevivia
ao próprio alerta.

**Correção.** `alertOnce(key, message)`, com a chave identificando o *caso*, não a
condição. **O retry continua rodando — só a notificação se cala.** Silenciar o
trabalho e silenciar o barulho são decisões diferentes.

**Deliberadamente não corrigido:** "o scanner não conseguiu ler a agenda" continua
alertando a cada passada enquanto a API de origem estiver fora. Suprimir uma queda
em andamento é uma decisão diferente de suprimir uma duplicata.

**Teste.** `4: uma condição que sobrevive ao alerta é anunciada uma vez, mas segue sendo retentada`

---

## 5. O watchdog verificava execução em vez de efeito

**Sintoma.** O watchdog reportou `ok` no dia em que 187 pessoas não receberam nada.

**Causa raiz.** Ele fazia duas perguntas — houve evento de scan hoje, e existem
lembretes atrasados — e as duas respondiam de forma tranquilizadora. O scan *tinha*
rodado. A consulta de atrasados filtrava por `created_at <= expires_at - 24h`, o que
exclui justamente os lembretes nascidos fora da janela, e as linhas paradas no
status do piloto não estavam em `pending`, então também eram invisíveis para ela.

**Correção.** Fazer a pergunta que faltava: **havia lembretes vencendo hoje, e
nenhum saiu?** O scanner registra `due` e `sent` a cada scan; o watchdog compara os
dois.

**Uma segunda ocorrência do mesmo bug, encontrada ao montar este repositório:** o
watchdog reescrito buscava lembretes com `listByDate(today)`. Os lembretes são
indexados pela data do *agendamento*, e o scan que os cria roda na véspera, então
ele inspecionava um conjunto vazio e reportava que estava tudo bem. Agora ele deriva
as datas em andamento das mesmas definições de fatia que o scanner usa. Um monitor
que faz a pergunta errada responde com confiança de qualquer jeito.

**Teste.** `5: o watchdog pega um dia que rodou e não mandou nada`

---

## 6. Uma janela estrita sem segunda chance perde agendamentos de última hora

**Sintoma.** Consultas marcadas de um dia para o outro nunca recebiam lembrete, e
nada contabilizava isso. Oito no primeiro dia em que se notou; mais quatro dois dias
depois, agendadas pela recepção na mesma manhã.

**Causa raiz.** A janela de envio é a fatia estrita `(24h, 25h]`. Um lembrete
descoberto depois que sua fatia passou nunca mais fica elegível, e ficava em
`pending` para sempre, em silêncio. **Isso acontece todo dia em que a recepção marca
para amanhã** — não é evento raro.

Uma armadilha vizinha: essas linhas tinham telefone nulo, porque o telefone só é
consultado na segunda fase do scanner. "Sem telefone" ali significa "nunca chegamos
a consultar" — as quatro tinham telefone no sistema de origem.

**Correção.** Uma segunda fatia estrita em `(12h, 13h]`, mesma mensagem, mesmo
template, com `recoveryHours` configurável e desativável. Fatias estritas foram
mantidas em vez de "enviar assim que a antecedência cair abaixo de N": o scan é de
hora em hora, então as fatias ladrilham a linha do tempo, e só escapa um agendamento
feito com menos de 12 horas de antecedência. A escolha está no
[ADR 0004](decisions/0004-strict-window-plus-second-slice.md).

Duas correções precisaram ir junto: o relatório de "não vai receber", que senão
listaria pessoas que agora recebem, e a consulta do watchdog, que precisa alarmar
para falhas em *ambas* as fatias.

**Custo.** Cerca de 10% da agenda de um dia vira uma mensagem cobrada que não
existia antes. Isso é uma decisão de negócio, não técnica.

**Teste.** `6: a fatia de recuperação alcança um agendamento feito depois que a fatia principal passou`

---

## 7. O provedor entrega toda mensagem recebida duas vezes

**Sintoma.** Toda resposta chegava duas vezes — uma como `action: "all"` e de novo
como `action: "queue_wait"`, de um a vinte segundos de diferença, com `content.id`
diferente. Inofensivo para uma resposta normal; para uma ambígua, gerava **dois
alertas para um evento**. Ao contar incidentes pelo log, divida por dois.

**Causa raiz.** Comportamento da plataforma com o filtro de eventos do painel
aberto. Não existe contrato de payload publicado para consultar.

**Correção — duas camadas, para dois problemas diferentes.** O id do evento barra um
*replay* legítimo da mesma entrega. A **guarda de estado** barra a entrega dupla,
porque os ids diferem: aplicar um veredito que o lembrete já tem não muda nada e
devolve `unchanged`. Confundir as duas coisas foi um erro que este repositório
cometeu e que o próprio teste pegou.

**Teste.** `7: uma mensagem entregue duas vezes é aplicada uma vez`

---

## 8. HTTP 200 com a falha no corpo

**Sintoma.** Gravações de volta que pareciam ter dado certo e não tinham acontecido.

**Causa raiz.** `PUT /agenda/status` responde **HTTP 200** com
`{"sucesso": false, "msg": ...}` quando recusa. Qualquer coisa que olhe o status
code acredita que gravou.

**Correção.** A porta devolve um *objeto* de resultado; só falha de transporte lança
exceção. O writer lê o corpo.

**E mais:** uma recusa é *permanente*. Retentá-la transformou uma falha num alerta a
cada dez minutos, para sempre. Recusas são registradas por agendamento e saem da
fila; erros de rede mantêm o lote pendente para a próxima passada.

**Teste.** `8: uma recusa é lida do corpo e nunca retentada`

---

## 9. Aceito não é entregue

**Sintoma.** Nenhum — este é uma armadilha evitada, não um bug sobrevivido.

**Causa raiz.** `POST /v3/messages/template/send` responde `201` assim que coloca a
mensagem na fila. Segundo a própria documentação do provedor, falhas de template e
de entrega aparecem só no painel; **não há callback de entrega nem endpoint de
status.**

**Correção.** O fato mais forte que o sistema registra é `sentAt`, que significa
"entregue ao provedor". Nada no schema nem nos relatórios afirma entrega, e a porta
de mensagens não tem nenhum método que pudesse fazê-lo.

**Teste.** `9: o pipeline nunca afirma entrega, porque o provedor nunca a informa`

---

## 10. A resposta não tem vínculo com a mensagem que responde

**Sintoma.** Ambiguidade estrutural que nenhuma engenharia elimina.

**Causa raiz.** Citando a documentação do provedor: um envio pela API não abre
conversa, e a resposta da paciente "iniciará uma nova conversa, sem vínculo com a
mensagem original". O **telefone é a única chave de correlação que existe.**

**Correção.** Aceitar e desenhar a política: unificar a granularidade do envio no
telefone (modo de falha 1) e, quando ainda houver dois lembretes aguardando resposta
no mesmo aparelho, recusar-se a adivinhar e passar para uma pessoa.

**Lição.** Parte da ambiguidade é propriedade da integração, não defeito do seu
código. Saber nomear qual das duas você está olhando poupa muito trabalho.

**Teste.** `10: com dois lembretes num aparelho, a resposta é estruturalmente ambígua`

---

## 11. Os dois sistemas escrevem o mesmo telefone de jeitos diferentes

**Sintoma.** Sem casar variantes, **nenhuma resposta jamais casaria com um
lembrete** e a funcionalidade simplesmente não faria nada, em silêncio.

**Causa raiz.** Os celulares brasileiros ganharam um nono dígito. O sistema de
agenda guarda a forma moderna; o WhatsApp informa alguns números antigos na forma
legada (`556590000000` onde a origem tem `5565990000000`).

**Correção.** `variants()` produz as duas formas e a correlação tenta todas.
Telefones fixos ficam fora da regra de propósito: inserir um nono dígito num fixo
inventa um número que pertence a outra pessoa.

**Teste.** `11: uma resposta no formato antigo do número ainda encontra seu lembrete`

---

## 12. Um campo nulo significava "não consultado" e foi lido como "não existe"

**Sintoma.** Lembretes reportados como "sem telefone" para pacientes que tinham um.

**Causa raiz.** A listagem de agendamentos não inclui telefone; ele é buscado numa
segunda fase. Um lembrete que nunca chegou à segunda fase tem telefone nulo, e o
relatório exibia isso como "sem telefone cadastrado".

**Correção.** A linha de "sem telefone" é criada **só pela fase de resolução**, de
modo que sua existência afirma que uma consulta rodou e não achou nada. Quando um
número aparece depois, o placeholder é descartado em vez de ficar contando em dobro.

**Lição.** Uma coluna anulável que significa duas coisas diferentes vai acabar sendo
lida do jeito errado. Torne a distinção estrutural.

**Teste.** `12: "sem telefone" só é registrado depois que uma consulta rodou de fato`

---

## 13. Endpoint público mais identificadores sequenciais

**Sintoma.** Nenhum — encontrado lendo a documentação da API, cujos próprios
exemplos são identificadores consecutivos (do tipo `1001`, `1002`, `1003`).

**Causa raiz.** O caminho de volta é um webhook, então um caminho precisa ser
acessível publicamente. Os identificadores de agendamento no sistema de agenda são
sequenciais. Se o handler confiasse num identificador vindo do corpo da requisição,
qualquer um que descobrisse a URL poderia ir contando para cima e cancelar
consultas de pacientes reais.

**Correção — as duas metades, juntas.**

1. Um segredo compartilhado num header customizado (a etapa de integração do
   provedor permite headers customizados), comparado em tempo constante.
2. **O corpo é chave de busca, nunca verdade.** Ele contribui com uma única coisa:
   um telefone a ser buscado. Só podem ser afetados lembretes que este próprio
   serviço enviou e que ainda aguardam resposta. Identificadores no payload são
   ignorados por completo.

Nenhuma das metades basta sozinha: sem a segunda, um segredo vazado significaria
gravação arbitrária; sem a primeira, só a busca ainda deixaria quem conhece o
número de uma paciente responder por ela.

**Teste.** `13: o payload é chave de busca e nunca fonte de verdade`

---

## 14. Respostas automáticas na própria linha da paciente

**Sintoma.** Respostas como "…agradece seu contato" e "Oi, obrigada pela mensagem!
Se eu demorar…" chegando de números com lembrete pendente, parecendo exatamente uma
resposta humana na fila de trabalho.

**Causa raiz.** Os próprios números das pacientes rodam respostas automáticas de
negócio. A fila não tinha como distinguir uma pessoa de um robô do outro lado.

**Correção.** Padrões configuráveis encaminham essas mensagens para um motivo
próprio (`automated`) em vez da fila que um humano lê.

**Teste.** `14: uma resposta automática é separada das respostas que um humano deve ler`

---

## O que ainda está em aberto

**Uma paciente confirma em linguagem livre e a agenda continua em branco.**

A regra "só o texto exato do botão age" foi escrita quando o coletor recebia *todo*
o tráfego de WhatsApp da clínica, e era a regra certa naquele momento. Desde que os
payloads de números sem lembrete pendente passaram a ser descartados, o risco que a
justificava encolheu — **mas a regra ficou.** Numa janela de 48 horas, pelo menos
oito pacientes escreveram "Sim", "Pode confirmar", "Eu vou", "Sim estou indo",
"Confirmado". Do lado delas, confirmaram. A agenda discordou.

O código permite ampliar o vocabulário de confirmação — e só o de confirmação, nunca
o de cancelamento, conforme o
[ADR 0003](decisions/0003-asymmetric-tolerance-confirm-vs-cancel.md).
O padrão conservador é o que foi para produção; o
[ADR 0007](decisions/0007-exact-button-text-only.md) registra os argumentos dos dois
lados. Está listado aqui em vez de omitido em silêncio porque um custo documentado é
uma decisão, e um custo não documentado é um bug.
