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

// --- CONFIGURATION ---
const EOS_CONFIG = {
    deploymentId: process.env.EOS_DEPLOYMENT_ID,
    clientId: process.env.EOS_CLIENT_ID,
    clientSecret: process.env.EOS_CLIENT_SECRET,
    apiUrl: 'https://api.epicgames.dev'
};

// --- MONGODB CONNECTION ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Connected to MongoDB Cloud"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- SCHEMA ---
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
        const response = await axios.post(
            `${EOS_CONFIG.apiUrl}/auth/v1/oauth/token`,
            new URLSearchParams({ 
                grant_type: 'client_credentials', 
                deployment_id: EOS_CONFIG.deploymentId 
            }),
            { 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                auth: { 
                    username: EOS_CONFIG.clientId, 
                    password: EOS_CONFIG.clientSecret 
                } 
            }
        );
        tokenCache.token = response.data.access_token;
        tokenCache.expiresAt = Date.now() + (response.data.expires_in - 300) * 1000;
        return tokenCache.token;
    } catch (error) { throw new Error('EOS Auth Failed: ' + error.message); }
}

// ================= ROUTES =================

// 1. TRACK PLAYER
app.post('/api/players/track', async (req, res) => {
    const { productUserId, username } = req.body;
    if (!productUserId) return res.status(400).json({ error: "Missing ID" });

    try {
        let player = await Player.findOneAndUpdate(
            { productUserId: productUserId },
            { 
                $set: { lastSeen: new Date(), username: username },
                $addToSet: { aliases: username }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log(`📝 Logged: ${player.username}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});

// 2. GET PLAYERS
app.get('/api/players', async (req, res) => {
    try {
        const players = await Player.find().sort({ lastSeen: -1 });
        res.json({ success: true, players });
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});

// 3. BAN PLAYER (FIXED LOGIC)
app.post('/api/sanctions/create', async (req, res) => {
    try {
        const { productUserId, action, durationSeconds, justification } = req.body;
        
        // VALIDATION
        if (!productUserId || typeof productUserId !== 'string' || productUserId.trim() === "") {
            return res.status(400).json({ success: false, error: "Missing Product User ID" });
        }

        const cleanId = productUserId.trim();
        console.log(`🔨 Processing Ban for: ${cleanId}`);

        const accessToken = await getAccessToken();
        
        // FORCE 'BAN_GAMEPLAY' (Default action that always exists)
        // If we send 'RESTRICT_MATCHMAKING' and it's not configured in the portal, Epic fails.
        const safeAction = "BAN_GAMEPLAY"; 

        const sanctionData = {
            subjectId: cleanId, 
            action: safeAction,
            justification: justification || "Manual Ban via Admin Tool", 
            source: 'MANUAL', 
            tags: ['banned']
        };

        // Add duration if provided
        if (durationSeconds && durationSeconds > 0) {
            sanctionData.expirationTimestamp = Math.floor(Date.now() / 1000) + durationSeconds;
        }

        console.log("📤 Sending Payload to Epic...");

        // MANUALLY STRINGIFY to ensure array format is perfect
        const response = await axios({
            method: 'post',
            url: `${EOS_CONFIG.apiUrl}/sanctions/v1/${EOS_CONFIG.deploymentId}/sanctions`,
            headers: { 
                'Authorization': `Bearer ${accessToken}`, 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            data: JSON.stringify([sanctionData]) 
        });

        console.log("✅ Epic Sanction Created");

        // Update MongoDB
        await Player.findOneAndUpdate(
            { productUserId: cleanId }, 
            { isBanned: true }, 
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log("✅ MongoDB Updated");

        res.json({ success: true, data: response.data });

    } catch (error) { 
        const apiError = error.response?.data;
        console.error("❌ Ban Failed:");
        if (apiError) {
            console.error("   Code:", apiError.errorCode);
            console.error("   Message:", apiError.errorMessage);
            console.error("   Failures:", JSON.stringify(apiError.validationFailures || {}));
        } else {
            console.error("   Error:", error.message);
        }
        res.status(500).json({ success: false, error: error.message }); 
    }
});

// 4. UNBAN PLAYER
app.post('/api/sanctions/remove', async (req, res) => {
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
            await Player.findOneAndUpdate({ productUserId: productUserId }, { isBanned: false });
        }
        console.log(`🕊️ Unbanned: ${productUserId}`);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
