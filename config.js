export const GAME_CONFIG = {
  port: Number(process.env.PORT ?? 8080),
  maxPlayers: Number(process.env.MAX_PLAYERS ?? 64),
  tickRate: Number(process.env.TICK_RATE ?? 30),
  snapshotRate: Number(process.env.SNAPSHOT_RATE ?? 20),
  world: {
    gravity: 28,
    halfSize: 58,
    seaStartZ: 22,
  },
  combat: {
    bashDamage: 20,
    bashCooldown: 0.72,
    bashDuration: 0.24,
    bashImpulse: 17,
    knockback: 12,
    respawnSeconds: 2,
  },
  chat: {
    maxLength: 140,
    historyLimit: 30,
  },
};
