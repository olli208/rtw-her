var mongoose = require('mongoose');
mongoose.Promise = global.Promise;

// The models for the database will be here.
var genreSchema = new mongoose.Schema({
  // Schema's go here.
  playlistID: { type: String, unique: false },
  genres: Array
})

module.exports = mongoose.model('Genres' , genreSchema);