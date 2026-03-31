#!/bin/bash

# Script para execução via Cron (Mensal - Dia 10)
# Este script navega até o diretório do projeto e executa o index.js

# Define o display para execução do Puppeteer (necessário se headless: false)
export DISPLAY=:0

# Caminho do projeto
PROJECT_DIR="/home/jhon/Desktop/CarteiraDeSaude/scrapeJsPubmed"
LOG_FILE="$PROJECT_DIR/cron_output.log"

echo "=== Iniciando Job Mensal: $(date) ===" >> "$LOG_FILE"

cd "$PROJECT_DIR" || { echo "Falha ao navegar para o diretório" >> "$LOG_FILE"; exit 1; }

# Executa o node (assumindo que 'node' está no PATH, caso contrário use o caminho absoluto ex: /usr/bin/node)
# Redireciona stdout e stderr para o log
/usr/bin/node index.js >> "$LOG_FILE" 2>&1

echo "=== Fim do Job: $(date) ===" >> "$LOG_FILE"
