// pm2 keeps the server running, restarts it if it crashes, and starts it again after a reboot.
module.exports = {
  apps: [
    {
      name: "12pubs",
      script: "server/index.js",
      env: { NODE_ENV: "production", PORT: 3000, STATS_KEY: process.env.STATS_KEY || "" }, // STATS_KEY = password for /stats
      max_memory_restart: "300M",
      time: true, // timestamps in the logs
    },
  ],
};
