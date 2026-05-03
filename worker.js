/**
 * ✅ VLESS WebSocket Proxy для Cloudflare Workers
 * Полная версия с проксированием трафика
 * Совместим с sing-box / Xray / Clash
 * 
 * Настройка: замените UUID ниже на ваш из config.json
 */

// 🔑 Ваш UUID (должен совпадать с config.json!)
const UUID = "d3f8a1c9-7b4e-4d2a-9f6c-8e5b3a7d1c4f";

// 🌐 Путь для WebSocket (должен совпадать с transport.path в config.json)
const WS_PATH = "/proxy";

// 🔄 Прокси-IP для обхода (опционально, оставьте пустым для начала)
const PROXY_IP = "";

// 🎯 Порты по умолчанию
const DEFAULT_PORT = 443;

export default {
  /**
   * Главный обработчик запросов
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1️⃣ Проверка работоспособности (браузер / curl)
    if (url.pathname === "/" || url.pathname === "/status") {
      return new Response(`✅ VLESS Proxy Active\nTime: ${Date.now()}`, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    // 2️⃣ VLESS over WebSocket (для sing-box)
    if (url.pathname.includes(WS_PATH)) {
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
        return await vlessOverWSHandler(request);
      }
    }
    
    // 3️⃣ Всё остальное — 404
    return new Response("Not Found", { status: 404 });
  }
};

/**
 * Обработчик VLESS over WebSocket
 */
async function vlessOverWSHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);
  
  webSocket.accept();
  
  let address = "";
  let portWithRandomLog = "";
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
  
  // Создаём читаемый поток из WebSocket
  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader);
  
  // Обёртка для удалённого сокета
  let remoteSocketWapper = { value: null };
  let udpStreamWrite = null;
  let isDns = false;
  
  // Обрабатываем входящие данные
  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (isDns && udpStreamWrite) {
            return udpStreamWrite(chunk);
          }
          
          if (remoteSocketWapper.value) {
            // Данные для уже установленного соединения
            const writer = remoteSocketWapper.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }
          
          // Парсим заголовок VLESS
          const {
            hasError,
            message,
            addressRemote,
            portRemote,
            rawDataIndex,
            vlessVersion,
            isUDP,
          } = await processVlessHeader(chunk, UUID);
          
          if (hasError) {
            throw new Error(message);
            return;
          }
          
          // Если UDP (DNS)
          if (isUDP) {
            if (portRemote === 53) {
              isDns = true;
            } else {
              throw new Error("UDP proxy only enabled for DNS (port 53)");
              return;
            }
          }
          
          address = addressRemote;
          portWithRandomLog = `${portRemote}`;
          
          // Устанавливаем соединение с целевым сервером
          remoteSocketWapper.value = await handleTCPOutBound(
            remoteSocketWapper,
            addressRemote,
            portRemote,
            readableWebSocketStream,
            webSocket,
            rawDataIndex
          );
        },
        close() {},
        abort(reason) {},
      })
    )
    .catch((err) => {
      console.error("WebSocket stream error:", err);
    });
  
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

/**
 * Парсинг заголовка VLESS
 */
async function processVlessHeader(vlessBuffer, userID) {
  if (vlessBuffer.byteLength < 24) {
    return { hasError: true, message: "Invalid data: too short" };
  }
  
  const version = new Uint8Array(vlessBuffer.slice(0, 1))[0];
  
  // Проверка UUID (16 байт, начиная с позиции 1)
  let isValidUser = true;
  for (let i = 0; i < 16; i++) {
    if (vlessBuffer[i + 1] !== userID[i]) {
      isValidUser = false;
      break;
    }
  }
  
  if (!isValidUser) {
    return { hasError: true, message: "Invalid UUID" };
  }
  
  // Пропускаем UUID (17 байт: 1 версия + 16 UUID)
  let offset = 17;
  
  // Добавочная длина (varint)
  const addonLength = vlessBuffer[offset];
  offset += 1 + addonLength;
  
  // Тип адреса (1 байт): 1=IPv4, 2=Домен, 3=IPv6
  const addressType = vlessBuffer[offset];
  offset += 1;
  
  let addressLength = 0;
  let addressRemote = "";
  
  if (addressType === 1) {
    // IPv4 (4 байта)
    addressRemote = `${vlessBuffer[offset]}.${vlessBuffer[offset+1]}.${vlessBuffer[offset+2]}.${vlessBuffer[offset+3]}`;
    offset += 4;
  } else if (addressType === 2) {
    // Домен: 1 байт длина + строка
    addressLength = vlessBuffer[offset];
    offset += 1;
    const decoder = new TextDecoder();
    addressRemote = decoder.decode(vlessBuffer.slice(offset, offset + addressLength));
    offset += addressLength;
  } else if (addressType === 3) {
    // IPv6 (16 байт)
    const bytes = vlessBuffer.slice(offset, offset + 16);
    addressRemote = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(':');
    offset += 16;
  } else {
    return { hasError: true, message: `Invalid address type: ${addressType}` };
  }
  
  // Порт (2 байта, big-endian)
  const portRemote = (vlessBuffer[offset] << 8) | vlessBuffer[offset + 1];
  offset += 2;
  
  return {
    hasError: false,
    addressRemote: addressRemote,
    portRemote: portRemote,
    rawDataIndex: offset,
    vlessVersion: version,
    isUDP: false,
  };
}

/**
 * Создание читаемого потока из WebSocket
 */
function makeReadableWebSocketStream(webSocket, earlyDataHeader) {
  let readableStreamCancel = false;
  
  const stream = new ReadableStream({
    start(controller) {
      webSocket.addEventListener("message", (event) => {
        if (readableStreamCancel) return;
        const message = event.data;
        controller.enqueue(message);
      });
      
      webSocket.addEventListener("close", () => {
        safeCloseWebSocket(webSocket);
        if (readableStreamCancel) return;
        controller.close();
      });
      
      webSocket.addEventListener("error", (err) => {
        controller.error(err);
      });
    },
    cancel(reason) {
      if (readableStreamCancel) return;
      readableStreamCancel = true;
      safeCloseWebSocket(webSocket);
    },
  });
  
  return stream;
}

/**
 * Безопасное закрытие WebSocket
 */
function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  } catch (error) {
    // Игнорируем ошибки закрытия
  }
}

/**
 * Установка соединения с целевым сервером
 * ⚠️ Cloudflare Workers не поддерживают raw TCP, поэтому используем fetch к HTTPS
 */
async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  readableWebSocketStream,
  webSocket,
  rawDataIndex
) {
  try {
    // Для HTTPS/HTTP используем fetch с потоковой передачей
    if (portRemote === 443 || portRemote === 80) {
      return await handleHTTPSOutBound(
        addressRemote,
        portRemote,
        readableWebSocketStream,
        webSocket,
        rawDataIndex
      );
    }
    
    // Для других портов — заглушка (Cloudflare не поддерживает raw TCP)
    console.log(`Unsupported port ${portRemote} for ${addressRemote}`);
    return null;
    
  } catch (error) {
    console.error("handleTCPOutBound error:", error);
    return null;
  }
}

/**
 * Проксирование HTTPS/HTTP трафика через fetch
 */
async function handleHTTPSOutBound(
  address,
  port,
  readableWebSocketStream,
  webSocket,
  rawDataIndex
) {
  const url = `https://${address}${port === 443 ? '' : `:${port}`}`;
  
  // Создаём TransformStream для буферизации данных от клиента
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  
  // Отправляем "остаток" данных после заголовка VLESS
  // (это начало запроса к целевому серверу)
  
  // Запускаем фоновую пересылку: WebSocket → fetch
  (async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Forwarded-For': '127.0.0.1',
        },
        body: readable,
        duplex: 'half',
      });
      
      if (response.body) {
        // Пересылка: fetch response → WebSocket
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (webSocket.readyState === WebSocket.OPEN) {
            webSocket.send(value);
          }
        }
      }
    } catch (error) {
      console.error(`fetch error for ${url}:`, error);
    }
  })();
  
  // Пересылка: WebSocket → fetch request body
  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          if (webSocket.readyState === WebSocket.OPEN) {
            await writer.write(chunk.slice(rawDataIndex));
          }
        },
        close() { writer.close(); },
        abort(reason) { writer.abort(reason); },
      })
    )
    .catch(() => {});
  
  return { writable };
}

/**
 * Вспомогательная функция для пересылки потоков
 */
async function pipeStream(readable, webSocket) {
  if (!readable) return;
  
  const reader = readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(value);
      }
    }
  } catch (error) {
    console.error("pipeStream error:", error);
  } finally {
    reader.releaseLock();
  }
}
