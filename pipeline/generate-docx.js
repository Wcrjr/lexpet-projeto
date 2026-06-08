#!/usr/bin/env node
// =============================================================
// LEXPET — generate-docx.js
// Converte texto plano da peça jurídica em .docx forense
// =============================================================

const {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, BorderStyle, UnderlineType, HeadingLevel
} = require('docx');
const fs = require('fs');

const INPUT_FILE = process.argv[2];
const OUTPUT_FILE = process.argv[3];
const LEAD_ID = process.argv[4] || 'SEM_ID';

if (!INPUT_FILE || !OUTPUT_FILE) {
  console.error('Uso: node generate-docx.js <input.txt> <output.docx> [lead_id]');
  process.exit(1);
}

const rawText = fs.readFileSync(INPUT_FILE, 'utf8');

// =============================================================
// PARSER — detecta tipo de parágrafo pelo conteúdo
// =============================================================

function parseParagraphs(text) {
  const lines = text.split('\n');
  const children = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Linha vazia — espaço
    if (!line) {
      children.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }

    // Remove marcação markdown residual
    const clean = line
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/^#+\s*/, '')
      .replace(/^---+$/, '')
      .trim();

    if (!clean) continue;

    // Endereçamento ao juízo (sempre em caixa alta e negrito centralizado)
    if (clean.match(/^EXCELENTISSIMO|^EXCELENTÍSSIMO/i)) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 480 },
        children: [new TextRun({ text: clean, font: 'Arial', size: 24, bold: true })]
      }));
      continue;
    }

    // Título da ação (ALL CAPS centralizado negrito sublinhado)
    if (clean.match(/^ACAO|^AÇÃO|^RECURSO|^CONTESTACAO|^CONTESTAÇÃO|^APELACAO|^APELAÇÃO|^MANDADO/i) &&
        clean === clean.toUpperCase()) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 240 },
        children: [new TextRun({
          text: clean,
          font: 'Arial',
          size: 24,
          bold: true,
          underline: { type: UnderlineType.SINGLE }
        })]
      }));
      continue;
    }

    // Seções (I —, II —, III — etc)
    if (clean.match(/^(I|II|III|IV|V|VI|VII|VIII|IX|X)\s*[—\-]/)) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 320, after: 160 },
        children: [new TextRun({ text: clean, font: 'Arial', size: 24, bold: true })]
      }));
      continue;
    }

    // Subseções (II.1, II.2 etc)
    if (clean.match(/^[IVX]+\.\d+\s*[—\-]/)) {
      children.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 200, after: 120 },
        children: [new TextRun({ text: clean, font: 'Arial', size: 24, bold: true })]
      }));
      continue;
    }

    // Pedidos com letras (a), b), c)...)
    if (clean.match(/^[a-z]\)/)) {
      children.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 0, after: 120 },
        indent: { left: 720 },
        children: [new TextRun({ text: clean, font: 'Arial', size: 24 })]
      }));
      continue;
    }

    // Lista numerada (1., 2., 3.)
    if (clean.match(/^\d+\./)) {
      children.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 0, after: 120 },
        indent: { left: 720 },
        children: [new TextRun({ text: clean, font: 'Arial', size: 24 })]
      }));
      continue;
    }

    // Local e data
    if (clean.match(/^Vinhedo|^São Paulo|^Sao Paulo/) && clean.match(/\d{4}/)) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 320, after: 720 },
        children: [new TextRun({ text: clean, font: 'Arial', size: 24 })]
      }));
      continue;
    }

    // Assinatura (nome do advogado em negrito centralizado)
    if (clean.match(/^Waterl[oô]o Cassiano/i)) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 40 },
        children: [new TextRun({ text: clean, font: 'Arial', size: 24, bold: true })]
      }));
      continue;
    }

    // OAB
    if (clean.match(/^OAB\/SP/)) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 480 },
        children: [new TextRun({ text: clean, font: 'Arial', size: 24 })]
      }));
      continue;
    }

    // Nota LexPet / disclaimer
    if (clean.match(/^NOTA LEXPET|^O advogado signatario|^A jurisprudencia citada/i)) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        border: i > 0 && lines[i-1].match(/^NOTA LEXPET/i) ? undefined :
          { top: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC', space: 1 } },
        spacing: { before: clean.match(/^NOTA LEXPET/i) ? 480 : 0, after: 60 },
        children: [new TextRun({ text: clean, font: 'Arial', size: 18, color: '888888' })]
      }));
      continue;
    }

    // Parágrafo normal justificado
    children.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { before: 0, after: 160 },
      children: [new TextRun({ text: clean, font: 'Arial', size: 24 })]
    }));
  }

  return children;
}

// =============================================================
// GERAR DOCUMENTO
// =============================================================

const children = parseParagraphs(rawText);

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 24 } } }
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1800 }
      }
    },
    children
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUTPUT_FILE, buffer);
  console.log(`OK: ${OUTPUT_FILE}`);
}).catch(err => {
  console.error('ERRO ao gerar .docx:', err.message);
  process.exit(1);
});
