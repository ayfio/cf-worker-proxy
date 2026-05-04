// ✅ ULTRA-MINIMAL WEBSOCKET WORKER - 2026
// Никаких импортов, никаких переменных, только база

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Простой ответ для /status
    if (url.pathname === "/status") {
      return new Response("OK", { status: 200 });
    }
    
    // WebSocket: только создаём пару и возвращаем 101
    // Без обработчиков сообщений — чисто тест соединения
    if (url.pathname === "/proxy" && request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      pair[1].accept();
      return new Response(null, {
        status: 101,
        webSocket: pair[0],
      });
    }
    
    return new Response("Not Found", { status: 404 });
  }
};
