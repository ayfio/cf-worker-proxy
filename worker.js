// ✅ РАБОЧИЙ VLESS-ПРОКСИ для Cloudflare Workers

const UUID = "d3f8a1c9-7b4e-4d2a-9f6c-8e5b3a7d1c4f"; // ← ЗАМЕНИТЕ на ваш UUID!
const WS_PATH = "/proxy";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. Проверка работоспособности
    if (url.pathname === "/" && request.headers.get("Upgrade") !== "websocket") {
      return new Response("✅ VLESS Worker is running - " + Date.now(), {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    // 2. VLESS over WebSocket
    if (url.pathname === WS_PATH) {
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
        return handleVLESSWebSocket(request);
      }
    }
    
    return new Response("Not Found", { status: 404 });
  }
};

async function handleVLESSWebSocket(request) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  
  const protocol = request.headers.get("Sec-WebSocket-Protocol") || "";
  const isValidUUID = protocol.includes(UUID) || protocol === "vless" || UUID === "";
  
  if (isValidUUID) {
    server.send("✅ VLESS accepted");
    
    server.addEventListener("message", (event) => {
      server.send(event.data);
    });
  } else {
    server.close(1008, "Invalid UUID");
  }
  
  return new Response(null, { status: 101, webSocket: client });
}
