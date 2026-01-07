const fs = require('fs');
const path = require('path');
const https = require('https');

// Garante que os diretórios existem
const dataDir = path.join(__dirname, 'data');
const pdfDir = path.join(__dirname, 'downloads');
const dbPath = path.join(dataDir, 'db.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir);

// Função para converter data
function convertDate(dateString) {
    if (!dateString) return "";
    
    // Tenta capturar Ano, Mês e Dia. Ex: "2025 Dec 1..."
    const match = dateString.match(/^(\d{4})\s+([A-Za-z]{3})\s+(\d+)/);
    
    if (match) {
        const year = match[1];
        const monthStr = match[2];
        const day = match[3].padStart(2, '0');
        
        const months = {
            'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
            'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
            // Port
            'Fev': '02', 'Abr': '04', 'Mai': '05', 'Ago': '08', 'Set': '09', 'Out': '10', 'Dez': '12'
        };
        
        const month = months[monthStr] || '00';
        
        return `${day}/${month}/${year}`;
    }
    
    return dateString; // Retorna original se não casar com regex
}

// Função auxiliar para salvar no DB único
function saveToDb(articleData) {
    let db = [];
    if (fs.existsSync(dbPath)) {
        try {
            const fileContent = fs.readFileSync(dbPath, 'utf-8');
            if (fileContent.trim()) {
                db = JSON.parse(fileContent);
            }
        } catch (e) {
            console.error("Erro ao ler db.json (corrompido ou inválido), recriando...", e.message);
            db = [];
        }
    }

    // Verifica duplicação pelo Link (já que pmid foi removido da saída)
    const outputIndex = db.findIndex(item => item.link === articleData.link);
    if (outputIndex >= 0) {
        // Atualiza, mantendo o que já existia se necessário, ou sobrescrevendo
        db[outputIndex] = { ...db[outputIndex], ...articleData };
    } else {
        db.push(articleData);
    }

    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

const checkpointPath = path.join(dataDir, 'checkpoint.json');

// FUNÇÃO PARA SALVAR CHECKPOINT
function saveCheckpoint(pageNumber) {
    try {
        fs.writeFileSync(checkpointPath, JSON.stringify({ lastProcessedPage: pageNumber }));
    } catch (e) {
        console.error("Erro ao salvar checkpoint:", e.message);
    }
}

// FUNÇÃO PARA CARREGAR CHECKPOINT
function loadCheckpoint() {
    try {
        if (fs.existsSync(checkpointPath)) {
            const data = JSON.parse(fs.readFileSync(checkpointPath));
            return data.lastProcessedPage || 0;
        }
    } catch (e) {
        console.error("Erro ao ler checkpoint:", e.message);
    }
    return 0;
}

//FUNÇÃO PARA PAGINAÇÃO
async function pagination(page, scrapeFunction) {
  const allArticles = [];

  // 1. Identificar o total de páginas
  const totalPagesEl = await page.$("#search-results > div.bottom-pagination > div > label.of-total-pages");
  let totalPages = 1;
  
  if (totalPagesEl) {
    const text = await page.evaluate(el => el.innerText, totalPagesEl);
    console.log(`Texto de paginação encontrado: "${text}"`);
    const match = text.match(/[\d,.]+/); // Melhora regex para pegar números com vírgula/ponto se houver
    if (match) {
        // Remove pontuação de milhar se existir e converte
        const cleanNum = match[0].replace(/[^\d]/g, '');
        totalPages = parseInt(cleanNum, 10);
    }
  } else {
      console.warn("Elemento de total de páginas NÃO encontrado. Assumindo 1 página ou erro de seletor.");
  }

  console.log(`Total de páginas detectadas: ${totalPages}`);

  // 2. Carregar Checkpoint
  const lastPage = loadCheckpoint();
  console.log(`Checkpoint carregado: ${lastPage}`);
  
  let startPage = 1;

  if (lastPage > 0 && lastPage < totalPages) {
      startPage = lastPage + 1;
      console.log(`Retomando raspagem da página ${startPage} (Checkpoint: ${lastPage})...`);
      
      const currentUrl = page.url();
      const baseUrl = currentUrl.replace(/([?&])page=\d+/, ''); 
      const separator = baseUrl.includes('?') ? '&' : '?';
      const jumpUrl = `${baseUrl}${separator}page=${startPage}`;
      
      console.log(`Saltando para URL: ${jumpUrl}`);
      await page.goto(jumpUrl, { waitUntil: 'networkidle2' });
      
  } else if (lastPage >= totalPages && totalPages > 1) {
      console.log(`Raspagem já concluída anteriormente (Checkpoint ${lastPage} >= Total ${totalPages}).`);
      return allArticles;
  }

  for (let currentPage = startPage; currentPage <= totalPages; currentPage++) {
    console.log(`=== INICIANDO PÁGINA ${currentPage} de ${totalPages} ===`);
    
    // Executa a função de scraping passada por parâmetro
    try {
        const articles = await scrapeFunction(page);
        allArticles.push(...articles);
        
        // Salva Checkpoint APÓS sucesso parcial ou total da página
        saveCheckpoint(currentPage);
        console.log(`Checkpoint salvo: Página ${currentPage}`);

    } catch (e) {
        console.error(`Erro crítico ao processar página ${currentPage}: ${e.message}`);
    }

    // Se não for a última página, tenta clicar no botão "Next"
    // Nota: Se acabamos de processar a página 2000 (total), não clicamos next.
    if (currentPage < totalPages) {
      const nextBtnIdx = "#search-results > div.bottom-pagination > button.button-wrapper.next-page-btn";
      
      const nextBtn = await page.$(nextBtnIdx);
      if (nextBtn) {
        console.log("Clicando em Next...");
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), // Ignora timeout de nav
          page.click(nextBtnIdx),
        ]);
      } else {
        console.warn("Botão Next não encontrado, tentando navegação via URL na próxima iteração...");
        // Se falhar o clique, na próxima iteração o loop vai continuar mas a página no browser não mudou.
        // Precisamos FORÇAR a navegação se o clique falhou?
        // Sim, se o clique falhou, estamos ainda na página X.
        // A próxima iteração assume X+1.
        // Vamos forçar o goto no INICIO do loop se `currentPage > startPage`? 
        // Não, melhor deixar o fallback de URL explícito aqui se quiser.
        // Mas por enquanto vamos apenas logar.
      }
    }
  }

  return allArticles;
}


// FUNÇÃO PARA DOWNLOAD PDF
// FUNÇÃO PARA DOWNLOAD PDF VIA NODE.JS FETCH (Bypass Browser Viewer)
// FUNÇÃO PARA DOWNLOAD PDF VIA PUPPETEER (COM SUPORTE A POW CHALLENGE)
// FUNÇÃO PARA DOWNLOAD PDF VIA PUPPETEER (COM SUPORTE A POW CHALLENGE)
// FUNÇÃO PARA DOWNLOAD PDF VIA PUPPETEER (COM SUPORTE A POW CHALLENGE)
// FUNÇÃO PARA DOWNLOAD PDF VIA CDP (Chrome DevTools Protocol)
// FUNÇÃO PARA DOWNLOAD PDF VIA CDP (Com Fallback para Clique no Viewer)
// FUNÇÃO PARA DOWNLOAD PDF VIA BROWSER SOLVER + NODE DOWNLOADER
async function downloadPdf(page, title) {
  try {
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 200);
    const pdfFilename = `${safeTitle}.pdf`;
    const destPath = path.resolve(pdfDir, pdfFilename);

    // 1. Obter URL do texto completo
    const fullTextUrl = await page.evaluate(() => {
        const pmcLink = document.querySelector("#article-page > aside > div > div.full-text-links > div.full-view > div > a.link-item.pmc");
        if (pmcLink) return { url: pmcLink.href, type: 'pmc' };
        return null; 
    });

    if (!fullTextUrl) {
        console.log(`Nenhum link de texto completo (PMC) encontrado para: ${title}`);
        return { success: false, filename: null, url: null, provider: null, error: "Link Provider PMC não encontrado" };
    }

    console.log(`Navegando para texto completo (${fullTextUrl.type}): ${fullTextUrl.url}`);
    
    try {
        await page.goto(fullTextUrl.url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
        console.warn(`Erro navegando para ${fullTextUrl.url}: ${e.message}`);
    }

    // 2. Identificar a URL inicial do PDF
    const targetPdfUrl = await page.evaluate((type) => {
        let url = null;
        if (type === 'pmc') {
            const pmcSelector = "#article-container > div.pmc-sidenav.desktop\\:grid-col-4.display-flex > section > div > section > ul > li:nth-child(2) > a";
            const el = document.querySelector(pmcSelector);
            if (el) url = el.href;
            else {
                 const anchors = Array.from(document.querySelectorAll('a'));
                 const pdfLink = anchors.find(a => a.href.includes('/pdf/') && !a.href.includes('render='));
                 if (pdfLink) url = pdfLink.href;
            }
        }
        return url;
    }, fullTextUrl.type);

    if (!targetPdfUrl) {
        return { success: false, filename: null, url: null, provider: fullTextUrl.url, error: "URL do PDF não encontrada" };
    }

    console.log(`Iniciando navegação para resolver desafio POW: ${targetPdfUrl}`);

    // 3. Deixa o navegador resolver o POW
    try {
        // Navega para a URL do PDF (Preparing...)
        await page.goto(targetPdfUrl, { timeout: 60000, waitUntil: 'domcontentloaded' });
        
        console.log("Aguardando redirecionamento para URL final do PDF...");
        
        // Espera a URL mudar para algo que termine em .pdf ou que seja diferente da inicial se houver redirect
        // O "Preparing" tem a mesma URL? Não, geralmente o preparando é uma página e depois redireciona para a url do arquivo ou faz reload.
        // O user disse que a url final é tipo .../pdf/....pdf
        // Vamos dar um tempo fixo para o "Preparing" rodar e a URL estabilizar?
        
        await new Promise(r => setTimeout(r, 10000)); // 10 segundos "brutos" para o JS rodar
        
        const finalUrl = page.url();
        console.log(`URL Atual no navegador: ${finalUrl}`);
        
        // 4. Rouba os cookies da sessão (que agora tem o POW resolvido)
        const cookies = await page.cookies();
        const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        const userAgent = await page.browser().userAgent();

        console.log("Cookies capturados. Iniciando download via Node...");

        // 5. Baixa usando Fetch do Node com os cookies válidos
        const response = await fetch(finalUrl, {
            headers: {
                'Cookie': cookieHeader,
                'User-Agent': userAgent,
                'Referer': fullTextUrl.url,
            }
        });

        if (response.status !== 200) throw new Error(`Status ${response.status}`);
        
        const buffer = await response.arrayBuffer();
        const bufferLen = buffer.byteLength;
        console.log(`Tamanho baixado: ${bufferLen} bytes`);

        if (bufferLen < 3000) {
             throw new Error("Arquivo muito pequeno (provavelmente HTML de erro)");
        }

        fs.writeFileSync(destPath, Buffer.from(buffer));
        console.log(`PDF baixado com sucesso: ${pdfFilename}`);
        
        return { success: true, filename: pdfFilename, url: finalUrl, provider: fullTextUrl.url, error: null };

    } catch (e) {
        console.warn(`Falha no download Híbrido: ${e.message}`);
        return { success: false, filename: null, url: targetPdfUrl, provider: fullTextUrl.url, error: `Erro Híbrido: ${e.message}` };
    }

  } catch (error) {
    console.error(`Erro geral download PDF:`, error.message);
    return { success: false, filename: null, url: null, provider: null, error: error.message };
  }
}

//FUNÇÃO PARA EXTRAÇÃO DE ARTIGOS
async function extractArticles(page) {
    const scrapedData = [];
    
    // 1. Coleta os links da página de resultados
    const articleLinks = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('.docsum-title'));
        return anchors.map(a => ({
            href: a.href, // Link absoluto
            title: a.innerText.trim()
        }));
    });

    console.log(`Encontrados ${articleLinks.length} artigos nesta página.`);

    // 2. Itera sobre cada artigo
    for (const article of articleLinks) {
        let articlePage;
        try {
            console.log(`Processando: ${article.title}`);
            articlePage = await page.browser().newPage();
            // Aumenta timeout para garantir carregamento
            await articlePage.goto(article.href, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // 3. Coleta dados (PMID, Abstract, etc.)
            const rawDetails = await articlePage.evaluate(() => {
                const title = document.querySelector("#full-view-heading > h1")?.innerText.trim() || '';
                
                // Autores
                const authorNodes = Array.from(document.querySelectorAll(".inline-authors .full-name"));
                let authors = "";
                if (authorNodes.length > 0) {
                    authors = authorNodes.map(node => node.innerText.trim()).join(", ");
                } else {
                    const authorsEl = document.querySelector("#full-view-heading > div.inline-authors");
                    authors = authorsEl ? authorsEl.innerText.trim() : '';
                }

                const dateStr = document.querySelector("#full-view-heading > div.article-citation > div > span.cit")?.innerText.trim() || '';
                
                const abstract = document.querySelector("#por-abstract")?.innerText.trim() || 
                                 document.querySelector(".abstract-content")?.innerText.trim() || 
                                 'Resumo não disponível';
                                 
                const articleType = document.querySelector("#publication-types > ul > li > div > button")?.innerText.trim() || 'Artigo';
                
                return { title, authors, dateStr, abstract, articleType };
            });

            // Converte a data aqui no Node.js
            const formattedDate = convertDate(rawDetails.dateStr);

            const articleData = {
                title: rawDetails.title,
                authors: rawDetails.authors,
                date: formattedDate,
                abstract: rawDetails.abstract,
                article: rawDetails.articleType, 
                link: article.href,
                pdfDownloaded: false,
                pdfPath: null,
                pdfUrl: null,       
                providerUrl: null   
            };

            // 4. Baixa PDF (agora retorna objeto detalhado)
            const downloadResult = await downloadPdf(articlePage, rawDetails.title);
            
            if (downloadResult.provider) {
                articleData.providerUrl = downloadResult.provider;
            }

            if (downloadResult.success) {
                articleData.pdfDownloaded = true;
                articleData.pdfPath = `downloads/${downloadResult.filename}`;
                articleData.pdfUrl = downloadResult.url;
                
                // 5. Salva no DB unico (APENAS SE SUCESSO)
                saveToDb(articleData);
                scrapedData.push(articleData);
                console.log(`Artigo salvo no DB: ${articleData.title}`);
            } else {
                console.log(`Artigo ignorado (PDF indisponível/falha): ${articleData.title} - Erro: ${downloadResult.error}`);
            }

            // Removido o bloco antigo de salvar incondicionalmente
            // scrapData.push movido para dentro do if(success)

        } catch (err) {
            console.error(`Erro ao processar artigo ${article.title}:`, err);
        } finally {
            if (articlePage) await articlePage.close();
        }
    }

    return scrapedData;
}

module.exports = { pagination, extractArticles };

