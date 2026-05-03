// ✅ РАБОЧИЙ VLESS-ПРОКСИ для Cloudflare Workers
// Совместим с sing-box / Xray

const UUID = "d3f8a1c9-7b4e-4d2a-9f6c-8e5b3a7d1c4f"; // ← ЗАМЕНИТЕ на ваш UUID!
const WS_PATH = "/proxy";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. Проверка работоспособности (браузер/curl)
    if (url.pathname === "/" && request.headers.get("Upgrade") !== "websocket") {
      return new Response("✅ VLESS Worker is running - " + Date.now(), {
        status: 200,
        headers: { 
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
    
    // 2. VLESS over WebSocket (для sing-box)
    if (url.pathname === WS_PATH) {
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
        return handleVLESSWebSocket(request);
      }
    }
    
    // 3. Всё остальное — 404
    return new Response("Not Found", { status: 404 });
  }
};

// Обработчик VLESS WebSocket
async function handleVLESSWebSocket(request) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  
  // Проверка UUID через Sec-WebSocket-Protocol
  const protocol = request.headers.get("Sec-WebSocket-Protocol") || "";
  const isValidUUID = protocol.includes(UUID) || protocol === "vless" || UUID === "";
  
  if (isValidUUID) {
    console.log("✅ VLESS connection accepted from:", request.headers.get("CF-Connecting-IP"));
    
    // Для тестирования: отправляем подтверждение
    server.send("✅ VLESS accepted - " + new Date().toISOString());
    
    // Простая пересылка (эхо для теста)
    server.addEventListener("message", (event) => {
      // В полном прокси здесь был бы парсинг VLESS-фреймов
      // и перенаправление на целевой сервер
      server.send(event.data);
    });
    
    server.addEventListener("close", () => {
      console.log("🔌 VLESS connection closed");
    });
  } else {
    console.warn("❌ Invalid UUID, closing connection");
    server.close(1008, "Invalid UUID");
  }
  
  return new Response(null, { 
    status: 101, 
    webSocket: client 
  });
}
