/**
 * ✅ ULTRA-MINIMAL WORKER — не может упасть
 * Просто отвечает на /status и эхо на /proxy
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // 🔹 Health check — всегда работает
    if (url.pathname === "/status" || url.pathname === "/") {
      return new Response("✅ Worker OK\n" + new Date().toISOString(), {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    // 🔹 WebSocket echo (для теста соединения)
    if (url.pathname === "/proxy" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const { 0: client, 1: server } = new WebSocketPair();
      server.accept();
      
      server.addEventListener("message", (event) => {
        if (server.readyState === WebSocket.OPEN) {
          server.send(event.data); // Эхо обратно
        }
      });
      
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }
    
    // 🔹 Всё остальное — 404
    return new Response("Not Found - Use /status or /proxy", { status: 404 });
  }
};
