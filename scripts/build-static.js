// Gera dist/ com o frontend e as bibliotecas de node_modules (hospedagem estática).
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.join(__dirname, '..');
const dist = path.join(raiz, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(raiz, 'public'), dist, { recursive: true });
const vendor = { bootstrap: 'bootstrap/dist', 'bootstrap-icons': 'bootstrap-icons/font', 'chart.js': 'chart.js/dist', fonte: '@fontsource-variable/plus-jakarta-sans', 'mapa-brasil': '@svg-maps/brazil' };
for (const [nome, origem] of Object.entries(vendor)) {
  fs.cpSync(path.join(raiz, 'node_modules', origem), path.join(dist, 'vendor', nome), { recursive: true });
}
console.log('dist/ gerado');
