"""Gera docs/roteiro-demonstracao-sprints-4-5.pdf (uma página por história). Uso: python3 docs/demo/gerar-roteiro.py docs/roteiro-demonstracao-sprints-4-5.pdf"""
import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (CondPageBreak, KeepTogether, ListFlowable, ListItem, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle)

HERE = Path(__file__).parent
OUT = Path(sys.argv[1])
FICHAS = {int(k): v for k, v in json.loads((HERE / 'fichas.json').read_text()).items()}

FONT_DIR = '/usr/share/fonts/truetype/dejavu'
LIB = '/usr/share/fonts/truetype/liberation'
pdfmetrics.registerFont(TTFont('Sans', f'{LIB}/LiberationSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', f'{LIB}/LiberationSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Oblique', f'{LIB}/LiberationSans-Italic.ttf'))
pdfmetrics.registerFont(TTFont('Mono', f'{FONT_DIR}/DejaVuSansMono.ttf'))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily('Sans', normal='Sans', bold='Sans-Bold', italic='Sans-Oblique', boldItalic='Sans-Bold')

ORANGE = colors.HexColor('#E8710A')
INK = colors.HexColor('#1F1B16')
MUTED = colors.HexColor('#6B645C')
SOFT = colors.HexColor('#FFF4EA')
LINE = colors.HexColor('#E6DED4')
GREEN_BG = colors.HexColor('#EAF7EE')
GREEN = colors.HexColor('#166534')

st = {
    'title': ParagraphStyle('title', fontName='Sans-Bold', fontSize=24, leading=30, textColor=INK),
    'subtitle': ParagraphStyle('subtitle', fontName='Sans', fontSize=12, leading=17, textColor=MUTED),
    'h1': ParagraphStyle('h1', fontName='Sans-Bold', fontSize=17, leading=22, textColor=INK, spaceBefore=4, spaceAfter=8),
    'h2': ParagraphStyle('h2', fontName='Sans-Bold', fontSize=11.5, leading=15, textColor=ORANGE, spaceBefore=8, spaceAfter=3),
    'body': ParagraphStyle('body', fontName='Sans', fontSize=9.6, leading=13.6, textColor=INK, alignment=TA_LEFT),
    'small': ParagraphStyle('small', fontName='Sans', fontSize=8.4, leading=11.5, textColor=MUTED),
    'quote': ParagraphStyle('quote', fontName='Sans-Oblique', fontSize=9.8, leading=14, textColor=INK),
    'label': ParagraphStyle('label', fontName='Sans-Bold', fontSize=8, leading=10, textColor=MUTED),
    'cell': ParagraphStyle('cell', fontName='Sans', fontSize=8.6, leading=11.4, textColor=INK),
    'cellb': ParagraphStyle('cellb', fontName='Sans-Bold', fontSize=8.6, leading=11.4, textColor=INK),
    'code': ParagraphStyle('code', fontName='Mono', fontSize=8.2, leading=11, textColor=INK, backColor=colors.HexColor('#F4F1EC'), borderPadding=(4, 5, 4, 5)),
    'ficha': ParagraphStyle('ficha', fontName='Sans-Bold', fontSize=9, leading=11, textColor=colors.white),
    'fichatitle': ParagraphStyle('fichatitle', fontName='Sans-Bold', fontSize=15, leading=19, textColor=INK),
}


def P(text, style='body'):
    return Paragraph(text, st[style])


def bullets(items, style='body', numbered=False):
    return ListFlowable(
        [ListItem(P(item, style), leftIndent=14, value=None) for item in items],
        bulletType='1' if numbered else 'bullet', start='1' if numbered else '•',
        bulletFontName='Sans-Bold' if numbered else 'Sans', bulletFontSize=9, bulletColor=ORANGE, leftIndent=14,
    )


def box(flowables, bg=SOFT, border=None):
    t = Table([[flowables]], colWidths=[174 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg),
        ('BOX', (0, 0), (-1, -1), 0.6, border or bg),
        ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    return t


def table(rows, widths, header=True):
    data = [[P(c, 'cellb' if (header and i == 0) else 'cell') for c in row] for i, row in enumerate(rows)]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if header else 0)
    style = [
        ('GRID', (0, 0), (-1, -1), 0.4, LINE),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    if header:
        style.append(('BACKGROUND', (0, 0), (-1, 0), SOFT))
    t.setStyle(TableStyle(style))
    return t


# ─── Roteiros por história ──────────────────────────────────────────────────
# who: perfil/janela; prep: preparação antes de mostrar; steps: passo a passo; show: o que apontar ao professor.
D = {}

# Sprint 4 — Cliente
D[15] = dict(
    who='Cliente <b>joao@email.com</b> (janela C) e atendente/gestor no painel <b>/atendente</b> (janela G).',
    prep='O Bar do Mestre já tem a regra "5% de volta em todo pedido" (Gestor → Cupons e cashback → aba Cashback).',
    steps=[
        'Janela C: Perfil → <b>Meu cashback</b>. Anote o saldo atual.',
        'Abra Restaurantes → <b>Bar do Mestre</b> → Ver cardápio, adicione 2 itens e vá ao pagamento. Mostre a linha "Cashback deste pedido".',
        'Pague com <b>Cartão de crédito</b> → cenário <b>Pagamento aprovado</b>.',
        'Janela G (lucas@bardomestre.com.br em /atendente) → Pedidos: avance o pedido até <b>Marcar como entregue</b>.',
        'Janela C: Perfil → Meu cashback. O valor já entrou no saldo, com a linha do pedido no extrato.',
        'Faça um novo pedido: no pagamento, marque <b>Usar meu cashback</b>. O desconto aparece na linha "Cashback" e o total cai na hora.',
    ],
    show='O crédito entra no momento da entrega (bem dentro das 24 h do critério) e o saldo é usado no checkout seguinte, sem cupom. Se o pedido for cancelado/estornado, o cashback ganho é revertido.',
)
D[30] = dict(
    who='Cliente <b>joao@email.com</b> (janela C) e gestor <b>lucas@bardomestre.com.br</b> em /gestor (janela G).',
    prep='Nenhuma.',
    steps=[
        'Janela C: Restaurantes → <b>Bar do Mestre</b> → <b>Reservar com data e horário</b>.',
        'Escolha a data (amanhã), o número de pessoas e um horário livre → confirmar.',
        'A tela mostra a reserva <b>confirmada</b> na hora (a disponibilidade é decidida automaticamente).',
        'Perfil → <b>Minhas reservas</b>: aparece com status confirmada. Notificações: aviso da confirmação.',
        'Janela G: Gestor → <b>Reservas de mesa</b>: a mesma reserva aparece como confirmada (com opção de cancelar ou "cliente chegou").',
        'Opcional: aumente bastante o número de pessoas — só aparecem horários com mesa que comporta o grupo; sem mesa, a reserva é recusada automaticamente com o motivo.',
    ],
    show='A mesma reserva com status "confirmada" no perfil do cliente e no painel do gestor.',
)
D[48] = dict(
    who='Cliente <b>joao@email.com</b> (janela C) e /atendente (janela G).',
    prep='Use o pedido entregue da ficha 15 (ou faça um novo e marque como entregue).',
    steps=[
        'Janela C: Restaurantes → Bar do Mestre: anote a <b>nota média</b> e o número de avaliações.',
        'Pedidos → abra o pedido entregue → <b>Avaliar pedido</b> (o pedido de avaliação também chega em Notificações na entrega).',
        'Dê a nota (1 a 5) e escreva um comentário → enviar.',
        'Volte à página do Bar do Mestre: a nota média e a contagem mudaram <b>na hora</b>, e o comentário está no topo das avaliações recentes.',
        'Tente avaliar o mesmo pedido de novo: não é permitido (uma avaliação por pedido entregue).',
    ],
    show='A média é recalculada na mesma operação que grava a avaliação, então aparece em segundos (critério: até 1 minuto).',
)
D[49] = dict(
    who='Cliente <b>joao@email.com</b> (janela C).',
    prep='O pagamento é simulado: nenhum cartão real é usado.',
    steps=[
        'Perfil → <b>Métodos de pagamento</b> → adicionar cartão: número de teste (ex.: 4111 1111 1111 1111), nome, validade e CVV.',
        'O cartão aparece como "final 1111" com a bandeira. Marque <b>Definir como padrão</b>.',
        'Faça um pedido no Bar do Mestre e vá ao pagamento: o cartão salvo já vem <b>pré-selecionado</b>. Pague sem digitar nada.',
    ],
    show='Só o token, a bandeira, o final e a validade ficam guardados (nunca o número completo nem o CVV); no checkout seguinte o cartão é pré-selecionado.',
)
D[56] = dict(
    who='Cliente <b>joao@email.com</b> (janela C).',
    prep='Cupons do seed no Bar do Mestre: <b>BEMVINDO10</b> (10%), <b>ECONOMIZE5</b> (R$ 5 a partir de R$ 30) e <b>VERAO24</b> (expirado).',
    steps=[
        'Monte um pedido no Bar do Mestre acima de R$ 30 e vá ao pagamento.',
        'Digite <b>VERAO24</b>: aparece a mensagem clara de cupom expirado.',
        'Digite <b>BEMVINDO10</b>: o desconto de 10% entra na hora no total. Pague.',
        'Em um novo pedido, tente <b>BEMVINDO10</b> de novo: recusado com "você já usou este cupom".',
        'Mostre também a tela do gestor: Gestor → <b>Cupons e cashback</b> (criar cupom, validade, mínimo, limite de usos).',
    ],
    show='Desconto correto aplicado na hora; cupom expirado ou já usado recusado com mensagem clara.',
)
D[62] = dict(
    who='Cliente (janela C) e uma <b>janela anônima</b> sem login.',
    prep='Nenhuma.',
    steps=[
        'Janela C: Restaurantes → Bar do Mestre → ícone <b>Compartilhar restaurante</b> → copiar link (ou WhatsApp/outro).',
        'Cole o link numa janela anônima (sem estar logado): abre direto a página do Bar do Mestre.',
        'Gestor → <b>Dashboard</b>: a visita aparece contada por origem (copiar link, WhatsApp…).',
    ],
    show='O link (/?r=…&src=…) abre a página do restaurante sem instalar nada (o app é web) e a origem fica registrada.',
)
D[64] = dict(
    who='Cliente <b>joao@email.com</b> (janela C).',
    prep='Itens do Bar do Mestre com alérgenos no seed: Cerveja IPA 600ml (glúten, lactose), X-Bacon e Combo IPA + X-Burger.',
    steps=[
        'Perfil → <b>Alergias e restrições</b>: marque <b>Glúten</b> e salve.',
        'Abra o cardápio do Bar do Mestre: os itens com glúten mostram o selo de alerta.',
        'Toque em <b>Cerveja IPA 600ml</b> e tente adicionar: aparece o aviso e é preciso <b>confirmar</b> antes de ir para o carrinho.',
        'Gestor → Cardápio → editar item: mostre onde se cadastram os alérgenos do prato.',
    ],
    show='Aviso visual claro antes de o item entrar no carrinho.',
)

# Sprint 4 — Gestor
D[57] = dict(
    who='Gestor <b>lucas@bardomestre.com.br</b> em /gestor (Bar do Mestre).',
    prep='O seed tem 45 dias de vendas e fichas técnicas dos lanches.',
    steps=[
        'Gestor → <b>Custo por período</b>: escolha o mês atual.',
        'Mostre, por item, a quantidade vendida × custo da ficha técnica, o custo total e a margem; e o resumo por categoria.',
        'Confira uma linha à mão: abra Fichas técnicas → o prato → custo unitário × quantidade = custo da linha.',
        'Clique em <b>Exportar CSV</b> e <b>Exportar PDF</b>.',
    ],
    show='Os totais são a soma das linhas (custo da ficha × quantidade vendida), por isso batem com o cálculo manual.',
)
D[67] = dict(
    who='Gestor <b>lucas@bardomestre.com.br</b> → Cardápio.',
    prep='Nenhuma.',
    steps=[
        'Gestor → <b>Cardápio</b> → num item com foto, clique em <b>Duplicar item</b>.',
        'O formulário abre <b>preenchido</b> (nome "… (cópia)", descrição, preço, categoria, alérgenos e a foto).',
        'Ajuste o nome/preço (ex.: versão 300 ml) e salve: o item novo aparece na lista em segundos.',
        'Tente salvar com o mesmo nome do original: é recusado (não cria dois itens ativos iguais).',
    ],
    show='Criado em segundos com os mesmos dados do original, pronto para ajustes.',
)
D[70] = dict(
    who='Gestor <b>lucas@bardomestre.com.br</b> (Bar do Mestre).',
    prep='O seed tem lotes: um vencendo em 5 dias, um vencido e um dentro do prazo.',
    steps=[
        'Ao entrar no painel do gestor, o <b>banner amarelo</b> já mostra: "Lote … vence em 5 dias. Priorize: X-Burger".',
        'Gestor → <b>Validade de insumos</b>: lista por situação (Perto de vencer, Vencido, Dentro do prazo) e a antecedência configurada (padrão 7 dias, mínimo 3).',
        'Clique em <b>Cadastrar lote</b> com validade daqui a 4 dias: o alerta aparece na hora, com os pratos que usam o insumo.',
        'Marque um lote como <b>Usado/descartado</b>: o alerta some.',
    ],
    show='O alerta chega com no mínimo 3 dias de antecedência (padrão 7), no painel e no sino de avisos.',
)

# Sprint 4 — Admin
D[33] = dict(
    who='Admin <b>admin@filazero.app</b> em /admin (janela A) + terminal.',
    prep='A integração <b>PDV Caixa 1</b> do Bar do Mestre usa a chave de demonstração <font name="Mono">ik_dev_pdv_caixa1_demo_key</font>. Se já houver um incidente antigo do PDV aberto, envie um sinal normal antes para encerrá-lo.',
    steps=[
        'Terminal: envie um sinal de vida do PDV (comando no apêndice). Janela A: Admin → <b>Incidentes</b> → PDV Caixa 1 fica <b>Disponível</b>.',
        'Pare de enviar. Em cerca de 35 segundos aparece o <b>banner vermelho de incidente ativo</b> com "1 estabelecimento impactado".',
        'Para mostrar na hora: envie um sinal com status de erro (segundo comando do apêndice): o incidente abre imediatamente.',
        'Envie um sinal normal: o incidente é resolvido e vai para o <b>Histórico de incidentes</b> (que não pode ser apagado).',
    ],
    show='Incidente em menos de 1 minuto da queda, com a contagem de estabelecimentos impactados e histórico para auditoria.',
)
D[38] = dict(
    who='Admin (janela A) e gestor (janela G).',
    prep='O seed deixa a mensalidade do <b>Seu Joaquim Bar</b> pendente e vencida (dia 10), e as demais pagas.',
    steps=[
        'Admin → <b>Pagamentos</b>: filtros Pendentes / Pagas / Atrasadas, com totais.',
        'A fatura do Seu Joaquim Bar aparece como <b>Atrasada</b> (o status muda sozinho depois do vencimento).',
        'Clique em <b>Executar cobrança agora</b> (é a mesma rotina que roda de hora em hora): gera as mensalidades que faltam, marca atrasadas e envia os avisos — rodar de novo não duplica nada.',
        'Clique em <b>Registrar pagamento</b> na fatura atrasada: vira Paga.',
        'Janela G (lucas): Gestor → <b>Faturas</b> mostra as faturas da casa; o sino traz o aviso de fatura emitida/em atraso.',
    ],
    show='Fatura vencida muda para "atrasado" e o estabelecimento é avisado no dia seguinte ao vencimento (e a cada 3 dias). A regra do "dia seguinte" é coberta por teste automático com relógio simulado.',
)
D[39] = dict(
    who='Gestor <b>lucas@bardomestre.com.br</b> (janela G) e admin (janela A).',
    prep='O seed já tem um chamado aberto: "Impressora da cozinha não imprime".',
    steps=[
        'Janela G: Gestor → <b>Suporte</b> → <b>Novo chamado</b> com urgência Alta e uma mensagem.',
        'Janela A: Admin → <b>Suporte</b>: o chamado aparece na fila <b>em segundos</b>, ordenado por urgência e depois por antiguidade.',
        'Abra o chamado, escreva a resposta e clique em <b>Responder</b>; mude o status para Em andamento.',
        'Janela G: o sino mostra o aviso da resposta e a conversa aparece no chamado. Responda de volta.',
        'Janela A: <b>Marcar como resolvido</b>. O histórico de conversa fica guardado.',
    ],
    show='O chamado entra na fila em menos de 1 minuto e a casa é avisada a cada resposta (in-app e e-mail).',
)
D[66] = dict(
    who='Admin (janela A).',
    prep='Nenhuma.',
    steps=[
        'Admin → <b>Estabelecimentos</b> → Bar do Mestre → editar: mude o tempo médio de espera e o endereço → salvar.',
        'Admin → <b>Histórico</b>: aparece o registro com <b>autor, data, campo, valor anterior e valor novo</b>.',
        'Filtre por estabelecimento e por campo alterado.',
        'Troque o plano ou o status da casa: também vira registro.',
    ],
    show='Toda alteração gera registro consultável; o valor anterior fica preservado e o banco não deixa editar nem apagar o histórico.',
)

# Sprint 5 — Admin
D[32] = dict(
    who='Admin <b>admin@filazero.app</b> em /admin.',
    prep='O seed tem 45 dias de vendas em 8 estabelecimentos ativos.',
    steps=[
        'Admin → <b>Visão geral</b> (tela inicial do admin): estabelecimentos ativos, pedidos do dia, GMV do dia e usuários ativos, cada um com a variação em relação a ontem.',
        'Desça até a tabela por estabelecimento: some a coluna de pedidos/GMV e mostre que bate com a linha <b>Total</b> e com os cartões do topo.',
        'Mostre que casas com problema vêm primeiro (fatura em atraso, integração fora do ar, pedidos pausados, aberta e sem pedidos hoje).',
        'Use os atalhos <b>Organizações</b> e <b>Usuários</b> para navegar; no fim da página, a lista de usuários ativos do dia.',
        'Ao vivo: faça um pedido pago como cliente e atualize a visão geral — pedidos e GMV de hoje sobem.',
    ],
    show='Os números gerais são calculados como a soma dos estabelecimentos ativos (suspensos ficam fora e aparecem à parte).',
)
D[35] = dict(
    who='Admin (janela A), gestor <b>lucas@bardomestre.com.br</b> (janela G) e gestora <b>paula@cantina.edu.br</b>.',
    prep='Lucas é <b>admin da rede</b> "Grupo Bar do Mestre" (3 unidades).',
    steps=[
        'Admin → <b>Organizações</b> → Grupo Bar do Mestre: relatório consolidado do período (pedidos, GMV, ticket médio) e as unidades.',
        'Mostre que a soma das unidades bate com o total. Clique em <b>Abrir</b> numa unidade: vai para o cadastro dela.',
        'Em Pessoas da rede → <b>Adicionar</b>: adicione Paula como <b>Visualizador</b>.',
        'Entre como Paula em /gestor → <b>Minha rede</b>: ela vê o relatório da rede, mas não acessa as unidades.',
        'Janela G (Lucas, admin da rede) → <b>Minha rede</b> → <b>Abrir unidade</b>: troca para a unidade (acesso herdado da rede).',
        'Opcional: em "Vincular outro estabelecimento", traga uma casa para a rede: o relatório e os acessos mudam na hora.',
    ],
    show='Dados consolidados corretos, navegação para cada estabelecimento e permissões por rede (admin da rede × visualizador).',
)
D[40] = dict(
    who='Admin em /admin → <b>Incidentes</b>.',
    prep='O seed cria a integração <b>Gateway de pagamento</b> com URL de saúde (em desenvolvimento, o próprio /api/health).',
    steps=[
        'Na linha Gateway de pagamento, clique no raio (<b>Testar</b>): fica <b>Disponível</b>. Ícone de relógio: histórico de testes com horário e tempo de resposta.',
        'Clique em <b>Nova integração</b>: Bar do Mestre, tipo Gateway de pagamento, URL de saúde <font name="Mono">http://localhost:3999/health</font> (endereço sem nada respondendo).',
        'Clique em Testar: fica <b>Indisponível</b> e o banner de <b>incidente</b> abre na hora; o histórico registra a falha e o motivo.',
        'Clique no botão de liga/desliga: a integração fica <b>Desativada</b>, o incidente é encerrado e ela deixa de ser monitorada.',
        'Explique: sem teste manual, o monitor testa as URLs sozinho a cada 30 s.',
    ],
    show='Integração com falha aparece como "Indisponível" em até 1 minuto (no teste manual, na hora) e gera incidente automaticamente.',
)
D[41] = dict(
    who='Admin em /admin → <b>Métricas</b>.',
    prep='Nenhuma.',
    steps=[
        'Mostre os três cartões (pedidos, GMV, usuários ativos) com a variação contra o período anterior.',
        'Passe o mouse nos gráficos: valor do dia no período e no período anterior (linha tracejada).',
        'Troque o período (atalhos 7, 30, 90 dias ou datas livres): números e gráficos recalculam.',
        'Marque <b>Comparar com outro período</b> e escolha datas: a comparação muda.',
        'Desça até "Por estabelecimento": a soma da tabela bate com o total.',
        'Clique em <b>Exportar CSV</b> e <b>Exportar PDF</b>.',
    ],
    show='Ao filtrar, gráficos e números recalculam e batem com a soma por estabelecimento.',
)
D[42] = dict(
    who='Cliente novo (janela anônima) e admin (janela A).',
    prep='Crie na hora uma conta de cliente de teste (o código de verificação aparece no terminal da API).',
    steps=[
        'Janela anônima: crie uma conta de cliente, entre e vá em Perfil → Segurança e privacidade → <b>excluir conta</b>, confirmando com a senha.',
        'Janela A: Admin → <b>Auditoria</b> (atualiza sozinha): aparece "<b>Conta excluída</b>" — sem dados pessoais do titular.',
        'Clique no registro: autor, data, IP, alvo e detalhes.',
        'Filtre por ação, por data e clique no nome de um autor para filtrar por usuário.',
        'Outras ações também aparecem: suspender usuário, trocar plano, mudar configuração, aprovar parceiro, estorno, importar cardápio.',
        'Diga: não há botão de editar/apagar e o próprio banco recusa alteração (garantido por teste automático).',
    ],
    show='A ação sensível gera um registro imutável, consultável em segundos (critério: até 1 minuto).',
)
D[43] = dict(
    who='Admin (janela A) e cliente (janela C).',
    prep='Nenhuma.',
    steps=[
        'Admin → <b>Configurações</b>: recursos (liga/desliga) e parâmetros globais, com quem alterou e quando.',
        'Desligue <b>Reservas de mesa</b> (crítico): aparece o <b>impacto</b> antes de salvar → <b>Confirmar alteração</b>.',
        'Janela C: atualize a página do Bar do Mestre — o botão "Reservar com data e horário" sumiu (em até ~10 s, sem deploy).',
        'Mude o parâmetro "Máximo de pessoas por reserva" para 4 e salve; religue as reservas; no cliente, tente reservar para 6: recusado.',
        'Admin → Auditoria: as alterações aparecem com antes/depois.',
        'Volte os valores originais (Reservas ligado, máximo 20).',
    ],
    show='A alteração reflete no comportamento da plataforma em até 1 minuto, sem deploy; alterações críticas pedem confirmação depois de mostrar o impacto.',
)
D[52] = dict(
    who='Admin (janela A) e cliente <b>joao@email.com</b> numa <b>janela anônima ou outro navegador</b>.',
    prep='Faça login do João antes num navegador (o primeiro aparelho da conta).',
    steps=[
        'Faça login do João na janela anônima (aparelho que a conta ainda não conhece).',
        'Janela A: Admin → <b>Acessos</b>: o login aparece na hora com data/hora, IP, aparelho (ex.: "Chrome · Windows") e o selo <b>Novo aparelho</b>. Filtro "Aparelho não reconhecido".',
        'O João recebe o aviso de login em aparelho novo (sino no app e e-mail no terminal da API).',
        'Clique em <b>Encerrar</b> nessa linha (um clique).',
        'Na janela anônima, faça qualquer ação: a sessão caiu e pede login de novo.',
        'Clique no nome do João: histórico de logins, sessões ativas e "Encerrar todas".',
    ],
    show='Login de aparelho não reconhecido gera registro imediato e é encerrado pelo admin em um clique.',
)
D[55] = dict(
    who='Visitante em <b>/parceiro</b> (janela anônima), admin (janela A) e cliente (janela C).',
    prep='O seed já tem dois cadastros na fila (um aguardando análise, outro aguardando informações).',
    steps=[
        'Janela anônima: abra <b>/parceiro</b> e preencha (CNPJ válido de exemplo: <font name="Mono">04.252.011/0001-10</font>; latitude -22.905 e longitude -47.060, Campinas; abre 00:00, fecha 23:59 para estar aberto na demo).',
        'Enviar: aparece o <b>código de acompanhamento</b>. Clique em <b>Anexar</b> e envie um PDF qualquer.',
        'Janela A: Admin → <b>Novos parceiros</b>: o cadastro está na fila com dados e documento (clique para baixar).',
        'Mostre <b>Pedir informações</b> num cadastro (o parceiro vê o pedido e responde pela página dele).',
        'No novo cadastro: <b>Aprovar</b> → escolha o plano → Confirmar. A página do parceiro mostra <b>Aprovado</b>.',
        'Janela C: Restaurantes — a casa nova aparece aberta e já aceita pedido (cardápio vazio até o gestor cadastrar, o que pode ser feito pela importação da ficha 54).',
        'Recusa: em outro cadastro, clique em <b>Recusar</b> com um motivo: o parceiro recebe o motivo por e-mail (terminal da API) e vê na página de acompanhamento.',
    ],
    show='Aprovado passa a aceitar pedidos na hora (cria a rede, o estabelecimento ativo e a conta de gestor); recusado recebe o motivo.',
)

# Sprint 5 — Gestor
D[54] = dict(
    who='Gestor <b>lucas@bardomestre.com.br</b> → <b>Importar cardápio</b>.',
    prep='Use as planilhas prontas do repositório: <font name="Mono">docs/demo/cardapio-50-itens.csv</font> e <font name="Mono">docs/demo/cardapio-com-erros.csv</font>.',
    steps=[
        'Clique em <b>Modelo CSV</b>: abre no Excel com as colunas e exemplos.',
        'Selecione <b>cardapio-50-itens.csv</b> → <b>Validar</b> (não grava nada) → <b>Importar</b>.',
        'Relatório: 50 linhas, 50 criadas, 0 erros, com o tempo gasto (fração de segundo). Abra o Cardápio: os itens estão lá.',
        'Selecione <b>cardapio-com-erros.csv</b> → Importar: as linhas boas entram e as com problema aparecem com o motivo (sem nome, preço inválido, "talvez", estação inexistente, item repetido).',
        'Clique em <b>Planilha com os erros</b>, corrija as linhas no Excel e importe de novo: entram as corrigidas e nada é duplicado.',
    ],
    show='50 itens importados corretamente em menos de 1 minuto, com relatório claro de sucesso e erro.',
)
D[69] = dict(
    who='Gestor <b>ze@grupodoze.com.br</b> (Lancheria do Zé, plano Pro).',
    prep='Nenhuma.',
    steps=[
        'Gestor → <b>Planos</b>: colunas Start, Pro e Business com mensalidade, limites (unidades, mesas, equipe) e cada recurso.',
        'O plano atual (Pro) está destacado com "Seu plano"; as linhas onde os planos diferem estão realçadas.',
        'Cada plano tem o botão de troca; quando o uso atual não cabe no plano (ex.: rede com mais unidades que o Start permite), o botão fica desabilitado com o motivo.',
    ],
    show='Os recursos de cada plano lado a lado, com o plano atual destacado e as diferenças visíveis.',
)
D[58] = dict(
    who='Gestor <b>ze@grupodoze.com.br</b> (janela G) e admin (janela A).',
    prep='A mensalidade do mês já está emitida no seed, então a troca gera valor proporcional.',
    steps=[
        'Gestor → <b>Planos</b> → <b>Fazer upgrade</b> no Business: o diálogo mostra a cobrança proporcional (diferença × dias restantes ÷ dias do mês).',
        'Confirme. Na hora, o Business vira "Seu plano" e os recursos exclusivos liberam (ex.: Planta do salão → <b>Duplicar layout</b>, antes bloqueado).',
        'Janela A: Admin → <b>Pagamentos</b>: a fatura proporcional com o valor exato. O e-mail de confirmação aparece no terminal da API.',
        'Volte para o Pro (downgrade): o diálogo mostra o <b>crédito</b> que será abatido na próxima mensalidade; os recursos do Business saem na hora.',
        'Admin → Auditoria e Histórico: a troca registrada (de → para, valor proporcional).',
    ],
    show='Recursos liberados na hora (critério: até 1 minuto) e cobrança proporcional correta (conta mostrada no diálogo e conferida por teste automático).',
)
D[68] = dict(
    who='Gestor <b>lucas@bardomestre.com.br</b> (janela G) e cliente <b>joao@email.com</b> (janela C).',
    prep='<b>Rode <font name="Mono">pnpm db:seed</font> no dia da apresentação</b>: ele coloca o aniversário do João na data de hoje. A campanha "Presente de aniversário" do Bar do Mestre já existe e a rotina automática dispara quando a API sobe (e a cada hora).',
    steps=[
        'Janela C (João): o sino de notificações tem o aviso "Feliz aniversário!" com o cupom — ninguém disparou nada manualmente.',
        'Perfil → <b>Minhas ofertas</b>: o cupom pessoal (NIVER-…), o desconto e a validade.',
        'Use o cupom num pedido do Bar do Mestre: o desconto é aplicado. Outro cliente que digitar o mesmo código recebe "cupom inválido".',
        'Janela G: Gestor → <b>Campanhas segmentadas</b>: enviados, usados e a <b>taxa de uso</b> do segmento.',
        'Crie uma campanha nova (ex.: Clientes frequentes, 3 pedidos em 30 dias): quem já está no segmento recebe na hora; os demais, automaticamente quando entrarem.',
        'Mostre que o cliente informa a data de nascimento em Perfil → Editar.',
    ],
    show='A promoção de aniversário chega sozinha, no dia certo e uma vez por ano (o envio "no dia certo" é provado por teste automático com relógio simulado).',
)

# ─── Montagem ───────────────────────────────────────────────────────────────

SPRINT4 = [('Cliente', [15, 30, 48, 49, 56, 62, 64]), ('Gestor', [57, 67, 70]), ('Administração da plataforma', [33, 38, 39, 66])]
SPRINT5 = [('Administração da plataforma', [32, 35, 40, 41, 42, 43, 52, 55]), ('Gestor', [54, 69, 58, 68])]


def ficha_block(num, sprint):
    f = FICHAS[num]
    d = D[num]
    badge = Table([[P(f'SPRINT {sprint} · FICHA {num} · {f["points"]} PONTOS', 'ficha')]], colWidths=[174 * mm])
    badge.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), ORANGE), ('LEFTPADDING', (0, 0), (-1, -1), 8), ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]))
    parts = [
        badge, Spacer(1, 5), P(f['title'], 'fichatitle'), Spacer(1, 5),
        box([P('HISTÓRIA', 'label'), Spacer(1, 2), P(f['story'], 'quote')]),
        Spacer(1, 5),
        box([P('CRITÉRIO DE AVALIAÇÃO (DO PDF)', 'label'), Spacer(1, 2), P(f['criterion'], 'body')], bg=colors.white, border=LINE),
        P('Quem e onde', 'h2'), P(d['who']),
        P('Antes de mostrar', 'h2'), P(d['prep']),
        P('Roteiro da demonstração', 'h2'), bullets(d['steps'], numbered=True),
        Spacer(1, 6),
        box([P('O QUE MOSTRAR AO PROFESSOR', 'label'), Spacer(1, 2), P(d['show'], 'body')], bg=GREEN_BG),
    ]
    return parts


def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont('Sans', 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10 * mm, 'FilaFacil · Roteiro de demonstração das Sprints 4 e 5')
    canvas.drawRightString(192 * mm, 10 * mm, f'Página {doc.page}')
    canvas.restoreState()


story = []
story += [Spacer(1, 30 * mm), P('Roteiro de demonstração', 'title'), P('Sprints 4 e 5 — uma página por história', 'subtitle'), Spacer(1, 10),
          P('FilaFacil (marca exibida: FilaZero) · 26 histórias · 120 pontos', 'subtitle'), Spacer(1, 14),
          box([P('Como usar este roteiro', 'h2'),
               bullets([
                   'Cada história tem: o texto da ficha, o critério de avaliação, quem/onde, o passo a passo e o que apontar ao professor.',
                   'Siga a ordem: primeiro a preparação (página 2), depois as histórias. Algumas aproveitam dados das anteriores (ex.: o pedido entregue da ficha 15 serve para a 48).',
                   'Todas as contas de demonstração usam a senha <b>FilaFacil123</b>.',
                   'Os critérios com prazo ("até 1 minuto", "no dia seguinte", "no dia certo") também são provados por testes automáticos com relógio simulado (486 testes passando).',
               ])])]
story.append(PageBreak())

# Preparação
story += [P('Preparação (10 minutos antes)', 'h1'),
          P('1. Atualize o código e o banco', 'h2'),
          P('cd FilaFacil<br/>git checkout main &amp;&amp; git pull<br/>pnpm install<br/>pnpm db:up &amp;&amp; pnpm db:migrate &amp;&amp; pnpm db:seed<br/>pnpm dev', 'code'),
          Spacer(1, 4),
          P('Rode o <b>pnpm db:seed no dia da apresentação</b>: ele coloca o aniversário do João na data de hoje (ficha 68) e recria as mensalidades do mês. Deixe o terminal do <font name="Mono">pnpm dev</font> visível: os códigos de verificação e os e-mails de aviso aparecem nele ("[E-mail dev]").', 'body'),
          P('2. Abra quatro janelas (cada uma com um login diferente)', 'h2'),
          P('O navegador compartilha os cookies entre abas. Use navegadores ou perfis diferentes (ex.: Chrome normal, Chrome anônimo, Edge, Firefox).', 'small'),
          Spacer(1, 3),
          table([
              ['Janela', 'Endereço', 'Conta', 'Para quê'],
              ['A · Admin', 'localhost:5173/admin', 'admin@filazero.app', 'Plataforma: painel, métricas, organizações, parceiros, incidentes, pagamentos, suporte, auditoria, acessos, configurações'],
              ['G · Gestor', 'localhost:5173/gestor', 'lucas@bardomestre.com.br', 'Bar do Mestre (Business, admin da rede). Também abre /atendente'],
              ['C · Cliente', 'localhost:5173/ (modo celular: F12 → ícone de celular)', 'joao@email.com', 'App do cliente'],
              ['P · Parceiro', 'localhost:5173/parceiro (anônima)', 'sem login', 'Cadastro de novo estabelecimento'],
          ], [24, 46, 44, 60]),
          P('3. Outras contas usadas', 'h2'),
          table([
              ['Conta', 'Uso'],
              ['ze@grupodoze.com.br', 'Gestor com plano Pro (fichas 58 e 69: comparativo e troca de plano)'],
              ['paula@cantina.edu.br', 'Gestora da Cantina (ficha 35: visualizador da rede)'],
              ['carlos@bardomestre.com.br', 'Atendente do Bar do Mestre (/atendente)'],
              ['Código dev-parceiro-cantina-boa-vista-0001', 'Acompanhar em /parceiro um cadastro "aguardando análise"'],
              ['Código dev-parceiro-emporio-do-chopp-0002', 'Acompanhar em /parceiro um cadastro "aguardando mais informações"'],
          ], [70, 104]),
          P('4. Avisos que valem para toda a demonstração', 'h2'),
          bullets([
              'O <b>pagamento é simulado</b>: nenhum dinheiro é movido (a tela informa). Cartão: escolha "Pagamento aprovado".',
              'E-mails e SMS não são enviados de verdade em desenvolvimento: aparecem no terminal da API.',
              'Se algo der errado no meio, <font name="Mono">pnpm db:seed</font> restaura os dados de demonstração sem apagar o que foi criado.',
          ]),
          ]
story.append(PageBreak())

# Índice
rows = [['Sprint', 'Ficha', 'História', 'Perfil']]
for sprint, groups in ((4, SPRINT4), (5, SPRINT5)):
    for group, nums in groups:
        for n in nums:
            rows.append([str(sprint), str(n), FICHAS[n]['title'], group])
story += [P('Índice das histórias', 'h1'), table(rows, [16, 14, 96, 48]), PageBreak()]

for sprint, groups in ((4, SPRINT4), (5, SPRINT5)):
    for group, nums in groups:
        for n in nums:
            story += ficha_block(n, sprint)
            story.append(PageBreak())

# Apêndice
story += [P('Apêndice — comandos da ficha 33 (incidentes)', 'h1'),
          P('Sinal de vida normal do PDV (rode algumas vezes; parar de enviar = queda):', 'body'), Spacer(1, 3),
          P('curl -X POST http://localhost:3000/api/integrations/heartbeat \\<br/>&nbsp;&nbsp;-H "X-Integration-Key: ik_dev_pdv_caixa1_demo_key" \\<br/>&nbsp;&nbsp;-H "Content-Type: application/json" -d "{}"', 'code'),
          Spacer(1, 8),
          P('Falha informada pelo PDV (abre o incidente na hora):', 'body'), Spacer(1, 3),
          P('curl -X POST http://localhost:3000/api/integrations/heartbeat \\<br/>&nbsp;&nbsp;-H "X-Integration-Key: ik_dev_pdv_caixa1_demo_key" \\<br/>&nbsp;&nbsp;-H "Content-Type: application/json" \\<br/>&nbsp;&nbsp;-d "{\\"status\\":\\"error\\",\\"message\\":\\"Impressora sem papel\\"}"', 'code'),
          Spacer(1, 6),
          P('No Windows (PowerShell), use <font name="Mono">curl.exe</font> no lugar de <font name="Mono">curl</font>.', 'small'),
          P('Onde está cada coisa no código', 'h1'),
          P('Para quem quiser conferir a implementação: <font name="Mono">docs/sprint4-especificacao.md</font> e <font name="Mono">docs/sprint5-especificacao.md</font> mostram, para cada ficha, o critério, como foi atendido e os arquivos. Os testes automáticos ficam em <font name="Mono">apps/api/test/integration</font> (rode <font name="Mono">pnpm test</font>).', 'body'),
          ]

doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
                        title='Roteiro de demonstração — Sprints 4 e 5', author='FilaFacil')
doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
print('ok', OUT)
