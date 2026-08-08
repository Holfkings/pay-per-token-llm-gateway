import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { getConfig } from '@x402/config';

const redisProvider = {
  provide: 'REDIS',
  useFactory: () => {
    const config = getConfig();
    return new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      lazyConnect: true,
    });
  },
};

@Global()
@Module({
  providers: [redisProvider],
  exports: ['REDIS'],
})
export class RedisModule {}
