const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { pagination, extractArticles, loadCheckpoint, saveCheckpoint } = require('./functions');
const { generateCsv } = require('./generateDbCsv');

function getDateRange() {
  const end = new Date();
  let start;

  // Tenta ler a data da última execução do checkpoint.json
  const checkpoint = loadCheckpoint();
  if (checkpoint.lastRun) {
    // Converte de YYYY/MM/DD para Date object
    const parts = checkpoint.lastRun.split('/'); // Assumindo formato YYYY/MM/DD
    start = new Date(parts[0], parts[1] - 1, parts[2]);
    console.log(`Data da última execução encontrada no checkpoint: ${checkpoint.lastRun}`);
  }

  // Fallback: Se não houver data salva, inicia do dia 1º do mês atual
  if (!start) {
    start = new Date();
    start.setDate(1); 
    console.log("Nenhuma data anterior encontrada. Iniciando do dia 01 do mês atual.");
  }

  const formatDate = (date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
  };

  return {
    start: formatDate(start),
    end: formatDate(end)
  };
}



async function scrapePubMed() {
  // URL base sem o filtro de anos (será aplicado via UI)
  const url = 'https://pubmed.ncbi.nlm.nih.gov/?term=portuguese%5BLanguage%5D&filter=simsearch2.ffrft&filter=lang.english&filter=lang.portuguese&filter=hum_ani.humans';

  const dateRange = getDateRange();
  console.log(`Configurando filtro de data: ${dateRange.start} até ${dateRange.end}`);

  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
    protocolTimeout: 0 
  });

  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Interação com Datepicker conforme análise do DOM
    const datePickerTrigger = "#datepicker-trigger";
    await page.waitForSelector(datePickerTrigger, { timeout: 10000 });
    await page.click(datePickerTrigger);

    console.log("Menu Custom Range aberto.");

    // Seletores dos inputs (baseados no dump)
    const selectors = {
        startYear: '.start-year',
        startMonth: '.start-month',
        startDay: '.start-day',
        endYear: '.end-year',
        endMonth: '.end-month',
        endDay: '.end-day',
        applyBtn: '.apply-btn'
    };

    // Aguarda inputs aparecerem
    await page.waitForSelector(selectors.startYear, { visible: true, timeout: 5000 });

    // Parse das datas (formato atual da função getDateRange: YYYY/MM/DD)
    const [startYear, startMonth, startDay] = dateRange.start.split('/');
    const [endYear, endMonth, endDay] = dateRange.end.split('/');

    console.log(`Preenchendo Data Inicial: ${startDay}/${startMonth}/${startYear}`);
    await page.type(selectors.startDay, startDay);
    await page.type(selectors.startMonth, startMonth);
    await page.type(selectors.startYear, startYear);

    console.log(`Preenchendo Data Final: ${endDay}/${endMonth}/${endYear}`);
    await page.type(selectors.endDay, endDay);
    await page.type(selectors.endMonth, endMonth);
    await page.type(selectors.endYear, endYear);

    // Clica em Apply
    console.log("Clicando em Apply...");
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click(selectors.applyBtn)
    ]);
    console.log("Filtro de data aplicado com sucesso.");

    // Espera a lista carregar
    await page.waitForSelector('.search-results-chunk');

    // Chama a função de paginação passando a página, a função de extração e options
    // Agora permitimos que ele use o checkpoint.json para retomar de onde parou (se houver lastProcessedPage)
    const allArticles = await pagination(page, extractArticles);

    console.log(`Total de artigos raspados: ${allArticles.length}`);

    // Salva a data final da execução atual e reseta o checkpoint de página para a próxima vez
    try {
        saveCheckpoint({ 
            lastRun: dateRange.end,
            lastProcessedPage: 0 // Reseta para que a próxima execução (em outra data) comece do início
        });
        console.log(`Configurações de checkpoint atualizadas: Data ${dateRange.end}, Página resetada.`);
    } catch (saveErr) {
        console.error("ERRO CRÍTICO ao salvar checkpoint final:", saveErr);
    }

  } catch (error) {
    console.error("Erro durante a navegação/scraping:", error);
  } finally {
    await browser.close();
  }

  // Generate CSV
  try {
    generateCsv();
  } catch (error) {
    console.error("Erro ao gerar CSV:", error);
  }
}

scrapePubMed().catch(console.error);
