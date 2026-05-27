const CONFIG = {
    API_URL: "https://ahifhoj0guiqfd69x80tmg64n7kda7oyqp4jf12w9czbmwzxxp.sa033.shop/api/v5_5.php",
    STATIC_KEY: "37204f820330f0300300",
    DEVICE_ID: "065c5b219517310e",
    USER_AGENT: "ostora-5.5"
};

/**
 * محرك فك تشفير XOR
 */
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
    const url = new URL(request.url);
    
    // تقسيم الرابط لاستخراج القسم والمعرف (مثال: /series/7116 أو /sports/200)
    const segments = url.pathname.split('/').filter(Boolean);

    // التعامل مع طلبات Preflight لـ CORS
    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        });
    }

    // التحقق من وجود نسخة مخزنة مؤقتاً في الكاش الإقليمي لـ Cloudflare
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cache = caches.default;
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

    const [category, id] = segments;

    // التحقق من أن القسم المطلوب من الأقسام المدعومة
    const validCategories = ["series", "rseries", "moviesar", "sports"];
    if (!category || !validCategories.includes(category)) {
        return new Response(JSON.stringify({ error: "Route not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = new URLSearchParams();
    payload.append("id", CONFIG.DEVICE_ID);

    let isEpisodeQuery = false;

    // توجيه الطلبات بناءً على المدخلات المكتشفة في الرابط
    if (category === "sports") {
        if (!id) {
            return new Response(JSON.stringify({ error: "Sports ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }
        payload.append("cat_id", id);
        isEpisodeQuery = true;
    } else {
        // فئات: series, rseries, moviesar
        if (id) {
            // جلب حلقات/خوادم بناءً على الـ ID المتغير
            payload.append("cat_id", id);
            isEpisodeQuery = true;
        } else {
            // جلب القوائم الرئيسية للأقسام الثلاثة
            let mainId = "18"; // الافتراضي للمسلسلات العامة
            if (category === "rseries") mainId = "31";
            if (category === "moviesar") mainId = "19";

            payload.append("main_id", mainId);
            payload.append("sub_id", "0");
        }
    }

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
            if (isEpisodeQuery) {
                return new Response(JSON.stringify({
                    status: "success",
                    id: id,
                    episodes: [],
                    data: [],
                    message: "No data returned"
                }), {
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                });
            } else {
                return new Response(JSON.stringify({ error: "Decryption failed or invalid source data" }), {
                    status: 502,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                });
            }
        }

        let finalResponseData;

        if (isEpisodeQuery) {
            // صياغة الرد للحلقات والبث المباشر
            const episodes = decryptedData.data.map(ep => ({
                id: ep.id,
                number: ep.num,
                title: ep.channel_title,
                url: ep.channel_url,
                thumbnail: ep.channel_thumbnail,
                agent: ep.agent
            }));

            finalResponseData = JSON.stringify({
                status: "success",
                id: id,
                count: episodes.length,
                episodes: episodes,
                data: episodes // دعم التوافق مع الكودين
            });
        } else {
            // صياغة الرد لقوائم التصنيف
            const formatted = decryptedData.data.map(item => ({
                id: item.cid || item.id,
                name: item.category_name || item.channel_title,
                thumbnail: item.image || item.channel_thumbnail
            }));

            finalResponseData = JSON.stringify({ status: "success", data: formatted });
        }

        // تحديد وقت صلاحية الكاش (3 ساعات للقوائم وساعة واحدة للحلقات والبث)
        const maxAge = isEpisodeQuery ? 3600 : 10800;

        const apiResponse = new Response(finalResponseData, {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": `public, max-age=${maxAge}`,
                "X-Cache": "MISS"
            }
        });

        // حفظ الاستجابة في ذاكرة التخزين المؤقت لاستخدامها لاحقاً
        context.waitUntil(cache.put(cacheKey, apiResponse.clone()));

        return apiResponse;

    } catch (error) {
        return new Response(JSON.stringify({ error: "Internal server error", details: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }
}
