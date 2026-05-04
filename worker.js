/**
 * ✅ WORKING VLESS WebSocket Proxy — Minimal & Stable
 * Uses cloudflare:sockets for raw TCP proxying
 * Compatible with sing-box / Xray / Clash / Hiddify
 */

// @ts-ignore
import { connect } from 'cloudflare:sockets';

const UUID = "d3f8a1c9-7b4e-4d2a-9f6c-8e5b3a7d1c4f";
const WS_PATH = "/proxy";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 🔹 Health check — всегда работает
    if (url.pathname === "/" || url.pathname === "/status") {
      return new Response(`✅ VLESS Worker OK\n${new Date().toISOString()}`, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    // 🔹 VLESS over WebSocket
    if (url.pathname === WS_PATH && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return handleVLESSWS(request, env);
    }
    
    return new Response("Not Found - Use /status or /proxy", { status: 404 });
  }
};

async function handleVLESSWS(request, env) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  
  let remoteSocket = null;
  let hasParsedHeader = false;
  let uuid = env.UUID || UUID;
  
  server.addEventListener("message", async (event) => {
    try {
      const data = event.data instanceof ArrayBuffer 
        ? new Uint8Array(event.data) 
        : new TextEncoder().encode(event.data);
      
      // Парсим заголовок VLESS только один раз
      if (!hasParsedHeader) {
        const parsed = parseVlessHeader(data, uuid);
        if (!parsed) {
          console.error("Invalid VLESS header");
          server.close(1008, "Bad protocol");
          return;
        }
        
        hasParsedHeader = true;
        
        // 🔹 Устанавливаем TCP-соединение через cloudflare:sockets
        remoteSocket = connect(`${parsed.address}:${parsed.port}`);
        
        // Отправляем остаток данных (начало запроса)
        if (parsed.payload && parsed.payload.length > 0) {
          const writer = remoteSocket.writable.getWriter();
          await writer.write(parsed.payload);
          writer.releaseLock();
        }
        
        // 🔹 Читаем ответ от цели и пересылаем в WebSocket
        pumpRemoteToWS(remoteSocket.readable, server);
        
      } else if (remoteSocket) {
        // Соединение уже установлено — просто пересылаем
        const writer = remoteSocket.writable.getWriter();
        await writer.write(data);
        writer.releaseLock();
      }
    } catch (err) {
      console.error("WS message error:", err);
      server.close(1011, "Internal error");
    }
  });
  
  server.addEventListener("close", () => {
    remoteSocket?.close?.();
  });
  
  server.addEventListener("error", (err) => {
    console.error("WS error:", err);
  });
  
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

function parseVlessHeader(buffer, uuid) {
  if (buffer.length < 24) return null;
  if (buffer[0] !== 0) return null; // version must be 0
  
  // Проверка UUID (16 байт после версии)
  const uuidBytes = buffer.slice(1, 17);
  const uuidHex = Array.from(uuidBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  if (uuidHex !== uuid.replace(/-/g, '')) return null;
  
  // Пропускаем UUID + опции (addLen)
  let offset = 17 + buffer[17];
  
  // Тип адреса: 1=IPv4, 2=Domain, 3=IPv6
  const addrType = buffer[offset++];
  let address = "";
  
  if (addrType === 1) { // IPv4
    address = `${buffer[offset]}.${buffer[offset+1]}.${buffer[offset+2]}.${buffer[offset+3]}`;
    offset += 4;
  } else if (addrType === 2) { // Domain
    const len = buffer[offset++];
    address = new TextDecoder().decode(buffer.slice(offset, offset + len));
    offset += len;
  } else if (addrType === 3) { // IPv6
    const bytes = buffer.slice(offset, offset + 16);
    address = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(':');
    offset += 16;
  } else {
    return null;
  }
  
  // Порт (2 байта, big-endian)
  const port = (buffer[offset] << 8) | buffer[offset + 1];
  offset += 2;
  
  return {
    address,
    port,
    payload: buffer.slice(offset), // Остаток данных — начало запроса
  };
}

async function pumpRemoteToWS(remoteReadable, webSocket) {
  const reader = remoteReadable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(value);
      }
    }
  } catch (err) {
    console.error("pumpRemoteToWS error:", err);
  } finally {
    reader.releaseLock();
  }
}
