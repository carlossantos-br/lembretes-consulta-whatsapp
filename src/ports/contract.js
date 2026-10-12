/**
 * Os ports são descritos como listas simples de nomes de método e verificados uma
 * vez só, na montagem. Não há nada de esperto aqui: a ideia é que um método
 * faltando falhe alto quando o orquestrador é construído, e não no meio de um scan
 * que já mandou algumas mensagens.
 */

export function assertImplements(name, adapter, methods) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError(`${name}: esperava um objeto adapter, recebeu ${typeof adapter}`);
  }
  const missing = methods.filter((method) => typeof adapter[method] !== 'function');
  if (missing.length > 0) {
    throw new TypeError(`${name}: método(s) ausente(s) ${missing.join(', ')}`);
  }
  return adapter;
}
