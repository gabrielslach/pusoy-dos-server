'use strict'

const fp = require('fastify-plugin')
const mongoose = require('mongoose')

/**
 * This plugins loads MongoDB server to Mongoose instance
 *
 */
module.exports = fp(async function (fastify, opts) {
  const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.jril1.mongodb.net/testdb?retryWrites=true&w=majority`;
  await mongoose.connect(uri);

  console.log('Connected to MongoDB...')
})
