# Suíte E2E (Playwright) — FilaFacil

Valida, **no navegador real**, as jornadas da Sprint 1 e as 14 fichas da Sprint 2 contra a pilha completa
**frontend + API + PostgreSQL + Socket.IO**. Nada de mocks nem `route.fulfill` nas APIs do app: cada teste confere a
interface **e** o estado persistido (consultas somente leitura ao banco).

## Isolamento (obrigatório)

| Camada | Alvo da suíte | Nunca |
|---|---|---|
| Web (Vite) | `http://localhost:5180` | 5173 |
| API | `http://localhost:3100` | 3000 |
| Banco | `filafacil_e2e` | `filafacil` (dev) e `filafacil_test` |

O `globalSetup` (`e2e/support/global-setup.ts`) **aborta a execução** se: a API/web não respondem nas portas 3100/5180;
o PID em :3100 não é o gravado em `.e2e/pids.json`; o gateway não é o simulado; ou se a sessão criada por um login real
na API **não aparece** dentro do banco `filafacil_e2e` (prova do elo API → banco). O acesso ao banco (`e2e/support/db.ts`)
é read-only (`default_transaction_read_only=on`) e confere `current_database() = filafacil_e2e`.

Os limites de requisição da API ficam **ligados**. As chamadas de autenticação são espaçadas por `e2e/support/pacer.ts`
(≤ limite−1 por 60 s) e, se outro processo consumir o limite do IP, o login espera e repete (HTTP 429 `TOO_MANY_REQUESTS`).
OTPs de desenvolvimento são lidos do **log da API** (`.e2e/api.log`, linhas `[E-mail dev]`/`[SMS dev]`); não existe código fixo.

## Como rodar

```bash
pnpm install                         # instala @playwright/test (já fixado em 1.64.0)
pnpm exec playwright install chromium

pnpm e2e:setup                       # sobe (ou reaproveita) a pilha E2E: db:setup + API :3100 + web :5180
pnpm e2e                             # roda tudo (projeto "chromium", 1 worker, ~8–12 min)
pnpm e2e:slow                        # testes @slow (ex.: código de recuperação expirando de verdade, ~11 min)
pnpm e2e:ui                          # modo interativo do Playwright
pnpm e2e:report                      # abre o relatório HTML (e2e/.results/report-chromium)
pnpm e2e:reset                       # zera o banco filafacil_e2e (TRUNCATE guardado) e refaz o seed — roda a suíte "do zero"
pnpm e2e:stop                        # encerra só os processos gravados em .e2e/pids.json (API/web e `vite preview`)
node scripts/e2e-env.mjs web:build   # build de produção do web em .e2e/web-dist (não toca apps/web/dist)
node scripts/e2e-env.mjs preview     # serve o build em :5181 (proxy /api → :3100)
pnpm e2e:perf                        # fichas 11, 02 e 03 em build de produção (n=12; PERF_RUNS=N); falha se p95 > meta
pnpm e2e:throttle                    # limites REAIS (login/otp/reset/cadastro/bloqueio por conta), ~6 min; ver abaixo
```

Um arquivo ou teste: `pnpm exec playwright test e2e/sprint2/b-customer-staff.spec.ts --project=chromium -g "B1"`.
Artefatos (trace, screenshot e vídeo só em falha) ficam em `e2e/.results/artifacts`; latências medidas em
`e2e/.results/latency.jsonl` e nas anotações do relatório.

A suíte **cria e deixa dados** em `filafacil_e2e` (pedidos, contas descartáveis `e2e-*@example.test`). Os testes se
protegem disso (limpam mesas, preços, promoções), mas para um estado idêntico ao do seed use `pnpm e2e:reset`.

## Fixture de horário e modos de throttle

- **Horários 24 h (fixture):** o `globalSetup`, depois de confirmar que o banco é `filafacil_e2e`, ajusta (via API de admin) o horário de Bar do Mestre, Bar do Mestre 2, Boteco da Vila e Lancheria do Zé para 00:00–23:59, porque o seed (ex.: 10:00–02:00) faz o produto **corretamente** mostrar "Pedidos fechados" fora do horário e os testes de pedido precisam de casa aberta. O comportamento "bar fechado" é provado em C1b com a Cantina (seg–sex 11–14, não alterada), usando o estado real informado pela API.
- **Modo padrão (throttle real):** limites ligados; o `pacer` espaça logins/OTP/cadastros e repete após 429.
- **Modo rápido:** suba a API com `E2E_THROTTLE_DISABLED=true node scripts/e2e-env.mjs start` e rode `E2E_THROTTLE_DISABLED=true pnpm e2e` (o pacer se desliga). O bloqueio por conta (5 senhas erradas → `TOO_MANY_LOGIN_ATTEMPTS`) continua ligado nos dois modos. S1-SEC e os testes de limite só valem com a API em throttle real.

## Estrutura

```
playwright.config.ts            # 1 worker, projetos chromium/slow, trace+screenshot+vídeo em falha
e2e/support/                    # env, db (read-only), api (cliente HTTP real), otp (log de dev), pacer, ui, client-flow,
                                # domain (contas descartáveis, mesas), metrics (latências), fake-camera (QR em vídeo .y4m)
e2e/sprint1/                    # auth.spec.ts · browse-manage.spec.ts
e2e/sprint2/                    # a-customer-order · b-customer-staff · c-tables · d-account · e-management · g-qr
```

## Plano: critério de aceitação → teste

Fonte: PDF das fichas (Sprint 1 p. 1–15, Sprint 2 p. 16–29) e `auditoria_sprint2_filazero_claude.md`. Nenhum critério foi inventado.

| Ficha | Critério (resumo) | Teste(s) |
|---|---|---|
| **02** QR | QR único por mesa; leitor no app; pedido ligado à mesa; QR inválido e bar fechado; abre o cardápio da mesa em ≤ 3 s | G1 (unicidade no banco, QR do painel decodificado com jsQR), G2 (leitor com câmera virtual), C1/C1b (link, código digitado, inválido, fechado), A1/C2 (`tableLabel` no pedido), A12 |
| **04** Pagamento | Pix e cartão; comprovante; falha e estorno; aprovado atualiza o pedido e gera comprovante no histórico | A1 (cartão), A4 (Pix), A2/A3 (recusa/erro), A8 (duplicado), A9 (preço mudou), B3 (estorno pela equipe → cliente vê) |
| **08** Carrinho | itens/quantidades, editar/remover, total ao vivo, confirmação | A1, A10 (item esgotado no carrinho), A11 (visitante) |
| **09** Status | linha do tempo; tempo real ≤ 5 s sem recarregar; estimativa e local de retirada; resumo e total | B1 (latências), B2 (polling), A1/A12 (tela de rastreio) |
| **16** Mapa de mesas | cores por estado, pessoas, destaque de chamados, atualização ≤ 3 s | C2, C3, C4, C5 |
| **47** Mesclar | mesclar 2+ mesas, capacidade somada, conta única, aparece como unidade, desfazer reverte | C6 |
| **61** Duplicar layout | escolher origem, copiar para unidade da mesma organização, editar depois, origem intacta, mesmas posições/capacidades | E5 |
| **65** Verificação | código no cadastro; funções restritas até verificar; reenvio após espera mínima; só código correto verifica; não verificado não paga | S1-01, S1-01b, A7 |
| **44** Recuperação de senha | tela; código por e-mail/SMS; validar e nova senha; expira; login imediato | D3, D3b, D3c (@slow) |
| **45** Favoritos | ícone na lista e no detalhe; aba Favoritos ≤ 1 s; sincroniza com a conta/outro aparelho; remover com um toque | D1 |
| **46** Mais pedidos | ranking por loja (30 dias, pagos); selo "+ pedido"; gestor destaca manualmente; recálculo semanal | E3 (recálculo semanal automático = NOT VERIFIED) |
| **53** Exclusão (LGPD) | fluxo de pedido; autenticação adicional; remover/anonimizar; e-mail de confirmação | D4, D4b |
| **59** Biometria | ativar/desativar; login tradicional preservado; falhas com retry/fallback; login < 2 s sem digitar | D5, D5b (WebAuthn com autenticador virtual do Chromium) |
| **60** Categorias | categorias por estabelecimento; filtro múltiplo; atualiza ≤ 1 s sem recarregar | D2 |

Sprint 1: **01** S1-01/01b · **03** S1-11/12/03 · **06** S1-06/06b · **11** e **12** S1-11/12/03 · **13** S1-13/13b ·
**19** E1/E2 · **20** E4 · **21** S1-21 · **28** E1 · **29** e **31** S1-29/31 · **34/36/37** S1-34/36/37 ·
RBAC S1-RBAC · tempo real S1-RT (suspensão derruba sessão/socket), B1/B2, E1/E2.

## Limitações (NOT VERIFIED)

- **SMS/e-mail reais**: só o provider `dev` (log da API). Entrega real, SPF/SMTP e SMS não são testados.
- **Câmera/QR físico**: o leitor é validado com câmera **virtual** (`--use-fake-device-for-media-stream`), não com lente real.
- **Biometria (Face ID / Touch ID)**: WebAuthn é validado com o autenticador **virtual** do Chromium (CDP), não com hardware.
- **Recálculo semanal do ranking (ficha 46)** e **limpeza em até 30 dias (ficha 53)** dependem de tempo/calendário; a
  anonimização imediata é verificada, a janela de 30 dias não.
- **Gateway real (Mercado Pago)**: só o gateway simulado; nenhuma cobrança real.
- **Chromium apenas** (sem Safari/Firefox/dispositivos móveis reais); o viewport do cliente é 390×844.
- O botão flutuante **DEV** (só em `pnpm dev`) cobre a aba "Perfil" em 390 px; o helper `nav()` dispara o clique no elemento.

## Estado final e pendências

- **Passe autêntico (backend-e2e, API em throttle-off):** 51 passed, 0 failed, 1 skipped (S1-12, `test.fixme` da ficha 12); `@slow` (D3c, validade real do código = 10 min ≤ 30) passou; S1-SEC (API com throttle real) passou; banco de dev inalterado. As falhas de passes anteriores vieram do *Maintenance Sleep* do macOS e de carga da máquina, não do app.
- **Metas de latência como asserções** (valores dos cards): ficha 02 ≤ 3 s (A1, C1, G2) · 09 ≤ 5 s (B1, B2, estorno) · 16 ≤ 3 s (C2, C3, C5) · 45 ≤ 1 s (D1) · 59 ≤ 2 s (D5) · 60 ≤ 1 s (D2) · 19 ≤ 5 s (E1, E2). Medidas em máquina de desenvolvimento (Chromium headless, localhost), **não** em produção; os números ficam em `e2e/.results/latency.jsonl`.
- **B2**: a queda do socket é provada (nenhuma requisição Socket.IO concluída, nenhum WebSocket aberto) e exige ≥ 1 `GET /orders` de polling após a mudança, com a mudança visível em ≤ 5 s.
- **Lint/tipos**: `pnpm e2e:lint` (ESLint flat config em `e2e/eslint.config.mjs`, reaproveita apps/web, + `tsc`).
- **Lacunas registradas (não são falhas da suíte):** ficha 12 sem botão "reservar" do cliente (`S1-12` fixme); `POST /auth/otp` responde 404 para conta inexistente (enumeração, baixa, intencional segundo o backend); recálculo semanal do ranking e janela real de 30 dias de vendas (46) e janela de 30 dias da exclusão (53) NOT VERIFIED; SMS/e-mail reais, câmera e biometria físicas NOT VERIFIED.


## Projetos extras

- **`perf`** (`e2e/perf`): mede abertura da busca (ficha 11), link do QR → cardápio (02) e cardápio (03) com contextos novos (frio) e a mesma página (quente), registra mín/mediana/p95/máx, ambiente e decomposição (rede/JS/API/espera sem rede) em `e2e/.results/perf-<modo>-*.json`. Só **reprova** no build de produção (:5181); no Vite dev (:5180: `E2E_WEB_URL=http://localhost:5180 pnpm exec playwright test --project=perf`) apenas registra. `e2e/perf/timeline.spec.ts` é diagnóstico (linha do tempo de uma carga fria). **Ressalva:** laptop de desenvolvimento com Postgres em Docker, API, web e Chromium no mesmo host — limite superior, não SLA.
- **`throttle`** (`e2e/throttle`): precisa da API em **throttle real** e de ninguém mais em :3100 (`pnpm e2e:stop; node scripts/e2e-env.mjs start; pnpm e2e:throttle`). Cada teste espera a janela de 60 s da rota terminar (≈ 6 min no total). Nunca rode junto com `pnpm e2e` (compartilham o limite por IP).
- Matriz ficha × teste: ver [`COBERTURA.md`](./COBERTURA.md).
