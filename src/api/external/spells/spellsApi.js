const express = require('express');
const { createLogger } = require('../../../utils/logger');
const { authenticateGuestOrUser } = require('../../../platforms/web/middleware/guestAuth');
const { validateWebhookUrl } = require('../../../utils/webhookUtils');

/**
 * Creates an external-facing Express router for Spells.
 * This router proxies requests to the internal spells API, handling user authentication.
 * @param {Object} dependencies - Dependencies including internalApiClient, dualAuth middleware, and guestAuthService.
 * @returns {express.Router}
 */
function createSpellsApi(dependencies) {
    const router = express.Router();
    const { internalApiClient, logger, dualAuth, guestAuthService } = dependencies;
    
    // Create guest authentication middleware if guestAuthService is available
    const guestOrUserAuth = guestAuthService 
        ? authenticateGuestOrUser(guestAuthService)
        : dualAuth; // Fallback to dualAuth if guestAuthService not available

    // --- PUBLIC: Marketplace/Discovery Endpoint ---
    router.get('/marketplace', async (req, res) => {
        try {
            const { tag, search } = req.query;
            const params = new URLSearchParams();
            if (tag) params.append('tag', tag);
            if (search) params.append('search', search);
            
            const url = `/internal/v1/data/spells/public${params.toString() ? '?' + params.toString() : ''}`;
            const response = await internalApiClient.get(url);
            const raw = response.data;
            const list = Array.isArray(raw) ? raw : (raw.spells || raw.data || []);
            const publicSpells = list.map(spell => ({
                spellId: spell.spellId,
                slug: spell.slug || spell.spellId || spell._id,
                name: spell.name || spell.displayName,
                description: spell.description,
                uses: spell.uses || 0,
                author: spell.author || null,
                tags: spell.tags || [],
                createdAt: spell.createdAt,
            }));
            publicSpells.sort((a, b) => (b.uses || 0) - (a.uses || 0));
            res.status(200).json(publicSpells);
        } catch (error) {
            logger.error('Failed to fetch public spells for marketplace:', error);
            res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Unable to fetch public spells.' } });
        }
    });

    // --- REGISTRY: Full spell definitions for UI builders (mirrors /tools/registry) ---
    router.get('/registry', async (req, res) => {
        try {
            const ownedBy = req.user?.userId;
            const requests = [];
            if (ownedBy) {
                requests.push(internalApiClient.get(`/internal/v1/data/spells?ownedBy=${ownedBy}`));
            }
            // Always include public spells for discovery / fallback
            requests.push(internalApiClient.get('/internal/v1/data/spells/public'));

            const results = await Promise.allSettled(requests);
            const collected = [];
            for (const r of results) {
                if (r.status === 'fulfilled') {
                    const arr = r.value.data?.spells || r.value.data || [];
                    if (Array.isArray(arr)) collected.push(...arr);
                }
            }
            // Dedupe by spellId/_id
            const seen = new Set();
            const unique = collected.filter(s => {
                const id = s.spellId || s._id || s.id;
                if (!id || seen.has(id)) return false;
                seen.add(id); return true;
            });
            const simplified = unique.map(s => ({
                spellId: s.spellId || s._id || s.id,
                displayName: s.name || s.displayName || 'Spell',
                description: (s.description || '').split('\n')[0],
                inputSchema: s.inputSchema || s.paramsSchema || null,
                exposedInputs: s.exposedInputs || [],
            }));
            res.status(200).json(simplified);
        } catch (error) {
            logger.error('[externalSpellsApi] Failed to fetch spells registry:', error);
            const status = error.response?.status || 502;
            res.status(status).json({ error: { code: 'BAD_GATEWAY', message: 'Unable to fetch spells registry.' } });
        }
    });

    router.get('/registry/:spellId', async (req, res) => {
        const { spellId } = req.params;
        try {
            // Try to extract user from JWT cookie if present (optional auth for public endpoint)
            let masterAccountId = req.user?.userId || req.user?.masterAccountId;
            
            // If no user from middleware, try to read JWT cookie directly
            if (!masterAccountId) {
                const token = req.cookies?.jwt;
                if (token) {
                    try {
                        const jwt = require('jsonwebtoken');
                        const decoded = jwt.verify(token, process.env.JWT_SECRET);
                        masterAccountId = decoded.userId || decoded.masterAccountId;
                        // Set req.user for consistency
                        req.user = decoded;
                    } catch (error) {
                        // JWT invalid or expired - continue without auth (public access)
                        logger.debug(`[externalSpellsApi] JWT verification failed for /registry/${spellId}:`, error.message);
                    }
                }
            }
            
            const params = masterAccountId ? { masterAccountId } : {};
            const response = await internalApiClient.get(`/internal/v1/data/spells/${spellId}`, { params });
            const s = response.data || {};
            const def = {
                spellId: s.spellId || s._id || spellId,
                displayName: s.name || s.displayName || 'Spell',
                description: s.description || '',
                inputSchema: s.inputSchema || s.paramsSchema || null,
                exposedInputs: s.exposedInputs || [],
                // --- NEW: include steps and connections for client progress UI ---
                steps: s.steps || [],
                connections: s.connections || [],
            };
            res.status(200).json(def);
        } catch (error) {
            if (error.response?.status === 404) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Spell with ID '${spellId}' not found.` } });
            }
            if (error.response?.status === 403) {
                // Forward 403 errors with proper error message
                const errorData = error.response?.data || { error: 'You do not have permission to view this spell.' };
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: errorData.error || 'You do not have permission to view this spell.' } });
            }
            logger.error(`[externalSpellsApi] Failed to fetch registry data for spell ${spellId}:`, error);
            const status = error.response?.status || 502;
            res.status(status).json({ error: { code: 'BAD_GATEWAY', message: 'Unable to fetch spell definition.' } });
        }
    });

    // --- PUBLIC: Fetch a spell's metadata by slug ---
    router.get('/:slug', async (req, res, next) => {
        const { slug } = req.params;
        try {
            const response = await internalApiClient.get(`/internal/v1/data/spells/public/${slug}`);
            res.status(response.status).json(response.data);
        } catch (error) {
            logger.error(`[externalSpellsApi] Failed to fetch spell ${slug}:`, error);
            const statusCode = error.response ? error.response.status : 502;
            const errorData = error.response ? error.response.data : { message: 'Unable to fetch spell.' };
            res.status(statusCode).json({ error: { code: 'BAD_GATEWAY', ...errorData } });
        }
    });

    // --- PUBLIC: Get quote for a spell by id/slug ---
    router.post('/:spellIdentifier/quote', async (req, res) => {
        const { spellIdentifier } = req.params;
        const payload = req.body || {};
        try {
            const response = await internalApiClient.post(`/internal/v1/data/spells/${spellIdentifier}/quote`, payload);
            res.status(response.status).json(response.data);
        } catch (error) {
            logger.error('[externalSpellsApi] Failed to get spell quote:', error);
            const statusCode = error.response ? error.response.status : 502;
            const errorData = error.response ? error.response.data : { message: 'Unable to get spell quote.' };
            res.status(statusCode).json({ error: { code: 'BAD_GATEWAY', ...errorData } });
        }
    });

    // --- PROTECTED: All other spells endpoints ---
    router.use(dualAuth);

    // GET /spells - List user's spells
    router.get('/', async (req, res) => {
        try {
            const user = req.user;
            if (!user || !user.userId) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User or userId not found.' } });
            }
            const response = await internalApiClient.get(`/internal/v1/data/spells?ownedBy=${user.userId}`);
            logger.info('[externalSpellsApi] Data received from internal API:', JSON.stringify(response.data, null, 2));
            res.status(200).json(response.data);
        } catch (error) {
            logger.error('Failed to fetch user spells:', error);
            res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Unable to fetch user spells.' } });
        }
    });

    // POST /spells - Create a new spell
    router.post('/', async (req, res) => {
        try {
            const user = req.user;
            if (!user || !user.userId) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User or userId not found.' } });
            }
            const payload = { ...req.body, creatorId: user.userId, ownedBy: user.userId };
            const response = await internalApiClient.post('/internal/v1/data/spells', payload);
            res.status(response.status).json(response.data);
        } catch (error) {
            logger.error('Failed to create spell:', error);
            res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Unable to create spell.' } });
        }
    });

    // PUT /spells/:spellId - Update a spell
    router.put('/:spellId', async (req, res) => {
        try {
            const user = req.user;
            if (!user || !user.userId) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User or userId not found.' } });
            }
            const { spellId } = req.params;
            // Add both ownedBy and masterAccountId for internal API compatibility
            const payload = { ...req.body, ownedBy: user.userId, masterAccountId: user.userId };
            const response = await internalApiClient.put(`/internal/v1/data/spells/${spellId}`, payload);
            res.status(response.status).json(response.data);
        } catch (error) {
            logger.error('Failed to update spell:', error);
            res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Unable to update spell.' } });
        }
    });

    // DELETE /spells/:spellId - Delete a spell
    router.delete('/:spellId', async (req, res) => {
        try {
            const user = req.user;
            if (!user || !user.userId) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User or userId not found.' } });
            }
            const { spellId } = req.params;
            
            // The internal API expects masterAccountId in the body for authorization.
            // We use the authenticated user's ID for this.
            const response = await internalApiClient.delete(
                `/internal/v1/data/spells/${spellId}`, 
                { data: { masterAccountId: user.userId } }
            );

            // Forward the response. A successful DELETE (204) has no body.
            if (response.status === 204) {
                return res.status(204).send();
            }
            res.status(response.status).json(response.data);
        } catch (error) {
            const errorData = error.response ? error.response.data : { message: 'Unable to delete spell.' };
            const statusCode = error.response ? error.response.status : 502;
            logger.error('Failed to delete spell:', errorData);
            res.status(statusCode).json({ error: { code: 'BAD_GATEWAY', ...errorData } });
        }
    });

    // GET /spells/casts/:castId - Get cast status and results
    // Supports both regular users and guest users
    router.get('/casts/:castId', async (req, res, next) => {
        try {
            const { castId } = req.params;
            const user = req.user;
            
            // Allow guest users or regular users
            if (guestOrUserAuth) {
                return guestOrUserAuth(req, res, async (err) => {
                    if (err) return next(err);
                    try {
                        const response = await internalApiClient.get(`/internal/v1/data/spells/casts/${castId}`);
                        return res.status(response.status || 200).json(response.data);
                    } catch (error) {
                        const statusCode = error.response ? error.response.status : 502;
                        const errorData = error.response ? error.response.data : { message: 'Unable to fetch cast status.' };
                        return res.status(statusCode).json({ error: { code: 'BAD_GATEWAY', ...errorData } });
                    }
                });
            } else {
                // Fallback: require authentication
                if (!user || !user.userId) {
                    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
                }
                try {
                    const response = await internalApiClient.get(`/internal/v1/data/spells/casts/${castId}`);
                    return res.status(response.status || 200).json(response.data);
                } catch (error) {
                    const statusCode = error.response ? error.response.status : 502;
                    const errorData = error.response ? error.response.data : { message: 'Unable to fetch cast status.' };
                    return res.status(statusCode).json({ error: { code: 'BAD_GATEWAY', ...errorData } });
                }
            }
        } catch (error) {
            const statusCode = error.response ? error.response.status : 502;
            const errorData = error.response ? error.response.data : { message: 'Unable to fetch cast status.' };
            logger.error('Failed to fetch cast status via external API:', errorData);
            return res.status(statusCode).json({ error: { code: 'BAD_GATEWAY', ...errorData } });
        }
    });

    // POST /spells/cast - Execute a spell (proxy to internal API)
    // Supports both regular users, guest users, and anonymous (for zero-cost spells)
    router.post('/cast', async (req, res, next) => {
        try {
            const { slug, context = {} } = req.body || {};
            if (!slug) {
                return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing spell slug in request body.' } });
            }

            // Check if this is a zero-cost spell (no payment required)
            const isZeroCost = context.chargeUpfront === false && !context.quote;
            
            // Validate webhook URL if provided
            if (context.webhookUrl) {
                const validation = validateWebhookUrl(context.webhookUrl, process.env.NODE_ENV !== 'production');
                if (!validation.valid) {
                    return res.status(400).json({ 
                        error: { code: 'BAD_REQUEST', message: `Invalid webhook URL: ${validation.error}` } 
                    });
                }
            }

            // Handler function for casting spell
            async function handleCast() {
                const user = req.user;
                let masterAccountId;
                
                if (isZeroCost && (!user || !user.userId)) {
                    // For zero-cost spells without auth, use a placeholder
                    // The internal API should handle this gracefully
                    masterAccountId = 'anonymous-zero-cost';
                } else if (user && user.userId) {
                    masterAccountId = user.userId;
                } else {
                    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
                }

                const proxyPayload = {
                    slug,
                    context: {
                        ...context,
                        masterAccountId: masterAccountId,
                        platform: context.platform || (user?.isGuest ? 'web-public' : (user ? 'web-sandbox' : 'web-public')),
                        parameterOverrides: context.parameterOverrides || {},
                        isGuest: user?.isGuest || isZeroCost, // Zero-cost spells are treated as guest
                        // Include quote if provided for upfront payment charging
                        quote: context.quote || null,
                        chargeUpfront: context.chargeUpfront !== false && !isZeroCost, // Don't charge zero-cost spells
                        // Include webhook URL and secret if provided
                        webhookUrl: context.webhookUrl || null,
                        webhookSecret: context.webhookSecret || null
                    }
                };

                // Forward FULL response from internal API so frontend immediately knows castId / generationId
                const internalResp = await internalApiClient.post('/internal/v1/data/spells/cast', proxyPayload);
                // Typical success -> 200 OK with body { castId, generationId?, status }
                return res.status(internalResp.status || 200).json(internalResp.data);
            }
            
            // For zero-cost spells, allow anonymous execution
            if (isZeroCost) {
                return handleCast();
            }
            
            // For spells with cost, require authentication
            if (guestOrUserAuth) {
                return guestOrUserAuth(req, res, async (err) => {
                    if (err) return next(err);
                    // Continue to handler after auth
                    return handleCast();
                });
            } else {
                // No auth middleware available, require user
                if (!req.user || !req.user.userId) {
                    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required for spells with cost.' } });
                }
                return handleCast();
            }
        } catch (error) {
            const statusCode = error.response ? error.response.status : 502;
            const errorData = error.response ? error.response.data : { message: 'Unable to cast spell.' };
            logger.error('Failed to cast spell via external API:', errorData);
            res.status(statusCode).json({ error: { code: 'BAD_GATEWAY', ...errorData } });
        }
    });

    // ... add other protected endpoints as needed ...

    return router;
}

module.exports = createSpellsApi; 