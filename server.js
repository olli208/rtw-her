var express = require('express');
var app = express();
var session = require('express-session');

// Socket requires
var http = require('http').createServer(app);
var io = require('socket.io')(http);

var path = require('path');
var request = require('request'); // simple API requests
var rp = require('request-promise'); // request promise thingy
var querystring = require('querystring');
var cookieParser = require('cookie-parser'); //parses cookier (? from spotify)
var dotenv = require('dotenv').config(); //secret stuff
var diff = require('deep-diff').diff; // compare objects
var mongoose = require('mongoose');

const isOnline = require('is-online');

mongoose.connect(process.env.DATABASE)
mongoose.Promise = global.Promise;

mongoose.connection.on('error' , function (err) {
  console.log('Something went wrong with MONGODB ->' , err.message)
})

require('./models/Genres');
var Genres = mongoose.model('Genres');

var client_id = process.env.client_id;
var client_secret = process.env.client_secret;
var redirect_uri = process.env.redirect_uri; // For local testing !!

app.set('view engine' , 'ejs')
    .set('views' , path.join(__dirname, 'views'))
    .use(express.static('static'))
    .use(cookieParser())
    .use(session({
        secret: 'stil',
        resave: false,
        saveUninitialized: true
    }));

// object where users are stored
var users = {};
var sessionid = [];

var stateKey = 'spotify_auth_state';

app.get('/', index);
app.get('/login', login);
app.get('/callback', callback);
app.get('/playlists', playlists);
app.get('/playlists/:id/:user/' , genres);

app.delete('/:id/:user/' , unfollowPL);

function index(req , res) {
    sessionid.push(req.sessionID);
    res.render('index');
}

function login(req, res){
    var state = generateRandomString(16);
    res.cookie(stateKey, state);

    // Application requests authorization
    var scope = 'playlist-read-private user-read-private user-library-read user-library-modify playlist-modify-public playlist-modify-private user-follow-read';
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: client_id,
            scope: scope,
            redirect_uri: redirect_uri,
            state: state
        }));
}

function callback(req, res) {
    // The state can be useful for correlating requests and responses...
    // more info here: https://developer.spotify.com/web-api/authorization-guide/
    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
        res.redirect('/#' +
            querystring.stringify({
                error: 'state_mismatch'
            }));
    } else {
        res.clearCookie(stateKey);

        var authOptions = {
            url: 'https://accounts.spotify.com/api/token',
            form: {
                code: code,
                redirect_uri: redirect_uri,
                grant_type: 'authorization_code'
            },
            headers: {
                'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
            },
            json: true
        };

        // Get acces and refresh okens from Spotify
        request.post(authOptions, function(error, response, body) {
            if (!error && response.statusCode === 200) {
                req.session.access_token = body.access_token;
                req.session.refresh_token = body.refresh_token;

                var options = {
                    url: 'https://api.spotify.com/v1/me',
                    headers: { 'Authorization': 'Bearer ' + req.session.access_token },
                    json: true
                };

                // get user id
                rp(options).then((body) => {
                    req.session.playlistOwner = body.id;
                    res.redirect('/playlists');
                });
                
            } else {
                // unless there's an error...
                res.redirect('/#' +
                    querystring.stringify({
                        error: 'invalid_token'
                    }));
            }
        });
    }
}

function playlists(req, res) {
    if (req.session.access_token) {
        var playlistsArray = [];
        var requestPlaylists = {
            // available endpoints https://developer.spotify.com/web-api/using-scopes/
            url: 'https://api.spotify.com/v1/me/playlists?offset=0&limit=6',
            headers: { 'Authorization': 'Bearer ' + req.session.access_token },
            json: true
        };
    
        rp(requestPlaylists)
            .then(function(body) {
                playlistsArray = body.items;   
                // console.log(body.items);
                
                res.render('playlist', {
                    data: body.items,
                    user: req.session.playlistOwner,
                });

                setInterval(getPlaylists, 5000);

              })
              .catch(function(err) {
                  console.log('error when loading playlists');
                  res.redirect('/login');
                  throw err
              });
    
        // setInterval purpose is to give the "real time" feeling
        // this should be a temporary sollution untill I find a better one
        function getPlaylists(){

            rp(requestPlaylists)
                .then(function(body) {
                    var difference = diff(playlistsArray, body); // Compare old with new data
                    if (difference) {
                        io.emit('playlists', {
                            playlists: body,
                            userID: req.session.playlistOwner
                        });
                    }
                    playlistsArray = body;
                })
                .catch(function(err) {
                  console.log('error when loading playlists', err);
                  socket.emit('offline' , err );
                  // res.redirect('/');
                });
          }
    } else {
        res.redirect('/');
    }
}

function unfollowPL(req , res) {
    console.log('UNFOLLOW: ' , req.params.user,  req.params.id);

    var unfollowOptions = {
        // https://api.spotify.com/v1/users/{owner_id}/playlists/{playlist_id}/followers
        url: 'https://api.spotify.com/v1/users/' + req.params.user + '/playlists/' + req.params.id + '/followers',
        headers: { 'Authorization': 'Bearer ' + req.session.access_token }
    };

    request.del(unfollowOptions, function(err, response, body) {
        console.log(response);

        if (!err && response.statusCode === 200) {
            console.log('success playlist unfollowed', response ,body)
            // res.send('success playlist unfollowed', response);
        } else {
            console.log('ERROR FAIL', err)
            res.send(err)
            throw err
        }
    });
}

function genres(req, res ) {
    var tracks = [];

    var playlistOption = {
        url: 'https://api.spotify.com/v1/users/' + req.params.user + '/playlists/' + req.params.id + '/tracks?market=NL',
        headers: {'Authorization': 'Bearer ' + req.session.access_token},
        json: true
    };

    var playlistGenres = Genres.find({'playlistID': req.params.id });

    rp(playlistOption)
        .then(body => {
            tracks = body;

            if (req.session.access_token) {
                res.render('tracks', {
                    data: tracks,
                    playlistID: req.params.id
                });

            } else {
                res.redirect('/');
            }

            return tracks;
        })
        .then(tracks => {

            var playlistGenres = Genres.find({'playlistID': req.params.id });

            playlistGenres.then(genres => {

                if (genres.length < 1) {
                    console.log('playlist DOES NOT exist so we make it!');

                    var genres = [];
                    var counts = {};
        
                    function hasID(track) {
                        return track.track.artists[0].id != null;
                    }
        
                    var onlyWithID = tracks.items.filter(hasID);
        
                    var promises = onlyWithID.map(function(e) {
                        var reqGenre = {
                            url: 'https://api.spotify.com/v1/artists/' + e.track.artists[0].id,
                            headers: {'Authorization': 'Bearer ' + req.session.access_token},
                            json: true
                        };
        
                        return rp(reqGenre)
                            .then(body => {
                                return body.genres;
                            })
                            .catch(function (x, err) {
                                console.log('couldnt get genres', err);
                                throw err
                            });
                    })
        
                    return Promise.all(promises).then(function (results) {
                        io.on('connection', socket => {
                            socket.emit('genres' , {
                                playlistID: req.params.id,
                                genres: results
                            });
                        });

                        var formatGenre = {
                            playlistID: req.params.id,
                            genres: results
                        }

                        new Genres(formatGenre)
                        .save()
                        .then(function (data) {
                            console.log('LALALA IT WORKS??' , data);
                        })
                        .catch(err => {
                            console.log(err)
                        });
                    });

                } else if (genres[0].genres.length > 1) {
                    console.log('playlist DOES EXIST!');

                    io.on('connection', socket => {
                        socket.emit('genres' , {
                            playlistID: genres[0].playlistID,
                            genres: genres[0].genres
                        });
                    });

                }
            })
        })
        .catch(err => {
            console.log('couldnt get tracks', err);
            throw err;
        });
};

function generateRandomString(length) {
    var text = '';
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

var port = process.env.PORT || 1000;

http.listen(port, function (){
    console.log('server is running: on: ' + port);
});