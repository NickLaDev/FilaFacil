# Sprint 4 — fichas, critérios e onde está a implementação

Fonte: `Fichas_Sprint4_Completo.pdf` (14 fichas, 58 pontos). Os critérios de avaliação abaixo são os **do PDF**;
as regras marcadas como *decisão* foram escolhidas na implementação onde a ficha não especifica.

## Regras gerais (as mesmas das sprints anteriores)
- Dinheiro em centavos (`Int`), cálculos só no servidor, datas em `timestamptz`.
- Cada rotina automática (cobrança, validade, monitor de integrações) é **idempotente** e aceita relógio injetado nos testes.
- Permissões novas em `packages/shared/src/access.ts`; a migration concede as permissões novas a quem já existe.
- Pagamento continua **simulado**; cartão salvo usa o cofre do provedor (hoje só o simulador implementa o cofre).

## Cliente

| Ficha | Critério (PDF) | Como foi atendido | Onde |
|---|---|---|---|
| **15** Cashback (5) | Cashback aparece no perfil em até 24 h após o pedido ser marcado como entregue e pode ser usado no checkout seguinte | Regras por estabelecimento ou promoção (gestor); o valor é **congelado na criação do pedido** e creditado **na entrega** (pagamento aprovado ou comanda quitada) — imediato, bem abaixo de 24 h. Razão idempotente `(pedido, tipo)`; saldo nunca negativo; usar no checkout abate o total; cancelar/estornar devolve o usado e reverte o ganho | `modules/benefits`, `CashbackScreen`, `CouponsSection` (aba Cashback) |
| **30** Reservas (5) | Reserva confirmada aparece no perfil do cliente e no painel do gestor com status "confirmada" | Data + horário + nº de pessoas; **confirma ou recusa na hora** pela disponibilidade (menor mesa que comporta o grupo, 90 min, sob lock; considera reservas da equipe); aviso in-app + e-mail ao cliente; gestor/atendente cancelam ou marcam "cliente chegou" | `modules/bookings`, `BookingScreen`, `BookingsSection` |
| **48** Avaliar (5) | Avaliação atualiza a nota média em até 1 min e aparece na lista recente | 1 por pedido **entregue**; média = soma ÷ quantidade recalculada **na mesma transação** (imediato); pedido de avaliação por aviso in-app + e-mail na entrega (sem duplicar); lista pública com nome curto | `modules/reviews`, `ReviewScreen`, página do restaurante |
| **49** Métodos salvos (5) | Cartão salvo aparece pré-selecionado no checkout seguinte, sem digitar os dados | Número só passa pelo servidor para tokenizar no cofre do provedor; o banco guarda **token, bandeira, final e validade** (nunca número/CVV); padrão pré-selecionado; pagar envia só o `savedMethodId`. *Decisão:* com Mercado Pago o cofre não existe → 503 explícito (não finge salvar) | `modules/payment-methods`, `PaymentMethodsScreen`, checkout |
| **56** Cupom (5) | Cupom válido aplica o desconto correto na hora; expirado ou já usado é recusado com mensagem clara | Código único por estabelecimento; valida ativo, período, valor mínimo, limite de usos e **uso único por cliente** (índice único); mensagens por código (`COUPON_EXPIRED`…); cancelar o pedido libera o cupom; nunca deixa o líquido < R$ 1,00 | `modules/benefits`, checkout, `CouponsSection` |
| **64** Alergias (3) | Item com alérgeno que o cliente restringiu exibe aviso visual claro antes de entrar no carrinho | Catálogo de 11 alérgenos/restrições; múltiplas por cliente; selo vermelho no cardápio + aviso no item + **confirmação** antes de adicionar | `ALLERGENS` (shared), `DietaryScreen`, `MenuScreens`, `MenuItemFormModal` |
| **62** Compartilhar (3) | Link abre direto na página do restaurante, mesmo sem o app | `/?r=<id>&src=<origem>` abre a página (o app é web: nada a instalar); origem registrada (`share_visits`) e exibida por canal no dashboard do gestor | `ShareLinkHandler`, `modules/share` |

## Gestor

| Ficha | Critério (PDF) | Como foi atendido | Onde |
|---|---|---|---|
| **57** Custo por período (5) | O relatório do mês bate com a soma dos custos das fichas × quantidade vendida | `custo da ficha × quantidade`, arredondado **uma vez por linha** (totais = soma das linhas); margem por item e por categoria; filtro de datas; export CSV (pt-BR) e PDF. *Decisão:* pedidos pagos e não cancelados, pela data do pagamento; item sem ficha fica fora de custo/margem e é sinalizado | `modules/reports`, `CostReportSection` |
| **67** Duplicar item (3) | Item duplicado é criado em segundos com os mesmos dados, pronto para ajustes | Botão "Duplicar" abre o formulário **preenchido** (nada salvo até confirmar); servidor copia categoria, descrição, preço, alérgenos, estação e a **foto como arquivo próprio**; índice único parcial impede dois ativos com o mesmo nome na categoria | `MenuService.duplicateItem`, `MenuItemFormModal` |
| **70** Validade (3) | Alerta chega com pelo menos 3 dias de antecedência | Lotes por insumo; antecedência configurável (**padrão 7 dias, mínimo 3**); um alerta por lote no painel + aviso à equipe; mensagem atualizada a cada dia; sugere os pratos que usam o insumo; lote usado/descartado fecha o alerta | `modules/ingredient-lots`, `ExpirySection` |

## Admin

| Ficha | Critério (PDF) | Como foi atendido | Onde |
|---|---|---|---|
| **33** Incidentes (5) | Incidente ativo aparece em até 1 min da queda, com contagem correta de estabelecimentos impactados | Integração manda heartbeat (`X-Integration-Key`); sem sinal por 30 s o monitor (a cada 10 s) abre **um** incidente — detectado em ~33–40 s (medido no navegador); falha informada abre na hora; contagem = estabelecimentos distintos; histórico **imutável** (trigger) | `modules/monitoring`, `MonitoringSection` |
| **38** Pagamentos (5) | Fatura vencida vira "atrasado" e notifica o estabelecimento no dia seguinte | Fatura mensal gerada por rotina idempotente (única por casa+mês); `pending` vencida é **exibida como atrasada na leitura** e gravada pela rotina; aviso no dia seguinte e lembrete a cada 3 dias; admin registra pagamento/cancela | `modules/billing`, `BillingSection`, `InvoicesSection` |
| **39** Suporte (5) | Chamado aparece na fila em até 1 min e o estabelecimento é notificado a cada resposta | A casa abre com urgência; fila por **urgência e depois antiguidade**; tempo real (+ consulta de segurança); cada resposta gera aviso in-app e e-mail; histórico de conversa; status/urgência editáveis | `modules/support`, `SupportSection` (admin e gestor) |
| **66** Histórico (3) | Toda alteração gera registro consultável, com autor, data e valor anterior preservado | Registro **na mesma transação** da alteração (campo, antes, depois, autor); só o que mudou; filtros; comparação antes/depois; **somente inserção** (trigger bloqueia UPDATE/DELETE) | `modules/establishment-history`, `HistorySection` |

## Avisos in-app (transversal)
`app_notifications` serve cliente (conta) e equipe (casa + permissão): reserva, pedido para avaliar, resposta do suporte, fatura emitida/atrasada, validade. Entrega por tempo real; e-mail é canal extra, best-effort e só para contas verificadas (falha nunca derruba a regra de negócio).

## Limites conhecidos (não escondidos)
- Cofre de cartões: só o gateway **simulado** implementa; com Mercado Pago real é preciso integrar a API de clientes/cartões.
- Integrações (PDV): o monitoramento é por heartbeat — não existe um PDV real; a chave de demonstração do seed é `ik_dev_pdv_caixa1_demo_key`.
- Cobrança da plataforma: não move dinheiro (a plataforma registra o pagamento); a "cobrança automática" é a geração recorrente da fatura + avisos.
- Reserva: a mesa é escolhida automaticamente; mesas mescladas e ocupação em tempo real do salão não entram na decisão.
