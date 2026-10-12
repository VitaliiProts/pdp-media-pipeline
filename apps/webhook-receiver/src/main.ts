import { createReceiver } from './receiver';

const port = Number(process.env.PORT ?? 3000);
const server = createReceiver();
server.listen(port, '0.0.0.0', () => {
  console.log(`webhook-receiver listening on ${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}
