/**
 * ✅ VLESS WebSocket Worker для Cloudflare
 * Версия: 2.1 (стабильная)
 * - /status → health check
 * - /proxy → VLESS over WebSocket (эхо-режим)
 * - Глобальный try/catch → никогда не возвращает 1101
 */

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // 🔹 Health check (для тестов)
      if (path === "/status" || path === "/") {
        return new Response("✅ OK:" + Date.now(), {
          status: 200,
          headers: {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Host, Upgrade, Connection"
          }
        });
      }

      // 🔹 CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Host, Upgrade, Connection",
            "Access-Control-Max-Age": "86400"
          }
        });
      }

      // 🔹 WebSocket для VLESS
      if (path === "/proxy" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        const { 0: client, 1: server } = new WebSocketPair();
        server.accept();

        server.addEventListener("message", (event) => {
          if (server.readyState === WebSocket.OPEN) {
            // Эхо-режим: отправляем данные обратно
            // Для полноценного VLESS нужен парсинг заголовков
            server.send(event.data);
          }
        });

        server.addEventListener("close", () => {
          if (client.readyState === WebSocket.OPEN) client.close();
        });

        return new Response(null, {
          status: 101,
          webSocket: client,
          headers: { "Access-Control-Allow-Origin": "*" }
        });
      }

      // 🔹 Всё остальное → 404
      return new Response("Not Found", { status: 404 });

    } catch (e) {
      // 🔹 Глобальный перехват ошибок — НИКОГДА не 1101
      return new Response("ERR:" + e.message, {
        status: 500,
        headers: { "Content-Type": "text/plain" }
      });
    }
  }
};
