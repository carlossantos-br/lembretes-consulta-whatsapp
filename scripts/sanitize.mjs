#!/usr/bin/env node
/**
 * Impede que um segredo ou um literal identificável chegue a um repositório
 * público.
 *
 * A restrição interessante: **uma denylist de literais não pode, ela mesma, ser
 * publicada.** Um arquivo listando o nome do cliente, o hostname interno e os ids
 * de template vazaria exatamente o que existe para proteger, e vazaria num
 * arquivo cujo propósito inteiro anuncia que aquilo é sensível.
 *
 * Por isso a verificação tem duas metades:
 *
 *   1. **Formatos**, commitados aqui. Descrevem a *cara* de um segredo — object
 *      ids de 24 hex, JWTs, cabeçalhos de chave, credenciais dentro de URL,
 *      atribuições longas e opacas — e não nomeiam nada.
 *   2. **Literais**, nunca commitados. `.sanitize-local.json` está no gitignore e
 *      guarda os termos específicos de um deploy. Rode antes de publicar; o CI
 *      roda só os formatos.
 *
 * Exit code 1 em qualquer ocorrência, então serve como gate de CI e como hook de
 * pre-push.
 *
 *   node scripts/sanitize.mjs [--local .sanitize-local.json]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'coverage']);
// Este arquivo contém os próprios padrões, então varrê-lo reportaria o próprio
// código-fonte. Todos os outros arquivos do repositório entram na varredura.
const SKIP_FILES = new Set(['scripts/sanitize.mjs']);
const BINARY = /\.(png|jpe?g|gif|pdf|zip|ico|woff2?|ttf)$/i;

const SHAPES = [
  { name: 'object id (24 hex)', pattern: /\b[0-9a-f]{24}\b/g },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: 'bloco de chave privada', pattern: /-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}/g },
  { name: 'aws access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'credenciais em url', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]+@/gi },
  { name: 'token bearer literal', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/g },
  {
    name: 'atribuição longa e opaca',
    pattern: /\b[A-Z][A-Z0-9_]{3,}\s*=\s*['"]?[A-Za-z0-9+/=_-]{24,}['"]?/g,
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
      continue;
    }
    if (BINARY.test(entry)) continue;
    const rel = relative(ROOT, full);
    if (SKIP_FILES.has(rel)) continue;
    yield { full, rel };
  }
}

function loadLiterals(path) {
  try {
    const terms = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(terms)) throw new TypeError('esperava um array de strings');
    return terms.filter((term) => typeof term === 'string' && term.trim().length >= 3);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

const localPath = process.argv.includes('--local')
  ? process.argv[process.argv.indexOf('--local') + 1]
  : join(ROOT, '.sanitize-local.json');
const literals = loadLiterals(localPath);
// A lista de literais obviamente contém todos os literais. Varrê-la reportaria cada
// termo contra ele mesmo e afogaria as ocorrências que importam.
SKIP_FILES.add(relative(ROOT, localPath));

const findings = [];
let scanned = 0;

for (const { full, rel } of walk(ROOT)) {
  const text = readFileSync(full, 'utf8');
  scanned += 1;
  const lines = text.split('\n');

  for (const { name, pattern } of SHAPES) {
    for (const [index, line] of lines.entries()) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) findings.push({ rel, line: index + 1, name, sample: match[0].slice(0, 24) });
    }
  }

  for (const term of literals ?? []) {
    const needle = term.toLowerCase();
    for (const [index, line] of lines.entries()) {
      if (line.toLowerCase().includes(needle)) {
        findings.push({ rel, line: index + 1, name: 'literal local', sample: term });
      }
    }
  }
}

console.log(`sanitize: ${scanned} arquivo(s), ${SHAPES.length} formato(s)`);
console.log(
  literals
    ? `sanitize: ${literals.length} literal(is) local(is) de ${relative(ROOT, localPath)}`
    : 'sanitize: nenhuma lista local de literais encontrada — só formatos (é o que o CI roda)',
);

if (findings.length === 0) {
  console.log('sanitize: limpo');
  process.exit(0);
}

for (const finding of findings) {
  console.error(`  ${finding.rel}:${finding.line}  ${finding.name}  →  ${finding.sample}`);
}
console.error(`\nsanitize: ${findings.length} ocorrência(s). Nada é publicado enquanto elas existirem.`);
process.exit(1);
