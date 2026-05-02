// worker.js — минимальный тестовый воркер
export default {
  async fetch(request) {
    return new Response("✅ Worker is ALIVE - " + Date.now(), {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  }
};
