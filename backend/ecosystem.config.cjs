const path = require("path");

module.exports = {
  apps: [
    {
      name: "pdv-backend",
      cwd: __dirname,
      script: path.join(__dirname, "src", "server.js"),
      exec_mode: "fork",
      instances: 1,
      time: true,
      env_file: path.join(__dirname, ".env"),
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: "3333",
        BIND_HOST: "127.0.0.1",
        REQUIRE_HTTPS: "true",
        APP_URL: "https://paytech.app.br,https://www.paytech.app.br",
      },
      max_memory_restart: "350M",
      kill_timeout: 5000,
      listen_timeout: 5000,
      restart_delay: 2000,
    },
  ],
};

