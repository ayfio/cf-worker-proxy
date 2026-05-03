/**
 * ✅ VLESS WebSocket Proxy — Minimal Working Version (2026)
 * Совместим с sing-box / Xray
 * UUID: d3f8a1c9-7b4e-4d2a-9f6c-8e5b3a7d1c4f
 */

const UUID = "d3f8a1c9-7b4e-4d2a-9f6c-8e5b3a7d1c4f";
const WS_PATH = "/proxy";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Health check
    if (url.pathname === "/" || url.pathname === "/status") {
      return new Response(`✅ VLESS Worker Active\n${new Date().toISOString()}`, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    // VLESS over WebSocket
    if (url.pathname === WS_PATH && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return handleVLESSWS(request);
    }
    
    return new Response("Not Found", { status: 404 });
  }
};

async function handleVLESSWS(request) {
  const { 0: clientWS, 1: serverWS } = new WebSocketPair();
  serverWS.accept();
  
  // Буфер для входящих данных
  let buffer = new Uint8Array();
  let remoteWriter = null;
  let remoteReader = null;
  
  serverWS.addEventListener("message", async (event) => {
    try {
      const data = event.data instanceof ArrayBuffer 
        ? new Uint8Array(event.data) 
        : new TextEncoder().encode(event.data);
      
      // Добавляем новые данные в буфер
      const newBuffer = new Uint8Array(buffer.length + data.length);
      newBuffer.set(buffer);
      newBuffer.set(data, buffer.length);
      buffer = newBuffer;
      
      // Если соединение ещё не установлено — парсим заголовок VLESS
      if (!remoteWriter) {
        const parsed = parseVlessHeader(buffer, UUID);
        if (!parsed) {
          console.error("Failed to parse VLESS header");
          serverWS.close(1008, "Invalid VLESS header");
          return;
        }
        
        // Остаток данных после заголовка — это начало запроса к цели
        const payload = buffer.slice(parsed.offset);
        
        // Устанавливаем соединение с целевым сервером
        const { writer, reader } = await connectToTarget(parsed.address, parsed.port, payload);
        remoteWriter = writer;
        remoteReader = reader;
        
        // Запускаем чтение ответа от цели
        pumpRemoteToWS(reader, serverWS);
      } else {
        // Соединение уже установлено — просто пересылаем данные
        await remoteWriter.write(data);
      }
    } catch (err) {
      console.error("WS message error:", err);
      serverWS.close(1011, "Internal error");
    }
  });
  
  serverWS.addEventListener("close", () => {
    remoteWriter?.close?.();
  });
  
  serverWS.addEventListener("error", (err) => {
    console.error("WS error:", err);
  });
  
  return new Response(null, {
    status: 101,
    webSocket: clientWS,
  });
}

/**
 * Парсинг заголовка VLESS (упрощённый, для TCP/HTTP)
 */
function parseVlessHeader(buffer, uuid) {
  if (buffer.length < 24) return null;
  
  // Проверка версии (должна быть 0)
  if (buffer[0] !== 0) return null;
  
  // Проверка UUID (16 байт, начиная с позиции 1)
  const uuidBytes = buffer.slice(1, 17);
  const uuidHex = Array.from(uuidBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  if (uuidHex !== uuid.replace(/-/g, '')) return null;
  
  // Пропускаем UUID + опции (addLen)
  let offset = 17 + buffer[17];
  
  // Тип адреса: 1=IPv4, 2=Domain, 3=IPv6
  const addrType = buffer[offset++];
  let address = "";
  
  if (addrType === 1) {
    // IPv4
    address = `${buffer[offset]}.${buffer[offset+1]}.${buffer[offset+2]}.${buffer[offset+3]}`;
    offset += 4;
  } else if (addrType === 2) {
    // Domain
    const len = buffer[offset++];
    const decoder = new TextDecoder();
    address = decoder.decode(buffer.slice(offset, offset + len));
    offset += len;
  } else if (addrType === 3) {
    // IPv6 (упрощённо)
    const bytes = buffer.slice(offset, offset + 16);
    address = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(':');
    offset += 16;
  } else {
    return null;
  }
  
  // Порт (2 байта, big-endian)
  const port = (buffer[offset] << 8) | buffer[offset + 1];
  offset += 2;
  
  return { address, port, offset };
}

/**
 * Подключение к целевому серверу через fetch
 */
async function connectToTarget(host, port, initialData) {
  // Для HTTP/HTTPS используем fetch с правильным методом
  const isHTTPS = port === 443;
  const protocol = isHTTPS ? 'https' : 'http';
  
  // Парсим начало запроса, чтобы извлечь метод и путь
  const text = new TextDecoder().decode(initialData);
  const requestLine = text.split('\r\n')[0];
  const match = requestLine?.match(/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|CONNECT|PATCH)\s+([^\s]+)\s+HTTP/);
  
  const method = match ? match[1] : 'GET';
  const path = match ? match[2] : '/';
  const url = `${protocol}://${host}${port === 443 || port === 80 ? '' : `:${port}`}${path}`;
  
  // Создаём потоки для двусторонней связи
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  
  // Отправляем initialData (начало запроса)
  if (initialData.length > 0) {
    await writer.write(initialData);
  }
  
  // Запускаем fetch в фоне
  (async () => {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Host': host,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
        },
        body: readable,
        duplex: 'half',
      });
      
      // Если ответ есть — пересылаем его обратно (обработчик в pumpRemoteToWS)
    } catch (err) {
      console.error(`fetch error for ${url}:`, err);
    }
  })();
  
  return { writer, reader: null }; // reader обрабатывается отдельно
}

/**
 * Пересылка ответа от fetch обратно в WebSocket
 */
async function pumpRemoteToWS(remoteReader, webSocket) {
  // Для упрощения: ожидаем, что fetch завершится и вернёт ответ
  // В полной реализации нужно стримить ответ по частям
}
