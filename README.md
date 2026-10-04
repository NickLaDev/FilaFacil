# FilaFacil

Sistema de gerenciamento de filas e pedidos para bares e restaurantes. O cliente encontra o estabelecimento, consulta o cardápio, escaneia o QR Code da mesa, faz o pedido e acompanha o preparo; a equipe controla cardápio, salão e fila; a administração cuida de estabelecimentos, usuários e planos.

Este é o repositório único do projeto (monorepo pnpm):

- **Sprint 1** — frontend + **backend real** (API NestJS, PostgreSQL, autenticação, autorização, tempo real e testes).
- **Sprint 2** — frontend pronto; os dados dessas fichas ainda são simulados no navegador até o backend correspondente.

> A interface exibe a marca **FilaZero**, nome usado no protótipo e nas fichas. Para trocar, altere `apps/web/src/config/brand.ts`, `apps/api/src/common/brand.ts` e o `<title>` de `apps/web/index.html`.

## Sumário

- [Organização do repositório](#organização-do-repositório)
- [Stack](#stack)
- [Como rodar (do zero)](#como-rodar-do-zero)
- [Scripts](#scripts)
- [Contas de desenvolvimento](#contas-de-desenvolvimento)
- [Perfis e rotas](#perfis-e-rotas)
- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [API](#api)
- [Banco de dados](#banco-de-dados)
- [Segurança](#segurança)
- [Testes](#testes)
- [Dependências externas](#dependências-externas)
- [O que ainda é simulado](#o-que-ainda-é-simulado)

## Organização do repositório

```
.
├── apps/
│   ├── web/              # Frontend React (@filafacil/web)
│   └── api/              # API NestJS + Prisma (@filafacil/api)
├── packages/
│   └── shared/           # Validações, catálogo de permissões/recursos e contratos da API
├── infra/postgres/       # Inicialização do Postgres (cria o banco de teste)
├── docs/                 # Decisões técnicas
├── scripts/              # Utilitários (geração do .env local)
├── compose.yaml          # PostgreSQL para desenvolvimento
├── .env.example          # Todas as variáveis, documentadas
└── pnpm-workspace.yaml
```

## Stack

| Camada | Tecnologias |
|---|---|
| Frontend | React 19, TypeScript strict, Vite 8, Tailwind CSS v4, TanStack Query, Socket.IO client |
| API | Node.js 22+, NestJS 12 (ESM), TypeScript strict, class-validator, Swagger/OpenAPI, Socket.IO |
| Banco | PostgreSQL 18, Prisma 7 (migrations versionadas) |
| Segurança | Argon2id, JWT (jose) + refresh token rotacionado, cookies HttpOnly, helmet, rate limit, OIDC (openid-client) |
| Imagens | sharp (validação e reencode para WebP) com storage plugável |
| Testes | Vitest + Supertest contra PostgreSQL real |

## Como rodar (do zero)

Requisitos: **Node.js 22.12+**, **pnpm 11** (`corepack enable`) e **Docker**.

```bash
git clone https://github.com/NickLaDev/FilaFacil.git
cd FilaFacil
pnpm install          # instala tudo e gera o cliente Prisma e o pacote shared
pnpm setup:env        # cria o .env com senhas e segredos aleatórios
docker compose up -d  # PostgreSQL (bancos filafacil e filafacil_test), com healthcheck
pnpm db:migrate       # aplica as migrations
pnpm db:seed          # dados de demonstração
pnpm dev              # API em :3000 e frontend em :5173
```

- Frontend: http://localhost:5173 (o Vite encaminha `/api` e o WebSocket para a API)
- Documentação da API: http://localhost:3000/api/docs
- Saúde: http://localhost:3000/api/health

Os dados ficam no volume Docker `filafacil_postgres-data`: fechar o navegador, reiniciar a API ou o computador não apaga nada. `pnpm db:seed` pode ser rodado de novo a qualquer momento — ele restaura os dados de demonstração sem apagar o que foi criado pela interface.

## Scripts

| Script | O que faz |
|---|---|
| `pnpm dev` | API (watch) + frontend (HMR) |
| `pnpm dev:web` / `pnpm dev:api` | Só um dos apps |
| `pnpm build` | Build de produção de todos os pacotes |
| `pnpm typecheck` | TypeScript de todos os pacotes (inclui os testes da API) |
| `pnpm lint` | ESLint de web e API |
| `pnpm test` | Testes da API (unitários + integração no banco `filafacil_test`) |
| `pnpm db:up` | `docker compose up -d --wait` |
| `pnpm db:migrate` | Aplica migrations (`prisma migrate deploy`) |
| `pnpm db:migrate:dev` | Cria nova migration a partir do schema (desenvolvimento) |
| `pnpm db:seed` | Seed de desenvolvimento (idempotente) |
| `pnpm setup:env` | Gera o `.env` local (`--force` para recriar) |

## Contas de desenvolvimento

Todas com a senha **`FilaFacil123`** (somente desenvolvimento — o seed se recusa a rodar com `NODE_ENV=production`).

| Perfil | E-mail | Observação |
|---|---|---|
| Admin | `admin@filazero.app` | Painel `/admin` |
| Gestor | `lucas@bardomestre.com.br` | Bar do Mestre, Bar do Mestre 2 e Express (plano Business) |
| Gestor | `paula@cantina.edu.br` | Cantina Universitária (plano Start: sem promoções e fichas) |
| Gestor | `ze@grupodoze.com.br` | Lancheria do Zé e Bar do Zé (plano Pro) |
| Atendente | `carlos@bardomestre.com.br` | Bar do Mestre — painel `/atendente` |
| Atendente suspensa | `mariana@bardomestre.com.br` | Login bloqueado (teste de suspensão) |
| Cliente | `joao@email.com` | Celular `(19) 99999-9999`, CPF `529.982.247-25`, 2 endereços |

**Login por celular/e-mail com código:** em desenvolvimento o código (aleatório, 6 dígitos) aparece no **terminal da API** (`[SMS dev]` / `[E-mail dev]`). Não existe código fixo.

Os fluxos simulados da Sprint 2 (confirmação de contato, recuperação de senha, exclusão de conta) aceitam o código `123456` e não alteram nada no servidor.

## Perfis e rotas

| Rota | Perfil | Acesso |
|---|---|---|
| `/` | Cliente | Web app mobile; visitante navega sem login |
| `/atendente` | Atendente | Login de equipe (atendente ou gestor) |
| `/gestor` | Gestor | Login de equipe (gestor) |
| `/admin` | Admin | Login de equipe (admin) |

Em `pnpm dev`, o botão **DEV** alterna entre os perfis. Os perfis compartilham os cookies do navegador: para ficar logado com contas diferentes ao mesmo tempo, use janelas anônimas ou perfis distintos.

## Funcionalidades

### Sprint 1 — com backend

| Ficha | O que está implementado |
|---|---|
| 01 · Cadastro por nome e CPF | CPF validado (dígitos verificadores) no front e no servidor; duplicidade bloqueada pelo servidor; CPF guardado protegido (HMAC + AES-256-GCM) |
| 03 · Menu de lanches | Cardápio com foto, descrição, preço, categorias, busca e filtro; só itens disponíveis; preço vigente calculado no servidor |
| 06 · Login | E-mail e senha (Argon2id), celular ou e-mail com código de uso único, Google e Apple (OIDC, quando configurados); sessão persistente |
| 11 · Restaurantes próximos | Busca por distância (Haversine) com filtros aberto agora, mais próximos e menor espera; status "aceitando pedidos"; mapa pelas coordenadas reais |
| 12 · Página do restaurante | Galeria, nota, endereço com "Como chegar" (coordenadas), horário do dia no fuso da casa, cardápio |
| 13 · Perfil | Edição de nome, e-mail e celular; endereços salvos (um padrão por conta) |
| 19 · Disponibilidade (atendente) | Esgotar/reativar item com histórico (quem e quando); o cliente recebe a mudança por WebSocket em segundos |
| 20 · Planta do salão | Editor com arrastar e soltar, formato e capacidade; gravação versionada (conflito → 409); limite de mesas do plano; mesmo layout no mapa do atendente |
| 21 · Fila de espera | Fila por estabelecimento com posição única sob lock transacional, reordenação, estimativa pelas mesas livres e aviso automático ao liberar mesa (SMS por adapter) |
| 28 · Cadastro de cardápio | CRUD com categorias, preço em centavos e upload de foto (validado e convertido para WebP) |
| 29 · Promoções | Por período (UTC), aplicadas e encerradas pelo próprio período, sem job; o preço original nunca muda |
| 31 · Fichas técnicas | Insumos com custo Decimal e fichas por item; custo, percentual e alerta calculados pelo servidor e recalculados a cada leitura |
| 34 · Estabelecimentos (admin) | Listagem paginada, cadastro/edição (coordenadas, horários, galeria), organização, plano e status ativo/inativo/suspenso |
| 36 · Usuários (admin) | Filtro por papel, edição de papel, permissões e vínculos, suspensão com perda imediata de acesso, histórico com antes e depois |
| 37 · Planos (admin) | CRUD de planos, preço, limites e recursos; trocar o plano libera ou bloqueia recursos na API na hora |

### Sprint 2 — frontend pronto, dados ainda simulados

QR Code da mesa (02), pagamento (04), carrinho (08), acompanhamento do pedido (09), mapa de mesas com reservada/chamado (16), recuperação de senha (44), favoritos (45), "+ pedido" (46), mesclagem de mesas (47), exclusão LGPD (53), biometria (59), filtro múltiplo de categorias (60), duplicação de planta (61, usando a gravação de planta da Sprint 1) e verificação de contato (65). Detalhes em [O que ainda é simulado](#o-que-ainda-é-simulado).

## Arquitetura

### Frontend (`apps/web`)

- Cada perfil é um app carregado sob demanda (`React.lazy`), com chunk próprio.
- **Camada de serviços** (`src/services/`): única forma de as telas acessarem dados. Hooks do TanStack Query sobre o cliente HTTP central (`src/lib/api/client.ts`), que cuida de base URL (`VITE_API_URL`), cookies, header anti-CSRF, parsing de erro e renovação de sessão (uma única chamada de refresh por vez; 401 → refresh → repete).
- **Tempo real** (`src/lib/realtime.ts`): uma conexão Socket.IO; as telas assinam salas e recarregam os dados pela API quando chega um evento ou quando a conexão volta.
- Os serviços da Sprint 2 continuam no navegador (`accountExtrasService`, `orderService` e partes de `floorService`), isolados e identificados.

### API (`apps/api`)

```
src/
├── config/        # .env validado com zod no boot (falha rápido)
├── common/        # Erros padronizados, pipes, CSRF, paginação, horário/fuso, preço
├── database/      # PrismaService (driver adapter pg) e lock transacional
└── modules/
    ├── auth/              # Cadastro, login, OTP, OAuth, sessões, cookies, guard global
    ├── me/                # Perfil e endereços
    ├── access/            # Autorização: vínculo + permissão + recurso do plano (entitlements)
    ├── restaurants/       # Busca, página e cardápio público
    ├── menu/              # Cardápio da equipe, foto e disponibilidade
    ├── promotions/        # Promoções
    ├── technical-sheets/  # Insumos e fichas técnicas
    ├── floor-plan/        # Planta do salão
    ├── waitlist/          # Fila de espera e liberação de mesas
    ├── establishments/    # Plano vigente (equipe)
    ├── admin/             # Estabelecimentos, organizações, usuários, auditoria, planos
    ├── realtime/          # Gateway Socket.IO e emissor de eventos
    ├── notifications/     # Adapters de SMS/e-mail (dev = log)
    └── storage/           # FileStorage (local) + validação de imagens
```

Os controllers só recebem e validam, e delegam; as regras ficam nos services. Decisões técnicas detalhadas em [`docs/decisoes.md`](docs/decisoes.md).

### Autenticação

- **Sessão:** o login cria uma linha em `sessions` e define dois cookies HttpOnly + SameSite=Lax (Secure em produção): `ff_access` (JWT HS256, 10 min, `Path=/api`) e `ff_refresh` (token opaco aleatório, 30 dias, `Path=/api/auth`). O banco guarda só o SHA-256 do refresh token.
- **Refresh:** rotação a cada uso. O token anterior vale por 30 s (abas concorrentes); depois disso, reapresentá-lo revoga a sessão (detecção de roubo).
- **Revogação:** toda requisição confere a sessão e o status do usuário no banco. Logout, "sair de todos os aparelhos" e suspensão valem na hora, sem esperar o JWT expirar. A suspensão também derruba as conexões WebSocket do usuário com o evento `session.revoked`.
- **E-mail e senha:** Argon2id (parâmetros OWASP), mensagem única para e-mail inexistente ou senha errada (com verificação de tempo constante) e limite de 5 erros por conta em 15 min, além do rate limit por IP.
- **Código (OTP):** 6 dígitos gerados com CSPRNG e guardados como HMAC ligado ao desafio. Expira em 10 min, aceita no máximo 5 tentativas, exige 42 s entre envios, limita a 5 por hora e é de uso único.
- **Google/Apple:** Authorization Code + PKCE + state + nonce (state guardado no banco, uso único). Sem credenciais no `.env`, a API responde `PROVIDER_NOT_CONFIGURED` e o app mostra o aviso; não existe login social simulado.

### Autorização

- Papéis `client`, `attendant`, `manager` e `admin`, mais permissões por usuário (catálogo em `packages/shared`) e **vínculos** (`establishment_memberships`).
- Rotas `/api/establishments/:establishmentId/...` passam pelo `EstablishmentAccessGuard`: o id da rota só vale se o usuário for da equipe daquele estabelecimento. Depois são conferidos o status do estabelecimento (suspenso bloqueia a equipe), a permissão exigida e o recurso do plano. Recursos de outro estabelecimento respondem 404 (sem IDOR).
- Os recursos de plano ficam em `plan_features` e são checados por `@RequireAccess([...], 'promotions')`; não há `if (plano === ...)` no código.
- Rotas `/api/admin/*` exigem papel admin e a permissão de plataforma correspondente. O admin não altera nem suspende a própria conta, e a plataforma nunca fica sem admin ativo.

### Tempo real

| Evento | Sala | Quando |
|---|---|---|
| `menu.updated` | `restaurant:{id}` e `staff:{id}` | Item criado, editado ou excluído; disponibilidade; promoção; plano ou status |
| `availability.changed` | `staff:{id}` | Esgotar/reativar item |
| `restaurant.updated` | `restaurant:{id}` | Dados públicos, status, fotos |
| `establishment.updated` | `staff:{id}` | Plano ou status (o painel recarrega os recursos liberados) |
| `floor-plan.updated` | `staff:{id}` | Planta salva, mesas liberadas ou ocupadas |
| `waitlist.updated` | `staff:{id}` | Qualquer mudança na fila |
| `session.revoked` | `user:{id}` | Suspensão ou logout em todos os aparelhos |

O payload só diz o que mudou; o app busca o estado novo pela API, que é a fonte da verdade. As salas de equipe exigem sessão válida e vínculo, e o handshake confere o `Origin`.

## API

Documentação completa e interativa em **`/api/docs`** (OpenAPI em `/api/docs/openapi.json`). Resumo:

| Recurso | Endpoints |
|---|---|
| Autenticação | `POST /auth/register`, `POST /auth/login`, `POST /auth/otp`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/providers`, `GET /auth/oauth/:provider` (+ callback) |
| Perfil | `GET/PATCH /me`, `GET/POST /me/addresses`, `PATCH/DELETE /me/addresses/:id` |
| Cliente | `GET /restaurants`, `GET /restaurants/:id`, `GET /restaurants/:id/menu` |
| Equipe · plano | `GET /establishments/:id/plan` |
| Equipe · cardápio | `GET /establishments/:id/menu/items`, `GET …/menu/categories`, `POST …/menu/items`, `PATCH/DELETE …/menu/items/:itemId`, `PUT …/menu/items/:itemId/photo`, `PATCH …/menu/items/:itemId/availability`, `GET …/menu/availability-history` |
| Equipe · promoções | `GET/POST /establishments/:id/promotions`, `PATCH/DELETE …/promotions/:promotionId` |
| Equipe · fichas | `GET/POST /establishments/:id/ingredients`, `PATCH/DELETE …/ingredients/:ingredientId`, `GET …/technical-sheets`, `PUT/DELETE …/technical-sheets/:menuItemId` |
| Equipe · salão e fila | `GET/PUT /establishments/:id/floor-plan`, `POST …/floor-plan/tables/release`, `GET/POST …/waitlist`, `PATCH …/waitlist/:entryId/position`, `POST …/waitlist/:entryId/notify`, `POST …/waitlist/:entryId/seat`, `DELETE …/waitlist/:entryId` |
| Admin | `GET/POST /admin/establishments`, `GET/PATCH /admin/establishments/:id`, `PATCH …/status`, `PUT …/plan`, `POST/DELETE …/photos`, `GET/POST /admin/organizations`, `GET /admin/users`, `GET /admin/users/:id`, `PATCH …/access`, `PATCH …/status`, `GET /admin/permission-audit`, `GET/POST /admin/plans`, `PATCH/DELETE /admin/plans/:id` |

Os erros seguem sempre o formato `{ statusCode, code, message, details? }` (400, 401, 403, 404, 409, 413, 422, 429, 503), sem stack trace. Datas em ISO 8601 (UTC); dinheiro em centavos; custos de insumo e quantidades como string decimal.

## Banco de dados

Schema em `apps/api/prisma/schema.prisma` e migrations em `apps/api/prisma/migrations`, que incluem índices únicos parciais e CHECK constraints que o Prisma não expressa.

| Grupo | Tabelas |
|---|---|
| Identidade | `users`, `user_permissions`, `establishment_memberships`, `user_addresses`, `sessions`, `otp_challenges`, `auth_accounts`, `oauth_states` |
| Estabelecimentos | `organizations`, `establishments`, `establishment_photos`, `opening_hours` |
| Planos | `plans`, `plan_features` |
| Cardápio | `menu_categories`, `menu_items`, `menu_item_availability_changes`, `promotions`, `promotion_items` |
| Fichas técnicas | `ingredients`, `technical_sheets`, `technical_sheet_items` |
| Salão e fila | `floor_plans`, `dining_tables`, `waitlist_entries`, `waitlist_notifications` |
| Auditoria | `permission_audit_logs` |

Todas as datas são `timestamptz`. O horário de funcionamento é guardado em minutos no fuso IANA do estabelecimento.

## Segurança

- Validação server-side com DTO whitelist (campos desconhecidos → 400) e consultas parametrizadas, inclusive o SQL da busca por distância.
- Autorização por vínculo em toda rota de estabelecimento.
- Cookies HttpOnly e defesa CSRF (SameSite + header obrigatório + CORS restrito).
- helmet, limite de 100 kB no JSON, rate limit geral e específico em autenticação.
- CPF protegido e nunca devolvido completo; logs sem senha, token ou CPF, e destinos de SMS mascarados.
- Uploads com MIME e assinatura conferidos, reencode para WebP (remove EXIF), nomes aleatórios e proteção contra path traversal.
- Segredos só no `.env`, validados no boot; providers de desenvolvimento bloqueados em produção.

## Testes

```bash
pnpm test
```

72 testes (Vitest):

- **Unitários:** horário/fuso, preço, custo de ficha, estimativa da fila e proteção do CPF.
- **Integração contra PostgreSQL real** (`filafacil_test`, com migrations aplicadas automaticamente):
  - cadastro, CPF inválido/duplicado, login, refresh com rotação e reuso, sessão revogada, suspensão, OTP, CSRF;
  - autorização entre estabelecimentos, IDOR, plano bloqueando recurso;
  - CRUD do cardápio, disponibilidade com WebSocket, promoções ativa/futura/expirada, upload;
  - planta (posição, conflito, limite) e fila (ordem, reordenação, remoção, aviso, concorrência);
  - fichas técnicas, visibilidade de estabelecimentos, troca de plano, histórico de permissões e salas de tempo real.

## Dependências externas

| Recurso | O que é preciso |
|---|---|
| Login com Google | `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (OAuth client do tipo "Aplicativo da Web") com o redirect `${API_PUBLIC_URL}/auth/oauth/google/callback` |
| Login com Apple | `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY` (.p8); a Apple exige domínio HTTPS público para o retorno |
| SMS (login por celular e aviso da fila) | Contratar um provedor (ex.: Twilio, Zenvia) e implementar `SmsSender` em `apps/api/src/modules/notifications` |
| E-mail (login por código) | Provedor transacional (ex.: SES, Resend) implementando `EmailSender` |
| Imagens em produção | S3/R2/MinIO implementando `FileStorage` (`apps/api/src/modules/storage`) |
| Endereço digitado → coordenadas | Serviço de geocodificação; hoje a escolha manual usa uma lista de regiões com coordenadas |

## O que ainda é simulado

Somente funcionalidades da Sprint 2 ou que dependem de credencial externa:

- Pedidos, carrinho, pagamento e acompanhamento (`orderService`), com histórico de exemplo do cliente do seed.
- QR Code da mesa: os códigos do seed são resolvidos por um diretório local (`data/qrDirectory.ts`); o estabelecimento e o cardápio vêm da API.
- Status reservada/chamado e a ocupação gerada por pedidos simulados no mapa do atendente (livre/ocupada vem do servidor).
- Mesclagem de mesas, destaque "+ pedido" e favoritos.
- Confirmação de e-mail/telefone, recuperação de senha e exclusão de conta (esta só encerra a sessão).
- Biometria: o atalho pede a biometria do aparelho, mas abrir sessão exige WebAuthn no servidor (Sprint 2).
- Google/Apple e SMS/e-mail reais dependem das credenciais acima.
