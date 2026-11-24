"""Gera docs/colinha-demonstracao.pdf: uma linha por história. Uso: python3 docs/demo/gerar-colinha.py docs/colinha-demonstracao.pdf"""
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

LIB = '/usr/share/fonts/truetype/liberation'
pdfmetrics.registerFont(TTFont('Sans', f'{LIB}/LiberationSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', f'{LIB}/LiberationSans-Bold.ttf'))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily('Sans', normal='Sans', bold='Sans-Bold', italic='Sans', boldItalic='Sans-Bold')

ORANGE = colors.HexColor('#E8710A')
SOFT = colors.HexColor('#FFF4EA')
LINE = colors.HexColor('#E6DED4')
MUTED = colors.HexColor('#6B645C')
cell = ParagraphStyle('c', fontName='Sans', fontSize=7.6, leading=9.6)
head = ParagraphStyle('h', fontName='Sans-Bold', fontSize=7.8, leading=9.6, textColor=colors.white)
title = ParagraphStyle('t', fontName='Sans-Bold', fontSize=13, leading=16)
small = ParagraphStyle('s', fontName='Sans', fontSize=7.6, leading=10, textColor=MUTED)
sect = ParagraphStyle('x', fontName='Sans-Bold', fontSize=8.2, leading=10, textColor=ORANGE)

# (ficha, nome curto, conta → tela, o que fazer, o que provar)
S4 = [
    ('15', 'Cashback', 'Cliente → Bar do Mestre → pagar; Atendente → Pedidos', 'Pedir e pagar (Pagamento aprovado) → atendente marca <b>entregue</b> → Perfil › Meu cashback → novo pedido com <b>Usar meu cashback</b>', 'Saldo entra na entrega e é usado no checkout seguinte'),
    ('30', 'Reservas', 'Cliente → Bar do Mestre › <b>Reservar com data e horário</b>', 'Data + pessoas + horário → confirmada → Perfil › Minhas reservas; Gestor › <b>Reservas de mesa</b>', 'Status "confirmada" no cliente e no gestor'),
    ('48', 'Avaliar', 'Cliente → Pedidos › pedido entregue › <b>Avaliar pedido</b>', 'Anotar a nota do Bar do Mestre → avaliar com nota e comentário → voltar à página do bar', 'Média muda na hora + comentário na lista'),
    ('49', 'Cartão salvo', 'Cliente → Perfil › <b>Métodos de pagamento</b>', 'Adicionar 4111 1111 1111 1111 → <b>Definir como padrão</b> → novo pedido', 'Cartão já vem selecionado no checkout'),
    ('56', 'Cupom', 'Cliente → pagamento (pedido > R$ 30)', '<b>VERAO24</b> (expirado) → <b>BEMVINDO10</b> (10%) → repetir BEMVINDO10 em outro pedido', 'Desconto certo; expirado/usado recusado com mensagem'),
    ('62', 'Compartilhar', 'Cliente → Bar do Mestre › ícone compartilhar', 'Copiar link → colar em janela anônima; Gestor › Dashboard (origem)', 'Abre direto na página do restaurante'),
    ('64', 'Alergias', 'Cliente → Perfil › <b>Alergias e restrições</b>', 'Marcar <b>Glúten</b> → cardápio do Bar do Mestre → <b>Cerveja IPA 600ml</b> → adicionar', 'Selo + aviso + confirmação antes do carrinho'),
    ('57', 'Custo por período', 'Gestor → <b>Custo por período</b>', 'Mês atual → mostrar linhas (qtd × custo da ficha) → <b>Exportar CSV/PDF</b>', 'Total = soma das fichas × quantidade'),
    ('67', 'Duplicar item', 'Gestor → <b>Cardápio</b> › ícone <b>Duplicar item</b>', 'Formulário vem preenchido → mudar nome/preço → salvar', 'Item novo em segundos, mesmos dados e foto'),
    ('70', 'Validade', 'Gestor → banner amarelo / <b>Validade de insumos</b>', 'Mostrar lote vencendo em 5 dias → <b>Cadastrar lote</b> vencendo em 4 dias', 'Alerta com ≥ 3 dias (padrão 7) + pratos afetados'),
    ('33', 'Incidentes', 'Admin → <b>Incidentes</b> + terminal (curl do PDV)', 'Mandar heartbeat → parar → ~35 s → banner vermelho (ou curl com status error = na hora)', 'Incidente < 1 min + nº de casas impactadas'),
    ('38', 'Faturas', 'Admin → <b>Pagamentos</b>; Gestor → <b>Faturas</b>', 'Seu Joaquim Bar = <b>Atrasada</b> → <b>Executar cobrança agora</b> → <b>Registrar pagamento</b>', 'Vencida vira "atrasado" e avisa a casa (dia seguinte: teste automático)'),
    ('39', 'Suporte', 'Gestor → <b>Suporte › Novo chamado</b>; Admin → <b>Suporte</b>', 'Abrir chamado urgente → aparece na fila do admin → <b>Responder</b> → sino do gestor', 'Na fila em segundos; casa avisada a cada resposta'),
    ('66', 'Histórico', 'Admin → <b>Estabelecimentos</b> › editar → <b>Histórico</b>', 'Mudar tempo de espera/endereço → ver registro', 'Autor, data, antes e depois; não pode apagar'),
]
S5 = [
    ('32', 'Painel geral', 'Admin → <b>Visão geral</b>', 'Cartões do dia vs ontem → somar a tabela = linha Total → casas com problema no topo', 'Totais = soma das casas ativas'),
    ('41', 'Métricas', 'Admin → <b>Métricas</b>', 'Trocar período (7/30/90) → <b>Comparar com outro período</b> → hover no gráfico → exportar', 'Recalcula e bate com a soma por casa'),
    ('35', 'Organizações', 'Admin → <b>Organizações</b> › Grupo Bar do Mestre; Gestor → <b>Minha rede</b>', 'Relatório consolidado → <b>Abrir</b> unidade → adicionar Paula como Visualizador', 'Consolidado certo + navegar para cada unidade'),
    ('40', 'Integrações', 'Admin → <b>Incidentes</b> (raio = testar)', 'Testar Gateway = Disponível → nova integração com URL <b>http://localhost:3999/health</b> → testar → desligar', '"Indisponível" + incidente na hora'),
    ('42', 'Auditoria', 'Cliente novo (anônima) → excluir conta; Admin → <b>Auditoria</b>', 'Criar conta → Segurança › excluir conta → ver "Conta excluída" → abrir detalhe / filtros', 'Registro imutável em segundos'),
    ('43', 'Configurações', 'Admin → <b>Configurações</b>; Cliente → Bar do Mestre', 'Desligar <b>Reservas de mesa</b> → impacto → confirmar → botão some no cliente → religar', 'Muda em ~10 s sem deploy'),
    ('52', 'Acessos', 'João em outro navegador; Admin → <b>Acessos</b>', 'Login do João → selo <b>Novo aparelho</b> → <b>Encerrar</b> → João cai', 'Registro imediato + encerrar em 1 clique'),
    ('55', 'Novo parceiro', '<b>/parceiro</b> (anônima); Admin → <b>Novos parceiros</b>', 'Cadastrar (CNPJ 04.252.011/0001-10, 00:00–23:59) → anexar PDF → admin <b>Aprovar</b> → aparece no app; outro: <b>Recusar</b> com motivo', 'Aprovado aceita pedido na hora; recusado vê o motivo'),
    ('54', 'Importar cardápio', 'Gestor → <b>Importar cardápio</b>', '<b>docs/demo/cardapio-50-itens.csv</b> → Validar → Importar; depois <b>cardapio-com-erros.csv</b> → planilha de erros', '50 itens em < 1 s com relatório'),
    ('69', 'Comparar planos', '<b>ze@grupodoze.com.br</b> → Gestor › <b>Planos</b>', 'Mostrar colunas, "Seu plano" (Pro) e linhas destacadas', 'Lado a lado com o atual destacado'),
    ('58', 'Trocar plano', '<b>ze@grupodoze.com.br</b> → <b>Planos</b>; Admin → Pagamentos', '<b>Fazer upgrade</b> Business (mostra proporcional) → Planta › Duplicar layout liberado → voltar p/ Pro (crédito)', 'Recursos na hora + valor proporcional'),
    ('68', 'Campanha', 'Cliente João → sino / Perfil › <b>Minhas ofertas</b>; Gestor → <b>Campanhas segmentadas</b>', 'Mostrar cupom NIVER-… que chegou sozinho → usar no pedido → taxa de uso no gestor', 'Aniversário chega no dia, sem disparo manual'),
]


def rows(data):
    return [[Paragraph(f'<b>{n}</b>', cell), Paragraph(f'<b>{name}</b>', cell), Paragraph(where, cell), Paragraph(what, cell), Paragraph(proof, cell)] for n, name, where, what, proof in data]


def block(label, data):
    header = [Paragraph(h, head) for h in ('Ficha', 'História', 'Onde (conta → tela)', 'O que fazer', 'O que provar')]
    t = Table([header] + rows(data), colWidths=[11 * mm, 27 * mm, 68 * mm, 110 * mm, 61 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), ORANGE),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, SOFT]),
        ('GRID', (0, 0), (-1, -1), 0.3, LINE),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
    ]))
    return [Paragraph(label, sect), Spacer(1, 2), t]


INFO = ('Senha de todas as contas: <b>FilaFacil123</b> · Admin <b>admin@filazero.app</b> (/admin) · Gestor <b>lucas@bardomestre.com.br</b> (/gestor e /atendente) · Cliente <b>joao@email.com</b> (/) · '
        'Antes: <b>pnpm db:seed</b> no dia (aniversário do João = hoje) e <b>pnpm dev</b> · Códigos e e-mails aparecem no terminal da API · Pagamento é simulado: escolha "Pagamento aprovado".')
story = [
    Paragraph('Colinha da demonstração — Sprint 4', title), Paragraph(INFO, small), Spacer(1, 5),
] + block('SPRINT 4 · 14 HISTÓRIAS', S4) + [
    Spacer(1, 5),
    Paragraph('PDV (ficha 33): <font name="Sans-Bold">curl -X POST http://localhost:3000/api/integrations/heartbeat -H "X-Integration-Key: ik_dev_pdv_caixa1_demo_key" -H "Content-Type: application/json" -d "{}"</font> '
              '— queda na hora: troque o corpo por <font name="Sans-Bold">{\\"status\\":\\"error\\"}</font> (Windows: curl.exe). Passo a passo completo: docs/roteiro-demonstracao-sprints-4-5.pdf.', small),
    PageBreak(),
    Paragraph('Colinha da demonstração — Sprint 5', title), Paragraph(INFO, small), Spacer(1, 5),
] + block('SPRINT 5 · 12 HISTÓRIAS', S5) + [
    Spacer(1, 5),
    Paragraph('Contas extras: <b>ze@grupodoze.com.br</b> (plano Pro: fichas 58 e 69) · <b>paula@cantina.edu.br</b> (visualizador da rede: ficha 35) · Parceiro de exemplo em /parceiro › Acompanhar: <b>dev-parceiro-cantina-boa-vista-0001</b>. '
              'Planilhas da ficha 54 em <b>docs/demo/</b>.', small),
]

doc = SimpleDocTemplate(sys.argv[1], pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=9 * mm, bottomMargin=8 * mm, title='Colinha da demonstração — Sprints 4 e 5')
doc.build(story)
print('ok')
