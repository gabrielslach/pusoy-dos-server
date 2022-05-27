const fastify = require('fastify')();
const ws = require('fastify-websocket');

const mongoose = require('./plugins/mongoose');
const Room = require('./models/room');

require('dotenv').config()

fastify.register(ws, {options: { clientTracking: true }});
fastify.register(mongoose);

const createCardDeck = (shuffleCount) => {
    const suits = ['Clubs', 'Spades', 'Hearts', 'Diamonds'];
    const values = ['A', 2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K'];

    let deck = []
    suits.forEach(s => values.forEach(v => {
        deck.push({ family: s, value: v });
    }));

    for (let i = 0; i < shuffleCount; i++) {
        const centerIndex = Math.round(Math.random() * deck.length);
        const sideA = deck.slice(0,centerIndex);
        const sideB = deck.slice(centerIndex);

        const aLen = sideA.length;
        const bLen = sideB.length;
        
        const mostCount = aLen > bLen ? aLen : bLen;

        deck = [];

        for (let j = 0; j < mostCount; j++) {
            if (j < aLen) {
                deck.push(sideA[j]);
            }
            if (j < bLen) {
                deck.push(sideB[j]);
            }
        }
    }

    return deck;
}

const broadcastMessage = (message, roomID) => {
    const clients = fastify.websocketServer.clients;
    clients.forEach(client => {
        if (client.roomID !== roomID) {
            return;
        }

        client.send(message);
    });
}

const getPlayerIndex = (players, playerID) => players.findIndex(p=> p._id.equals(playerID));

const dropCards = (deck) => (cardsDropped) => {
    
    return deck.filter(d => {
        const _cardIndex = cardsDropped.findIndex(c=> c.family === d.family && c.value === d.value);
        return _cardIndex < 0;
    })
}
                              
const getNextPlayerIndex = (currentPlayerIndex) => {
    let _r = currentPlayerIndex + 1;
    if (_r >= 4) {
        _r = 0;
    }
    return _r;
}

const checkFirstTurn = c => (c.family === 'Clubs' && c.value === 3);

fastify.post('/new-room',async (request, reply)=>{
    const cardDeck = createCardDeck(Math.round(Math.random() * 20));
    const playerDecks = {
        0: [],
        1: [],
        2: [],
        3: [],
    };

    cardDeck.forEach((card, index) => {
        const playerIndex = index % 4;
        playerDecks[playerIndex].push(card);
    });

    let playerTurn = -1;
    
    Object.entries(playerDecks).forEach(([playerIndex, deck]) => {
        if (-1 !== deck.findIndex(checkFirstTurn)) {
            playerTurn = playerIndex;
        }
    });

    const room = new Room({
        roomID: request.body.roomID, //TODO
        playerTurn,
        players: [],
        playerDecks
    });
    
    return await room.save();
});

fastify.post('/enter-room', async (request, reply) => {
    const { roomID, playerName } = request.body;
    const room = await Room.findOne({ roomID }).exec();

    if (room.players.length >= 4) {
        return { roomID, myID: null, error: 'Room is full.'};
    }

    room.players.push({ playerName });

    const roomSaved = await room.save();

    if (!roomSaved) {
        return { roomID, myID: null, error: 'Cant join room.'}
    };

    const playerIndex = roomSaved.players.length - 1;
    const playerObj = roomSaved.players[playerIndex];

    return {
        roomID,
        myID: playerObj._id,
        myDeck: roomSaved.playerDecks[playerIndex],
        myTurn: roomSaved.playerTurn === playerIndex,
    };
})

fastify.get('/play/:roomID/:playerID', { websocket: true }, (conn, req, params) => {
    conn.socket.roomID = params.roomID;
    conn.socket.playerID = params.playerID;

    conn.socket.on('message', async (msg) => {
        const data = JSON.parse(msg);
        const {action, payload} = data;

        const room = await Room.findOne({ roomID: conn.socket.roomID }).exec();
        const playerIndex = getPlayerIndex(room.players, conn.socket.playerID);
        
        const nextTurnData = {
            nextPlayer: undefined,
            droppedCards: [],
            error: undefined,
        };
        
        if (room.playerTurn !== playerIndex) {
            nextTurnData.error = 'Invalid data';
            return conn.socket.send(JSON.stringify(nextTurnData));
        }

        const nextPlayerIndex = getNextPlayerIndex(playerIndex);
        
        switch(action) {
            case 'DROP_CARD':
                const cardsLeft = dropCards(room.playerDecks[playerIndex])(payload);
                if (room.playerDecks[playerIndex].length - cardsLeft.length !== payload.length) {
                    nextTurnData.error = 'Invalid Data';
                    break;
                }
                
                room.playerDecks[playerIndex] = cardsLeft;
                room.playerTurn = nextPlayerIndex;
                room.droppedCards.push(payload);

                nextTurnData.droppedCards = payload;
                nextTurnData.nextPlayer = room.players[nextPlayerIndex];
                break;
                
            case 'PASS':
                room.playerTurn = nextPlayerIndex;

                nextTurnData.nextPlayer = room.players[nextPlayerIndex];
                break;
                
            default:
                nextTurnData.error = 'Invalid data';
        }
    
        await room.save();

        if (nextTurnData.error) {
            return conn.socket.send(JSON.stringify(nextTurnData));
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