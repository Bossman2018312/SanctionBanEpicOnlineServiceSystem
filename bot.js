const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');

// --- CONFIGURATION ---
const CHANNEL_ID = "1455641113447633027"; 
const CLIENT_ID = "1455683759813820651"; // Your Bot ID
// ---------------------

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

function startBot() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) return console.error("❌ [BOT] STOPPED: No Token in Environment.");

    // 1. REGISTER THE /TEST COMMAND
    const commands = [
        new SlashCommandBuilder().setName('test').setDescription('Force a database backup')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    (async () => {
        try {
            console.log('🔄 [BOT] Refreshing Slash Commands...');
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
            console.log('✅ [BOT] Slash Commands Registered!');
        } catch (error) {
            console.error('❌ [BOT] Command Registration Error:', error);
        }
    })();

    // 2. LISTEN FOR COMMANDS
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'test') {
            await interaction.deferReply(); // Tells Discord "Wait a sec..."
            try {
                await runBackup(interaction);
            } catch (e) {
                await interaction.editReply(`❌ Backup Failed: ${e.message}`);
            }
        }
    });

    client.once('ready', () => {
        console.log(`✅ [BOT] Online as ${client.user.tag}`);
        
        // Auto-Backup Every Minute (Testing)
        cron.schedule('* * * * *', () => {
            console.log("⏳ [BOT] Auto-Backup Triggered...");
            runBackup();
        }, { scheduled: true, timezone: "America/New_York" });
    });

    client.login(token).catch(e => console.error("❌ Login Failed:", e));
}

async function runBackup(interaction = null) {
    if (!client.isReady()) throw new Error("Bot not ready");

    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) throw new Error("Channel not found");

    const Player = mongoose.model('Player');
    const players = await Player.find({}, { _id: 0, __v: 0 });
    
    const jsonData = JSON.stringify(players, null, 2);
    const buffer = Buffer.from(jsonData, 'utf-8');
    const dateStr = new Date().toISOString().replace(/:/g, '-');
    const fileName = `GW_Backup_${dateStr}.json`;

    const attachment = new AttachmentBuilder(buffer, { name: fileName });
    
    const messagePayload = { 
        content: `🛡️ **BACKUP GENERATED**\n👥 Players: ${players.length}`, 
        files: [attachment] 
    };

    // Send to channel
    await channel.send(messagePayload);

    // If triggered by command, reply to user
    if (interaction) {
        await interaction.editReply("✅ Backup sent to channel!");
    }
}

module.exports = { startBot, forceTestMessage: runBackup };
