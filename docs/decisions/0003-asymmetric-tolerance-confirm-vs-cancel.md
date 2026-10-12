# 0003 — Erros de custo diferente merecem tolerâncias diferentes

**Status:** aceita · **Vale para** a interpretação da resposta e a aplicação ao grupo

## Contexto

São dois veredictos, e a tentação é tratá-los de forma simétrica: mesmas regras de
casamento, mesmo escopo de aplicação. Eles não são simétricos.

## A assimetria

**Confirmar errado custa um no-show** — que *já* é o resultado padrão quando ninguém
responde. O erro só devolve o sistema à linha de base.

**Cancelar errado tira uma paciente da agenda.** O horário é oferecido a outra
pessoa, e ela chega para descobrir que a consulta sumiu. O erro cria uma situação que
não existiria de outra forma, e a paciente vê.

Mesmo mecanismo, consequências com uma ordem de grandeza de diferença.

## Decisão

As tolerâncias acompanham o custo, tanto no casamento quanto no escopo:

| | Confirmar | Cancelar |
|---|---|---|
| Vocabulário | pode ser ampliado (`confirmVocabulary`) | só o texto exato do botão, nunca ampliado |
| Vale para | o grupo inteiro | o grupo inteiro, **exceto** se o aparelho for compartilhado |
| Aparelho compartilhado | aplicado | **recusado**, escalado para humano |

O cancelamento é verificado *primeiro* em `interpretReply`, então nem uma
configuração errada que liste o botão de cancelar como frase de confirmação consegue
transformar um cancelamento em confirmação. Não existe, de propósito, um parâmetro
`cancelVocabulary` — a assimetria é estrutural, não uma chave que alguém vira às 2h
da manhã.

## Por que "aparelho compartilhado" é o limite do cancelamento

Um grupo pode conter uma mãe e dois filhos. Um "Não irei" não fala por três pessoas,
e o custo de errar são três pacientes chegando a uma clínica que não as espera mais.
Uma confirmação na mesma situação é segura, porque o pior caso é a linha de base.

## Lição

Tratar de forma simétrica custos assimétricos é um cheiro de design. A pergunta não é
"quão confiante eu estou?", e sim "quanto custa errar, em cada direção?"
