/** Destino de alertas em memória. Junta o que teria sido dito a um humano. */
export function createFakeAlerts() {
  const messages = [];
  return {
    async notify(message) {
      messages.push(message);
    },
    /** Inspeção, não faz parte do port. */
    all: () => [...messages],
    count: () => messages.length,
    matching: (pattern) => messages.filter((message) => pattern.test(message)),
  };
}
