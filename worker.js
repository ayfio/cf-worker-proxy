// ✅ ULTRA-SIMPLE - не может упасть
export default {
  async fetch(request) {
    return new Response("ALIVE", { 
      status: 200,
      headers: { "content-type": "text/plain" }
    });
  }
};
