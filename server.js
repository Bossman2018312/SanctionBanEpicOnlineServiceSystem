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

const EOS_CONFIG = {
    deploymentId: process.env.EOS_DEPLOYMENT_ID,
    clientId: process.env.EOS_CLIENT_ID,
    clientSecret: process.env.EOS_CLIENT_SECRET,
    apiUrl: 'https://api.epicgames.dev'
};

// --- DATABASE ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Connected to MongoDB Cloud"))
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
        console.log("✅ EOS Token Acquired");
        return tokenCache.token;
    } catch (error) { 
        console.error("❌ Auth Error:", error.response?.data || error.message);
        throw new Error('EOS Auth Failed'); 
    }
}

// --- MIDDLEWARE ---
const verifyAdminPassword = (req, res, next) => {
    const providedPassword = req.headers['x-admin-auth'];
    if (!ADMIN_PASSWORD) return next(); 
    if (providedPassword !== ADMIN_PASSWORD) {
        return res.status(403).json({ success: false, error: "WRONG PASSWORD" });
    }
    next();
};

// --- ROUTES ---

app.post('/api/players/track', async (req, res) => {
    const { productUserId, username } = req.body;
    if (!productUserId) return res.status(400).json({ error: "Missing ID" });
    try {
        await Player.findOneAndUpdate(
            { productUserId: productUserId },
            { $set: { lastSeen: new Date(), username: username }, $addToSet: { aliases: username } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "DB Error" }); }
});

app.get('/api/players', verifyAdminPassword, async (req, res) => {
    try {
        const players = await Player.find().sort({ lastSeen: -1 });
        res.json({ success: true, players });
    } catch (err) { res.status(500).json({ error: "DB Error" }); }
});

// --- BAN ROUTE (FIXED) ---
app.post('/api/sanctions/create', verifyAdminPassword, async (req, res) => {
    try {
        const { productUserId, action, durationSeconds, justification } = req.body;

        if (!productUserId) return res.status(400).json({ success: false, error: "Missing ID" });

        // FIX 1: Aggressively clean the ID (remove any accidental spaces or hidden chars)
        const cleanId = String(productUserId).replace(/[^a-fA-F0-9]/g, ""); 
        
        if (cleanId.length !== 32) {
            console.error(`⚠️ Invalid ID Length: ${cleanId.length} (Should be 32)`);
            return res.status(400).json({ success: false, error: "Invalid ID Format" });
        }

        const accessToken = await getAccessToken();
        const safeAction = action || "RESTRICT_GAME_ACCESS"; 

        const sanctionData = {
            subjectId: cleanId, 
            action: safeAction,
            justification: justification || "Manual Ban", 
            source: 'MANUAL', 
            tags: ['banned']
        };
        
        if (durationSeconds > 0) {
            sanctionData.expirationTimestamp = Math.floor(Date.now() / 1000) + durationSeconds;
        }

        console.log(`🔨 Banning ID: ${cleanId}`);
        console.log(`📋 Deployment: ${EOS_CONFIG.deploymentId}`);
        console.log(`📤 Payload:`, JSON.stringify([sanctionData]));

        // FIX 2: Use axios.post directly with the Object (Let Axios handle JSON)
        const response = await axios.post(
            `${EOS_CONFIG.apiUrl}/sanctions/v1/${EOS_CONFIG.deploymentId}/sanctions`,
            [sanctionData], // Pass the array directly
            { 
                headers: { 
                    'Authorization': `Bearer ${accessToken}`, 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                } 
            }
        );

        console.log("✅ Epic Sanction Success!");

        await Player.findOneAndUpdate(
            { productUserId: cleanId }, 
            { isBanned: true }, 
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        
        res.json({ success: true, data: response.data });

    } catch (error) { 
        console.error("❌ Ban Failed:", error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            error: error.response?.data?.errorMessage || "Server Error" 
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
            await Player.findOneAndUpdate({ productUserId: productUserId }, { isBanned: false });
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
