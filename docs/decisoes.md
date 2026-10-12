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
- Verificação de contato, recuperação de senha e exclusão de conta usam códigos reais (CSPRNG, HMAC no banco), como o login por código.

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
| Reservas | Reserva de mesa por mesa é da equipe (ficha 16); a "reservar" do cliente (ficha 12) é entrada na fila de espera — ver "Reserva do cliente" abaixo |
| Tempo de espera exibido na busca (ficha 11) | `average_wait_minutes` configurado por estabelecimento; a fila calcula a sua própria estimativa |
| Quem edita dados do estabelecimento | O admin (ficha 34); o gestor ainda não tem tela de dados da casa |
| Localização manual (ficha 11) | Lista de regiões com coordenadas, pois não há geocodificação contratada; com permissão de localização, usa o GPS |
| Biometria (ficha 59) | WebAuthn real no servidor (ver Sprint 2, blocos 2 e 3) |
| QR Code da mesa (ficha 02) | Resolvido pela API (`GET /restaurants/qr/:code`) |
| Mesclagem de mesas (ficha 47) | Persistida no servidor (ver Sprint 2, blocos 2 e 3) |

# Decisões técnicas — Sprint 2, bloco 1 (fichas 02, 04, 08, 09 e 65)

## Pedido e preço
- O servidor calcula o total (`POST /orders`): preço do item + melhor promoção vigente, com a mesma regra do cardápio (`common/pricing.ts`). O cliente envia `expectedTotalCents` só para detectar mudança de preço (409 `PRICE_CHANGED`).
- Nome e preço do item são copiados para `order_items`; mudar o cardápio depois não altera pedidos antigos. A mesa é opcional; se a mesa sair da planta, o pedido guarda o nome em `table_label`.
- **Sem duplicar pedido:** o app gera um `clientRequestId` por tentativa de checkout (índice único por usuário). Repetir o envio, ou tentar pagar de novo depois de uma recusa, reaproveita o mesmo pedido. Mudou o carrinho = outro pedido; o abandonado fica `received` sem pagamento e não aparece para a cozinha.

## Pagamento (Mercado Pago)
- O cartão nunca passa pelo servidor: o navegador troca os dados por um token direto com o Mercado Pago (SDK) e a API recebe só `cardToken` e `paymentMethodId`.
- **Só o gateway aprova.** Criação, webhook, sincronização e estorno passam por `OrderPaymentsService.apply`, sob `pg_advisory_xact_lock` do pedido e idempotente. O webhook autêntica a assinatura (`x-signature`, HMAC) e mesmo assim reconsulta o pagamento na API do gateway; o valor aprovado precisa ser igual ao do pedido.
- `POST /orders/:id/payments/sync` consulta o gateway (o app chama a cada poucos segundos enquanto o Pix está pendente), então o webhook é opcional em desenvolvimento local.
- No máximo um pagamento `pending`/`approved` por pedido (índice parcial). A chave de idempotência enviada ao gateway é `order-<id>-<tentativa>`. Trocar Pix pendente por cartão cancela o Pix antes de cobrar.
- Sem `PAYMENT_PROVIDER` o pagamento responde 503. Limitação conhecida: se a chamada ao gateway der timeout depois de cobrar, a transação local é desfeita; repetir o pedido reaproveita a mesma chave de idempotência.
- Estorno: permissão própria (`orders.refund`, só gestor), apenas para pedidos pagos que ainda não ficaram prontos.

## Verificação de contato (ficha 65)
- Reaproveita `otp_challenges`, agora com `purpose` e `user_id`: o código de verificação só vale para a conta que o pediu, para o contato atual dela e para essa finalidade (não abre sessão, e código de login não verifica contato).
- O destino nunca vem da requisição. O servidor recusa pagamento de conta sem e-mail ou celular verificado.
- E-mail real por SMTP (Nodemailer). SMS não tem provider: `GET /auth/providers` informa os canais disponíveis e o app só oferece o que funciona.

## Andamento do pedido (ficha 09)
- Status: `received` (aguardando pagamento) → `paid` → `preparing` → `ready` → `delivered`, mais `cancelled` (estorno). A equipe só avança um passo por vez (`orders.manage`, atualização condicional); pedido não pago nunca entra na cozinha.
- Evento `order.updated` para a sala `user:<id>` do dono e a sala da equipe. Sem WebSocket o app consulta a API a cada 4–5 s.
- Estimativa = `averageWaitMinutes` da casa; retirada = `pickupPoint` (editável pelo admin); o código de retirada só aparece com o pedido pronto.

## QR Code (ficha 02)
- `GET /restaurants/qr/:code` (público, com limite) resolve qualquer mesa da planta, inclusive as criadas depois. O conteúdo impresso é um link do app (`/?mesa=CODIGO`): a câmera nativa abre o app na mesa e o leitor interno aceita o link ou o código.
- Leitor: Shape Detection API quando existe e jsQR nos demais (Safari/iOS, Firefox). A câmera exige HTTPS fora de localhost.

## Estabilização do bloco 1 (revisão técnica)

### Pagamento: resultado incerto nunca vira cobrança duplicada
- A tentativa (`payments`) é gravada **antes** de falar com o Mercado Pago e as chamadas HTTP ficam **fora** de transação. O id da tentativa é a referência externa (`external_reference`) e a chave de idempotência (`payment-<id>`), estáveis em qualquer repetição. O token do cartão é de uso único (7 dias) e só é usado na chamada original: nenhuma repetição o reaproveita.
- Falha **antes** de cobrar (credencial/dados recusados, sem conexão) encerra a tentativa (`refused`) e libera outra. Timeout, conexão perdida ou 5xx são **incertos**: a tentativa fica `pending` sem `provider_payment_id`, o servidor procura a cobrança por `external_reference` (`GET /v1/payments/search`, documentado) e **nenhuma outra cobrança é aberta** enquanto ela estiver incerta.
- A conciliação roda na criação, em `POST …/payments/sync` e no webhook (que acha a linha pela referência e liga o id do gateway). Pix incerto sem cobrança no gateway é encerrado: o código nunca chegou ao cliente, então ninguém pode pagá-lo. Cartão incerto só sai do estado incerto quando o gateway confirma a cobrança (o provedor sem resposta, ou busca ainda sem o registro, mantém o bloqueio).
- Estorno: `refund_requested_at` é gravado antes de chamar o gateway; a chave `refund-<id>` é fixa; qualquer desfecho termina consultando o pagamento (inclusive "já estornado"). Estorno sem confirmação continua repetível, aparece como pendente para a equipe e é fechado por webhook, sincronização ou nova tentativa.

### Pedido velho e estado da casa
- O mesmo `clientRequestId` com outro carrinho/mesa/total é recusado (`ORDER_CONTENT_CHANGED`/`PRICE_CHANGED`). O pagamento recebe o total que o cliente viu (`ORDER_TOTAL_CHANGED`).
- Antes de abrir uma **nova** cobrança o servidor reavalia o pedido: não expirou (30 min sem pagar), a casa aceita pedidos, itens disponíveis e preços iguais aos da criação. Pix pendente ainda válido, pedido pago e pedido com cobrança em andamento não passam por essa checagem: o que foi aceito antes de a casa fechar não é cancelado.

### Limites de requisição
- Com sessão válida o limite é por **usuário**; sem sessão, por IP. Os guards são CSRF → sessão → limite (a sessão precisa estar resolvida). Login e demais rotas sem sessão continuam por IP, com os mesmos limites. Pedido 30/min, pagamento 12/min, sincronização 60/min por usuário (o Pix consulta 15/min); webhook 600/min; leitura de QR 300/min por IP; padrão 600/min.

### Tempo real
- O servidor envia `realtime.ready {authenticated}` ao conectar. Conexão sem sessão não conta como tempo real: o app consulta a API a cada 4 s, tenta renovar a sessão (chamada autenticada) e reconecta, no máximo uma vez a cada 30 s.

## Gateway de pagamento simulado (demonstração acadêmica)

- **Por quê:** o projeto é acadêmico; exigir conta, credenciais, webhook público e transações reais atrapalha a demonstração. `SimulatedPaymentGateway` implementa o mesmo `PaymentGateway` do Mercado Pago, que continua disponível para uso futuro. **Não é integração com instituição financeira: nenhum dinheiro é movido e as transações não têm valor financeiro** (`PaymentDto.simulated`, faixa na tela e no comprovante).
- **Opt-in duplo e proteção de produção:** `PAYMENT_PROVIDER=simulated` + `ALLOW_SIMULATED_PAYMENTS=true`. O schema do `.env` recusa a combinação em `NODE_ENV=production` (e a fábrica do módulo também), e o padrão do código continua `none`. A rota `POST /orders/:id/payments/demo-confirm` responde 404 com qualquer outro gateway.
- **Cenários de cartão** (crédito e débito) pelo `cardToken`: `sim_approved`, `sim_refused`, `sim_error` (falha antes de cobrar → 502). Nenhum dado de cartão é digitado; qualquer outro token é recusado.
- **Pix:** cobrança pendente com id `SIM-<referência>` e código `SIMULADO-NAO-PAGAVEL-…` (sem payload Pix real). O dono do pedido confirma pelo botão de demonstração; o simulador só marca a cobrança e quem muda pagamento/pedido continua sendo o `apply()` de sempre (lock, conferência de valor, evento Socket.IO).
- **Sem segunda fonte de verdade:** o ledger em memória é um espelho. Id desconhecido (reinício) é reconstruído da linha `payments` já aplicada; uma aprovação marcada no ledger e não gravada no banco some no reinício. Estorno, idempotência por referência, conciliação e permissões são as do fluxo real (nenhuma migration).
- **Limitação:** vale para uma instância da API. Trocar de provedor com pagamentos pendentes no banco exige limpá-los, pois cada provedor só conhece os próprios ids.


# Decisões técnicas — Sprint 2, blocos 2 e 3 (fichas 16, 44, 45, 46, 47, 53, 59, 60, 61)

Migrations novas: `20261011180000_sprint2_blocks_2_3` e `20261011190000_ranking_runs` (`pnpm db:migrate`). Dependência nova: `@simplewebauthn/server` (API) e `@simplewebauthn/browser` (web). Variável nova, opcional: `WEBAUTHN_RP_ID`.

## Mapa de mesas (16) e mescla (47)
- Estado da mesa por leitura: **chamado > ocupada > reservada > livre**. `occupancy` continua só `free/occupied` (a fila de espera depende dele); chamados (`table_calls`) e reservas (`table_reservations`) são tabelas próprias, com índice parcial: no máximo um chamado aberto e uma reserva ativa por mesa.
- Pagamento aprovado de pedido com mesa ocupa a mesa (ou o grupo) se estava livre, na mesma transação do pagamento; o número de pessoas fica 0 (a tela mostra "—") até o atendente informar. Liberar usa `WaitlistService.releaseTables`, então a fila continua avisando o próximo grupo.
- Tempo real: evento `tables.updated` para a equipe em qualquer mudança (chamado, ocupação, reserva, mescla, pedido/pagamento, planta). O app recarrega `GET /table-map`.
- Ações de mapa usam a permissão existente `tables.view` (atendente e gestor); mesclar/desfazer exige `floor.manage` (gestor). Não foi criada permissão nova.
- Mescla = `table_groups` + `dining_tables.group_id`: capacidade somada, estado agregado, ações valem para o grupo todo, desfazer apaga o grupo e cada mesa volta ao próprio estado. Excluir mesa da planta desfaz grupos com menos de duas mesas.
- Conta consolidada (`GET table-checks/:tableId`): pedidos pagos das mesas do grupo desde a ocupação (ou criação do grupo). Reaproveita pedidos/pagamentos; não há sistema de cobrança novo.

## Duplicar layout (61)
- Substituir mesas do destino (`replace`) é recusado (`TARGET_IN_USE`) se há mesa ocupada, chamado, reserva, pedido em andamento ou mesa mesclada. Exige `floor.manage` e o recurso `layout_duplication` na origem e no destino, mesma organização e vínculo do usuário com o destino. Transação com lock das duas plantas; a origem só é lida. Destino com mesas exige `replace: true`. QR Codes do destino são novos.

## Mais pedidos (46)
- Top 3 por casa pela quantidade vendida em pedidos com pagamento aprovado nos últimos 30 dias (cancelado/estornado não conta), gravado em `menu_item_rankings`. Recálculo semanal por verificação horária no processo + `ranking_runs` + lock no banco (sem cron externo; desligado com `NODE_ENV=test`). Destaque manual do gestor em `menu_items.highlighted`; o cardápio público traz `isTopOrdered` e `isHighlighted`.

## Conta (44, 45, 53, 59, 60)
- **Recuperação de senha:** reaproveita `otp_challenges` (`purpose=password_reset`): código de 6 dígitos, HMAC, 10 min, uso único, 5 tentativas. Conta inexistente, suspensa ou em cooldown recebe a mesma resposta (sem enumeração). Redefinir encerra todas as sessões e marca o contato como verificado.
- **Favoritos:** tabela `favorites` por conta; restaurante inativo some da lista, mas o favorito permanece.
- **Exclusão LGPD:** reautenticação por senha ou código enviado a contato verificado; anonimização imediata (nome, contatos, CPF, senha, endereços, vínculos sociais, favoritos, credenciais); pedidos permanecem sem identificação; bloqueada com pedidos em andamento (`ACTIVE_ORDERS`); contas da equipe não se autoexcluem; e-mail de confirmação ao endereço antigo. Sessões são revogadas (e IP/agente zerados) e códigos de login do contato apagados na mesma transação.
- **Biometria:** WebAuthn real (`@simplewebauthn/server`): credencial descobrível, verificação de usuário obrigatória, desafio de uso único com 5 min, conferência de origem (`WEB_ORIGIN`), RP ID e contador. Só a chave pública é guardada. Ativar = cadastrar credencial; desativar = removê-la. Login tradicional segue disponível.
- **Categorias:** `GET /restaurants?categories=a,b` (basta atender a uma) e `GET /restaurants/categories`; o antigo `category` continua valendo.

## Reserva do cliente (12), acesso em tempo real e estorno (decisões da fase final)
- **Reservar (12):** a reserva do cliente é uma entrada real na fila de espera do restaurante (ficha 21), não uma reserva de mesa (ficha 16, que é por mesa e feita pela equipe). `POST/GET/DELETE /restaurants/:id/reservation`: exige login de cliente, restaurante ativo e aberto agora, recurso `waitlist` no plano, uma entrada ativa por cliente (lock da fila + índice parcial único em `waitlist_entries.customer_id`), celular da conta ou informado. A equipe vê a entrada na fila (selo "Reserva online") e o cliente acompanha posição/aviso (consulta a cada 15 s; sem sala de tempo real para clientes). Limitação conhecida: logout de uma única sessão não derruba o socket dela até reconectar (eventos só levam ids; a API é quem autoriza). Excluir a conta tira a entrada da fila e anonimiza nome/celular.
- **Código de login para conta inexistente (`POST /auth/otp` → 404): mantido.** O cadastro (`POST /auth/register`) já revela se e-mail/celular existem (409), ambos limitados a 5/min por IP; resposta uniforme aqui só pioraria a mensagem de erro da ficha 06 sem fechar a enumeração. Login por senha continua uniforme (`INVALID_CREDENTIALS`). É um oráculo de enumeração conhecido e aceito (a redefinição de senha, sim, usa resposta uniforme).
- **Tempo real da equipe:** cada `subscribe` a uma sala de equipe confere no banco sessão ativa, usuário não suspenso, papel de equipe, ao menos uma permissão e vínculo atual. Mudança de papel/permissões/vínculos pelo admin tira as conexões abertas das salas da equipe na hora; suspensão derruba a conexão. Estabelecimento suspenso não é checado no socket: os eventos só dizem "o que mudou" e a API já devolve 403.
- **Estorno × avanço de etapa:** `advanceStatus` roda sob o mesmo lock `order:<id>` do estorno e recusa (409 `REFUND_IN_PROGRESS`) pedido com estorno pedido e não concluído; assim nunca fica entregue/pronto e estornado. Efeito colateral aceito: estorno incerto bloqueia o avanço até ser repetido/conciliado.
- **Biometria em conta sem senha (59):** exige código enviado ao contato verificado (`POST /auth/webauthn/register/code`, finalidade `passkey_registration`, uso único) em `register/options`; contas com senha seguem confirmando a senha.
- **Abertura por link de mesa (02):** com `?mesa=` a vinheta inicial dura 250 ms (aguardando a sessão); o início normal mantém 1,8 s. O tempo de 1,8 s era o que dominava link→cardápio, não a API.
- **`THROTTLE_DISABLED`:** faz parte do schema do ambiente e é recusado com `NODE_ENV=production` (e ignorado pelo throttler em produção).
- **Limitações conhecidas:** dos limites de plano só `maxTables` é aplicado (unidades e equipe não são verificados na criação); sem provider de SMS (`SMS_PROVIDER=none`) o aviso de "mesa pronta" da fila não é entregue — fica registrado como `skipped` e a equipe avisa presencialmente (vale também para o cliente que reservou pelo app: a posição/aviso aparece na tela dele); logout de uma única sessão não derruba o socket dela.

## Não verificado
- Entrega real de SMTP/SMS; WebAuthn em aparelho/navegador real (testes usam autenticador de software); recálculo semanal em tempo real (testado com relógio injetado).
