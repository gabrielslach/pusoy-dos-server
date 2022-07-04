module.exports = (playerDecks) => {
    const playersCardsCount = {};
    Object.entries(playerDecks).forEach(([key, val]) => {
        playersCardsCount[key] = val.length;
    });

    return playersCardsCount;
}