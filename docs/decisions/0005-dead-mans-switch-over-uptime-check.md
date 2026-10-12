# 0005 — Monitorar o dado, não o processo

**Status:** aceita

## Contexto

O primeiro watchdog fazia duas perguntas: houve um evento de scan registrado hoje, e
existem lembretes atrasados? No dia em que 187 de 231 pacientes não receberam nada,
ele respondeu `ok`.

As duas respostas eram verdadeiras. O scan *tinha* rodado. A consulta de atrasados
filtrava por `created_at <= expires_at - 24h`, o que exclui exatamente os lembretes
nascidos fora da janela, e as linhas paradas num status de piloto não eram `pending`,
então também ficavam invisíveis para ela.

## Decisão

O watchdog pergunta pelo **efeito**, e a pergunta principal é a que faltava: *havia
lembretes para sair hoje, e nenhum saiu?*

O scanner registra `due` e `sent` a cada scan; o watchdog compara os dois. Além disso,
ele reporta envios que falharam, lembretes que já não podem mais ser alcançados e
agendamentos sem telefone — cada um via `alertOnce`, de modo que uma condição que
sobrevive ao próprio alerta é anunciada uma única vez.

A notificação vai para um bot de chat, e não para o provedor de mensagens usado com
as pacientes: alerta operacional não deve dividir canal, modelo de cobrança nem fila
de aprovação de template com aquilo que ele monitora.

## Por que não um health check HTTP

`/health` responde "o processo está escutando", que é a coisa menos interessante que
pode ser verdade sobre um serviço cujo trabalho é mandar mensagem. Um dead man's
switch sobre o dado — um alarme que dispara quando o sinal esperado *deixa* de
chegar — pergunta se o trabalho aconteceu. Estar vivo é necessário e está longe de
ser suficiente.

## Aconteceu de novo

Enquanto este repositório era escrito, o watchdog reescrito buscava lembretes com
`listByDate(today)`. Lembretes são indexados pela data do *agendamento*, e o scan que
os cria roda na véspera — então ele inspecionava um conjunto vazio e relatava que
estava tudo bem. Mesmo bug, roupa nova, pego por uma demo e não por um incidente em
produção.

Agora ele deriva as datas em andamento das mesmas definições de fatia que o scanner
usa, então os dois não têm como discordar sobre o que está em andamento.

## Lição

Um monitor que faz a pergunta errada responde com confiança de qualquer jeito. Quando
um monitor diz que está tudo saudável durante um incidente, o bug está na pergunta,
não no limiar.
