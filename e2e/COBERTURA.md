# Matriz de cobertura — fichas × implementação × testes

Fonte dos critérios: **PDF das fichas** (`FilaZero_Fichas_Sprint1_Sprint2_Completo.pdf`, 29 páginas; lido página a página).
Nenhum critério foi inventado. O README do projeto **não** foi usado como critério.
Legenda: ✅ coberto · 🟡 parcial · ❌ ausente/não atendido · **NV** = *não verificado* (precisa de hardware/serviço externo).
Testes: `S1-*`/`A*`…`G*` = Playwright em `e2e/**` (navegador real + API real + PostgreSQL `filafacil_e2e`);
`API:` = testes de integração da API (`apps/api/test/integration`, banco `filafacil_test`, dono: impl); `PERF` = `e2e/perf`; `THR` = `e2e/throttle`.
Simulado = pagamento (gateway simulado), SMS/e-mail (provider `dev`: texto no log da API), biometria (autenticador virtual do Chromium), câmera do QR (vídeo falso), GPS (geolocalização emulada).

> Estado desta matriz: **12/out/2026**. Matriz de rastreabilidade: critério do PDF → implementação → teste.

## Sprint 1 (PDF pp. 1–15)

| Ficha | Tarefas (PDF) | Critério de avaliação (PDF) | Implementação | Testes | Status |
|---|---|---|---|---|---|
| **01** Cadastro nome+CPF (p.1) | formulário; validar CPF; guardar com segurança; tela de login e perfil | CPF inválido é bloqueado; dados salvos são reconhecidos em pedidos futuros | `auth/*` (CPF HMAC + criptografia), `SignupScreens`, `ProfileScreens` | S1-01, S1-01b (CPF inválido/duplicado, CPF protegido no banco), S1-13 (dados do perfil usados depois), A1 (dados do cliente no pedido); API: auth.spec | ✅ |
| **03** Menu de lanches (p.2) | cadastrar itens; upload de fotos; categorias; busca/filtro | todo item mostra foto, nome, descrição, preço; cardápio carrega em ≤ 2 s | `menu/*`, `MenuScreens`, `MenuSection` | S1-11/12/03 (campos, categorias, busca, ≤2 s aquecido), E1 (cadastro com foto pela UI), **PERF P03** (frio 74 ms, quente 45 ms) | ✅ |
| **06** Login (celular, e-mail, Google, Apple) (p.3) | tela login; login social; validar credenciais/erros; sessão ativa | entra em ≤ 3 tentativas por qualquer método, sem perder pedidos/pontos | `auth/*`, `LoginScreens`, `oauth.service` | S1-06 (erro genérico, sessão persiste, logout), S1-06b (código por SMS/e-mail, uso único), S1-SEC, THR T1–T2b; **Google/Apple: NV** (sem credenciais OAuth no ambiente; o app informa "ainda não está disponível" — testado) | 🟡 (social **NV**) |
| **11** Buscar restaurantes próximos (p.4) | geolocalização; listar por distância; filtros (aberto agora, mais próximos, menor espera); mapa | busca ordenada por distância em ≤ 2 s com status "aceitando pedidos" visível | `restaurants/*`, `ExploreScreen`, `deviceService` | S1-11/12/03 (ordem por distância, status, mapa, "Aberto agora"), **S1-11b** (geolocalização emulada → lat/lng na requisição, ordem exibida = ordem da API, "Menor espera" `sort=wait`, "Aberto agora", permissão negada → região manual), **PERF P11/P11b** (frio/quente, prod; o critério é a latência da BUSCA — clique → lista; a abertura do app, ~2,5 s com splash em lançamento simples, é só registrada). GPS real: **NV** (emulado) | ✅ |
| **12** Página do restaurante (p.5) | galeria + nota; endereço + "como chegar"; horário do dia; botões "ver cardápio" e "reservar" | informações batem com os dados do gestor | `RestaurantDetailScreen`, `ReservationSheet`, `waitlist/reservations.controller` | S1-11/12/03 (nota, galeria, endereço, "Como chegar", horário, "Ver cardápio"), **S1-12** (reservar: UI→API→banco→fila da equipe em tempo real→SMS simulado→cancelar; negativas), **S1-12b** (visitante, sem celular, casa fechada); API: reservations.spec | ✅ (defeito #1 corrigido pelo impl: sheet z-50) |
| **13** Perfil do usuário (p.6) | tela de perfil; editar nome/e-mail/telefone; endereços; atalhos para pedidos e reservas | alterações salvas e refletidas em pedidos futuros | `ProfileScreens`, `me/*` | S1-13 (nome, e-mail duplicado, endereços CRUD+padrão único), S1-13b, **S1-13c** (e-mail e telefone pela UI, reflexo na reserva/pedido); **F3** (Minhas reservas: lista, posição, pessoas, isolamento, some ao cancelar) | ✅ (defeito #2 corrigido) |
| **19** Disponibilidade do cardápio (p.7) | toggle por item; refletir em tempo real; reativar; histórico | item desativado some do cardápio do cliente em ≤ 5 s e não vai ao carrinho | `menu/availability`, `AttendantApp` | E2 (toggle, histórico com autor/hora, cliente não adiciona; ≤ 5,5 s), A10 (item esgotado no carrinho: UI avisa e bloqueia), E6 (permissões) | ✅ |
| **20** Planta do salão (p.8) | editor arrastar/soltar; formato e capacidade; salvar por estabelecimento; sincronizar com mapa do atendente | mesa reposicionada aparece na mesma posição no mapa do atendente, sem reconfiguração | `floor-plan/*`, `FloorPlanSection` | E4 (teclado, capacidade, versão/conflito, limites do plano), **S1-20b** (arrastar com o mouse, formato, criar/remover mesa pela UI; atendente em tempo real; QR único), E5 | ✅ |
| **21** Fila de espera (p.9) | tela com nome/tamanho; estimar espera; notificar quando mesa pronta; remover/reordenar | ao liberar mesa compatível, o próximo da fila é notificado automaticamente em ≤ 10 s | `waitlist/*`, `WaitlistSection` | S1-21 (adicionar, reordenar, avisar, remover, posições únicas, concorrência), **S1-21b** (só avisa quem cabe, estimativa presente, SMS simulado ≤ 10 s medido, mascaramento do telefone, sentar ocupa a mesa, próximo compatível); **SMS real: NV** | ✅ |
| **28** Cadastro e edição de cardápio (p.10) | tela de gestão; criar/editar/excluir; categorias; preço/foto/descrição | alteração do gestor reflete no cardápio do cliente em ≤ 1 min sem atualizar | `menu/*`, `MenuSection` | E1 (criar/editar/excluir + foto pela UI; cliente vê em tempo real; validação) | ✅ |
| **29** Promoções (p.11) | tela de cadastro; item/desconto/período; aplicar automaticamente; encerrar automaticamente | aparece no cardápio durante o período e some ao expirar | `promotions/*`, `PromotionsSection` | S1-29/31 (API: vigente/futura/expirada, validações, plano), **S1-29b** (criação pela UI → selo e preço riscado no cardápio do cliente → promoção que termina em 6 s encerra sozinha, continua cadastrada, estado `expired`) | ✅ |
| **31** Fichas técnicas (p.12) | ficha vinculada ao item; ingredientes/quantidade/custo; custo total automático; alerta acima do limite | mudança no preço de um ingrediente recalcula o custo de todos os pratos que o usam | `technical-sheets/*`, `RecipesSection` | S1-29/31 (API), **S1-31b** (pela UI: alerta "Custo acima do limite", edição de insumo, recálculo de todos os pratos, UI reflete) | ✅ |
| **34** Estabelecimentos (admin) (p.13) | listagem; cadastro/edição/desativação; vincular organização; status | desativado deixa de aceitar pedidos e some das buscas | `admin/establishments`, `AdminApp` | S1-34/36/37 (UI+API), S1-11 (inativo/suspenso fora da busca), **S1-34b** (inativo e suspenso: pedido novo 404, pagar pedido existente 422 `ESTABLISHMENT_NOT_ACCEPTING_ORDERS`, nada cobrado, reativar volta a aceitar); A6 cobre só "pedidos pausados" | ✅ |
| **36** Usuários da plataforma (admin) (p.14) | listagem com filtro por papel; editar papéis/permissões; suspender/reativar; histórico | usuário suspenso perde acesso imediato, refletido em qualquer sessão ativa | `admin/users`, `session.service`, `realtime.gateway` | S1-34/36/37, S1-RT (cliente suspenso), **F2** (atendente que perde todas as permissões deixa de receber eventos em tempo real e a API passa a dar 403; colega com permissão segue recebendo; suspensão → "Acesso suspenso" sem recarregar; auditoria), S1-RBAC; API: admin.spec, realtime.spec | ✅ |
| **37** Planos de assinatura (admin) (p.15) | cadastro de planos; preço/limites/recursos; vincular; bloquear recursos fora do plano | migrar de plano ganha/perde recursos imediatamente, sem deploy | `admin/plans`, `entitlements` | S1-34/36/37 (efeito imediato), S1-29/31 (Cantina/Start sem promoções), E4 (limite de mesas), E5 (`FEATURE_NOT_IN_PLAN`) | ✅ |

## Sprint 2 (PDF pp. 16–29)

| Ficha | Tarefas (PDF) | Critério de avaliação (PDF) | Implementação | Testes | Status |
|---|---|---|---|---|---|
| **02** QR Code (p.16) | QR único por mesa; leitor no app; vincular pedido à mesa; tratar QR inválido/bar fechado | ao escanear, cai no cardápio da mesa certa em ≤ 3 s com pedido associado | `tables/*`, `QRScreens`, `useQrScanner` | G1 (unicidade, QR do painel decodificado), G2 (leitor com câmera virtual), C1/C1b, C2/A1 (mesa no pedido), **H1–H3** (regressão do link: 10 reaberturas na mesma página, rede lenta, visitante, inválido, casa fechada; repetido 5× sem falhas), **PERF P02** (prod: mediana 1,08 s, p95 1,11 s após encurtar o splash do link de mesa; antes 2,57 s / 2,72 s). Câmera real: **NV** | ✅ |
| **04** Pagamento (p.17) | gateway; Pix e cartão; comprovante digital; falhas e estorno | aprovado atualiza o status na hora e gera comprovante no histórico | `payments/*` (gateway **simulado**; Mercado Pago só com credenciais) | A1, A2, A3, A4, A8, A9, B3 (estorno), API: payments/payment-consistency/simulated-payments. **Gateway real/Pix real: NV** | ✅ simulado / **NV** real |
| **08** Carrinho (p.18) | itens/quantidades; editar/remover; total em tempo real; confirmar | alteração atualiza o total instantaneamente antes de confirmar | `CheckoutScreens` | A1 (total ao vivo), A10, A11, A5 (pedido inválido recusado) | ✅ |
| **09** Acompanhar status (p.19) | linha do tempo; status em tempo real; estimativa e local de retirada; resumo | mudança na cozinha reflete em ≤ 5 s sem recarregar | `orders/*`, `OrderScreens`, `realtime` | B1 (latências medidas), B2 (fallback por polling), A1, A12 (local de retirada/mesa) | ✅ |
| **16** Mapa de mesas (p.20) | grade com cores por status; tempo real; nº de pessoas; destacar chamados | status muda em ≤ 3 s após pedido/chamado/pagamento | `AttendantApp`, `tables/*` | C2, C3, C4, C5, C7 (cores distintas); ≤ 3 s medidos | ✅ |
| **44** Recuperação de senha (p.21) | tela; link/código por e-mail/SMS; validar e criar nova senha; expirar | link expira em ≤ 30 min; define nova senha e entra imediatamente | `auth/otp`, `ForgotPasswordScreen` | D3, D3b, D3c (@slow: expiração real 10 min), THR T5 (limites); e-mail/SMS: simulados (log). **Entrega real: NV** | ✅ simulado |
| **45** Favoritar (p.22) | ícone na lista e no detalhe; aba Favoritos; sincronizar com a conta; remover com um toque | aparece na aba em ≤ 1 s e persiste ao trocar de aparelho | `favorites/*` | D1 | ✅ |
| **46** Itens mais pedidos (p.23) | calcular por estabelecimento; selo "+ pedido"; atualizar periodicamente; destaque manual | selo nos itens de maior volume dos últimos 30 dias, recalculado toda semana | `menu-ranking.service` | E3 (top-3 por vendas pagas, recalcular, estorno exclui, destaque manual, cliente vê selo); API (impl): janela de 30 dias/recálculo semanal com relógio injetado. **Passagem real de uma semana: NV** (determinístico só por relógio injetado na API) | 🟡 recálculo semanal só em API |
| **47** Mesclar mesas (p.24) | selecionar 2+ mesas; capacidade total; desfazer; refletir no mapa | mescladas aparecem como uma unidade e voltam ao original ao desfazer | `tables/merge`, `FloorPlanSection` | C6 | ✅ |
| **53** Exclusão de conta (LGPD) (p.25) | fluxo de solicitação; autenticação adicional; anonimizar/remover; e-mail de confirmação | dados removidos/anonimizados em ≤ 30 dias | `account-deletion.service` (imediato) | D4, D4b; API: account-deletion.spec. E-mail real: **NV** (simulado) | ✅ |
| **59** Login por biometria (p.26) | biometria nativa do SO; ativar/desativar; apenas atalho; tratar falha | entra em < 2 s sem digitar | `webauthn.*`, `account-security` | D5 (autenticador virtual WebAuthn: < 2 s), D5b (falha → retry/fallback), **F1** (conta sem senha: código de contato verificado obrigatório — `REAUTH_REQUIRED`, errado não registra, código de uso único, login < 2 s); API: webauthn.spec. **Face ID/Touch ID reais: NV** | ✅ virtual / **NV** hardware |
| **60** Filtro por categoria (p.27) | cadastrar categorias; filtro na busca; várias ao mesmo tempo; atualizar em tempo real | filtra corretamente em ≤ 1 s sem recarregar | `restaurants/categories` | D2 | ✅ |
| **61** Duplicar layout (p.28) | planta como modelo; copiar para outra unidade da organização; ajustes; original intacta | cópia fiel (posição e capacidade), pronta para ajustes | `floor-plan/duplicate` | E5; API: layout-duplication.spec | ✅ |
| **65** Verificação e-mail/telefone (p.29) | enviar código; bloquear funções sensíveis; reenviar após tempo mínimo; marcar verificada | só o código correto verifica; não verificada não paga | `contact-verification` | S1-01, S1-01b, A7, D3b (cooldown 42 s); API: contact-verification.spec | ✅ |

## Segurança e limites de requisição (projeto `throttle`, `pnpm e2e:throttle`)

Limites conferidos em `apps/api/src/modules/auth/auth.controller.ts` (`@Throttle`) e `login-attempts.service.ts`; execução real em 12/out/2026 (7 testes passando, ~6 min):

| Teste | O que prova |
|---|---|
| THR T1 | login: 10/min por IP — exatamente 10 passam, a 11ª = 429 `TOO_MANY_REQUESTS` + `Retry-After` ≤ 61, credencial válida também bloqueada e **nenhuma sessão criada**; bloqueio termina em ~60 s |
| THR T2 | 5 senhas erradas → 429 `TOO_MANY_LOGIN_ATTEMPTS` (15 min, em memória); senha certa e variação de caixa do e-mail também bloqueadas; outra conta no mesmo IP entra; **login por código (OTP) segue disponível**. *Fim dos 15 min: NV (não esperado em tempo real)* |
| THR T2b | senha certa zera o contador (4 erradas + 1 certa + 4 erradas não bloqueia) |
| THR T3 / T4 | `/auth/otp` 5/min e `/auth/otp/verify` 10/min por IP: 429 e recuperação |
| THR T5 | recuperação de senha: pedido 5/min e confirmação 10/min |
| THR T6 | cadastro 5/min (429 mesmo com dados válidos; nada gravado) |

`TRUST_PROXY=loopback`: chamadas vindas de loopback honram `X-Forwarded-For`; por isso o E2E local não consegue provar "IP forjado não escapa do limite" (**NV**; em produção o `trust proxy` deve apontar só para o balanceador).
Correções de segurança do impl cobertas em `e2e/sprint2/f-security.spec.ts`: F1 (passkey sem senha exige código), F2 (realtime após revogação/suspensão). `/auth/otp` para conta inexistente continua 404 **por decisão documentada** do impl (docs/decisoes.md; `/auth/register` já revela existência) — registrado, não é teste. `REFUND_IN_PROGRESS` (409 ao avançar pedido com estorno pendente): **NV no E2E** (o gateway simulado não falha o estorno; coberto só nos testes de API com gateway falso).

## Desempenho (projeto `perf`, `pnpm e2e:perf`)

Medido em build de produção (`vite preview` :5181 + API compilada), n = 10, contextos novos (frio) e mesma página (quente), M2 / 8 GB, load ≈ 3,5:

| Ficha | Meta | Frio (mediana / p95) | Quente (mediana / p95) | Veredito |
|---|---|---|---|---|
| 11 abrir busca → lista + status | ≤ 2 s | 56 / 89 ms | 21 / 23 ms | ✅ (API `/restaurants` 3–4 ms) |
| 03 "Ver cardápio" → itens com foto/preço | ≤ 2 s | 73 / 77 ms | 45 / 47 ms | ✅ |
| 02 link do QR → cardápio da mesa | ≤ 3 s | **1076 / 1107 ms** (antes do ajuste do splash: 2570 / 2718) | 875 / 887 ms | ✅ folga de ~1,9 s; a causa era o temporizador artificial do *splash* (`EntryScreens.tsx`), agora 250 ms em links de mesa |

Caveat: laptop de desenvolvimento com Postgres em Docker, API, web e Chromium no mesmo host; é limite superior, não SLA.

## Defeitos reportados (todos corrigidos pelo impl)

1. Ficha 12 — botão "Confirmar reserva" coberto pela barra inferior → corrigido (z-50); S1-12/S1-12b passam.
2. Ficha 13 — atalho de reservas → "Minhas reservas" (F3).
3. Ficha 02 — link do QR perdido de forma intermitente (efeito colateral na renderização + navegação concorrente do splash): corrigido pelo impl; regressão H1–H3. Splash de 1,8 s → 250 ms com `?mesa=`; re-medido: frio mediana 1076 ms / p95 1107 ms (antes 2570 / 2718).

## Lacunas conhecidas / não verificáveis

Google/Apple (credenciais), SMS/e-mail reais, gateway/Pix reais, Face ID/Touch ID, câmera real do QR, GPS real, recálculo semanal em tempo real, fim do bloqueio de 15 min por conta, `X-Forwarded-For` atrás de balanceador.
