const CONFIG = {
    API_URL: "https://ahifhoj0guiqfd69x80tmg64n7kda7oyqp4jf12w9czbmwzxxp.sa033.shop/api/v5_5.php",
    STATIC_KEY: "37204f820330f0300300",
    DEVICE_ID: "065c5b219517310e",
    USER_AGENT: "ostora-5.5"
};

// محرك فك التشفير الطرفي XOR
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
    const { request } = context;
    
    // التعامل مع طلبات CORS Preflight (OPTIONS)
    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        });
    }

    // إعداد مفتاح الكاش بناءً على رابط الطلب الفعلي لقصر التخزين
    const cacheUrl = new URL(request.url);
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    const cache = caches.default;

    // 🔍 1. محاولة جلب البيانات مباشرة من الكاش (بسرعة أقل من 15 ملي ثانية)
    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
        // ننسخ الاستجابة لإضافة ترويسة توضح أن البيانات قادمة من الكاش
        const newHeaders = new Headers(cachedResponse.headers);
        newHeaders.set("X-Cache", "HIT");
        return new Response(cachedResponse.body, {
            status: cachedResponse.status,
            statusText: cachedResponse.statusText,
            headers: newHeaders
        });
    }

    // 🌐 2. في حال لم تكن في الكاش (Cache Miss)، نجلبها من المصدر
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = new URLSearchParams();
    payload.append("id", CONFIG.DEVICE_ID);
    payload.append("main_id", "18");
    payload.append("sub_id", "0");

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

        if (!decryptedData || !decryptedData.data) {
            return new Response(JSON.stringify({ error: "Decryption failed or invalid source data" }), { 
                status: 502, 
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
            });
        }

        // تنسيق هيكلية البيانات للمخرجات الجديدة
        const formatted = decryptedData.data.map(item => ({
            id: item.cid,
            name: item.category_name,
            thumbnail: item.image
        }));

        const finalResponseData = JSON.stringify({ status: "success", data: formatted });

        // بناء استجابة جديدة تحتوي على ترويسات التخزين المؤقت لـ Cloudflare CDN
        const apiResponse = new Response(finalResponseData, {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=10800", // التخزين المؤقت لمدة 3 ساعات كاملة في خوادم CDN والملقمات الطرفية
                "X-Cache": "MISS"
            }
        });

        // 💾 3. حفظ النسخة الجديدة في الكاش لاستدعائها مستقبلاً بدون طلبات إضافية للمصدر
        context.waitUntil(cache.put(cacheKey, apiResponse.clone()));

        return apiResponse;

    } catch (error) {
        return new Response(JSON.stringify({ error: "Internal server error", details: error.message }), { 
            status: 500, 
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
        });
    }
}
