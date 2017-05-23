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

var client_id = process.env.client_id;
var client_secret = process.env.client_secret;
// var redirect_uri = 'http://localhost:1000/callback'; // For local testing !!
var redirect_uri = 'https://evening-plains-21777.herokuapp.com/callback';

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
var playlistOwner;
var users = {};
var sessionid = [];

var stateKey = 'spotify_auth_state';
var access_token,
    refresh_token;

io.on('connect', onConnect);

app.get('/', index);
app.get('/login', login);
app.get('/callback', callback);
app.get('/playlists', playlists);
app.delete('/:id/:user/' , unfollowPL);

function index(req , res) {
    sessionid.push(req.sessionID);
    console.log('sessionID: ' , req.sessionID);

    if (access_token) {
        res.redirect('/playlists')
    } else {
        res.render('index');
    }
}

function login(req, res){
    var state = generateRandomString(16);
    res.cookie(stateKey, state);

    // Application requests authorization
    var scope = 'user-read-private user-library-read user-library-modify playlist-modify-public playlist-modify-private';
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
                access_token = body.access_token;
                refresh_token = body.refresh_token;

                var options = {
                    url: 'https://api.spotify.com/v1/me',
                    headers: { 'Authorization': 'Bearer ' + access_token },
                    json: true
                };

                // get user id
                rp(options).then(function(body){playlistOwner = body.id});

                res.redirect('/playlists');
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
    var playlistsArray = [];

    var options = {
        // available endpoints https://developer.spotify.com/web-api/using-scopes/
        url: 'https://api.spotify.com/v1/me/playlists?offset=0&limit=25',
        headers: { 'Authorization': 'Bearer ' + access_token },
        json: true
    };

    rp(options)
        .then(function(body) {
            playlistsArray = body;
                res.render('playlist', {
                    data: playlistsArray,
                    user: playlistOwner
                });

                if (access_token){
                  setInterval(getPlaylists, 4000);
                }
          })
          .catch(function(err) {
              console.log('error when loading playlists');
              res.redirect('/login');
              throw err
          });

    // setInterval purpose is to give the "real time" feeling
    // this should be a temporary sollution untill I find a better one
    function getPlaylists(){
        rp(options)
            .then(function(body) {
              var difference = diff(playlistsArray, body); // Compare old with new data
              if (difference) {
                console.log('PLAYLIST CHANGES')
                io.emit('playlists', {playlists: body});
              }
              playlistsArray = body;
            })
            .catch(function(err) {
              console.log('error when loading playlists', err);
              // res.redirect('/');
            });
      }
}

function unfollowPL(req , res) {
    console.log('UNFOLLOW: ' , req.params.id)

    var unfollowOptions = {
        url: 'https://api.spotify.com/v1/users/' + playlistOwner + '/playlists/' + req.params.id,
        headers: { 'Authorization': 'Bearer ' + access_token }
    };

    rp(unfollowOptions)
      .then(function() {
        console.log('success playlist unfollowed')
      })
      .catch(function(err) {
        console.log('Couldnt unfollow playlist');
        throw err
      });
}

// SOCKET THINGIESS HERE
function onConnect(socket) {
    latestSocket = socket.id;

    console.log('USER CONNECTED:', socket.id);

    updateUsers();
    function updateUsers(){
        users[socket.id] = socket;
    }

    socket.on('disconnect', function(){
        console.log(socket.id , 'DISCONNECTED!');
        delete users[socket.id];
    });

    app.get('/playlists/:id/:user/' , getPlaylistTracks)

    function getPlaylistTracks (req, res) {
        if (access_token){
            var tracks = [];

            var playlistOption = {
              url: 'https://api.spotify.com/v1/users/' + req.params.user + '/playlists/' + req.params.id + '/tracks',
              headers: {'Authorization': 'Bearer ' + access_token},
              json: true
            };

            rp(playlistOption)
              .then(function (body) {
                tracks = body;

                if (access_token) {
                  getGenre(tracks);
                  res.render('tracks', {data: tracks});
                }

                return tracks;
              })
              .catch(function (err) {
                console.log('couldnt get tracks', err);
                throw err;
              });
          } else {
          res.redirect('/login')
        }
    }

    function getGenre(tracks) {
        var genres = [];

        var promises = tracks.items.map(function(e) {
            var reqGenre = {
                url: 'https://api.spotify.com/v1/artists/' + e.track.album.artists[0].id,
                json: true
            };

            return rp(reqGenre)
                .then(function (body) {
                    return body.genres
                })
                .catch(function (err) {
                    console.log('couldnt get genres', err);
                    throw err
                });
        });

        return Promise.all(promises).then(function (results) {
            genres.push(results);
            socket.broadcast.to(latestSocket).emit('tracks', {genres: genres});
        });
    }
}

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