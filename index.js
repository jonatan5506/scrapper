const puppeteer = require('puppeteer');
const { pagination, extractArticles } = require('./functions');

async function scrapePubMed() {
  const url = 'https://pubmed.ncbi.nlm.nih.gov/?term=free&filter=dates.2016%2F6%2F2-2016%2F12%2F29&filter=simsearch2.ffrft&filter=lang.english&filter=lang.portuguese&filter=hum_ani.humans&timeline=expanded';

  const browser = await puppeteer.launch({ 
    headless: false,//Se for true, não abre o navegador
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
    protocolTimeout: 0 // Disable timeout ensures the browser doesn't disconnect during long operations
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
