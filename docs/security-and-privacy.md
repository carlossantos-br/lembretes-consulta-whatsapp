# Segurança e privacidade

Duas propriedades desta integração a tornam mais sensível do que o tamanho sugere: um
caminho precisa ser acessível publicamente, e tudo o que passa por ele é dado de
agendamento de saúde.

## O endpoint público

A API do provedor de mensagens não tem webhook de resposta. O caminho de volta é um
webhook configurado no painel do provedor, o que significa que **um caminho precisa
ser acessível pela internet** — não há como manter o serviço inteiro privado.

Esse caminho consegue gravar nos agendamentos das pacientes, e os identificadores de
agendamento no sistema de agenda são sequenciais. Sem defesa, qualquer um que
descobrisse a URL poderia ir contando para cima e cancelar consultas reais.

### Defesa, as duas metades juntas

**1. Um segredo compartilhado num header customizado.** A etapa de integração do
provedor permite headers customizados. A comparação é em tempo constante, com
verificação de tamanho antes, para que a própria comparação não vaze o tamanho do
segredo.

**2. O payload é chave de busca e nunca verdade.** O corpo contribui com exatamente
uma coisa: um número de telefone para buscar. Só podem ser afetados lembretes que
*este próprio serviço enviou* e que ainda aguardam resposta. Identificadores no
payload são ignorados — veja `receiver.js` e o teste `13: o payload é chave de busca
e nunca fonte de verdade`.

Nenhuma metade basta sozinha. Segredo vazado com um handler que confia no payload
significa gravação arbitrária. Só a busca, sem segredo, ainda deixa qualquer um que
saiba o número de uma paciente responder em nome dela.

### O que o endpoint ainda permite

Dito com todas as letras, porque um modelo de ameaças que só lista mitigações é
marketing:

- Quem tiver o segredo **e** o telefone de uma paciente consegue confirmar ou cancelar
  a consulta dela. A mitigação é a confidencialidade do segredo, e nada além disso.
- O volume de tráfego num caminho público não é controlado aqui. Rate limiting é
  responsabilidade do proxy reverso.
- Um cancelamento é recusado em aparelho compartilhado, mas uma confirmação não, de
  propósito ([ADR 0003](decisions/0003-asymmetric-tolerance-confirm-vs-cancel.md)).
  Uma confirmação aplicada por engano é possível por design.

## Retenção mínima

Com o filtro de eventos do painel aberto, **toda mensagem de WhatsApp que a clínica
recebe** passa por este endpoint — centenas por dia. Nada disso é da conta do serviço.

Por isso o receiver verifica se há um lembrete aguardando resposta naquele número
**antes de gravar qualquer coisa**. Se não houver, ele registra um evento sem número
de telefone e sem texto de mensagem, e retorna. O teste `uma conversa sem relação não
deixa rastro` garante que o evento de descarte não tem nenhum campo além do tipo.

Mais três escolhas na mesma direção:

- **O texto da resposta não é armazenado por padrão.** Uma resposta escalada registra
  o *motivo* (`unrecognised`, `automated`, `empty`), não o conteúdo. Uma fila humana é
  mais útil com o texto e mais perigosa com ele; `storeEscalatedText` existe para que o
  deploy tome essa decisão explicitamente, e não por acidente.
- **Eventos operacionais carregam identificadores, não pessoas.** Ids de lembrete e ids
  de agendamento — nada de nomes, nada de números. O telefone fica na linha do
  lembrete, onde é necessário, e não é copiado para o log.
- **Alertas vão para quem opera o serviço, nunca para a recepção.** A equipe vê os
  resultados na agenda; só quem roda o serviço pode agir sobre "o write-back está
  falhando há uma hora". Isso mantém dados de pacientes fora de um grupo de chat.

Um deploy em produção coletou payloads de mensagens durante a depuração inicial e
depois os apagou. Vale registrar porque é a falha comum: a retenção é desenhada
depois da depuração, e é na depuração que os dados se acumulam.

## Publicar este repositório

A proteção é o [`scripts/sanitize.mjs`](../scripts/sanitize.mjs), rodado no CI.

A restrição de design dele merece ser explicitada: **uma denylist de literais não pode,
ela própria, ser publicada.** Um arquivo versionado listando o nome de um cliente,
hostnames internos e identificadores de template vazaria exatamente o que existe para
proteger, num arquivo cujo nome anuncia que esses termos são sensíveis.

Então a verificação tem duas metades:

1. **Formatos**, versionados. Identificadores de objeto de 24 caracteres hex, JWTs,
   cabeçalhos de chave privada, credenciais dentro de uma URL, literais de bearer,
   atribuições longas e opacas. Eles descrevem a cara de um segredo e não nomeiam nada.
2. **Literais**, nunca versionados. `.sanitize-local.json` está no gitignore; veja
   `.sanitize-local.example.json` para o formato. Rode antes de publicar; o CI roda só
   os formatos.

Também ficam de fora na mão, porque nenhum padrão os pega: o nome, a cidade e o
segmento do cliente; volumes diários absolutos (proporções são publicadas, contagens
não); cargos da equipe; valores de contrato; e qualquer captura de tela de painel.

### O repositório foi criado do zero

O histórico do deploy privado **não** foi tornado público. Ele tem arquivos `.env`,
identificadores de template e configuração real nos commits, e `git log` pode ser lido
por qualquer um. Virar um repositório privado para público publica o histórico
inteiro, não só a árvore atual — uma distinção que já constrangeu projetos com muito
mais recursos do que este.
