'use strict'

const fp = require('fastify-plugin')

/**
 * This plugin sets the redis pub sub up.
 *
 */
module.exports = fp(async function (fastify, { broadcastMessage, redisChannel }) {
    fastify.redis.sub.subscribe(redisChannel, (err, count) => {
        if (err) {
        console.error("Redis failed to subscribe: %s", err.message);
        } else {
        console.log(
            `Subscribed successfully! This client is currently subscribed to ${count} channels.`
        );
        }
    });
    fastify.redis.sub.on("message", (channel, redismsg) => {
        console.log('redis log: ', channel, redismsg)
        const json = JSON.parse(redismsg);
        if (!json) {
            return;
        }
        const { roomID, message } = json;
        broadcastMessage(message, roomID, true);
    });
    fastify.redis.sub.on("error", function(err) {
        throw err;
    });
    fastify.redis.pub.on("error", function(err) {
        throw err;
    });
})
