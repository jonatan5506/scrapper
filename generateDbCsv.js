const fs = require('fs');
const path = require('path');

const jsonFile = path.resolve(__dirname, 'data/db.json');
const csvFile = path.resolve(__dirname, 'data/db.csv');

// Using semicolon for Brazilian Excel compatibility
const SEPARATOR = ';';

/**
 * Escapes a string for CSV
 */
function escapeCsv(val) {
    if (val === null || val === undefined) return '';
    let str = String(val);
    // Replace newlines and carriage returns with spaces to keep CSV rows clean
    str = str.replace(/[\n\r]+/g, ' ');
    
    if (str.includes(SEPARATOR) || str.includes('"')) {
        str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

/**
 * Specifically format year for Excel (Simple string now as per user request)
 */
function formatYearForExcel(year) {
    if (!year) return '';
    return year;
}

/**
 * Converts JSON to CSV
 */
function generateCsv() {
    console.log('Generating CSV from db.json...');
    if (!fs.existsSync(jsonFile)) {
        console.error(`File not found: ${jsonFile}`);
        return;
    }

    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    if (data.length === 0) {
        console.log('No data to convert.');
        return;
    }

    // Define headers matching db.json structure
    const headers = [
        'title',
        'authors',
        'nome_revista',
        'date',
        'article',
        'abstract',
        'link',
        'pdfDownloaded',
        'pdfPath',
        'pdfUrl',
        'providerUrl',
        'cdnUrl'
    ];

    const csvRows = [];
    csvRows.push(headers.join(SEPARATOR));

    for (const item of data) {
        const row = [
            escapeCsv(item.title),
            escapeCsv(Array.isArray(item.authors) ? item.authors.join('; ') : item.authors),
            escapeCsv(item.nome_revista),
            escapeCsv(item.date),
            escapeCsv(item.article),
            escapeCsv(item.abstract),
            escapeCsv(item.link),
            escapeCsv(item.pdfDownloaded),
            escapeCsv(item.pdfPath),
            escapeCsv(item.pdfUrl),
            escapeCsv(item.providerUrl),
            escapeCsv(item.cdnUrl)
        ];
        csvRows.push(row.join(SEPARATOR));
    }

    fs.writeFileSync(csvFile, csvRows.join('\n'));
    console.log(`CSV generated successfully with semicolon separator: ${csvFile}`);
    console.log(`Total rows: ${data.length}`);
}

module.exports = { generateCsv };

