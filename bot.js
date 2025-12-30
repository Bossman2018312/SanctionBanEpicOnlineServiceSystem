const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');

// --- CONFIGURATION ---
const CHANNEL_ID = "1455641113447633027"; 
// ---------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function startBot() {
    console.log("🤖 Initializing Bot...");

    // DEBUG: Check if token exists (DON'T LOG THE REAL TOKEN FOR SAFETY)
    const token = process.env.DISCORD_BOT_TOKEN;
    
    if (!token) {
        console.error("❌❌❌ FATAL ERROR: DISCORD_BOT_TOKEN is MISSING or EMPTY in Environment Variables! ❌❌❌");
        return;
    } else {
        console.log("✅ Token found (starts with: " + token.substring(0, 5) + "...)");
    }

    client.once('ready', () => {
        console.log(`✅✅✅ BOT IS ONLINE! Logged in as: ${client.user.tag}`);

        // Run backup IMMEDIATELY on startup to verify it works
        console.log("⏳ Running STARTUP TEST backup...");
        runBackup();

        // Then schedule the 1-minute loop
        cron.schedule('* * * * *', async () => {
            console.log("⏳ Running 1-minute loop backup...");
            await runBackup();
        }, { scheduled: true, timezone: "America/New_York" });
    });

    client.login(token).catch(err => {
        console.error("❌❌❌ LOGIN FAILED: Token might be invalid! ❌❌❌");
        console.error(err);
    });
}

async function runBackup() {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return console.error("❌ Channel not found! Is the bot in the server?");

        const Player = mongoose.model('Player');
        const players = await Player.find({}, { _id: 0, __v: 0 });
        const jsonData = JSON.stringify(players, null, 2);
        const buffer = Buffer.from(jsonData, 'utf-8');
        const dateStr = new Date().toISOString().replace(/:/g, '-');
        const fileName = `GW_Backup_${dateStr}.json`;

        const attachment = new AttachmentBuilder(buffer, { name: fileName });
        await channel.send({ 
            content: `🛡️ **BACKUP SYSTEM ONLINE**\n👥 Players: ${players.length}`, 
            files: [attachment] 
        });

        console.log("✅ Backup successfully sent to Discord.");
    } catch (err) {
        console.error("❌ Backup Failed:", err);
    }
}

module.exports = { startBot };
