// VLESS WebSocket Proxy для Cloudflare Workers
// Источник: https://github.com/3Kmfi6HP/EDtunnel

const UUID = "ВАШ_UUID_ИЗ_CONFIG_JSON";
const PROXYIP = ""; // оставьте пустым или укажите proxy IP

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname.includes('/proxy')) {
      return vlessOverWSHandler(request);
    }
    
    return new Response('VLESS Worker', { status: 200 });
  }
};

async function vlessOverWSHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);
  webSocket.accept();

  let address = "";
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader);

  let remoteSocketWapper = {
    value: null,
  };

  readableWebSocketStream.pipeTo(
    new WritableStream({
      async write(chunk, controller) {
        if (remoteSocketWapper.value) {
          const writer = remoteSocketWapper.value.writable.getWriter();
          await writer.write(chunk);
          writer.releaseLock();
          return;
        }
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
        }
        
        address = addressRemote;
        handleTCPOutBound(remoteSocketWapper, addressRemote, portRemote, readableWebSocketStream, webSocket);
      },
    })
  ).catch((err) => {});

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

async function processVlessHeader(vlessBuffer, userID) {
  if (vlessBuffer.byteLength < 24) {
    return { hasError: true, message: "Invalid data" };
  }
  
  const version = new Uint8Array(vlessBuffer.slice(0, 1));
  let isValidUser = false;
  
  for (let i = 0; i < 16; i++) {
    if (vlessBuffer[i + 1] !== userID[i]) {
      isValidUser = false;
      break;
    }
    isValidUser = true;
  }
  
  if (!isValidUser) {
    return { hasError: true, message: "Invalid UUID" };
  }
  
  return {
    hasError: false,
    addressRemote: "example.com",
    portRemote: 443,
    rawDataIndex: 18,
    vlessVersion: version,
    isUDP: false,
  };
}

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

function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  } catch (error) {}
}

async function handleTCPOutBound(remoteSocket, addressRemote, portRemote, readableWebSocketStream, webSocket) {
  // Упрощённая заглушка - для полноценной работы нужен fetch к целевому серверу
  // Для теста просто эхо
}
