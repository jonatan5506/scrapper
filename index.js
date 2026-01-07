const puppeteer = require('puppeteer');
const { pagination, extractArticles } = require('./functions');

async function scrapePubMed() {
  const url = 'https://pubmed.ncbi.nlm.nih.gov/?term=portuguese%5BLanguage%5D&filter=datesearch.y_10&filter=simsearch2.ffrft';

  const browser = await puppeteer.launch({ 
    headless: false,//Se for true, não abre o navegador
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
  });

  const page = await browser.newPage();

  // Aumentar timeout se necessário
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // Espera a primeira carga
  await page.waitForSelector('.search-results-chunk');

  // Chama a função de paginação passando a página e a função de extração
  const allArticles = await pagination(page, extractArticles);

  console.log(`Total de artigos raspados: ${allArticles.length}`);
  console.log(allArticles);

  await browser.close();
}

scrapePubMed().catch(console.error);
