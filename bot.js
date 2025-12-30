const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');

// --- CONFIGURATION ---
const CHANNEL_ID = "1455641113447633027"; // <--- PASTE REAL ID HERE
// ---------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function startBot() {
    // SECURE: Looks for the token in the Server Environment (Render)
    const token = process.env.DISCORD_BOT_TOKEN;

    if (!token) {
        console.log("⚠️ Bot skipped: DISCORD_BOT_TOKEN not found in environment variables.");
        return;
    }

    client.once('ready', () => {
        console.log(`🤖 Backup Bot Online: ${client.user.tag}`);

        // SCHEDULE: Runs EVERY MINUTE for testing (* * * * *)
        cron.schedule('* * * * *', async () => {
            console.log("⏳ Starting 1-minute test backup...");
            await runBackup();
        }, {
            scheduled: true,
            timezone: "America/New_York"
        });
    });

    client.login(token);
}

async function runBackup() {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return console.error("❌ Channel not found! Check ID in bot.js");

        // Grab the 'Player' model that server.js already set up
        const Player = mongoose.model('Player');
        
        // 1. Get all players (Hide internal database IDs)
        const players = await Player.find({}, { _id: 0, __v: 0 });
        const jsonData = JSON.stringify(players, null, 2);
        
        // 2. Create the backup file
        const buffer = Buffer.from(jsonData, 'utf-8');
        const dateStr = new Date().toISOString().replace(/:/g, '-');
        const fileName = `GW_Backup_${dateStr}.json`;

        // 3. Send to Discord
        const attachment = new AttachmentBuilder(buffer, { name: fileName });
        await channel.send({ 
            content: `🛡️ **TEST BACKUP (1-Minute)**\n📅 Time: ${dateStr}\n👥 Players: ${players.length}`, 
            files: [attachment] 
        });

        console.log("✅ Backup sent to Discord!");
    } catch (err) {
        console.error("❌ Backup Failed:", err);
    }
}

module.exports = { startBot };
