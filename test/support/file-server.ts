import http from 'node:http';
import { type AddressInfo } from 'node:net';

export type Route = { body: Buffer; type: string } | { redirect: string };

export interface FileServer {
  port: number;
  hits: string[];
  close: () => Promise<void>;
}

/**
 * Serves fixed responses for job sources. Listens on all interfaces, so `localhost`
 * works whichever address family it resolves to first.
 */
export async function startFileServer(routes: Record<string, Route>): Promise<FileServer> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    hits.push(path);
    const route = routes[path];
    if (!route) return res.writeHead(404).end();
    if ('redirect' in route) return res.writeHead(302, { location: route.redirect }).end();
    res.writeHead(200, { 'content-type': route.type, 'content-length': route.body.length });
    res.end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    port: (server.address() as AddressInfo).port,
    hits,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
