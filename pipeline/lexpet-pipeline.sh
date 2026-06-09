#!/bin/bash
# =============================================================
# LEXPET PIPELINE — v2.1 (Parte 21)
# Fluxo: Jurisprudência → Themis JUR → Themis SUP → .docx → Telegram
# Escritório Cassiano Ribeiro | OAB/SP 182.716
# =============================================================

set -euo pipefail

# --- CONFIGURAÇÃO ---
LEXPET_DIR="/opt/lexpet"
PECAS_DIR="$LEXPET_DIR/pecas"
SCRIPTS_DIR="$LEXPET_DIR/scripts"
LOG_FILE="$LEXPET_DIR/logs/pipeline.log"
TELEGRAM_TOKEN="${TELEGRAM_NOTIFY_TOKEN}"
TELEGRAM_CHAT="${TELEGRAM_NOTIFY_ID:-363258994}"
CONTAINER="openclaw-openclaw-gateway-1"

# --- ARGUMENTOS ---
LEAD_ID="${1:-}"
LEAD_FILE="${2:-}"

if [ -z "$LEAD_ID" ] || [ -z "$LEAD_FILE" ]; then
  echo "Uso: $0 <LEAD_ID> <arquivo_lead.txt>"
  exit 1
fi

# --- FUNÇÕES ---
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

telegram_text() {
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT}" \
    -d text="$1" \
    -d parse_mode="HTML" > /dev/null
}

telegram_doc() {
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument" \
    -F chat_id="${TELEGRAM_CHAT}" \
    -F document=@"$1" \
    -F caption="$2" > /dev/null
}

# --- INÍCIO ---
mkdir -p "$PECAS_DIR" "$LEXPET_DIR/logs" "$LEXPET_DIR/tmp"

log "=== PIPELINE INICIADO: $LEAD_ID ==="

TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
TMP_DIR="$LEXPET_DIR/tmp/${LEAD_ID}_${TIMESTAMP}"
mkdir -p "$TMP_DIR"

# =============================================================
# ETAPA 0 — BUSCA DE JURISPRUDÊNCIA EM TEMPO REAL (Parte 21)
# =============================================================
log "[0/4] Buscando jurisprudência em tempo real..."

telegram_text "⚖️ <b>LexPet Pipeline</b>
Lead: <code>${LEAD_ID}</code>
Status: Buscando jurisprudência nos tribunais..."

# Extrair tipo de peça — apenas 2 primeiras palavras para não interferir na busca
TIPO_PECA=$(grep -i "TIPO DE PECA:" "$LEAD_FILE" 2>/dev/null | head -1 | sed 's/.*:\s*//' | tr -d '\r' | awk '{print $1, $2}' || echo "")

# Extrair keywords jurídicas limpas dos fatos e pedidos
FATOS_RESUMO=$(grep -A20 "FATOS:\|PEDIDOS:" "$LEAD_FILE" 2>/dev/null | \
  grep -oi "seguro\|carro reserva\|negativa\|indeniz\|dano moral\|dano material\|plano de saude\|locacao\|clausula\|consumidor\|acidente\|trabalhist\|demissao\|rescisao\|despejo" | \
  sort -u | tr '\n' ' ' | cut -c1-50 || echo "")

# Fallbacks
[ -z "$TIPO_PECA" ]    && TIPO_PECA="Peticao Inicial"
[ -z "$FATOS_RESUMO" ] && FATOS_RESUMO="indenizacao consumidor dano"

log "[0/4] Tipo de peça: ${TIPO_PECA}"
log "[0/4] Termo de busca: ${FATOS_RESUMO}"

JUR_FILE="$TMP_DIR/jurisprudencia.txt"

node "$SCRIPTS_DIR/jurisprudencia-search.js" \
  "${TIPO_PECA}" \
  "${FATOS_RESUMO}" \
  --texto > "$JUR_FILE" 2>>"$LOG_FILE" || true

JUR_TOTAL=$(grep -c "^JULGADO" "$JUR_FILE" 2>/dev/null || echo "0")

if [ "$JUR_TOTAL" -gt 0 ]; then
  log "[0/4] Jurisprudência: ${JUR_TOTAL} julgado(s) encontrado(s)"
  telegram_text "✅ <b>LexPet Pipeline</b>
Lead: <code>${LEAD_ID}</code>
Jurisprudência: ${JUR_TOTAL} julgado(s) real(is) encontrado(s)"
else
  log "[0/4] Nenhum julgado automático — Themis JUR usará [JURISPRUDÊNCIA PENDENTE]"
  telegram_text "⚠️ <b>LexPet Pipeline</b>
Lead: <code>${LEAD_ID}</code>
Jurisprudência: nenhum julgado automático — Themis sinalizará pendência"
  echo "Nenhum julgado encontrado. Use [JURISPRUDÊNCIA PENDENTE — verificar TJSP/STJ]." > "$JUR_FILE"
fi

# =============================================================
# ETAPA 1 — THEMIS JUR REDIGE A PEÇA (com julgados no contexto)
# =============================================================
log "[1/4] Themis JUR redigindo peça..."

telegram_text "📝 <b>LexPet Pipeline</b>
Lead: <code>${LEAD_ID}</code>
Status: Themis JUR redigindo a peça..."

PROMPT_JUR="=== DADOS DO LEAD ===
$(cat "$LEAD_FILE")

=== JURISPRUDÊNCIA PESQUISADA AUTOMATICAMENTE ===
$(cat "$JUR_FILE")

=== INSTRUÇÃO ===
Redija a peça jurídica completa com base nos dados acima.
Use obrigatoriamente os julgados fornecidos para fundamentar a argumentação.
Se um julgado tiver número e tribunal, cite-o no formato: (TJSP, Processo nº XXXXXXX, j. DD/MM/AAAA).
Se não houver julgados, use [JURISPRUDÊNCIA PENDENTE — verificar TJSP/STJ].
Siga o fluxo obrigatório do AGENTS.md."

PECA_BRUTA=$(docker exec "$CONTAINER" openclaw agent \
  --agent themis-jur \
  --message "${PROMPT_JUR}" \
  --local 2>/dev/null | \
  grep -v '^\[' | \
  grep -v '^gateway' | \
  grep -v '^EMBEDDED' | \
  grep -v '^Config' | \
  grep -v '^Bind:' | \
  grep -v '^Source:' | \
  grep -v '^Gateway' | \
  grep -v '◇' | \
  grep -v '├' | \
  grep -v '│' | \
  sed '/^$/d' | \
  tail -n +5)

if [ -z "$PECA_BRUTA" ]; then
  log "ERRO: Themis JUR nao retornou conteudo"
  telegram_text "❌ <b>LexPet Pipeline ERRO</b>
Lead: <code>${LEAD_ID}</code>
Etapa: Themis JUR
Erro: resposta vazia"
  exit 1
fi

echo "$PECA_BRUTA" > "$TMP_DIR/peca_bruta.txt"
log "[1/4] Peça redigida — $(echo "$PECA_BRUTA" | wc -l) linhas"

# =============================================================
# ETAPA 2 — THEMIS SUP AUDITA
# =============================================================
log "[2/4] Themis SUP auditando..."

telegram_text "🔍 <b>LexPet Pipeline</b>
Lead: <code>${LEAD_ID}</code>
Status: Themis SUP auditando a peça..."

AUDITORIA=$(docker exec "$CONTAINER" openclaw agent \
  --agent themis-sup \
  --message "Audite a seguinte peça jurídica gerada pelo Themis JUR para o lead ${LEAD_ID}. Aplique o checklist completo de 5 blocos e retorne o relatório de auditoria no formato padrão, seguido da peça CORRIGIDA e pronta para entrega (sem marcações internas):

$(cat "$TMP_DIR/peca_bruta.txt")" \
  --local 2>/dev/null | \
  grep -v '^\[' | \
  grep -v '^gateway' | \
  grep -v '^EMBEDDED' | \
  grep -v '^Config' | \
  grep -v '^Bind:' | \
  grep -v '^Source:' | \
  grep -v '^Gateway' | \
  grep -v '◇' | \
  grep -v '├' | \
  grep -v '│' | \
  sed '/^$/d' | \
  tail -n +5)

echo "$AUDITORIA" > "$TMP_DIR/auditoria.txt"
log "[2/4] Auditoria concluída"

STATUS_AUDITORIA="APROVADA"
if echo "$AUDITORIA" | grep -q "BLOQUEADA"; then
  STATUS_AUDITORIA="BLOQUEADA"
elif echo "$AUDITORIA" | grep -q "RESSALVAS"; then
  STATUS_AUDITORIA="APROVADA COM RESSALVAS"
fi

PECA_FINAL="$PECA_BRUTA"
if echo "$AUDITORIA" | grep -q "EXCELENTISSIMO\|EXCELENTÍSSIMO"; then
  PECA_FINAL=$(echo "$AUDITORIA" | awk '/EXCELENTISSIMO|EXCELENTÍSSIMO/{found=1} found{print}')
fi

echo "$PECA_FINAL" > "$TMP_DIR/peca_final.txt"

# =============================================================
# ETAPA 3 — GERAR .docx
# =============================================================
log "[3/4] Gerando .docx..."

NOME_ARQUIVO="${LEAD_ID}_$(date '+%Y%m%d').docx"
CAMINHO_DOCX="$PECAS_DIR/$NOME_ARQUIVO"

node "$SCRIPTS_DIR/generate-docx.js" \
  "$TMP_DIR/peca_final.txt" \
  "$CAMINHO_DOCX" \
  "$LEAD_ID"

if [ ! -f "$CAMINHO_DOCX" ]; then
  log "ERRO: .docx nao foi gerado"
  telegram_text "❌ <b>LexPet Pipeline ERRO</b>
Lead: <code>${LEAD_ID}</code>
Etapa: Geração .docx
Erro: arquivo nao criado"
  exit 1
fi

log "[3/4] .docx gerado: $CAMINHO_DOCX"

# =============================================================
# ETAPA 4 — ENVIAR TELEGRAM
# =============================================================
log "[4/4] Enviando para Telegram..."

RELATORIO_CURTO=$(echo "$AUDITORIA" | head -20)

telegram_text "✅ <b>LexPet — Peça Pronta para Revisão</b>

Lead: <code>${LEAD_ID}</code>
Status SUP: <b>${STATUS_AUDITORIA}</b>
Jurisprudência: <b>${JUR_TOTAL} julgado(s) real(is)</b>
Arquivo: <code>${NOME_ARQUIVO}</code>

<b>Relatório Themis SUP:</b>
<pre>${RELATORIO_CURTO}</pre>

Revise e assine antes de entregar ao advogado cliente."

telegram_doc "$CAMINHO_DOCX" "Petição ${LEAD_ID} — ${STATUS_AUDITORIA} | ${JUR_TOTAL} julgado(s) real(is)"

log "[4/4] .docx enviado para Telegram"
log "=== PIPELINE CONCLUÍDO: $LEAD_ID — Status: ${STATUS_AUDITORIA} | Julgados: ${JUR_TOTAL} ==="

echo ""
echo "PIPELINE CONCLUÍDO"
echo "Lead: $LEAD_ID"
echo "Status SUP: $STATUS_AUDITORIA"
echo "Julgados reais: $JUR_TOTAL"
echo "Arquivo: $CAMINHO_DOCX"
