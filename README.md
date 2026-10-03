# FilaFacil

Sistema de gerenciamento de filas e pedidos para bares e restaurantes. O cliente escaneia o QR Code da mesa, monta o pedido, paga pelo app e acompanha o preparo em tempo real, sem disputar espaço no balcão.

Este repositório contém o **frontend** referente às **Sprints 1 e 2**. Ainda não há backend: os dados são mockados e ficam organizados para serem trocados pela API sem alterar as telas.

> A interface exibe a marca **FilaZero**, nome usado no protótipo e nas fichas das sprints. Para trocar a marca, altere `src/config/brand.ts` e o `<title>` do `index.html`.

## Sumário

- [Stack](#stack)
- [Requisitos](#requisitos)
- [Como rodar](#como-rodar)
- [Perfis e rotas](#perfis-e-rotas)
- [Funcionalidades](#funcionalidades)
- [Dados de demonstração](#dados-de-demonstração)
- [Arquitetura](#arquitetura)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Integração com o backend](#integração-com-o-backend)
- [Fora do escopo atual](#fora-do-escopo-atual)

## Stack

- [React 19](https://react.dev) com TypeScript em modo `strict`
- [Vite 8](https://vite.dev)
- [Tailwind CSS v4](https://tailwindcss.com) (tokens de design em `src/index.css`)
- [lucide-react](https://lucide.dev) para ícones
- ESLint (`typescript-eslint`, `react-hooks`, `react-refresh`)
- pnpm

## Requisitos

- Node.js **22.12+** (ou 20.19+)
- pnpm **11** (versão fixada em `packageManager` no `package.json`; com Corepack basta `corepack enable`)

## Como rodar

```bash
pnpm install
pnpm dev
```

A aplicação sobe em `http://localhost:5173`.

| Script           | O que faz                                  |
|------------------|--------------------------------------------|
| `pnpm dev`       | Servidor de desenvolvimento com HMR        |
| `pnpm build`     | Checagem de tipos + build de produção (`dist/`) |
| `pnpm preview`   | Serve o build de produção localmente       |
| `pnpm typecheck` | Checagem de tipos (`tsc -b`)               |
| `pnpm lint`      | ESLint em todo o projeto                   |

## Perfis e rotas

Cada perfil é um app independente, carregado sob demanda em sua própria URL:

| Rota         | Perfil    | Uso                         |
|--------------|-----------|-----------------------------|
| `/`          | Cliente   | Web app mobile (PWA-like)   |
| `/atendente` | Atendente | Tablet no salão             |
| `/gestor`    | Gestor    | Painel do estabelecimento   |
| `/admin`     | Admin     | Painel da plataforma        |

Rodando com `pnpm dev`, o botão **DEV** no canto inferior direito alterna entre os perfis e restaura os dados de demonstração. Essa ferramenta existe só em desenvolvimento e não entra no build de produção.

## Funcionalidades

Os números entre parênteses são as fichas das sprints.

### Cliente

| Funcionalidade | Sprint |
|---|---|
| Cadastro com nome e CPF validado; CPF inválido ou já cadastrado é bloqueado (01) | 1 |
| Cardápio com foto, descrição, preço, categorias, busca e filtro (03) | 1 |
| Login por celular (código), e-mail e senha, Google e Apple; sessão mantida (06) | 1 |
| Busca de restaurantes próximos: ordenação por distância, filtros (aberto agora, mais próximos, menor espera), mapa e status "aceitando pedidos" (11) | 1 |
| Página do restaurante: galeria de fotos, nota média, endereço com "Como chegar", horário do dia e cardápio (12) | 1 |
| Perfil: edição de nome, e-mail e telefone, endereços salvos e atalho para pedidos (13) | 1 |
| QR Code da mesa: leitor pela câmera, código manual, pedido vinculado à mesa, QR inválido e estabelecimento fechado (02) | 2 |
| Pagamento por Pix ou cartão de crédito/débito, comprovante digital e tratamento de recusa (04) | 2 |
| Carrinho com edição de quantidade, remoção e total atualizado na hora (08) | 2 |
| Acompanhamento do pedido: recebido, pagamento, preparo, pronto e entregue, com estimativa e local de retirada (09) | 2 |
| Recuperação de senha por e-mail ou SMS, com código que expira em 30 minutos (44) | 2 |
| Favoritos salvos na conta, aba de favoritos e remoção com um toque (45) | 2 |
| Selo "+ pedido" nos itens mais vendidos ou destacados pelo gestor (46) | 2 |
| Exclusão de conta conforme a LGPD, com autenticação adicional (53) | 2 |
| Login por biometria como atalho opcional, ativado no perfil (59) | 2 |
| Filtro por categoria de comida com seleção múltipla (60) | 2 |
| Verificação de e-mail/telefone por código; conta não verificada não paga pelo app (65) | 2 |

### Atendente

| Funcionalidade | Sprint |
|---|---|
| Disponibilidade do cardápio: item esgotado some do cardápio do cliente, com histórico de alterações (19) | 1 |
| Mapa de mesas por status (livre, ocupada, reservada, chamado), pessoas por mesa e destaque de chamados, montado a partir da planta do gestor (16) | 2 |

### Gestor

| Funcionalidade | Sprint |
|---|---|
| Editor visual da planta do salão (arrastar e soltar, formato e capacidade das mesas), salvo por estabelecimento (20) | 1 |
| Fila de espera: estimativa pelas mesas livres, reordenação, notificação e aviso automático ao liberar uma mesa compatível (21) | 1 |
| Cadastro e edição do cardápio, com upload de foto (28) | 1 |
| Promoções por período, aplicadas e encerradas automaticamente no cardápio do cliente (29) | 1 |
| Fichas técnicas: ingredientes, custo calculado automaticamente e alerta de custo acima do limite (31) | 1 |
| Destaque manual de itens no cardápio (46) | 2 |
| Mesclar e desfazer mesclagem de mesas, refletido no mapa do atendente (47) | 2 |
| Duplicar a planta entre unidades da mesma organização (61) | 2 |
| QR Code único por mesa (02) | 2 |

### Admin

| Funcionalidade | Sprint |
|---|---|
| Estabelecimentos: cadastro, edição, vínculo com organização e status ativo/inativo/suspenso; inativo some da busca do cliente (34) | 1 |
| Usuários: filtro por papel, edição de papel e permissões, suspensão e histórico de alterações (36) | 1 |
| Planos de assinatura: preço, limites e recursos; troca de plano libera ou bloqueia recursos do gestor na hora (37) | 1 |

## Dados de demonstração

| O quê | Valor |
|---|---|
| Código de verificação (SMS, e-mail, recuperação de senha, exclusão de conta) | `123456` |
| Conta demo por e-mail | `joao@email.com` + qualquer senha com 8 ou mais caracteres |
| Conta demo por celular | `(19) 99999-9999` + código `123456` |
| QR Code de mesa (estabelecimento aberto) | `MESTRE-1041` |
| QR Code de mesa (estabelecimento fechado) | `CANTINA-1201` |
| Cartão aprovado | `4111 1111 1111 1111` |
| Cartão recusado | qualquer número válido terminado em `0002` (ex.: `4000 0000 0000 0002`) |

A lista completa de códigos de mesa fica em **Gestor → QR Codes**. A senha não é validada no mock; essa conferência é responsabilidade do backend.

## Arquitetura

- **Apps por perfil**: `src/App.tsx` resolve o perfil pela URL e carrega o app correspondente com `React.lazy`. Cliente, Atendente, Gestor e Admin evoluem de forma independente e geram chunks separados no build.
- **Camada de dados**: as telas nunca leem os mocks diretamente. Elas usam hooks e funções de `src/services/`, que hoje operam sobre um store em memória espelhado no `localStorage` (`src/lib/store.ts`, prefixo `filafacil:v1:`). Por isso, uma alteração em um perfil aparece nos demais, inclusive em outra aba do navegador.
- **Tempo real simulado**: o status do pedido avança conforme o tempo decorrido (`orderService`), substituindo temporariamente os eventos do servidor.
- **Segurança no cliente**: nenhum dado de cartão ou senha é persistido; o CPF fica salvo apenas mascarado e como hash para checar duplicidade; URLs de imagem aceitam somente `https` ou `data:image`.

## Estrutura de pastas

```
src/
├── app/          # Mapa perfil ↔ rota
├── apps/
│   ├── client/   # App do cliente (telas, hooks, componentes próprios)
│   ├── attendant/
│   ├── manager/
│   └── admin/
├── components/   # UI compartilhada: ui/, layout/, brand/, floor/
├── config/       # Marca
├── data/         # Seeds mockados
├── dev/          # Ferramentas só de desenvolvimento
├── lib/          # Store persistido, hooks, formatação e validações (CPF, cartão, e-mail, telefone)
├── services/     # Acesso a dados — ponto de integração com a API
└── types/        # Tipos de domínio
```

## Integração com o backend

Para ligar a API, substitua a implementação dos arquivos em `src/services/` mantendo as mesmas assinaturas. Pontos que hoje são simulados:

- Envio e validação de códigos por SMS/e-mail e conferência de senha (`authService`)
- OAuth com Google e Apple (`authService`)
- Gateway de pagamento, Pix e estorno (`orderService`)
- Atualização do status do pedido e das mesas em tempo real (`orderService`, `floorService`)
- Busca por geolocalização e cálculo de distância (`deviceService`, `establishmentService`)
- Ranking de itens mais pedidos (`menuService`)
- Biometria com WebAuthn e desafio emitido pelo servidor (`deviceService`)
- Notificação ao cliente da fila de espera (`waitlistService`)
- Geração da imagem do QR Code por mesa (hoje o código é único, mas a imagem é ilustrativa)

## Fora do escopo atual

Funcionalidades previstas para sprints posteriores não estão disponíveis nesta versão: reservas, fidelidade, cashback, carteira e cartões salvos, cupons, indicação, comanda compartilhada, chamada de garçom, KDS, fila de pedidos do atendente, dashboards e relatórios, estoque, equipe, financeiro e demais módulos administrativos.
