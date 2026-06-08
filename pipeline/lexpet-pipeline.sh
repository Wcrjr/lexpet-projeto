#!/bin/bash
# =============================================================
# LEXPET PIPELINE — v1.0
# Fluxo: Themis JUR → Themis SUP → .docx → Drive → Telegram
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

LEAD_CONTENT=$(cat "$LEAD_FILE")
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
TMP_DIR="$LEXPET_DIR/tmp/${LEAD_ID}_${TIMESTAMP}"
mkdir -p "$TMP_DIR"

# =============================================================
# ETAPA 1 — THEMIS JUR REDIGE A PEÇA
# =============================================================
log "[1/4] Themis JUR redigindo peça..."

telegram_text "⚖️ <b>LexPet Pipeline</b>
Lead: <code>${LEAD_ID}</code>
Status: Themis JUR redigindo a peça..."

PECA_BRUTA=$(docker exec "$CONTAINER" openclaw agent \
  --agent themis-jur \
  --message "$(cat "$LEAD_FILE")" \
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

# Extrair status da auditoria
STATUS_AUDITORIA="APROVADA"
if echo "$AUDITORIA" | grep -q "BLOQUEADA"; then
  STATUS_AUDITORIA="BLOQUEADA"
elif echo "$AUDITORIA" | grep -q "RESSALVAS"; then
  STATUS_AUDITORIA="APROVADA COM RESSALVAS"
fi

# Extrair peça corrigida (após o relatório)
# O SUP deve entregar: RELATORIO + "---PECA CORRIGIDA---" + peça
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
Arquivo: <code>${NOME_ARQUIVO}</code>

<b>Relatório Themis SUP:</b>
<pre>${RELATORIO_CURTO}</pre>

Revise e assine antes de entregar ao advogado cliente."

telegram_doc "$CAMINHO_DOCX" "Petição ${LEAD_ID} — ${STATUS_AUDITORIA} pelo Themis SUP"

log "[4/4] .docx enviado para Telegram"
log "=== PIPELINE CONCLUÍDO: $LEAD_ID — Status: ${STATUS_AUDITORIA} ==="

echo ""
echo "PIPELINE CONCLUÍDO"
echo "Lead: $LEAD_ID"
echo "Status SUP: $STATUS_AUDITORIA"
echo "Arquivo: $CAMINHO_DOCX"
