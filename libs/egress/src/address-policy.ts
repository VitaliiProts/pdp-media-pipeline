import { BlockList, isIP } from 'node:net';

/**
 * Everything that is not a globally routable unicast address: private networks, loopback,
 * link-local (cloud metadata lives at 169.254.169.254), CGNAT, documentation and benchmark
 * ranges, multicast, and IPv6 forms that tunnel or embed IPv4 (mapped, NAT64, 6to4, Teredo),
 * because those could smuggle a private IPv4 address past the IPv4 rules.
 */
const NON_PUBLIC_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const NON_PUBLIC_V6: [string, number][] = [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];

// Separate lists: BlockList also matches IPv4 addresses against IPv6 rules through their
// mapped form, so `::ffff:0:0/96` in a shared list would block every IPv4 address.
const blockedV4 = new BlockList();
for (const [net, prefix] of NON_PUBLIC_V4) blockedV4.addSubnet(net, prefix, 'ipv4');
const blockedV6 = new BlockList();
for (const [net, prefix] of NON_PUBLIC_V6) blockedV6.addSubnet(net, prefix, 'ipv6');

/** False for anything that is not a literal IP address, so callers must resolve first. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  if (family === 6) return !blockedV6.check(address, 'ipv6');
  return false;
}
