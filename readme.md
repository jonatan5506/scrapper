# PubMed Scraper - Execução Mensal

Este projeto realiza o scraping de artigos em Português do PubMed (NCBI) e gera um arquivo CSV consolidado.

## Estrutura de Arquivos

- **`index.js`**: Script principal. Gerencia o navegador, aplica filtros de data (mês corrente) e orquestra a raspagem.
- **`functions.js`**: Contém as funções utilitárias: `getDateRange`, `saveLastRunDate`, `pagination`, `downloadPdf`, e `extractArticles`.
- **`run_monthly_job.sh`**: Script Shell para execução via Cron. Configura o ambiente e chama o `index.js`.
- **`generateDbCsv.js`**: Gera o arquivo `db.csv` a partir do `db.json` consolidado.

## Dados

Todos os dados são persistidos na pasta `data/`:

- **`db.json`**: Base de dados principal com todos os artigos raspados.
- **`db.json`**: Base de dados principal com todos os artigos raspados.
- **`checkpoint.json`**: Armazena a data da última execução e o progresso da paginação para garantir continuidade e retomada em caso de falha.

## Configuração do Cron

O script está configurado para rodar automaticamente todo dia 10 de cada mês às 08:00.

Para verificar ou editar o agendamento:

```bash
crontab -e
```

Entrada típica:

```bash
0 8 10 * * /home/jhon/Desktop/CarteiraDeSaude/scrapeJsPubmed/run_monthly_job.sh
```

## Logs

A saída da execução do Cron é salva em:
`cron_output.log` (na raiz do projeto)


# PASSO A PASSO DA EXECUÇÃO

1º RODAR A PESQUISA COM NODE INDEX.JS
2º JOGAR PDFS PARA CDN - PASTA ARTIGOS_MEDIGOS/PUBMED
3º INSERIR OS DADOS DE DB.JSON NO BANCO DE DADOS