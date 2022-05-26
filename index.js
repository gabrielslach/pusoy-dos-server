const fastify = require('fastify')();
const ws = require('fastify-websocket');

fastify.register(ws, {options: { clientTracking: true }});

const room = {
    roomID: '123',
    players: [],
    playerDecks: {
        0: [{family: 'spades', value: 'A'}],
        1: [{family: 'clubs', value: '3'}],
        2: [{family: 'hearts', value: 'A'}],
        3: [{family: 'diamonds', value: 'A'}],
    },
    playerTurn: 1
};

fastify.post('/new-room',(request, reply)=>{
    return room.roomID;
});

fastify.post('/enter-room', (request, reply) => {
    const { roomID, playerID } = request.body;
    return { roomID, playerID, playerDeck: room.playerDecks[0] };
})

fastify.get('/play/:roomID/:playerID', { websocket: true }, (conn, req, params) => {
    conn.socket.roomID = params.roomID;
    conn.socket.playerID = params.playerID;

    conn.socket.on('message', (msg) => {
        const clients = fastify.websocketServer.clients;

        clients.forEach(client => {
            if (client.roomID !== params.roomID) {
                return;
            }
            
            client.send("Congrats you're one of us!");
        });
    });

    conn.socket.on('close', () => {
        console.log(`Closed ${conn.socket}`)
    });
});

fastify.listen({ port: 3000 }, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }

    console.log(`Server listening at ${address}`);
})