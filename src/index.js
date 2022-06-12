const Fastify = require('fastify');
const ws = require('fastify-websocket');
const redis = require('@fastify/redis');

const mongoose = require('./plugins/mongoose');
const Room = require('./models/room');
const redisPubSub = require('./plugins/redisPubSub');
const wsConnectionHealthCheck = require('./plugins/wsConnectionHealthCheck');

require('dotenv').config();

function build() {
    const fastify = Fastify({ trustProxy: true })
    return fastify
}

const fastify = build();

fastify.register(ws, {options: { clientTracking: true }});
fastify.register(mongoose);
fastify.register(wsConnectionHealthCheck);

// const redisChannel = "pusoy-2";
// fastify.register(redis, {
//     url : process.env.REDIS_URL,
//     namespace: 'sub'
//   });
// fastify.register(redis, {
//     url : process.env.REDIS_URL,
//     namespace: 'pub'
// });

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

const broadcastMessage = (message, roomID, fromSub = false) => {
    const clients = fastify.websocketServer.clients;
    // All broadcast coming from this server is published to redis
    // if (!fromSub) {
    //     fastify.redis.pub.publish(redisChannel, JSON.stringify({ roomID, message }));
    //     return;
    // }
    // Only broadcast coming from redis is sent to clients
    console.log("broadcast", message)
    clients.forEach(client => {
        if (client.roomID !== roomID) {
            return;
        }

        client.send(message);
    });
}

// fastify.register(redisPubSub, { broadcastMessage, redisChannel });

const getRoomClients = (roomID) => {
    try {
        const clients = fastify.websocketServer.clients;
        const filteredArr = [];
        clients.forEach(c => c.roomID === roomID && filteredArr.push(c.playerID))
        return filteredArr
    } catch (error) {
        return [];
    }
}

const getPlayerIndex = (players, playerID) => players.findIndex(p=> p._id.equals(playerID));

const findRoom = async (roomID) => {
    const room = await Room.findOne({ roomID }).exec();
    if (!room) {
        return {};
    }
    return room;
}

const getClientIDs = async (roomID) => {
    const { players } = await findRoom(roomID);
    return getRoomClients(roomID).map(clientID => getPlayerIndex(players, clientID));
}

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

const generateRoomID = async () => {
    const alphanum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';

    const roomIDArr = [];

    for (let i = 0; i < 5; i++) {
        roomIDArr.push(
            alphanum[Math.round(Math.random() * (alphanum.length - 1))]
            );
    }

    let roomID = roomIDArr.join('');
    
    if ( await Room.exists({ roomID }) ) {
        roomID = await generateRoomID();
    }

    return roomID;
}

fastify.register(require('@fastify/cors'), { 
    origin: true
  })

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

    const roomID = await generateRoomID();

    const room = new Room({
        roomID,
        playerTurn,
        players: [],
        playerDecks
    });
    
    await room.save();
    return { roomID };
});

fastify.post('/enter-room', async (request, reply) => {
    const { roomID, playerName } = request.body;
    const room = await Room.findOne({ roomID }).exec();

    if (!room) {
        return { error: 'Room not found.' };
    }
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
    };
})

fastify.get('/my-room/:roomID/:playerID', async (request, reply) => {
    const room = await Room.findOne({ roomID: request.params.roomID }).exec();
    const playerIndex = getPlayerIndex(room.players, request.params.playerID);

    if (!room) {
        return { error: 'Cant find room.'}
    };

    return {
        myDeck: room.playerDecks[playerIndex],
        myPlayerNumber: playerIndex,
        playerTurn: room.playerTurn,
        players: room.players.map(p => p.playerName),
        droppedCards: room.droppedCards[room.droppedCards.length - 1],
    };
})

fastify.get('/play/:roomID/:playerID', { websocket: true }, async (conn, req, params) => {
    if (!params || !params.roomID || !params.playerID || 
        params.roomID === 'undefined' || params.playerID === 'undefined') {
        return;
    }

    const clients = getRoomClients(params.roomID);

    if (clients.includes(params.playerID)) {
        return;
    }

    conn.socket.roomID = params.roomID;
    conn.socket.playerID = params.playerID;

    const playersOnline = await getClientIDs(conn.socket.roomID);
    broadcastMessage(JSON.stringify({ type: "PLAYERS_INFO", playersOnline }), conn.socket.roomID);

    conn.socket.on('close', async () => {
        const playersOnline = await getClientIDs(conn.socket.roomID);
        broadcastMessage(JSON.stringify({ type: "PLAYERS_INFO", playersOnline }), conn.socket.roomID);
    });

    conn.socket.on('message', async (msg) => {
        try {
            const data = JSON.parse(msg);
            const {action, payload} = data;

            const room = await Room.findOne({ roomID: conn.socket.roomID }).exec();
            const playerIndex = getPlayerIndex(room.players, conn.socket.playerID);
            
            const nextTurnData = {
                type: undefined,
                nextPlayerIndex: undefined,
                droppedCards: [],
                error: undefined,
                playersCardsCount: {},
            };
            if (room.playerTurn !== playerIndex) {
                nextTurnData.error = 'Invalid data';
                nextTurnData.type = 'ERROR';
                return conn.socket.send(JSON.stringify(nextTurnData));
            }

            let nextPlayerIndex = playerIndex;
            let counter = 0;
            do {
                nextPlayerIndex = getNextPlayerIndex(nextPlayerIndex)
                counter++;
            } while (counter < 4 && room.playerDecks[nextPlayerIndex].length < 1);
            
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
                    nextTurnData.nextPlayerIndex = nextPlayerIndex;
                    break;
                    
                case 'PASS':
                    room.playerTurn = nextPlayerIndex;

                    nextTurnData.nextPlayerIndex = nextPlayerIndex;
                    break;
                    
                default:
                    nextTurnData.error = 'Invalid data';
                    break;
            }
        
            Object.entries(room.playerDecks).forEach(([key, val]) => {
                nextTurnData.playersCardsCount[key] = val.length
            });
            await room.save();

            if (nextTurnData.error) {
                nextTurnData.type = 'ERROR';
                return conn.socket.send(JSON.stringify(nextTurnData));
            }

            if (action === 'DROP_CARD') {
                conn.socket.send(JSON.stringify({type: 'DECK_UPDATE', myDeck: room.playerDecks[playerIndex]}));
            }
            
            
            nextTurnData.type = 'NEXT_TURN';
            broadcastMessage(JSON.stringify(nextTurnData), conn.socket.roomID);

        } catch(error) {
            conn.socket.send(JSON.stringify({ type: 'ERROR', error }));
        }
    });
});

async function start() {
    const IS_GOOGLE_CLOUD_RUN = process.env.K_SERVICE !== undefined
  
    const port = process.env.PORT || 3000;
  
    const address = "0.0.0.0";
  
    try {
      const server = fastify;
      const _address = await server.listen(port, address)
      console.log(`Listening on ${_address}`)
    } catch (err) {
      console.error(err)
      process.exit(1)
    }
  }

start();