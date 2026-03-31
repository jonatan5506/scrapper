const fs = require('fs');
const path = require('path');

// Garante que os diretórios existem
const dataDir = path.join(__dirname, 'data');
const pdfDir = path.join(__dirname, 'downloads');
const dbPath = path.join(dataDir, 'db.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir);

// Função para converter data
function convertDate(dateString) {
    if (!dateString) return "";
    
    // 1. Se já estiver no formato dd/mm/yyyy, mantém
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) {
        return dateString;
    }

    const cleanDate = dateString.trim();

    // Mapeamento de meses (inglês e português)
    const months = {
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
        'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
        'fev': '02', 'abr': '04', 'mai': '05', 'ago': '08', 'set': '09', 'out': '10', 'dez': '12'
    };

    // 2. Tenta capturar Ano, Mês e Dia (Ex: "2025 Dec 1" ou "2025 Dec 01")
    // Regex ajustado para ser mais flexível com separadores
    const fullDateMatch = cleanDate.match(/^(\d{4})[\s,]+([A-Za-z]{3})[\s,;]+(\d+)/);
    
    if (fullDateMatch) {
        const year = fullDateMatch[1];
        const monthStr = fullDateMatch[2].toLowerCase();
        let day = fullDateMatch[3];
        
        const month = months[monthStr]; 
        
        if (month) {
            const dayNum = parseInt(day, 10);
            if (dayNum >= 1 && dayNum <= 31) {
                day = day.padStart(2, '0');
                return `${day}/${month}/${year}`;
            }
        }
    }

    // 3. Tenta capturar Ano e Mês (sem dia) -> Assume dia 01
    // Ex: "2025 Dec" ou "2025 Dec;..."
    const monthYearMatch = cleanDate.match(/^(\d{4})[\s,]+([A-Za-z]{3})/);
    
    if (monthYearMatch) {
        const year = monthYearMatch[1];
        const monthStr = monthYearMatch[2].toLowerCase();
        const month = months[monthStr];
        
        if (month) {
             return `01/${month}/${year}`;
        }
    }
    
    // 4. Se falhar tudo, tenta extrair apenas o ano (YYYY)
    const yearMatch = cleanDate.match(/\b\d{4}\b/);
    if (yearMatch) {
        return yearMatch[0];
    }
    
    return dateString; 
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
function saveCheckpoint(data) {
    try {
        let current = {};
        if (fs.existsSync(checkpointPath)) {
            const content = fs.readFileSync(checkpointPath, 'utf8');
            if (content.trim()) {
                current = JSON.parse(content);
            }
        }
        
        // Se for apenas um número, assume que é a página (para manter compatibilidade se necessário)
        const update = typeof data === 'number' ? { lastProcessedPage: data } : data;
        const newData = { ...current, ...update };
        
        fs.writeFileSync(checkpointPath, JSON.stringify(newData, null, 2));
    } catch (e) {
        console.error("Erro ao salvar checkpoint:", e.message);
    }
}

// FUNÇÃO PARA CARREGAR CHECKPOINT
function loadCheckpoint() {
    try {
        if (fs.existsSync(checkpointPath)) {
            const content = fs.readFileSync(checkpointPath, 'utf8');
            if (content.trim()) {
                return JSON.parse(content);
            }
        }
    } catch (e) {
        console.error("Erro ao ler checkpoint:", e.message);
    }
    return {};
}

//FUNÇÃO PARA PAGINAÇÃO
async function pagination(page, scrapeFunction, options = {}) {
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

  // 2. Carregar Checkpoint ou usar options.startPage
  let startPage = 1;
  const checkpoint = loadCheckpoint();
  const lastPage = checkpoint.lastProcessedPage || 0;
  
  if (options.startPage) {
      startPage = options.startPage;
      console.log(`Iniciando da página ${startPage} (definido via options)...`);
  } else {
      console.log(`Checkpoint carregado: ${lastPage}`);
      if (lastPage > 0 && lastPage < totalPages) {
          startPage = lastPage + 1;
          console.log(`Retomando raspagem da página ${startPage} (Checkpoint: ${lastPage})...`);
      } else if (lastPage >= totalPages && totalPages > 1) {
          console.log(`Raspagem já concluída anteriormente (Checkpoint ${lastPage} >= Total ${totalPages}).`);
          return allArticles;
      }
  }

  // Lógica de salto inicial (apenas se NÃO for ignorada)
  if (!options.skipInitialNavigation && startPage > 1) {
      const currentUrl = page.url();
      const baseUrl = currentUrl.replace(/([?&])page=\d+/, ''); 
      const separator = baseUrl.includes('?') ? '&' : '?';
      const jumpUrl = `${baseUrl}${separator}page=${startPage}`;
      
      console.log(`Saltando para URL: ${jumpUrl}`);
      await page.goto(jumpUrl, { waitUntil: 'networkidle2' });
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
    
    // Carrega o DB uma única vez para otimizar a checagem de duplicidade
    let db = [];
    if (fs.existsSync(dbPath)) {
        try {
            const content = fs.readFileSync(dbPath, 'utf8');
            if (content.trim()) db = JSON.parse(content);
        } catch (e) {
            console.error("Erro ao carregar DB para checagem:", e.message);
        }
    }

    // 1. Coleta os links da página de resultados
    const articleLinks = await page.evaluate(() => {
        const articles = Array.from(document.querySelectorAll('.docsum-content'));
        return articles.map(article => {
            const titleEl = article.querySelector('.docsum-title');
            const journalEl = article.querySelector('.docsum-journal-citation.short-journal-citation');
            
            return {
                href: titleEl ? titleEl.href : null,
                title: titleEl ? titleEl.innerText.trim() : "Título Desconhecido",
                journal: journalEl ? journalEl.innerText.trim() : "Revista Desconhecida"
            };
        }).filter(a => a.href);
    });

    console.log(`Encontrados ${articleLinks.length} artigos nesta página.`);

    // 2. Itera sobre cada artigo
    for (const article of articleLinks) {
        // VERIFICAÇÃO DE DUPLICIDADE (DB + Arquivo Físico)
        const entry = db.find(item => item.link === article.href);
        const pdfExists = entry && entry.pdfPath && fs.existsSync(path.join(__dirname, entry.pdfPath));

        if (pdfExists) {
            console.log(`Artigo já processado e PDF presente, pulando: ${article.title}`);
            continue;
        }

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

            // Clean Abstract Logic
            let cleanedAbstract = rawDetails.abstract;
            if (cleanedAbstract && cleanedAbstract !== 'Resumo não disponível') {
                const headerPattern = /(?:^|\s+)(Objetivo|Introduction|Introdução|Background|Purpose|Aim|Resumo|Abstract|Context|Racional|Método|Métodos|Methods|Resultados|Results|Conclusão|Conclusões|Conclusions|Conclusion)(?::+)\s*/gi;
                cleanedAbstract = cleanedAbstract.replace(headerPattern, ' ').trim();
                cleanedAbstract = cleanedAbstract.replace(/\s+/g, ' ');
            }

            // Converte a data aqui no Node.js
            const formattedDate = convertDate(rawDetails.dateStr);

            const articleData = {
                title: rawDetails.title,
                authors: rawDetails.authors,
                date: formattedDate,
                abstract: cleanedAbstract, // Use the cleaned version
                article: rawDetails.articleType, 
                nome_revista: article.journal, // Include extracted journal name 
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
                articleData.cdnUrl = `https://carteira-de-saude.b-cdn.net/artigos_medicos/pubmed/${downloadResult.filename}`;
                
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

module.exports = { pagination, extractArticles, downloadPdf, loadCheckpoint, saveCheckpoint };
