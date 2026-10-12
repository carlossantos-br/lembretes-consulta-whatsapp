# 0002 — Agrupar por telefone e data, não por paciente

**Status:** aceita · **Substitui** uma decisão anterior de agrupar por paciente

## Contexto

O sistema de agenda cria um agendamento por procedimento. Enviar um lembrete por
linha gerava mensagens duplicadas e, pior, deixava as respostas impossíveis de
correlacionar: a ida era por procedimento e a volta só pode ser casada pelo número de
telefone.

A primeira correção registrada foi "uma mensagem por paciente por dia".

## O que os dados mostraram

Dos doze números de telefone ambíguos em dois dias auditados, **sete eram pessoas
diferentes dividindo o mesmo aparelho**: quatro pacientes num mesmo número, todas
marcadas para o mesmo horário (uma mãe cadastrando os filhos), três familiares no
mesmo horário, dois casais, dois pares de mãe e filho.

Agrupar pelo id da paciente não junta nenhum desses casos. Eles continuariam sendo
duas, três e quatro mensagens para um mesmo aparelho, e continuariam quebrando o
caminho da resposta.

## Decisão

A chave é `telefone canônico + data local do agendamento`.

- Uma mensagem por aparelho por dia, enviada na fatia do agendamento *mais cedo* do
  grupo, para que ninguém seja lembrada mais tarde do que seria individualmente.
- Todos os horários do dia vão na terceira variável da mensagem, que é texto livre —
  então cobrir quatro procedimentos **não exigiu aprovar template novo**.
- Uma resposta vale para o grupo inteiro.
- Um grupo com mais de um id de paciente é marcado como `shared` (compartilhado), o
  que a [ADR 0003](0003-asymmetric-tolerance-confirm-vs-cancel.md) usa em seguida.

## Lição

**Ao correlacionar através de um canal, a chave tem de ser a identidade do canal, não
a sua.** Quem responde é o aparelho, não o cadastro. O banco de pacientes tem a visão
autoritativa de quem são as pessoas; o provedor de mensagens tem a visão autoritativa
de quem consegue responder.

## Custo aceito

A mensagem é endereçada à primeira paciente do grupo, então num aparelho
compartilhado ela é imprecisa por construção. A alternativa — uma mensagem por
pessoa — é justamente a ambiguidade que esta decisão existe para eliminar.
