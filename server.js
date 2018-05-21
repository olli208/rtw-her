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
var redirect_uri = 'http://localhost:1000/callback'; // For local testing !!
// var redirect_uri = 'https://evening-plains-21777.herokuapp.com/callback';

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
// var access_token,
//     refresh_token;

app.get('/', index);
app.get('/login', login);
app.get('/callback', callback);
app.get('/playlists', playlists);
app.delete('/:id/:user/' , unfollowPL);

function index(req , res) {
    sessionid.push(req.sessionID);
    // console.log('sessionID: ' , req.sessionID);

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

    if (req.session.access_token) {
        var playlistsArray = [];
        var requestPlaylists = {
            // available endpoints https://developer.spotify.com/web-api/using-scopes/
            url: 'https://api.spotify.com/v1/me/playlists?offset=0&limit=5',
            headers: { 'Authorization': 'Bearer ' + req.session.access_token },
            json: true
        };
    
        rp(requestPlaylists)
            .then(function(body) {
                playlistsArray = body.items;
    
                // console.log(body.items[0]);
    
                res.render('playlist', {
                    data: body.items,
                    user: playlistOwner
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
                    io.emit('playlists', {playlists: body});
                  }
                  playlistsArray = body;
                })
                .catch(function(err) {
                  console.log('error when loading playlists', err);
                  // res.redirect('/');
                });
          }
    } else {
        res.redirect('/');
    }
}

function unfollowPL(req , res) {
    console.log('UNFOLLOW: ' , req.params.id)

    var unfollowOptions = {
        url: 'https://api.spotify.com/v1/users/' + playlistOwner + '/playlists/' + req.params.id,
        headers: { 'Authorization': 'Bearer ' + req.session.access_token }
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

app.get('/playlists/:id/:user/' , function(req, res ) {
    var tracks = [];

    var playlistOption = {
        url: 'https://api.spotify.com/v1/users/' + req.params.user + '/playlists/' + req.params.id + '/tracks?market=NL',
        headers: {'Authorization': 'Bearer ' + req.session.access_token},
        json: true
    };

    rp(playlistOption)
        .then(body => {
            tracks = body;

            if (req.session.access_token) {
                res.render('tracks', {data: tracks});
                // getGenre(req, tracks);

            } else {
                res.redirect('/')
            }

            return tracks;
        })
        .then(tracks => {
            var genres = [];
            var counts = {};

            // tracks.items.forEach(element => {
            //     console.log(element.track.artists[0].id)
            // });

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
                        // console.log(body.genres)

                        return body.genres;
                    })
                    // .then(function(results) {
                    //     genres.push(results);
                        
                    //     var allGenres = genres.reduce(function(prev, curr) {
                    //         return prev.concat(curr);
                    //     });

                    //     var map = allGenres.reduce(function(prev, cur) {
                    //         prev[cur] = (prev[cur] || 0) + 1;
                    //         return prev;
                    //       }, {});



                    //     return map
                    // })
                    .catch(function (x, err) {
                        console.log('couldnt get genres', err);
                        throw err
                    });
            })

            return Promise.all(promises).then(function (results) {
                genres.push(results);

                io.on('connection', socket => {
                    socket.emit('genres' , {genres: genres});
                });

                
            });
        })
        .catch(err => {
            console.log('couldnt get tracks', err);
            throw err;
        });
});

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