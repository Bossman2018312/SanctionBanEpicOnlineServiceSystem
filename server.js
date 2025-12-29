const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; 

// --- ROBUST CONFIGURATION ---
// We trim() these to ensure no invisible spaces break the API
const EOS_CONFIG = {
    deploymentId: (process.env.EOS_DEPLOYMENT_ID || "").trim(),
    clientId: (process.env.EOS_CLIENT_ID || "").trim(),
    clientSecret: (process.env.EOS_CLIENT_SECRET || "").trim(),
    apiUrl: 'https://api.epicgames.dev'
};

// Check if variables are missing
if (!EOS_CONFIG.deploymentId || !EOS_CONFIG.clientId) {
    console.error("❌ CRITICAL ERROR: EOS Variables are missing in Render Environment!");
}

// --- DATABASE ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB Error:", err));

const PlayerSchema = new mongoose.Schema({
    productUserId: { type: String, required: true, unique: true },
    username: String,
    aliases: [String],
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    isBanned: { type: Boolean, default: false }
});
const Player = mongoose.model('Player', PlayerSchema);

// --- AUTH HELPER ---
let tokenCache = { token: null, expiresAt: 0 };
async function getAccessToken() {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
    try {
        console.log("🔄 Refreshing EOS Token...");
        const response = await axios.post(
            `${EOS_CONFIG.apiUrl}/auth/v1/oauth/token`,
            new URLSearchParams({ grant_type: 'client_credentials', deployment_id: EOS_CONFIG.deploymentId }),
            { 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                auth: { username: EOS_CONFIG.clientId, password: EOS_CONFIG.clientSecret } 
            }
        );
        tokenCache.token = response.data.access_token;
        tokenCache.expiresAt = Date.now() + (response.data.expires_in - 300) * 1000;
        return tokenCache.token;
    } catch (error) { 
        console.error("❌ Auth Failed:", error.response?.data || error.message);
        throw new Error('EOS Auth Failed'); 
    }
}

const verifyAdminPassword = (req, res, next) => {
    const provided = req.headers['x-admin-auth'];
    if (ADMIN_PASSWORD && provided !== ADMIN_PASSWORD) {
        return res.status(403).json({ success: false, error: "WRONG PASSWORD" });
    }
    next();
};

// --- ROUTES ---

// 1. TRACK PLAYER
app.post('/api/players/track', async (req, res) => {
    const { productUserId, username } = req.body;
    if (!productUserId) return res.status(400).json({ error: "Missing ID" });
    await Player.findOneAndUpdate(
        { productUserId }, 
        { $set: { lastSeen: new Date(), username }, $addToSet: { aliases: username } }, 
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true });
});

// 2. GET PLAYERS
app.get('/api/players', verifyAdminPassword, async (req, res) => {
    const players = await Player.find().sort({ lastSeen: -1 });
    res.json({ success: true, players });
});

// 3. BAN PLAYER (DEBUG MODE)
app.post('/api/sanctions/create', verifyAdminPassword, async (req, res) => {
    try {
        const { productUserId, action, durationSeconds, justification } = req.body;

        if (!productUserId || productUserId.trim() === "") {
            return res.status(400).json({ success: false, error: "Missing Product User ID" });
        }

        const accessToken = await getAccessToken();
        
        // Use exact action from Unity, or default
        const safeAction = action || "RESTRICT_GAME_ACCESS"; 
        const finalId = productUserId.trim();

        const sanctionPayload = {
            subjectId: finalId, 
            action: safeAction,
            justification: justification || "Manual Ban", 
            source: 'MANUAL', 
            tags: ['banned']
        };
        
        if (durationSeconds > 0) {
            sanctionPayload.expirationTimestamp = Math.floor(Date.now() / 1000) + durationSeconds;
        }

        console.log(`🔨 Processing Ban: Action='${safeAction}' for ID='${finalId}'`);
        console.log(`📋 Deployment ID: '${EOS_CONFIG.deploymentId}'`);

        // Send to Epic
        const response = await axios.post(
            `${EOS_CONFIG.apiUrl}/sanctions/v1/${EOS_CONFIG.deploymentId}/sanctions`,
            [sanctionPayload], 
            { 
                headers: { 
                    'Authorization': `Bearer ${accessToken}`, 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                } 
            }
        );

        console.log("✅ EOS Success!");

        // Update DB
        await Player.findOneAndUpdate(
            { productUserId: finalId }, 
            { isBanned: true }, 
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        
        res.json({ success: true, data: response.data });

    } catch (error) { 
        // --- THE DEBUG FIX ---
        // If Epic sends an error, we send the WHOLE object back to Unity
        // This will let you see "Validation Failed" or "Sanction Not Found" in your console.
        
        const epicError = error.response?.data;
        console.error("❌ EPIC REJECTED REQUEST:", JSON.stringify(epicError || error.message));

        res.status(400).json({ 
            success: false, 
            error: "EPIC_API_ERROR",
            details: epicError || error.message // <--- READ THIS IN UNITY CONSOLE
        }); 
    }
});

app.post('/api/sanctions/remove', verifyAdminPassword, async (req, res) => {
    try {
        const { productUserId, referenceId } = req.body;
        const accessToken = await getAccessToken();
        if (referenceId) {
            await axios.delete(
                `${EOS_CONFIG.apiUrl}/sanctions/v1/${EOS_CONFIG.deploymentId}/sanctions/${referenceId}`,
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
        }
        if (productUserId) {
            await Player.findOneAndUpdate({ productUserId }, { isBanned: false });
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
