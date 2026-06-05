// api/gerar-peticao.js
// LexPet — Função serverless Vercel
// Recebe dados do formulário, gera ID único e envia ao Telegram

// Contador em memória por instância (reinicia a cada cold start)
// Para produção com volume alto, substituir por KV store (Vercel KV ou Upstash)
let contadorDia = { data: '', seq: 0 };

function gerarID() {
  const agora = new Date();
  // Ajusta para horário de Brasília (UTC-3)
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const dd   = String(brasilia.getUTCDate()).padStart(2, '0');
  const mm   = String(brasilia.getUTCMonth() + 1).padStart(2, '0');
  const aaaa = brasilia.getUTCFullYear();
  const dataHoje = `${dd}${mm}${aaaa}`;

  // Reinicia contador se mudou o dia
  if (contadorDia.data !== dataHoje) {
    contadorDia.data = dataHoje;
    contadorDia.seq  = 0;
  }
  contadorDia.seq += 1;

  const seq = String(contadorDia.seq).padStart(4, '0');
  return `LEXPET-${dataHoje}-${seq}`;
}

function dataHoraBrasilia() {
  const agora = new Date();
  return agora.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function truncar(texto, limite = 200) {
  if (!texto || texto.trim() === '') return '(nao informado)';
  const t = texto.trim();
  return t.length > limite ? t.substring(0, limite) + '...' : t;
}

function campo(label, valor) {
  const v = (valor && String(valor).trim()) ? String(valor).trim() : '(nao informado)';
  return `${label}: ${v}`;
}

function montarMensagem(dados, id) {
  const linhas = [
    '=== NOVA SOLICITACAO LEXPET ===',
    '',
    campo('ID',              id),
    campo('Data e hora',     dataHoraBrasilia()),
    '',
    '--- DADOS DA PECA ---',
    campo('Tipo de peca',    dados.tipoPeca),
    campo('Vara / Juizo',    dados.vara),
    campo('Comarca',         dados.comarca),
    campo('Numero processo', dados.processo || 'Acao nova'),
    campo('Valor da causa',  dados.valor),
    '',
    '--- PARTES ---',
    campo('Parte autora',    dados.parte1),
    campo('Parte re',        dados.parte2),
    '',
    '--- ADVOGADO SUBSCRITOR ---',
    campo('Nome',            dados.advogado),
    campo('OAB',             dados.oab),
    campo('E-mail',          dados.email),
    campo('WhatsApp',        dados.whatsapp),
    '',
    '--- CONTEUDO (PREVIEW) ---',
    'Fatos:',
    truncar(dados.fatos, 200),
    '',
    'Pedidos:',
    truncar(dados.pedidos, 200),
    '',
    '--- ANEXO ---',
    campo('Documento anexado', dados.temAnexo ? 'SIM - ' + (dados.nomeAnexo || 'arquivo') : 'Nao'),
    '',
    '=== FIM DA SOLICITACAO ==='
  ];

  return linhas.join('\n');
}

async function enviarTelegram(mensagem, token, chatId) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text: mensagem,
    // Sem parse_mode — texto puro, sem risco de erro de formatacao
  });

  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!resp.ok) {
    const erro = await resp.text();
    throw new Error(`Telegram API ${resp.status}: ${erro}`);
  }

  return await resp.json();
}

export default async function handler(req, res) {
  // Apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Metodo nao permitido' });
  }

  // CORS — permite apenas o domínio do LexPet
  const origem = req.headers.origin || '';
  const origensPermitidas = [
    'https://lexpet.com.br',
    'https://www.lexpet.com.br',
    'http://localhost',        // testes locais
    'http://127.0.0.1',
    'null',                    // arquivo HTML aberto localmente (file://)
  ];

  // Em desenvolvimento (sem origin definida) também permite
  if (origensPermitidas.includes(origem) || !origem) {
    res.setHeader('Access-Control-Allow-Origin', origem || '*');
  } else {
    return res.status(403).json({ erro: 'Origem nao autorizada' });
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Lê variáveis de ambiente
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID nao configurados');
    return res.status(500).json({
      erro: 'Configuracao do servidor incompleta',
      id:   null
    });
  }

  // Gera ID antes de qualquer coisa — mesmo se der erro, retorna o ID
  const id = gerarID();

  try {
    // Extrai dados do corpo
    const dados = req.body || {};

    // Monta e envia mensagem
    const mensagem = montarMensagem(dados, id);
    await enviarTelegram(mensagem, token, chatId);

    return res.status(200).json({
      sucesso: true,
      id,
      mensagem: 'Solicitacao recebida com sucesso'
    });

  } catch (erro) {
    console.error('Erro ao enviar para Telegram:', erro.message);

    // Retorna o ID mesmo em caso de erro para rastreio
    return res.status(500).json({
      sucesso: false,
      id,
      erro: 'Nao foi possivel enviar a notificacao. Tente novamente ou entre em contato pelo WhatsApp.',
      detalhe: process.env.NODE_ENV === 'development' ? erro.message : undefined
    });
  }
}
