'use strict'

const fp = require('fastify-plugin')

/**
 * This plugin disconnects ws clients that are unresponsive.
 *
 */
module.exports = fp(async function (fastify) {
    function heartbeat() {
        console.log(this.playerID, ' responded')
        this.isAlive = true;
    }

    fastify.websocketServer.on('connection', function connection(ws) {
        ws.isAlive = true;
        ws.on('pong', heartbeat);
    });

    const interval = setInterval(() => {
        fastify.websocketServer.clients.forEach((client) => {
            console.log("Pinging: ", client.playerID, client.isAlive)
            if (!client.isAlive) {
                return ws.terminate();
            }

            client.isAlive = false;
            client.ping();
        })
    }, 30000);

    fastify.websocketServer.on('close', () => clearInterval(interval))
})
