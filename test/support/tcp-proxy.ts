import net from 'node:net';

export interface TcpProxy {
  url: string;
  /** `reset` drops new connections, like a dependency that is down. */
  mode: 'forward' | 'reset';
  close: () => Promise<void>;
}

/** A switchable TCP proxy in front of `target` (an http:// URL) for fault injection. */
export async function startTcpProxy(target: string): Promise<TcpProxy> {
  const { hostname, port } = new URL(target);
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  };

  const proxy: TcpProxy = { url: '', mode: 'forward', close: () => Promise.resolve() };
  const server = net.createServer((client) => {
    track(client);
    if (proxy.mode === 'reset') {
      client.resetAndDestroy();
      return;
    }
    const upstream = net.connect(Number(port), hostname);
    track(upstream);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.pipe(upstream).pipe(client);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  proxy.url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  proxy.close = () =>
    new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
  return proxy;
}
