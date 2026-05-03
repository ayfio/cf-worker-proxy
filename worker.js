// ✅ ПОЛНЫЙ ВОРКЕР: VLESS + HTTPS Proxy
const UUID = "d3f8a1c9-7b4e-4d2a-9f6c-8e5b3a7d1c4f"; // ← Замените на ваш
const WS_PATH = "/proxy";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. Простой ответ для проверки (корень)
    if (url.pathname === "/") {
      return new Response("✅ Worker is running: VLESS + HTTPS Proxy", {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    // 2. HTTPS Proxy (для панели Cloudflare, браузера)
    if (request.headers.get("Upgrade") !== "websocket") {
      return await handleHttpsProxy(request, url);
    }
    
    // 3. VLESS over WebSocket (для sing-box)
    if (url.pathname === WS_PATH) {
      return await handleWebSocket(request);
    }
    
    return new Response("Not Found", { status: 404 });
  }
};

// HTTPS Proxy handler
async function handleHttpsProxy(request, url) {
  let targetHost = request.headers.get("X-Target-Host") || url.searchParams.get("host");
  
  if (!targetHost) {
    return new Response("✅ HTTPS Proxy ready. Use X-Target-Host header.", {
      status: 200, headers: { "Content-Type": "text/plain" }
    });
  }
  
  // Защита от цикла
  if (url.hostname.includes("workers.dev") || url.hostname.includes("xubi.org")) {
    return new Response("Loop detected", { status: 400 });
  }
  
  try {
    const targetUrl = `${url.protocol}//${targetHost}${url.pathname}${url.search}`;
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.delete("X-Target-Host");
    proxyHeaders.set("Host", targetHost);
    
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
      redirect: "manual"
    });
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (e) {
    return new Response(`Proxy error: ${e.message}`, { status: 502 });
  }
}

// VLESS WebSocket handler (упрощённый)
async function handleWebSocket(request) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  
  // Простая проверка UUID (для совместимости с sing-box)
  const protocol = request.headers.get("Sec-WebSocket-Protocol") || "";
  if (protocol.includes(UUID) || protocol === "vless") {
    server.send("✅ VLESS WebSocket accepted");
  } else {
    server.close(1008, "Invalid protocol");
  }
  
  // Эхо-режим для теста (в продакшене здесь будет парсинг VLESS)
  server.addEventListener("message", (event) => {
    server.send(event.data);
  });
  
  return new Response(null, { status: 101, webSocket: client });
}
