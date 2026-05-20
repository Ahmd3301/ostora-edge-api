const CONFIG = {
    API_URL: "https://ahifhoj0guiqfd69x80tmg64n7kda7oyqp4jf12w9czbmwzxxp.sa033.shop/api/v5_5.php",
    STATIC_KEY: "37204f820330f0300300",
    DEVICE_ID: "065c5b219517310e",
    USER_AGENT: "ostora-5.5"
};

function decryptXor(encryptedText, timestamp) {
    try {
        const fullKey = timestamp + CONFIG.STATIC_KEY;
        let decrypted = '';
        for (let i = 0; i < encryptedText.length; i++) {
            decrypted += String.fromCharCode(
                encryptedText.charCodeAt(i) ^ fullKey.charCodeAt(i % 30)
            );
        }
        return JSON.parse(decrypted);
    } catch (e) {
        return null;
    }
}

export async function onRequest(context) {
    const { request, params } = context;
    const { id } = params; // استخراج قيمة الـ id ديناميكياً من الرابط ⚡

    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        });
    }

    const cacheUrl = new URL(request.url);
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    const cache = caches.default;

    // 🔍 1. فحص كاش السيرفر الإقليمي
    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
        const newHeaders = new Headers(cachedResponse.headers);
        newHeaders.set("X-Cache", "HIT");
        return new Response(cachedResponse.body, {
            status: cachedResponse.status,
            statusText: cachedResponse.statusText,
            headers: newHeaders
        });
    }

    // 🌐 2. طلب جديد للمصدر
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = new URLSearchParams();
    payload.append("id", CONFIG.DEVICE_ID);
    payload.append("cat_id", id); // إرسال الـ id ديناميكياً كـ cat_id للحلقات

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: "POST",
            headers: {
                "User-Agent": CONFIG.USER_AGENT,
                "Time": timestamp,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: payload.toString()
        });

        if (!response.ok) {
            return new Response(JSON.stringify({ error: "Source HTTP error" }), { 
                status: 502, 
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
            });
        }

        const rawData = await response.text();
        const decryptedData = decryptXor(rawData, timestamp);

        // إذا لم يكن هناك حلقات أو المعرف غير صحيح، نرجع مصفوفة فارغة
        if (!decryptedData || !decryptedData.data) {
            return new Response(JSON.stringify({
                status: "success",
                series_id: id,
                episodes: [],
                message: "Check if the ID is correct"
            }), { 
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
            });
        }

        const episodes = decryptedData.data.map(ep => ({
            id: ep.id,
            number: ep.num,
            title: ep.channel_title,
            url: ep.channel_url,
            thumbnail: ep.channel_thumbnail,
            agent: ep.agent
        }));

        const finalResponseData = JSON.stringify({
            status: "success",
            series_id: id,
            count: episodes.length,
            episodes: episodes
        });

        const apiResponse = new Response(finalResponseData, {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=3600", // التخزين المؤقت للحلقات لمدة ساعة واحدة
                "X-Cache": "MISS"
            }
        });

        // 💾 3. حفظ الحلقات في الكاش
        context.waitUntil(cache.put(cacheKey, apiResponse.clone()));

        return apiResponse;

    } catch (error) {
        return new Response(JSON.stringify({ error: "Internal server error", details: error.message }), { 
            status: 500, 
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
            });
    }
}
