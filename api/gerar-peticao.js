export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Metodo nao permitido' });
  }

  // Variaveis de ambiente
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';

  // Log de diagnostico (token mascarado)
  const tokenLog = token.length > 8
    ? token.slice(0, 4) + '...' + token.slice(-4)
    : '(vazio ou muito curto)';
  console.log('[LexPet] Token carregado:', tokenLog);
  console.log('[LexPet] Chat ID carregado:', chatId || '(vazio)');

  if (!token || !chatId) {
    console.error('[LexPet] ERRO: Variavel de ambiente ausente.');
    return res.status(500).json({
      erro: 'Configuracao incompleta',
      detalhe: 'TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID nao definidos'
    });
  }

  // Gerar ID sequencial
  const agora = new Date();
  const dd = String(agora.getDate()).padStart(2, '0');
  const mm = String(agora.getMonth() + 1).padStart(2, '0');
  const aaaa = agora.getFullYear();
  const seq = Math.floor(Math.random() * 9000) + 1000;
  const idPeticao = `LEXPET-${dd}${mm}${aaaa}-${seq}`;

  // Montar mensagem em texto puro, sem markdown, sem emojis
  const dados = req.body || {};
  const linhas = [
    `ID: ${idPeticao}`,
    `Tipo: ${dados.tipo || '(nao informado)'}`,
    `Autor: ${dados.autor || '(nao informado)'}`,
    `Reu: ${dados.reu || '(nao informado)'}`,
    `Comarca: ${dados.comarca || '(nao informado)'}`,
    `Processo: ${dados.processo || '(nao informado)'}`,
    `Advogado: ${dados.advogado || '(nao informado)'}`,
    `OAB: ${dados.oab || '(nao informado)'}`,
    `WhatsApp: ${dados.whatsapp || '(nao informado)'}`,
    ``,
    `Fatos:`,
    `${dados.fatos || '(nao informado)'}`,
    ``,
    `Pedidos:`,
    `${dados.pedidos || '(nao informado)'}`,
  ];
  const mensagem = linhas.join('\n');

  console.log('[LexPet] Mensagem montada, ID:', idPeticao);
  console.log('[LexPet] Enviando para chat_id:', chatId);

  // Enviar ao Telegram
  let telegramStatus = null;
  let telegramBody = null;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: mensagem
        // sem parse_mode — texto puro conforme solicitado
      })
    });

    telegramStatus = resposta.status;
    telegramBody = await resposta.json();

    console.log('[LexPet] Telegram status:', telegramStatus);
    console.log('[LexPet] Telegram resposta:', JSON.stringify(telegramBody));

    if (!resposta.ok) {
      return res.status(500).json({
        erro: 'Falha ao enviar para o Telegram',
        telegram_status: telegramStatus,
        telegram_erro: telegramBody
      });
    }

    return res.status(200).json({
      sucesso: true,
      id: idPeticao,
      mensagem: 'Solicitacao enviada com sucesso'
    });

  } catch (e) {
    console.error('[LexPet] Excecao ao chamar Telegram:', e.message);
    return res.status(500).json({
      erro: 'Excecao na chamada ao Telegram',
      detalhe: e.message,
      telegram_status: telegramStatus,
      telegram_body: telegramBody
    });
  }
}
