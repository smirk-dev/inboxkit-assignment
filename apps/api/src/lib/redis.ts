import Redis from 'ioredis';

// pub and sub must be separate clients — a subscribed client cannot issue regular commands
export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

export const redisSub = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (err) => console.error('Redis error', err));
redisSub.on('error', (err) => console.error('RedisSub error', err));

const COOLDOWN_TTL_S = 3;

export async function tryAcquireCooldown(
  userId: string
): Promise<{ acquired: boolean; remainingMs: number }> {
  const key = `cooldown:user:${userId}`;
  const result = await redis.set(key, '1', 'EX', COOLDOWN_TTL_S, 'NX');
  if (result === 'OK') {
    return { acquired: true, remainingMs: 0 };
  }
  const ttlMs = await redis.pttl(key);
  return { acquired: false, remainingMs: Math.max(0, ttlMs) };
}
