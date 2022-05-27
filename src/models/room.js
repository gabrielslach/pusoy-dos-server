const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const cardSchema = new Schema({
    family: String,
    value: String | Number
});

const playerSchema = new Schema({
    playerName: {
        type: String,
        required: true,
    },
});

const roomSchema = new Schema({
    roomID: {
        type: String,
        required: true,
        unique: true,
    },
    playerTurn: Number,
    players: [playerSchema],
    playerDecks: {
        0: [cardSchema],
        1: [cardSchema],
        2: [cardSchema],
        3: [cardSchema],
    },
    droppedCards: [[cardSchema]],
});

module.exports = mongoose.model('room', roomSchema);