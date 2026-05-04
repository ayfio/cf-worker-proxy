/**
 * ✅ WEBSOCKET ECHO TEST - Debug Build
 * Просто принимает WebSocket и возвращает данные обратно.
 * Никакого VLESS — только проверка соединения.
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Health check
    if (url.pathname === "/status" || url.pathname === "/") {
      return new Response(`✅ Worker OK - Echo Mode\n${new Date().toISOString()}`, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    // WebSocket echo
    if (url.pathname === "/proxy" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      console.log("[WS] New connection");
      
      const { 0: client, 1: server } = new WebSocketPair();
      server.accept();
      
      server.addEventListener("message", (event) => {
        if (server.readyState === WebSocket.OPEN) {
          server.send("ECHO: " + (typeof event.data === 'string' ? event.data : '[binary]'));
        }
      });
      
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }
    
    return new Response("Not Found", { status: 404 });
  }
};
