import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  jetstream,
  type JetStreamClient,
  type JetStreamManager,
  jetstreamManager,
  type PubAck,
} from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';

export interface NatsModuleOptions {
  servers: string;
  /** Connection name visible in NATS monitoring (`/connz`). */
  name: string;
}

export const NATS_OPTIONS = Symbol('NATS_OPTIONS');

@Injectable()
export class NatsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NatsService.name);
  private nc?: NatsConnection;
  private js?: JetStreamClient;
  private jsmPromise?: Promise<JetStreamManager>;

  constructor(@Inject(NATS_OPTIONS) private readonly options: NatsModuleOptions) {}

  async onModuleInit(): Promise<void> {
    this.nc = await connect({
      servers: this.options.servers,
      name: this.options.name,
      waitOnFirstConnect: true,
      maxReconnectAttempts: -1,
    });
    this.js = jetstream(this.nc);
    this.logger.log(`connected to ${this.nc.getServer()}`);
    void this.watchStatus(this.nc);
  }

  get connection(): NatsConnection {
    if (!this.nc) throw new Error('NATS connection is not initialised');
    return this.nc;
  }

  get jetstream(): JetStreamClient {
    if (!this.js) throw new Error('NATS connection is not initialised');
    return this.js;
  }

  manager(): Promise<JetStreamManager> {
    this.jsmPromise ??= jetstreamManager(this.connection);
    return this.jsmPromise;
  }

  /** `msgId` becomes `Nats-Msg-Id`: republishing within the duplicate window is a no-op. */
  publishJson(subject: string, data: unknown, msgId: string): Promise<PubAck> {
    return this.jetstream.publish(subject, JSON.stringify(data), { msgID: msgId });
  }

  /** Verifies the server responds and JetStream is enabled for the account. */
  async ping(): Promise<void> {
    if (!this.nc || this.nc.isClosed()) throw new Error('NATS connection is closed');
    const jsm = await this.manager();
    await jsm.getAccountInfo();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.nc && !this.nc.isClosed()) await this.nc.drain();
  }

  private async watchStatus(nc: NatsConnection): Promise<void> {
    for await (const status of nc.status()) {
      if (status.type === 'disconnect' || status.type === 'reconnect') {
        this.logger.warn(`nats ${status.type}`);
      }
    }
  }
}
