# Trade Performance · J. Cruzeiro

Business Intelligence comercial em React + TypeScript, alimentado pelo relatório hierárquico de vendas do Santri.

## Escopo entregue

- visão geral com venda líquida, lucro presente, margem, ticket, transações, desconto e quantidade;
- resumo semanal das categorias, diagnóstico automático e prioridade;
- matriz venda × margem em quatro quadrantes;
- páginas de categorias, detalhe da categoria, marcas, produtos/SKU, relatórios e qualidade dos dados;
- filtros globais de período, categoria, marca e comparação;
- exportação CSV, Excel e impressão/PDF;
- páginas administrativas com “Dados insuficientes” para campos ausentes;
- importador ODS → JSON, validação matemática e testes básicos.

## Fonte tratada nesta versão

`Relação de vendas por produto por agrupador, itens e movimentos - 16-07-2026(2).ods`

Estrutura real encontrada:

1. categoria (código de três dígitos);
2. família;
3. subcategoria;
4. agrupamento;
5. produto (ADM, descrição, NCM, marca e código original);
6. movimento (data, quantidade, preço, venda, frete, desconto, custo e lucro).

O arquivo contém movimentos de 02/01/2025 a 16/07/2026. Nesta importação foram aproveitados 496.761 movimentos datados, associados a 8.615 produtos, 21 categorias e 308 marcas.

### Limitações oficiais da fonte

O ODS recebido não contém loja, vendedor, meta, estoque ou snapshot da última reunião de Trade. A apresentação `Apresentação - Reunião Trade.pptx` e o arquivo `TOP 10 SKU.xlsx`, citados no briefing, não foram anexados nesta execução. Por isso, essas análises não foram simuladas.

## Regras de cálculo

- **Venda líquida:** campo `Total líquido` do movimento.
- **Lucro nominal:** `Total líquido − Custo`.
- **Lucro presente:** `Base lucro pres. − Custo`.
- **Margem consolidada:** `Σ Lucro presente ÷ Σ Base lucro pres.`. Não é média simples das margens.
- **Diferença de margem:** margem atual menos margem anterior, apresentada em pontos percentuais.
- **Ticket médio:** venda líquida dividida pela quantidade de movimentos únicos.
- **Preço médio:** venda líquida dividida pela quantidade vendida.
- **Desconto médio:** soma do desconto em reais dividida pela soma da base bruta.
- **Participação:** venda da categoria dividida pela venda total filtrada.
- **Semana operacional:** segunda-feira a sábado.
- **Comparação padrão:** última semana fechada contra a semana anterior.
- **Faixa neutra:** venda de -1% a +1%; margem de -0,2 a +0,2 p.p.
- **Datas ausentes:** movimentos sem data de fechamento ficam registrados na qualidade dos dados e não entram em análises temporais.

## Instalação e execução

Requer Node.js 22+ e Python 3.11+ com `lxml`.

```bash
npm install
npm run dev
```

O ambiente abre a aplicação em desenvolvimento. Para gerar a versão de produção:

```bash
npm run build
```

## Atualizar o relatório

Execute o importador passando o caminho do novo ODS:

```bash
npm run import-data -- "/caminho/novo-relatorio.ods"
```

O comando recria:

- `public/data/dashboard.json.gz` — indicadores, categorias, marcas, séries e qualidade;
- `public/data/products.json.gz` — catálogo analítico de produtos;
- os períodos de comparação com base na data máxima do relatório.

Depois valide os fechamentos:

```bash
python3 scripts/validate_data.py
python3 -m unittest tests/test_import_sales_data.py
```

A validação compara venda, custo, base de lucro e lucro presente por categoria, marca e produto, incluindo três períodos distintos. O resultado fica em `public/data/validation.json`.

## Estrutura principal

```text
app/
  dashboard-client.tsx   interface, rotas, filtros e páginas
  globals.css            identidade visual e responsividade
  types.ts               contratos dos dados
  utils.ts               cálculos e formatação
scripts/
  import_sales_data.py   leitura hierárquica e geração dos JSONs
  validate_data.py       reconciliação dos totais
public/data/
  dashboard.json.gz
  products.json.gz
tests/
  test_import_sales_data.py
```

## Publicação no Vercel

1. envie o projeto para um repositório Git;
2. importe o repositório no Vercel;
3. use Node.js 22;
4. comando de instalação: `npm install`;
5. comando de build: `npm run build`;
6. mantenha `public/data/*.json.gz` versionado, pois os dados são servidos localmente;
7. faça uma nova publicação sempre que o ODS for reimportado.

Não configure processamento do ODS durante cada acesso. O relatório deve ser convertido antes do deploy.

## GitHub Pages

A cópia do GitHub Pages é estática e usa os arquivos consolidados versionados em
`.github/pages-data`; o workflow remonta os arquivos em `public/data` antes de
gerar o site. O botão de importação de ODS fica oculto nessa hospedagem, pois o
Pages não executa as rotas de servidor responsáveis por validar e salvar novos
fechamentos.

Em hospedagens com servidor, configure `ALLOWED_UPLOADERS` como uma lista de
e-mails separados por vírgula para habilitar o importador. Nenhum e-mail pessoal
fica gravado no código público.

```bash
npm ci
npm run assemble:pages-data
npm run build:pages
```

O workflow `.github/workflows/pages.yml` publica automaticamente `pages-dist`
a cada envio para a branch `main`.

## Arquivos ainda necessários para completar 100% do briefing

- apresentação da última reunião de Trade, para metas e snapshot histórico;
- `TOP 10 SKU.xlsx`, para conciliação complementar por ADM;
- relatório com loja e vendedor em cada movimento;
- metas mensais oficiais por loja e/ou categoria;
- calendário de feriados, se a projeção mensal for ativada.
