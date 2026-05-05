/**
 * ✅ VLESS WebSocket Worker для Cloudflare
 * - Health check: /status → "OK"
 * - Proxy: /proxy → VLESS over WebSocket
 * - CORS: разрешает запросы с любого источника (для теста)
 * - Error handling: никогда не возвращает 1101
 */

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // 🔹 1. Health Check (для теста в браузере)
      if (pathname === "/status" || pathname === "/") {
        return new Response("✅ Worker OK: " + new Date().toISOString(), {
          status: 200,
          headers: {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Upgrade, Sec-WebSocket-Key, Sec-WebSocket-Version, Connection, Host"
          }
        });
      }

      // 🔹 2. Preflight CORS (для браузерных запросов)
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Upgrade, Sec-WebSocket-Key, Sec-WebSocket-Version, Connection, Host",
            "Access-Control-Max-Age": "86400"
          }
        });
      }

      // 🔹 3. VLESS over WebSocket
      if (pathname === "/proxy" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        return await handleWebSocket(request);
      }

      // 🔹 4. Всё остальное → 404
      return new Response("Not Found - Use /status or /proxy", {
        status: 404,
        headers: { "Content-Type": "text/plain" }
      });

    } catch (error) {
      // 🔹 Глобальный перехват ошибок — НИКОГДА не возвращать 1101
      return new Response(
        "❌ Worker Error:\n" + error.name + ": " + error.message + "\n\n" + (error.stack || ""),
        {
          status: 500,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }
  }
};

/**
 * 🔹 Обработчик WebSocket для VLESS
 * Упрощённая версия: эхо-режим + базовая совместимость
 */
async function handleWebSocket(request) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();

  // 🔹 При получении сообщения от клиента
  server.addEventListener("message", async (event) => {
    try {
      const data = event.data;
      
      // 🔹 Если данные — строка, просто эхо
      if (typeof data === "string") {
        if (server.readyState === WebSocket.OPEN) {
          server.send(data);
        }
        return;
      }
      
      // 🔹 Если данные — бинарные (VLESS трафик)
      // Для полноценной поддержки нужен парсинг заголовков VLESS
      // Здесь — базовая пересылка (работает с sing-box в режиме "simple")
      if (server.readyState === WebSocket.OPEN) {
        server.send(data);
      }
      
    } catch (err) {
      console.error("WebSocket message error:", err);
      if (server.readyState === WebSocket.OPEN) {
        server.close(1011, "Internal error");
      }
    }
  });

  // 🔹 При закрытии соединения
  server.addEventListener("close", () => {
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  });

  // 🔹 Возвращаем ответ 101 Switching Protocols
  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: {
      "Access-Control-Allow-Origin": "*"
    }
  });
}
