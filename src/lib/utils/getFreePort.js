import net from 'node:net';

// Grenache's WebSocket transport does not surface the OS-assigned port after
// listen(0) — it keeps reporting the configured value. Pre-allocating a free
// port through Node's net module gives us a real number to pass in.
async function getFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

export { getFreePort };
