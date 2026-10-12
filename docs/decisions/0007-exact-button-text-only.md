# 0007 — Só o texto exato do botão tem efeito (e o custo disso)

**Status:** aceita, com um custo conhecido e medido

## Contexto

O provedor permite no máximo dois botões de resposta rápida, então o vocabulário que
dá para *garantir* são duas strings exatas. Todo o resto é texto livre de uma pessoa
que pode estar confirmando, cancelando, pedindo para remarcar ou respondendo a outra
coisa.

## Decisão

Só o texto exato do botão tem efeito. Qualquer outra coisa vai para uma fila humana.

## Por que estava certo quando foi escrito

O coletor originalmente recebia **todo** o tráfego de WhatsApp da clínica — centenas
de mensagens sem relação nenhuma por dia. Interpretar texto livre nesse fluxo
significava adivinhar sobre conversas que o serviço não tinha nada que ler.

## Por que hoje é contestado

Payloads de números sem lembrete aguardando resposta são descartados antes de
qualquer gravação, então a entrada agora é estreita: mensagens de uma paciente a quem
acabaram de fazer uma pergunta de sim ou não. O risco que justificava a regra
encolheu. **A regra ficou.**

Numa janela de 48 horas, pelo menos oito pacientes escreveram "Sim", "Pode
confirmar", "Eu vou", "Sim estou indo", "Confirmado", "Sim querida" — e a agenda
continuou em branco. Do lado delas, confirmaram. Elas aparecem no log como
`chat_ignorado`, que é uma fila de trabalho legítima e não ruído, mas é uma fila de
pessoas que o sistema entendeu e escolheu ignorar.

Uma proposta de ampliar o vocabulário foi **recusada** por quem decide, e isso fica
registrado como foi tomado: a tolerância a uma confirmação errada é um julgamento de
negócio, não de engenharia.

## Como o código sustenta as duas posições

`interpretReply` recebe `confirmVocabulary`, vazio por padrão. Ampliar é mudança de
configuração, não de código, e vale **só para o lado da confirmação** — não existe
`cancelVocabulary`, conforme a
[ADR 0003](0003-asymmetric-tolerance-confirm-vs-cancel.md).

O casamento é por string inteira depois de normalizar caixa, acentos e pontuação
final, então "não posso confirmar" não tem como ser lido como concordância. Casar por
substring seria um bug disfarçado de prestatividade.

## Lição

Um padrão conservador é uma decisão real com um custo real, e o custo cai sobre
pessoas que fizeram o que foi pedido. Registre, conte e revisite quando a condição que
o justificou mudar — que é exatamente o que não aconteceu aqui.
