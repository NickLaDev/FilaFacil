# Sprint 3 — especificação acadêmica aprovada

Fonte: `Sprint3_Sugestao_Historias.pdf` (apenas proposta de títulos/pontos) + regras aprovadas pelo dono do projeto.
Os critérios abaixo foram propostos e aprovados; não são critérios oficiais do cliente.

## Regras gerais
- Dinheiro em centavos (Int). Pontos inteiros. Cálculos determinísticos.
- Reaproveitar módulos existentes (orders, tables, waitlist, payments, realtime, access).
- Pagamento continua simulado (`SimulatedPaymentGateway`); nenhuma transação real.
- Permissões novas ficam em `packages/shared/src/access.ts`; atendente/gestor recebem defaults coerentes.
- Banco destrutivo: só `filafacil_e2e`/`filafacil_test`. Nunca resetar `filafacil`.

## Grupo A — Operação
- **23 Fila de pedidos**: fila FIFO dos pedidos `paid|preparing|ready`, idade em minutos, destaque de atrasados (acima da estimativa), filtro por status, atualização em tempo real (`order.updated`).
- **24 Cozinha por estação**: gestor cadastra estações (ex.: Chapa, Bar); cada item do cardápio pode ter uma estação. A cozinha filtra itens por estação e marca cada item/estação como pronto; o pedido só vira `ready` quando todas as estações terminaram. Itens sem estação pertencem a uma estação implícita "Geral".
- **26 Impressora offline**: impressora cadastrada por estabelecimento (opcionalmente ligada a estação) com heartbeat via API; sem sinal por 60 s = offline; alerta in-app no painel (sem SMS/e-mail) em tempo real. Hardware real NÃO testado (simulado).
- **25 Histórico do turno**: gestor abre/fecha turno; histórico = pedidos entregues e cancelados do período, com totais.
- **63 Ajuste de tempo**: gestor define tempo estimado por pedido (1–240 min); sem ajuste vale `averageWaitMinutes`. Cliente vê o valor ajustado.

## Grupo B — Mesas e pagamentos
- **17 Comandas**: uma comanda aberta por mesa/grupo mesclado (respeita mescla). Pedido da mesa pode (a) ser pago individualmente adiantado ou (b) ser atribuído à comanda para pagamento posterior. Pedido não pago NUNCA é tratado como pago.
- **22 Fechar comanda e pagar**: a comanda mostra total, valor já pago e saldo. Fechar só cobra o saldo (pedidos já pagos nunca são cobrados de novo). Idempotência, transação e lock (padrão `lockResource`). Ao liquidar, libera a mesa/grupo conforme regra de ocupação existente. Pedidos cancelados saem do total.
- **18 Chamado de garçom**: reaproveitar `TableCall`; garantir fluxo cliente→equipe em tempo real e resolução.
- **10 Cancelar pedido**: cliente cancela antes do preparo (`received|paid`). Se pago → estorno automático via fluxo existente. Após preparo iniciar, só equipe com `orders.refund`/permissão adequada. Mantém consistência de estoque, pagamento e fidelidade.

## Grupo C — Cliente
- **05 Pedido pronto**: aviso in-app (evento + toast/banner) e e-mail quando houver e-mail verificado. SMS não por padrão. Sem duplicar envio (dedupe por pedido+canal). Falha do provedor registrada, nunca reportada como sucesso.
- **51 Posição na fila**: cliente vê posição e estimativa ao vivo (tempo real + polling de fallback).
- **07 Onboarding**: 3 telas leves no primeiro acesso, puláveis, lembradas por conta.
- **14 FilaZero Club**: conta verificada; 1 ponto por R$ 1 líquido pago (centavos/100, truncado); crédito só após pagamento aprovado E pedido entregue; resgate 100 pontos = R$ 5 de desconto; saldo nunca negativo; razão (ledger) auditável e idempotente (chave única por pedido+tipo); estorno/cancelamento reverte pontos ganhos e devolve pontos resgatados.

## Grupo D — Gestão
- **27 Dashboard**: pedidos e faturamento do dia, ticket médio, mesas ocupadas, fila de espera, pedidos atrasados. Só dados reais.
- **50 Estoque baixo**: estoque atual e mínimo por insumo; baixa pela ficha técnica exatamente uma vez (idempotente) na transição para `preparing`; cancelamento antes do preparo não baixa; após preparo, estoque consumido não é revertido; alerta in-app ao gestor quando estoque ≤ mínimo (sem repetir enquanto aberto).

## Notificações reais
- E-mail: SMTP (Nodemailer, Gmail de teste). Assunto por finalidade, timeout, erros tipados.
- SMS: adapter Twilio (REST), normalização E.164 brasileira (+55 + DDD + número), timeout, erro tipado; trial pode restringir destinatários/templates — sem assumir.
- Providers `dev`/fake permanecem para testes. Nunca logar OTP em produção nem credenciais.
- Falha de provedor nunca vira "sucesso" silencioso.
