const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');

dotenv.config();

const app = express();

// Increase payload size limit just in case
app.use(express.json({ limit: '10mb' }));
app.use(cors());

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; 

const EOS_CONFIG = {
    deploymentId: process.env.EOS_DEPLOYMENT_ID,
    clientId: process.env.EOS_CLIENT_ID,
    clientSecret: process.env.EOS_CLIENT_SECRET,
    apiUrl: 'https://api.epicgames.dev'
};

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

async function getAccessToken() {
    try {
        const response = await axios.post(
            `${EOS_CONFIG.apiUrl}/auth/v1/oauth/token`,
            new URLSearchParams({ grant_type: 'client_credentials', deployment_id: EOS_CONFIG.deploymentId }),
            { 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                auth: { username: EOS_CONFIG.clientId, password: EOS_CONFIG.clientSecret } 
            }
        );
        return response.data.access_token;
    } catch (error) { 
        console.error("❌ Auth Failed:", error.message);
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

// 3. BAN PLAYER (SIMPLIFIED & FIXED)
app.post('/api/sanctions/create', verifyAdminPassword, async (req, res) => {
    try {
        // LOG RAW INPUT to see exactly what Unity sent
        console.log("📥 Received Ban Request Body:", JSON.stringify(req.body));

        const { productUserId, action, durationSeconds, justification } = req.body;

        if (!productUserId || productUserId.trim() === "") {
            console.error("❌ Error: productUserId is missing or empty!");
            return res.status(400).json({ success: false, error: "Missing Product User ID" });
        }

        const accessToken = await getAccessToken();
        const safeAction = action || "RESTRICT_GAME_ACCESS"; 
        
        // SIMPLE TRIM ONLY - No aggressive regex that might delete the ID
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

        console.log("📤 Sending Payload to Epic:", JSON.stringify([sanctionPayload]));

        const response = await axios.post(
            `${EOS_CONFIG.apiUrl}/sanctions/v1/${EOS_CONFIG.deploymentId}/sanctions`,
            [sanctionPayload], // Must be an array
            { 
                headers: { 
                    'Authorization': `Bearer ${accessToken}`, 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                } 
            }
        );

        console.log("✅ EOS Success!");

        await Player.findOneAndUpdate(
            { productUserId: finalId }, 
            { isBanned: true }, 
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        
        res.json({ success: true, data: response.data });

    } catch (error) { 
        console.error("❌ Ban Request Failed:", error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.message }); 
    }
});

// 4. UNBAN PLAYER
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
