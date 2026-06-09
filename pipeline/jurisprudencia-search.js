#!/usr/bin/env node
/**
 * jurisprudencia-search.js
 * Escritório Cassiano Ribeiro — LexPet
 *
 * Busca jurisprudência real nos tribunais via Jurisprudências.ai API
 * e retorna julgados estruturados para o Themis JUR usar na petição.
 *
 * Uso:
 *   node jurisprudencia-search.js "<tipo_de_peca>" "<termo_de_busca>" [tribunal]
 *
 * Exemplos:
 *   node jurisprudencia-search.js "Petição Inicial JEC" "carro reserva seguro negativa" tjsp
 *   node jurisprudencia-search.js "Recurso" "dano moral consumidor" stj
 *   node jurisprudencia-search.js "Contestação" "plano de saúde negativa cirurgia" tjsp,stj
 *
 * Saída: JSON estruturado + bloco de texto pronto para o Themis JUR
 *
 * Variável de ambiente obrigatória:
 *   JURISPRUDENCIAS_API_TOKEN=jur_seu_token_aqui
 */

'use strict';

// ─── Configuração ────────────────────────────────────────────────────────────

const API_BASE    = 'https://jurisprudencias.ai/api/v1';
const MAX_RESULTS = 5;   // julgados retornados por tribunal
const MAX_EXCERPT = 800; // caracteres do trecho da decisão

// Tribunais padrão por tipo de peça (pode ser sobrescrito via argumento)
const TRIBUNAIS_PADRAO = {
  'jec':        ['tjsp'],
  'juizado':    ['tjsp'],
  'inicial':    ['tjsp', 'stj'],
  'recurso':    ['tjsp', 'stj'],
  'apelação':   ['tjsp'],
  'contestação':['tjsp', 'stj'],
  'trabalhista':['tst'],
  'default':    ['tjsp', 'stj'],
};

// Mapeamento de tipos de peça para termos de busca complementares
const TERMOS_COMPLEMENTARES = {
  'seguro':      'seguro recusa negativa indenização consumidor',
  'plano saúde': 'plano saúde negativa cobertura consumidor dano',
  'consumidor':  'código defesa consumidor dano moral indenização',
  'trabalhista': 'justa causa aviso prévio rescisão indenização',
  'locação':     'locação imóvel despejo rescisão contrato',
  'acidente':    'acidente trânsito dano material moral indenização',
};

// ─── Funções auxiliares ───────────────────────────────────────────────────────

function token() {
  const t = process.env.JURISPRUDENCIAS_API_TOKEN;
  if (!t) {
    erro('Variável JURISPRUDENCIAS_API_TOKEN não definida.\n' +
         'Adicione ao /opt/lexpet/.env: JURISPRUDENCIAS_API_TOKEN=jur_seu_token');
  }
  return t;
}

function erro(msg) {
  console.error(`\n[ERRO jurisprudencia-search] ${msg}`);
  process.exit(1);
}

function log(msg) {
  process.stderr.write(`[jur-search] ${msg}\n`);
}

// Detecta tribunais a partir do tipo de peça
function detectarTribunais(tipoPeca, tribunaisArg) {
  if (tribunaisArg) {
    return tribunaisArg.split(',').map(t => t.trim().toLowerCase());
  }
  const tipo = tipoPeca.toLowerCase();
  for (const [chave, tribunais] of Object.entries(TRIBUNAIS_PADRAO)) {
    if (tipo.includes(chave)) return tribunais;
  }
  return TRIBUNAIS_PADRAO['default'];
}

// Enriquece o termo de busca com complementos relevantes
// Regras: não duplica palavras já presentes, limita a 60 chars no total
function enriquecerTermo(termo) {
  const termoLower = termo.toLowerCase();
  const palavrasJaPresentes = new Set(termoLower.split(/\s+/));

  for (const [chave, complemento] of Object.entries(TERMOS_COMPLEMENTARES)) {
    if (termoLower.includes(chave)) {
      // Adiciona apenas palavras novas do complemento
      const novas = complemento.split(/\s+/).filter(p => !palavrasJaPresentes.has(p));
      if (novas.length === 0) return termo;
      const enriquecido = `${termo} ${novas.slice(0, 3).join(' ')}`;
      // Limita a 80 caracteres para não estourar a query
      return enriquecido.length <= 80 ? enriquecido : termo;
    }
  }
  return termo;
}

// Faz requisição à API com retry em caso de rate limit
async function apiGet(path, tentativa = 1) {
  const url = `${API_BASE}${path}`;
  log(`GET ${url} (tentativa ${tentativa})`);

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token()}`,
        'Accept': 'application/json',
        'User-Agent': 'LexPet/1.0 (Escritorio Cassiano Ribeiro)',
      },
    });
  } catch (e) {
    if (tentativa < 3) {
      log(`Erro de rede — aguardando 2s antes de retry...`);
      await sleep(2000);
      return apiGet(path, tentativa + 1);
    }
    erro(`Falha de conexão com a API: ${e.message}`);
  }

  if (res.status === 429 && tentativa < 3) {
    log(`Rate limit atingido — aguardando 5s...`);
    await sleep(5000);
    return apiGet(path, tentativa + 1);
  }

  if (res.status === 401) {
    erro('Token inválido ou expirado. Verifique JURISPRUDENCIAS_API_TOKEN no .env');
  }

  if (!res.ok) {
    log(`API retornou status ${res.status} para ${path} — ignorando este tribunal`);
    return null;
  }

  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Trunca texto preservando frases completas
function truncar(texto, maxChars) {
  if (!texto || texto.length <= maxChars) return texto || '';
  const truncado = texto.slice(0, maxChars);
  const ultimoPonto = truncado.lastIndexOf('.');
  return ultimoPonto > maxChars * 0.7
    ? truncado.slice(0, ultimoPonto + 1)
    : truncado + '...';
}

// Formata data ISO para DD/MM/AAAA
function formatarData(dataStr) {
  if (!dataStr) return 'data não informada';
  try {
    const d = new Date(dataStr);
    return d.toLocaleDateString('pt-BR');
  } catch {
    return dataStr;
  }
}

// ─── Busca principal ──────────────────────────────────────────────────────────

async function buscarJulgados(tribunal, termo, pagina = 0) {
  const termoEncoded = encodeURIComponent(termo);
  const path = `/courts/${tribunal}/decisions?q=${termoEncoded}&page=${pagina}`;
  const data = await apiGet(path);
  if (!data) return [];

  // A API retorna array ou objeto com campo decisions/results
  const lista = Array.isArray(data) ? data
    : data.decisions || data.results || data.data || [];

  return lista.slice(0, MAX_RESULTS);
}

async function buscarEmTodosOsTribunais(tribunais, termo) {
  const resultados = [];

  for (const tribunal of tribunais) {
    log(`Buscando em ${tribunal.toUpperCase()}: "${termo}"`);
    try {
      const julgados = await buscarJulgados(tribunal, termo);
      log(`→ ${julgados.length} julgado(s) encontrado(s) em ${tribunal.toUpperCase()}`);

      for (const j of julgados) {
        resultados.push({
          tribunal:      tribunal.toUpperCase(),
          numero:        j.process_number || j.numero || j.id || 'N/D',
          data:          formatarData(j.publication_date || j.data || j.date),
          ementa:        truncar(j.excerpt || j.ementa || j.summary || '', MAX_EXCERPT),
          texto_completo: truncar(j.full_text || '', 300),
          url_oficial:   j.url || j.source_url || `https://jurisprudencias.ai/courts/${tribunal}`,
        });
      }
    } catch (e) {
      log(`Erro ao buscar em ${tribunal}: ${e.message} — continuando...`);
    }

    // Pausa entre tribunais para não sobrecarregar a API
    if (tribunais.indexOf(tribunal) < tribunais.length - 1) {
      await sleep(500);
    }
  }

  return resultados;
}

// ─── Formatação da saída ──────────────────────────────────────────────────────

function formatarParaThemisJUR(julgados, termo, tipoPeca) {
  if (julgados.length === 0) {
    return `
=== JURISPRUDÊNCIA — RESULTADO DA PESQUISA AUTOMÁTICA ===
Termo pesquisado: "${termo}"
Tipo de peça: ${tipoPeca}
Status: NENHUM JULGADO ENCONTRADO

Instrução ao Themis JUR:
Nenhum julgado foi localizado automaticamente para este termo.
Use [JURISPRUDÊNCIA PENDENTE — verificar TJSP/STJ] e prossiga com a redação.
========================================================
`.trim();
  }

  const linhas = [
    `=== JURISPRUDÊNCIA — PESQUISA AUTOMÁTICA LEXPET ===`,
    `Termo pesquisado: "${termo}"`,
    `Tipo de peça: ${tipoPeca}`,
    `Julgados encontrados: ${julgados.length}`,
    `Data da pesquisa: ${new Date().toLocaleDateString('pt-BR')}`,
    ``,
    `INSTRUÇÃO AO THEMIS JUR:`,
    `Use os julgados abaixo para fundamentar a peça.`,
    `Cite sempre: Tribunal + Número do processo + Data.`,
    `Verifique a URL oficial antes de protocolar.`,
    ``,
    `─────────────────────────────────────────────────`,
  ];

  julgados.forEach((j, i) => {
    linhas.push(`JULGADO ${i + 1} — ${j.tribunal}`);
    linhas.push(`Processo: ${j.numero}`);
    linhas.push(`Data: ${j.data}`);
    if (j.ementa) {
      linhas.push(`Ementa/Trecho:`);
      linhas.push(j.ementa);
    }
    linhas.push(`Fonte oficial: ${j.url_oficial}`);
    linhas.push(`─────────────────────────────────────────────────`);
  });

  linhas.push(`=== FIM DA PESQUISA DE JURISPRUDÊNCIA ===`);

  return linhas.join('\n');
}

function formatarJSON(julgados, termo, tipoPeca, tribunais) {
  return JSON.stringify({
    status:    julgados.length > 0 ? 'OK' : 'VAZIO',
    termo,
    tipo_peca: tipoPeca,
    tribunais,
    total:     julgados.length,
    timestamp: new Date().toISOString(),
    julgados,
  }, null, 2);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`
Uso: node jurisprudencia-search.js "<tipo_de_peca>" "<termo>" [tribunal]

Exemplos:
  node jurisprudencia-search.js "Petição Inicial JEC" "carro reserva seguro negativa" tjsp
  node jurisprudencia-search.js "Recurso" "dano moral consumidor" stj
  node jurisprudencia-search.js "Inicial" "plano saúde negativa cirurgia" tjsp,stj

Tribunais disponíveis: stf, stj, tst, trf3, trf4, tjpr, tjrj, tjrs, tjsc, tjsp, carf
Flags opcionais:
  --json     Saída apenas em JSON (padrão: texto + JSON)
  --texto    Saída apenas em texto para o Themis JUR
    `);
    process.exit(0);
  }

  const tipoPeca    = args[0];
  const termoRaw    = args[1];
  const tribunaisArg = args[2] && !args[2].startsWith('--') ? args[2] : null;
  const flagJson    = args.includes('--json');
  const flagTexto   = args.includes('--texto');

  const termo     = enriquecerTermo(termoRaw);
  const tribunais = detectarTribunais(tipoPeca, tribunaisArg);

  log(`Iniciando busca de jurisprudência...`);
  log(`Tipo de peça: ${tipoPeca}`);
  log(`Termo original: "${termoRaw}"`);
  log(`Termo enriquecido: "${termo}"`);
  log(`Tribunais: ${tribunais.join(', ').toUpperCase()}`);

  const julgados = await buscarEmTodosOsTribunais(tribunais, termo);

  log(`Total de julgados retornados: ${julgados.length}`);

  if (flagJson) {
    console.log(formatarJSON(julgados, termoRaw, tipoPeca, tribunais));
  } else if (flagTexto) {
    console.log(formatarParaThemisJUR(julgados, termoRaw, tipoPeca));
  } else {
    // Saída padrão: texto para o Themis JUR (usado pelo pipeline)
    console.log(formatarParaThemisJUR(julgados, termoRaw, tipoPeca));
    // JSON para log/debug no stderr
    process.stderr.write('\n[DEBUG JSON]\n' + formatarJSON(julgados, termoRaw, tipoPeca, tribunais) + '\n');
  }
}

main().catch(e => erro(e.message));
