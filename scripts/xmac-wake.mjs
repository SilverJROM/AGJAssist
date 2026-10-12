#!/usr/bin/env node
// Wake a fleet machine by name (Wake-on-LAN magic packet), using the MAC from
// machines.conf. Usage: node scripts/xmac-wake.mjs media [hdd ...]
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONF = process.env.XMAC_CONF || path.join(os.homedir(), '.config/agent-protocols/xmac/machines.conf');
const macs = new Map();
for (const raw of fs.readFileSync(CONF, 'utf8').split('\n')) {
  const cols = raw.trim().split('|');
  if (cols.length >= 3 && !raw.trim().startsWith('#')) macs.set(cols[0].trim(), cols[2].trim());
}

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error(`usage: xmac-wake.mjs <name...>  (known: ${[...macs.keys()].join(', ')})`);
  process.exit(2);
}

const sock = dgram.createSocket('udp4');
sock.bind(() => {
  sock.setBroadcast(true);
  let pending = 0;
  for (const name of names) {
    const mac = macs.get(name);
    if (!mac || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) {
      console.error(`${name}: no valid MAC in ${CONF}`);
      process.exitCode = 1;
      continue;
    }
    const macBytes = Buffer.from(mac.replace(/:/g, ''), 'hex');
    const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(macBytes)]);
    for (const port of [9, 7]) {
      pending += 1;
      sock.send(packet, port, '255.255.255.255', (err) => {
        if (err) { console.error(`${name}: ${err.message}`); process.exitCode = 1; }
        if (--pending === 0) sock.close();
      });
    }
    console.log(`${name}: magic packet sent to ${mac}`);
  }
  if (pending === 0) sock.close();
});
