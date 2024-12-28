const cache = {
    triggers: new Map(),  // word -> [{lora_name, weight, version}]
    cognates: new Map(),  // word -> {lora_name, weight, version, replaceWith}
    lastUpdate: 0,
    CACHE_TTL: 1000 * 60 * 5  // 5 minutes
};

async function refreshLoraCache(db) {
    const now = Date.now();
    if (now - cache.lastUpdate < cache.CACHE_TTL) {
        return { triggers: cache.triggers, cognates: cache.cognates };
    }

    console.log('Refreshing LoRA cache...');
    
    // Get all LoRAs
    const loras = await db.findMany({});

    // Clear existing cache
    cache.triggers.clear();
    cache.cognates.clear();

    // Process each LoRA
    for (const lora of loras) {
        // Handle trigger words
        if (lora.triggerWords && Array.isArray(lora.triggerWords)) {
            for (const word of lora.triggerWords) {
                const wordLower = word.toLowerCase();
                if (!cache.triggers.has(wordLower)) {
                    cache.triggers.set(wordLower, []);
                }
                cache.triggers.get(wordLower).push({
                    lora_name: lora.lora_name,
                    weight: lora.default_weight || 1,
                    version: lora.version
                });
            }
        }

        // Handle cognates
        if (lora.cognates && Array.isArray(lora.cognates)) {
            for (const cognate of lora.cognates) {
                if (!cognate.word) continue;
                cache.cognates.set(cognate.word.toLowerCase(), {
                    lora_name: lora.lora_name,
                    weight: lora.default_weight || 1,
                    version: lora.version,
                    replaceWith: cognate.replaceWith || cognate.word
                });
            }
        }
    }

    cache.lastUpdate = now;
    console.log(`Cache refreshed with ${cache.triggers.size} triggers and ${cache.cognates.size} cognates`);
    
    return { triggers: cache.triggers, cognates: cache.cognates };
}

module.exports = {
    refreshLoraCache
};