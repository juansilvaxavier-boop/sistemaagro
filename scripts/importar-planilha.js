#!/usr/bin/env node
// Linha de comando da importação da planilha do sistema anterior (a lógica fica em server/importacao.js).
require('../server/importacao').main().catch((e) => { console.error(e); process.exit(1); });
