// Administração → Integrações: credenciais de APIs externas (NF-e, frete, boleto), ainda sem chamada real.
const express = require('express');
const A = require('../auth');
const I = require('../integracoes');

const r = express.Router();
r.use(A.exige('integracoes'));

r.get('/', async (req, res) => res.json(await I.todas()));

r.put('/:chave', async (req, res) => {
  const b = req.body || {};
  await I.salvar(req.params.chave, { ativo: !!b.ativo, ambiente: b.ambiente, valores: b.valores || {} }, req.user.id);
  res.json((await I.todas()).find((x) => x.chave === req.params.chave));
});

r.post('/:chave/testar', async (req, res) => res.json(await I.testar(req.params.chave)));

module.exports = r;
