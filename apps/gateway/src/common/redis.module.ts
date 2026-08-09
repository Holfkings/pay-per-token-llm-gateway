import { Global, Module, Logger, OnModuleInit, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { getConfig } from '@x402/config';

const redisProvider = {
  provide: 'REDIS',
  useFactory: () => {
    const config = getConfig();
    return new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      // Connect eagerly so connection failures surface at startup,
      // not at the first request.
      lazyConnect: false,
    });
  },
};

@Global()
@Module({
  providers: [redisProvider],
  exports: ['REDIS'],
})
export class RedisModule implements OnModuleInit {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject('REDIS') private readonly redis: Redis) {}

  async onModuleInit() {
    try {
      await this.redis.ping();
      this.logger.log('✅ Redis connected');
    } catch (error) {
      this.logger.error('❌ Redis connection failed', String(error));
      throw error;
    }
  }
}
