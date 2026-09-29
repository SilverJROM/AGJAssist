module.exports = {
  apps: [
    {
      name: "agjassist",
      script: "dist/index.js",
      cwd: "/home/agjrom/TGBOTS/AGJAssist",
      node_args: "--experimental-specifier-resolution=node",
      env: {
        NODE_ENV: "production",
        // xMachines armed against the real fleet (prod runtime only — kept out of
        // .env so tests keep using the synthetic fixture).
        XMACHINES_ARM: "1",
        XMACHINES_USE_REGISTRY: "1",
        XMACHINES_STATUS_FIXTURE: "/home/agjrom/.xmac/xm-status.txt",
        XMACHINES_TELEMETRY_FIXTURE: "/home/agjrom/.xmac/xm-telemetry.json",
        XMAC_CONF: "/home/agjrom/.config/agent-protocols/xmac/machines.conf"
      },
      max_memory_restart: "2048M",
      restart_delay: 3000,
      max_restarts: 10
    }
  ]
};
