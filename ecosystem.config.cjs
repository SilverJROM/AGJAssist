module.exports = {
  apps: [
    {
      name: "agjassist",
      script: "dist/index.js",
      cwd: "/home/agjrom/TGBOTS/AGJAssist",
      node_args: "--experimental-specifier-resolution=node",
      env: {
        NODE_ENV: "production"
      },
      max_memory_restart: "256M",
      restart_delay: 3000,
      max_restarts: 10
    }
  ]
};
