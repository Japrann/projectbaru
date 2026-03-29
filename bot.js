const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

require("dotenv").config();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

client.on("ready", () => {
  console.log("bot ready 😏");
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // pastiin cuma dari channel lu
  if (message.channel.id !== CHANNEL_ID) return;

  if (message.content.startsWith("/r ")) {
    const reply = message.content.slice(3);

    console.log("manual reply:", reply);

    try {
      await axios.post("http://localhost:3000/admin-reply", {
        message: reply
      });

      message.reply("sent 😏");
    } catch (err) {
      console.log(err);
      message.reply("error 😭");
    }
  }
});

client.login(TOKEN);