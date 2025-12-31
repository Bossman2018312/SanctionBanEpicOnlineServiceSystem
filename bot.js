const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');

// --- CONFIGURATION ---
const CHANNEL_ID = "1455641113447633027"; // <--- YOUR ID
// ---------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function startBot() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        console.error("❌ [BOT] STOPPED: No DISCORD_BOT_TOKEN found in Environment.");
        return;
    }

    client.once('ready', () => {
        console.log(`✅ [BOT] Online as ${client.user.tag}`);
        
        // Cron: Runs every minute
        cron.schedule('* * * * *', () => {
            console.log("⏳ [BOT] Auto-Backup Triggered...");
            runBackup();
        }, { scheduled: true, timezone: "America/New_York" });
    });

    client.login(token).catch(err => {
        console.error("❌ [BOT] Login Failed:", err.message);
    });
}

// Exported function for manual testing
async function runBackup() {
    if (!client.isReady()) {
        console.error("⚠️ [BOT] Cannot backup: Bot is not ready yet.");
        throw new Error("Bot not ready");
    }

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) {
            console.error(`❌ [BOT] Channel ${CHANNEL_ID} NOT FOUND!`);
            throw new Error("Channel not found");
        }

        const Player = mongoose.model('Player');
        const players = await Player.find({}, { _id: 0, __v: 0 });
        
        const jsonData = JSON.stringify(players, null, 2);
        const buffer = Buffer.from(jsonData, 'utf-8');
        const dateStr = new Date().toISOString().replace(/:/g, '-');
        const fileName = `GW_Backup_${dateStr}.json`;

        const attachment = new AttachmentBuilder(buffer, { name: fileName });
        await channel.send({ 
            content: `🛡️ **MANUAL/AUTO BACKUP**\n👥 Players: ${players.length}`, 
            files: [attachment] 
        });

        console.log("✅ [BOT] Backup sent successfully!");
    } catch (err) {
        console.error("❌ [BOT] Backup Error:", err);
        throw err; // Send error back to web browser
    }
}

// Export both functions
module.exports = { startBot, forceTestMessage: runBackup };
