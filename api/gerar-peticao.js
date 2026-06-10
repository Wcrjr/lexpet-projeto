
// Registra usuario e peca no Supabase
async function registrarNoSupabase(dados, idUnico) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    'apikey': SUPABASE_SERVICE_KEY
  };
  await fetch(SUPABASE_URL + '/rest/v1/usuarios', {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'resolution=ignore-duplicates' },
    body: JSON.stringify({ email: dados.email, nome: dados.advogado || '', oab: dados.oab || '', plano: 'avulso', pecas_disponiveis: 0, pecas_usadas: 0, ativo: true })
  });
  const r = await fetch(SUPABASE_URL + '/rest/v1/usuarios?email=eq.' + encodeURIComponent(dados.email) + '&select=id', { headers });
  const usuarios = await r.json();
  if (!usuarios || !usuarios[0]) return;
  const uid = usuarios[0].id;
  await fetch(SUPABASE_URL + '/rest/v1/pecas', {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ usuario_id: uid, lead_id: idUnico, tipo_peca: dados.tipoPeca || '', tribunal: dados.comarca || '', status: 'gerada' })
  });
  await fetch(SUPABASE_URL + '/rest/v1/uso', {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ usuario_id: uid, evento: 'peca_gerada', detalhes: { lead_id: idUnico, tipo_peca: dados.tipoPeca } })
  });
}

// LexPet — Funcao serverless para Vercel
// Recebe dados do formulario, gera ID unico e envia para o grupo do Telegram
// Opcao C hibrida: posta no grupo + ping no privado para Themis detectar

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Metodo nao permitido' });
  }

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const TELEGRAM_NOTIFY_TOKEN = process.env.TELEGRAM_NOTIFY_TOKEN;
  const TELEGRAM_NOTIFY_ID = process.env.TELEGRAM_NOTIFY_ID;

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

    // Monta a mensagem completa para o grupo
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

    const mensagemGrupo = partes.join('\n');

    // 1. Envia mensagem completa para o GRUPO via @LexPetLeads_bot
    const urlGrupo = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const respostaGrupo = await fetch(urlGrupo, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: parseInt(TELEGRAM_CHAT_ID),
        text: mensagemGrupo
      })
    });

    if (!respostaGrupo.ok) {
      const erroTexto = await respostaGrupo.text();
      console.error('Erro Telegram grupo:', erroTexto);
      return res.status(500).json({ erro: 'Erro ao enviar para grupo Telegram', id: idUnico });
    }

    // 2. Envia ping curto no PRIVADO via @Advocaciacr_bot para Themis detectar
    if (TELEGRAM_NOTIFY_TOKEN && TELEGRAM_NOTIFY_ID) {
      const mensagemPing = `NOVO LEAD LEXPET — ID: #${idUnico} — Tipo: ${dados.tipoPeca || 'nao informado'} — dados completos no grupo LexPet`;
      const urlPrivado = `https://api.telegram.org/bot${TELEGRAM_NOTIFY_TOKEN}/sendMessage`;
      await fetch(urlPrivado, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: parseInt(TELEGRAM_NOTIFY_ID),
          text: mensagemPing
        })
      });
    }

    await registrarNoSupabase(dados, idUnico);
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
