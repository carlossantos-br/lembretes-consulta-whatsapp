# 0001 — Um serviço dedicado: nem acoplado a um existente, nem low-code

**Status:** aceita · **Contexto:** projeto do zero, preço fechado, uma instância pequena

## Opções

**A. Um serviço Node dedicado.** Processo próprio, schema próprio, deploy próprio.

**B. Incorporar à API interna existente.** Sem deploy novo, conexão de banco
compartilhada, menos duplicação.

**C. Uma plataforma de automação low-code** (n8n, Pluga e similares). Menos código.

## Decisão

A.

## Por que não B

O acoplamento já tinha saído caro. Derrubar aquela API interna, uma vez, derrubou
junto uma página pública de vitrine — em silêncio, respondendo HTTP 200 com a galeria
vazia, descoberto por acaso. Duas falhas sem relação nenhuma dividiam o mesmo raio de
impacto.

Um serviço que grava nos agendamentos de pacientes não pode ter como derrubar outra
coisa, nem pode cair por causa do deploy alheio de outra coisa. Isso vale mais do que
a duplicação que custa.

## Por que não C

Três motivos independentes, e qualquer um deles bastaria:

1. **Custo recorrente dentro de um projeto de preço fechado.** Assinatura mensal
   contra um valor pago uma vez é uma conta que fecha no prejuízo e piora todo mês.
2. **Fraca justamente onde mora a dificuldade.** As partes difíceis desta integração
   são idempotência, disciplina de throttle e *classificação* de retry — saber que uma
   recusa é permanente e que um erro de socket não é. Ferramentas de fluxo visual são
   boas de encanamento e fracas exatamente nisso.
3. **Memória.** Uma instância de 2 GB já rodava três serviços e um banco de dados.

## Consequência

Tudo neste repositório — ports, fakes, uma máquina de estados, uma suíte de testes
determinística — é o custo da opção A. Esse custo só se justifica porque os modos de
falha de `docs/failure-modes.md` são do tipo que um fluxo visual não consegue
expressar, quanto mais cobrir com teste de regressão.
