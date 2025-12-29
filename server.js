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

const EXPECTED_KEY = "ilikemath"; 
let tokenCache = { token: null, expiresAt: 0 };

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

// --- AUTH ---
async function getAccessToken() {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
    try {
        const response = await axios.post(
            `${EOS_CONFIG.apiUrl}/auth/v1/oauth/token`,
            new URLSearchParams({ grant_type: 'client_credentials', deployment_id: EOS_CONFIG.deploymentId }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              auth: { username: EOS_CONFIG.clientId, password: EOS_CONFIG.clientSecret } }
        );
        tokenCache.token = response.data.access_token;
        tokenCache.expiresAt = Date.now() + (response.data.expires_in - 300) * 1000;
        return tokenCache.token;
    } catch (error) { throw new Error('EOS Auth Failed'); }
}

// ================= ROUTES =================

// 1. TRACK PLAYER (Upsert logic)
app.post('/api/players/track', async (req, res) => {
    const { productUserId, username } = req.body;
    if (!productUserId) return res.status(400).json({ error: "Missing ID" });

    try {
        // Find and update, or create if new (upsert: true)
        let player = await Player.findOneAndUpdate(
            { productUserId },
            { 
                $set: { lastSeen: new Date(), username: username },
                $addToSet: { aliases: username } // Adds username to history if unique
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        console.log(`📝 Logged: ${player.username}`);
        res.json({ success: true });
    } catch (err) {
        console.error("DB Error:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// 2. GET PLAYERS
app.get('/api/players', async (req, res) => {
    try {
        const players = await Player.find().sort({ lastSeen: -1 });
        res.json({ success: true, players });
    } catch (err) { res.status(500).json({ error: "Database error" }); }
});

// 3. BAN PLAYER (The Fix)
app.post('/api/sanctions/create', async (req, res) => {
    try {
        const { productUserId, action, durationSeconds, justification } = req.body;
        console.log(`🔨 Attempting to ban: ${productUserId}`);

        const accessToken = await getAccessToken();
        
        // 1. Send Ban to Epic Online Services
        const sanctionObject = {
            subjectId: productUserId, 
            action: action || "BAN_GAMEPLAY",
            justification: justification || "Manual Ban", 
            source: 'MANUAL', 
            tags: ['banned']
        };
        if (durationSeconds > 0) sanctionObject.expirationTimestamp = Math.floor(Date.now() / 1000) + durationSeconds;

        const response = await axios.post(`${EOS_CONFIG.apiUrl}/sanctions/v1/${EOS_CONFIG.deploymentId}/sanctions`, [sanctionObject], 
            { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });

        console.log("✅ EOS Sanction Success");

        // 2. FORCE Save to MongoDB (Upsert: Create if doesn't exist)
        await Player.findOneAndUpdate(
            { productUserId }, 
            { isBanned: true }, 
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log("✅ MongoDB Updated: Banned = True");

        res.json({ success: true, data: response.data });

    } catch (error) { 
        console.error("❌ Ban Failed:", error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.message }); 
    }
});

// 4. UNBAN PLAYER
app.post('/api/sanctions/remove', async (req, res) => {
     try {
        const accessToken = await getAccessToken();
        await axios.delete(`${EOS_CONFIG.apiUrl}/sanctions/v1/${EOS_CONFIG.deploymentId}/sanctions/${req.body.referenceId}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } });
        
        if (req.body.productUserId) {
            await Player.findOneAndUpdate({ productUserId: req.body.productUserId }, { isBanned: false });
        }
        console.log(`🕊️ Unbanned: ${req.body.productUserId}`);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
