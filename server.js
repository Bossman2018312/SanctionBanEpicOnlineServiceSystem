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
// Using the connection string from your .env file
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Connected to MongoDB Cloud"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- SCHEMA ---
// This defines what a "Player" looks like in the database
const PlayerSchema = new mongoose.Schema({
    productUserId: { type: String, required: true, unique: true },
    username: String,
    aliases: [String],
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    isBanned: { type: Boolean, default: false }
});
const Player = mongoose.model('Player', PlayerSchema);

// --- HELPER: GET EPIC ACCESS TOKEN ---
let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
    // Return cached token if it's still valid
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
    
    try {
        console.log("🔄 Refreshing EOS Access Token...");
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
        // Expire 5 minutes early to be safe
        tokenCache.expiresAt = Date.now() + (response.data.expires_in - 300) * 1000;
        console.log("✅ Token Refreshed");
        return tokenCache.token;
    } catch (error) { 
        console.error("❌ Auth Failed:", error.response?.data || error.message);
        throw new Error('EOS Auth Failed'); 
    }
}

// ================= ROUTES =================

// 1. TRACK PLAYER (Logs them when they join)
app.post('/api/players/track', async (req, res) => {
    const { productUserId, username } = req.body;
    
    if (!productUserId) return res.status(400).json({ error: "Missing ID" });

    try {
        // "Upsert": Update if exists, Create if new
        let player = await Player.findOneAndUpdate(
            { productUserId: productUserId },
            { 
                $set: { lastSeen: new Date(), username: username },
                $addToSet: { aliases: username } // Keep history of names
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        console.log(`📝 Logged: ${player.username} (${productUserId})`);
        res.json({ success: true });
    } catch (err) {
        console.error("DB Error:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// 2. GET ALL PLAYERS (For your Unity Admin Panel)
app.get('/api/players', async (req, res) => {
    try {
        // Sort by newest activity first
        const players = await Player.find().sort({ lastSeen: -1 });
        res.json({ success: true, players });
    } catch (err) { 
        res.status(500).json({ error: "Database error" }); 
    }
});

// 3. BAN PLAYER (The Fix for the Validation Error)
app.post('/api/sanctions/create', async (req, res) => {
    try {
        const { productUserId, action, durationSeconds, justification } = req.body;
        
        // --- VALIDATION START ---
        if (!productUserId || typeof productUserId !== 'string' || productUserId.trim() === "") {
            console.error("❌ Ban Request Rejected: 'productUserId' is missing or empty.");
            return res.status(400).json({ success: false, error: "Missing Product User ID" });
        }
        // --- VALIDATION END ---

        console.log(`🔨 Processing Ban for: ${productUserId}`);

        const accessToken = await getAccessToken();
        
        // Construct the Payload for Epic
        const sanctionData = {
            subjectId: productUserId.trim(), // Ensure no whitespace
            action: action || "BAN_GAMEPLAY",
            justification: justification || "Manual Ban via Admin Tool", 
            source: 'MANUAL', 
            tags: ['banned']
        };
        
        // Add expiration only if a duration was provided
        if (durationSeconds && durationSeconds > 0) {
            sanctionData.expirationTimestamp = Math.floor(Date.now() / 1000) + durationSeconds;
        }

        console.log("📤 Sending to Epic:", JSON.stringify(sanctionData));

        // Call Epic API
        const response = await axios.post(
            `${EOS_CONFIG.apiUrl}/sanctions/v1/${EOS_CONFIG.deploymentId}/sanctions`, 
            [sanctionData], // Must be an array
            { 
                headers: { 
                    'Authorization': `Bearer ${accessToken}`, 
                    'Content-Type': 'application/json' 
                } 
            }
        );

        console.log("✅ Epic Sanction Created");

        // Update MongoDB immediately so the ban persists even if Epic is down later
        await Player.findOneAndUpdate(
            { productUserId: productUserId }, 
            { isBanned: true }, 
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log("✅ MongoDB Record Updated: Banned");

        res.json({ success: true, data: response.data });

    } catch (error) { 
        // Detailed Error Logging
        const apiError = error.response?.data;
        console.error("❌ Ban Logic Failed:");
        if (apiError) {
            console.error("   Epic API Error Code:", apiError.errorCode);
            console.error("   Epic API Message:", apiError.errorMessage);
            console.error("   Failures:", JSON.stringify(apiError.validationFailures || {}));
        } else {
            console.error("   Internal Error:", error.message);
        }
        
        res.status(500).json({ success: false, error: error.message }); 
    }
});

// 4. UNBAN PLAYER
app.post('/api/sanctions/remove', async (req, res) => {
     try {
        const { productUserId, referenceId } = req.body;
        const accessToken = await getAccessToken();

        // Remove from Epic (if we have a reference ID)
        if (referenceId) {
            console.log(`🗑️ Removing Sanction Ref: ${referenceId}`);
            await axios.delete(
                `${EOS_CONFIG.apiUrl}/sanctions/v1/${EOS_CONFIG.deploymentId}/sanctions/${referenceId}`,
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
        }
        
        // Always unban in MongoDB
        if (productUserId) {
            console.log(`🕊️ Unbanning User in DB: ${productUserId}`);
            await Player.findOneAndUpdate({ productUserId: productUserId }, { isBanned: false });
        }

        res.json({ success: true });
    } catch (error) { 
        console.error("❌ Unban Failed:", error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.message }); 
    }
});

// Start the server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
