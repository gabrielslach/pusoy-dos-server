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

const broadcastMessage = (message, roomID) => {
    const clients = fastify.websocketServer.clients;
    clients.forEach(client => {
        if (client.roomID !== params.roomID) {
            return;
        }

        client.send(JSON.stringify(nextTurnData));
    });
}

const getPlayerIndex = (playerName) => players.findIndex(p=>p === playerName);

const dropCards = (roomID, playerName) => (cardsDropped) => {
    const _playerIndex = getPlayerIndex(playerName);
    const _room = room;
    const _playerDeck = _room.playerDecks[_playerIndex];
    
    return _playerDeck.filter(d => {
        const _cardIndex = cardsDropped.findIndex(c=> c.family === d.family && c.value === d.value);
        return _cardIndex < 0;
    })
}
                              
const getNextPlayer = (currentPlayerName) => {
    const _playerIndex = getPlayerIndex(playerName);
    return _playerIndex++;
}

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
        const data = JSON.parse(msg);
        const {action, payload} = data;
        const playerIndex = getPlayerIndex(conn.socket.playerID)
        
        const nextTurnData = {
            nextPlayer: undefined,
            droppedCards: [],
            error: undefined,
        };
        
        if (!checkturn(playerIndex))
            nextTurnData.error = 'Invalid data';
            return conn.send(JSON.stringify(nextTurnData));
        }
        
        switch(action) {
            case 'DROP_CARD':
                const cardsLeft = dropCards(conn.socket.roomID, conn.socket.playerID)(payload);
                if (room.playerDecks[playerIndex].length - cardsLeft.length !== payload.length) {
                    nextTurnData.error = 'Invalid Data';
                    break;
                }
                
                const updateDB = {cardsLeft, nextPlayer};
                nextTurnData.droppedCards = payload;
                nextTurnData.nextPlayer = room.players[playerIndex];
                break;
                
            case 'PASS':
                const updateDB = {nextPlayer};
                nextTurnData.nextPlayer = room.players[playerIndex];
                break;
                
            default:
                nextTurnData.error = 'Invalid data';
        }
    
        if (nextTurnData.error) {
            return conn.send(JSON.stringify(nextTurnData));
        }
        
        broadcastMessage(JSON.stringify(nextTurnData), conn.socket.roomID);
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
