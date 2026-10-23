// Notificações em tempo real via Server-Sent Events.
const clientes = new Set();

function conectar(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  const c = { res, user: req.user, empresaId: req.empresaId };
  clientes.add(c);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clientes.delete(c);
  });
}

/** filtro: { usuarios?: number[], perfis?: string[], todos?: boolean } */
function enviar(evento, dados, filtro = {}) {
  const payload = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const c of clientes) {
    const alvo =
      filtro.todos ||
      (filtro.usuarios && filtro.usuarios.includes(c.user.id)) ||
      (filtro.perfis && (filtro.perfis.includes(c.user.perfil) || ['admin', 'diretoria'].includes(c.user.perfil)));
    if (alvo && (!filtro.exceto || filtro.exceto !== c.user.id)) c.res.write(payload);
  }
}

function online() {
  return [...new Set([...clientes].map((c) => c.user.id))];
}

module.exports = { conectar, enviar, online };
