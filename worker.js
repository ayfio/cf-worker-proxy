/**
 * ✅ ULTRA-MINIMAL WORKER v2
 * 1. Отвечает на /status
 * 2. Делает эхо на /proxy (WebSocket)
 * 3. Не содержит импортов, сложной логики и парсинга — не может упасть
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 1. Health Check — всегда работает
    if (url.pathname === "/status" || url.pathname === "/") {
      return new Response("✅ Worker OK: " + Date.now(), {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // 2. WebSocket Echo — для теста соединения
    if (url.pathname === "/proxy" && request.headers.get("Upgrade") === "websocket") {
      const { 0: client, 1: server } = new WebSocketPair();
      server.accept();
      server.addEventListener("message", (event) => {
        if (server.readyState === WebSocket.OPEN) {
          server.send(event.data); // Просто возвращаем данные обратно
        }
      });
      return new Response(null, { status: 101, webSocket: client });
    }

    // 3. Всё остальное — 404
    return new Response("Not Found", { status: 404 });
  }
};
