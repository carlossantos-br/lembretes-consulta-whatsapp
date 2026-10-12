# 0004 — Uma fatia estrita de recuperação, não "enviar assim que der"

**Status:** aceita · **Revisa** a regra anterior de não haver segunda chance

## Contexto

A janela de envio é a fatia estrita `(24h, 25h]` de antecedência, verificada por um
scan de hora em hora. Um lembrete descoberto *depois* de sua fatia passar nunca mais
ficava elegível — ficava `pending` para sempre, em silêncio.

Não é um evento raro. Acontece todo dia em que a recepção marca uma consulta para a
manhã seguinte. Uma paciente agendada às 09:00 para as 08:00 de amanhã tem 23 horas
de antecedência e não recebia nada.

## Opções

**A. Uma segunda fatia estrita em `(12h, 13h]`** — mesma mensagem, mesmo template.

**B. "Enviar assim que a antecedência cair abaixo de 24h, com piso de 12h"** — sem
fatia, só um limiar.

## Decisão

A.

## Por que não B

Com um limiar, todo agendamento abaixo dele fica elegível em *todo* scan, e a
idempotência vira a única coisa entre a paciente e uma mensagem repetida. Com fatias
e scan de hora em hora, cada agendamento é examinado exatamente uma vez por fatia — a
garantia vem da aritmética, e não de uma constraint de banco aguentando concorrência.

Como o scan é de hora em hora, duas fatias de uma hora cobrem a linha do tempo sem
buracos. Só escapa o agendamento feito com **menos de 12 horas de antecedência**, e
isso agora é uma regra declarada, não um acidente.

## O que precisou ir junto

Duas correções são obrigatórias, não opcionais:

1. **O relatório de "não vai receber"**, que de outro modo listaria como inalcançáveis
   pessoas que agora recebem mensagem.
2. **A consulta de atrasados do watchdog**, que precisa alarmar para falhas nas
   *duas* fatias, não só na primeira.

Adicionar uma fatia sem essas duas correções transforma um buraco silencioso em duas
mentiras barulhentas.

## Custos aceitos

- Cerca de **10% da agenda de um dia vira mensagem cobrada** que antes não saía.
  Uma decisão de negócio, tomada como tal.
- **Sem horário de silêncio.** Uma mensagem de recuperação pode sair às 22:00. Aceito
  de propósito: um lembrete às 22:00 vale mais para a paciente do que o silêncio.
- O buraco ficou *menor*, não fechado. `recoveryHours` é configurável e `0` desliga a
  recuperação por completo.
