# Decisões técnicas — Sprint 1

Registro das escolhas que não estão óbvias no código e das ambiguidades das fichas, com a interpretação adotada.

## Identidade e sessão

### CPF (ficha 01)

- O CPF é dado pessoal sensível (LGPD) e precisa ser **único** e **consultável** para detectar duplicidade, mas não deve ser legível por quem acessa o banco.
- Por isso são guardados três campos:
  - `cpf_hash` (HMAC-SHA256 com `CPF_HMAC_SECRET`, índice único) — permite a busca exata sem revelar o valor; um hash sem chave seria vulnerável a dicionário, já que existem só cerca de 10⁹ CPFs;
  - `cpf_encrypted` (AES-256-GCM com `CPF_ENCRYPTION_KEY` e IV aleatório) — permite recuperar o valor no futuro (ex.: nota fiscal);
  - `cpf_masked` (`***.***.***-25`) — é o que as telas exibem.
- A API nunca devolve o CPF completo.
- A duplicidade é conferida no envio do cadastro e não enquanto o usuário digita, para não permitir enumeração de CPFs cadastrados.
- Contas criadas via Google/Apple não têm CPF; o campo é opcional no banco e o cadastro com senha o exige.

### Sessão: cookies + refresh rotacionado

- **Tokens em cookies, não em `localStorage`:** os tokens ficam em cookies HttpOnly, fora do alcance de JavaScript; um XSS não consegue exfiltrá-los.
- **Access token curto e sempre conferido:** o access token (JWT, 10 min) evita uma consulta pesada por requisição, mas mesmo assim cada requisição confere a linha de `sessions` e o status do usuário pela chave primária. É isso que faz a suspensão e o logout valerem na hora.
- **Refresh opaco e rotacionado:** o refresh token é opaco, rotacionado a cada uso e guardado como SHA-256. A janela de 30 s para o token anterior evita deslogar quem tem duas abas renovando juntas; depois dela, o reuso é tratado como roubo e a sessão é revogada.
- **Cookie de refresh restrito:** o cookie de refresh tem `Path=/api/auth`, então só trafega para os endpoints de autenticação.

### CSRF

- Cookies `SameSite=Lax` já bloqueiam POST cross-site na maioria dos navegadores. Como reforço, toda requisição que altera estado exige o header `X-FilaFacil-Client: web`. Um formulário de outro site não consegue enviar header customizado, e `fetch` cross-origin com header customizado dispara preflight, que o CORS (allowlist com `WEB_ORIGIN`) recusa.
- A única exceção é o callback `form_post` da Apple, protegido por `state` de uso único.

### Login por código (ficha 06)

- O código é aleatório (CSPRNG) mesmo em desenvolvimento; o provider `dev` apenas escreve a mensagem no terminal da API e é recusado com `NODE_ENV=production`.
- O código fixo `123456` existe só nos fluxos simulados da Sprint 2 (verificação de contato, recuperação de senha), que não falam com o servidor.

### Limite de tentativas de senha

- O contador por conta (5 erros em 15 min) fica em memória do processo. Para mais de uma instância da API, ele precisa ir para um store compartilhado (Redis). O rate limit por IP do `@nestjs/throttler` tem a mesma limitação.

## Autorização

- **Contexto vem da sessão:** o papel, o usuário e os vínculos vêm sempre da sessão, nunca do corpo da requisição.
- **Id da rota é só um pedido:** o `establishmentId` da rota é tratado como pedido de acesso e validado contra `establishment_memberships`. Recursos encontrados fora do estabelecimento do contexto respondem 404, para não revelar a existência de ids alheios.
- **Plano no banco:** os recursos do plano ficam em `plan_features` e são lidos a cada requisição. O admin troca o plano e o efeito é imediato na API; o painel do gestor é avisado pelo evento `establishment.updated`.
- **Limites aplicados:** dos limites do plano, o servidor aplica hoje o **número de mesas** (ficha 20). Os demais (atendentes, cardápios) são exibidos e editados pelo admin, mas só passam a ser aplicados quando as telas que os consomem existirem.
- **Inativo × suspenso** (ficha 34):
  - **inativo** — o estabelecimento some da busca e da página pública, mas a equipe continua usando o painel;
  - **suspenso** — também bloqueia a equipe (403 `ESTABLISHMENT_SUSPENDED`).
- **Login da equipe:** o protótipo não tinha login para atendente, gestor e admin. Foi adicionado um login de equipe (e-mail + senha) em cada painel, porque sem ele não há como aplicar autorização.

## Domínio

### Preços e promoções (ficha 29)

- **Dinheiro em centavos:** valores monetários são inteiros em centavos (`price_cents`), sem `float`.
- **Promoção sem job:** a promoção não altera o item. O preço vigente é calculado na leitura (`starts_at <= agora <= ends_at`), então a promoção começa e termina no horário certo sem cron, e nunca há preço "esquecido" alterado.
- **Promoções sobrepostas:** se mais de uma promoção cobre o item, vale o **maior desconto**.
- **Promoção depende do plano:** se o plano perde o recurso `promotions`, os descontos deixam de ser aplicados.

### Fichas técnicas (ficha 31)

- O custo do insumo é `Decimal(12,4)`, porque frações de centavo importam em ml e g.
- O custo total, o percentual sobre o preço de venda e o alerta de limite são **calculados a cada leitura** e não armazenados. Mudar o preço de um insumo atualiza todas as fichas sem inconsistência, e o cliente não consegue enviar um custo forjado (o DTO rejeita o campo).

### Planta do salão (ficha 20)

- **Versionamento:** a planta tem `version`. Salvar envia a versão base e, se outra pessoa salvou antes, a resposta é 409 e o editor oferece recarregar.
- **Atualização seletiva:** mesas não alteradas não são reescritas. Trocas de nome entre mesas passam por um rótulo temporário para não violar o índice único `(planta, rótulo)`.
- **QR Code:** é gerado pelo servidor e nunca muda depois de criado, já que o QR impresso continua valendo.

### Ocupação mínima das mesas (ficha 21)

- A ficha 21 pede que a estimativa de espera considere as mesas livres e que liberar uma mesa avise o próximo grupo. Isso exige saber se a mesa está livre ou ocupada, informação que na versão completa vem dos pedidos (Sprint 2).
- Foi adicionado só o necessário: `occupancy` (`free`/`occupied`) e `occupied_party_size` em `dining_tables`. Sentar um grupo da fila ocupa a mesa; "liberar mesa" a desocupa.
- Os estados reservada e chamado, e a ocupação derivada de pedidos, continuam na Sprint 2.

### Fila de espera (ficha 21)

- **Concorrência:** as posições são únicas entre as entradas ativas (índice único parcial). Toda operação que mexe na fila roda numa transação com `pg_advisory_xact_lock` por estabelecimento, então inserções simultâneas são serializadas sem lock de tabela. O teste dispara 15 inserções em paralelo e confere as posições de 1 a 15.
- **Estimativa:** grupos à frente consomem as mesas livres compatíveis; cada grupo excedente soma um giro médio de 12 min (constante, até haver histórico de giro).
- **Liberação de mesas:** ao liberar, o primeiro grupo ativo que cabe na capacidade liberada é avisado automaticamente pelo `NotificationService`. O aviso fica registrado em `waitlist_notifications` com o status do envio.

### Horário de funcionamento

- **Formato:** é guardado em minutos desde a meia-noite, no fuso IANA do estabelecimento (`America/Sao_Paulo` por padrão), e o "aberto agora" é calculado com `Intl` nesse fuso.
- **Viradas de dia:** faixas que atravessam a meia-noite (ex.: 18h–02h) são suportadas.

## Ambiguidades das fichas e interpretação adotada

| Tema | Interpretação |
|---|---|
| Nota do restaurante (ficha 12) | `rating_average`/`rating_count` agregados no estabelecimento; avaliações individuais não fazem parte da Sprint 1 |
| Reservas | Fora do escopo da Sprint 1; nenhuma ficha a pede |
| Tempo de espera exibido na busca (ficha 11) | `average_wait_minutes` configurado por estabelecimento; a fila calcula a sua própria estimativa |
| Quem edita dados do estabelecimento | O admin (ficha 34); o gestor ainda não tem tela de dados da casa |
| Localização manual (ficha 11) | Lista de regiões com coordenadas, pois não há geocodificação contratada; com permissão de localização, usa o GPS |
| Biometria (ficha 59) | O aparelho pede a biometria, mas abrir sessão exige WebAuthn no servidor (Sprint 2); hoje só mostra um aviso |
| QR Code da mesa (ficha 02) | Sprint 2; o diretório local resolve os códigos do seed para estabelecimentos reais da API |
| Mesclagem de mesas (ficha 47) | Sprint 2; fica como sobreposição local no mapa |
