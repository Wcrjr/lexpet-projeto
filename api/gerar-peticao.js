// LexPet — Funcao serverless para Vercel
// Recebe dados do formulario, gera ID unico e envia para o grupo do Telegram
export default async function handler(req, res) {
  // Apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Metodo nao permitido' });
  }
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  // Verifica token configurado
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(500).json({ erro: 'Configuracao do Telegram ausente no servidor' });
  }
  try {
    const dados = req.body;
    // Gera ID unico para este lead
    const data = new Date();
    const dataStr = data.toISOString().slice(0, 10).replace(/-/g, '');
    const seq = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    const idUnico = `LEXPET-${dataStr}-${seq}`;
    // Monta a mensagem para o Telegram
    const partes = [
      `NOVO LEAD LEXPET`,
      `ID: #${idUnico}`,
      `----------------------------------------`
    ];
    const campos = {
      tipoPeca: 'Tipo de peca',
      vara: 'Vara / Juizo',
      comarca: 'Comarca',
      numProcesso: 'Numero do processo',
      parte1: 'Parte 1',
      parte2: 'Parte 2',
      valorCausa: 'Valor da causa',
      email: 'E-mail profissional',
      advogado: 'Advogado subscritor',
      oab: 'OAB'
    };
    for (const [chave, rotulo] of Object.entries(campos)) {
      if (dados[chave] && dados[chave].trim()) {
        partes.push(`${rotulo}: ${dados[chave].trim()}`);
      }
    }
    if (dados.fatos && dados.fatos.trim()) {
      let fatos = dados.fatos.trim();
      if (fatos.length > 2000) fatos = fatos.slice(0, 2000) + '...';
      partes.push(`Fatos: ${fatos}`);
    }
    if (dados.pedidos && dados.pedidos.trim()) {
      let pedidos = dados.pedidos.trim();
      if (pedidos.length > 2000) pedidos = pedidos.slice(0, 2000) + '...';
      partes.push(`Pedidos: ${pedidos}`);
    }
    if (dados.nomeAnexo && dados.nomeAnexo.trim()) {
      partes.push(`Anexo: ${dados.nomeAnexo.trim()}`);
    }
    partes.push(`----------------------------------------`);
    partes.push(`Data: ${data.toLocaleString('pt-BR')}`);
    const mensagem = partes.join('\n');
    // Envia para o Telegram
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const respostaTelegram = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: parseInt(TELEGRAM_CHAT_ID),
        text: mensagem
      })
    });
    if (!respostaTelegram.ok) {
      const erroTexto = await respostaTelegram.text();
      console.error('Erro Telegram:', erroTexto);
      return res.status(500).json({ erro: 'Erro ao enviar para Telegram', id: idUnico });
    }
    return res.status(200).json({
      sucesso: true,
      id: idUnico,
      mensagem: `Recebemos sua solicitacao! Protocolo #${idUnico}. Em breve sua peticao sera analisada.`
    });
  } catch (erro) {
    console.error('Erro geral:', erro);
    return res.status(500).json({ erro: 'Erro interno do servidor' });
  }
}
