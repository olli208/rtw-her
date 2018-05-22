# minor-real-time-web - 22 may 2018

## Spotify realtime data

[Link to site (sockets dont work for some reason so you can only see how the app looks)](https://arcane-castle-34978.herokuapp.com/)

## About 
This app is supposed to be a Spotify app where a user can see different statistics of his/her account with their albums and/ or playlists.

A user can sign in with the spotify Oauth flow and the application receives the users data. 

What I have now is a server which allows the user go trough the Oauth flow from the page. After that we get can use the users account to get their data. The scope looks like this at the moment:
```
 var scope = 'user-read-private user-read-email playlist-read-private user-follow-read user-library-read user-library-modify';
```
After the user succesfully logs in with their account a socket connection is made which we can send JSON data from the on the server to the client. A list of playlist is shown like below.

![playlist](README-img/playlists.png)


In the meantime my server is requesting the Spotify API for data. On the server this data is compared to the first time and when there are changes, the data gets sent to the clinet. This happens with sockets so the data changes real time. To figure out if there any changes to the playlist I use [this](https://www.npmjs.com/package/deep-diff) super handy NPM package.

Once a user clicks on a playlist, they get a page with the tracks of the playlist. For every track I do another request (because Spotify :\) to get the genres. The using [D3](https://d3js.org/) I create a bubble graph to illustrate how many genres there are.

![genres](README-img/genre.png)

Data for the graph is sent to the specific socket.id. So each user sees data for their selected playlist.

## Install the app
To see it live and go trough the Oauth flow your self clone this repo, run the following command in the terminal
```
git clone https://github.com/olli208/minor-real-time-web.git
```

From the root of the directory run 
```
npm install
```

Then change these to your own you can get them [here](https://developer.spotify.com/)
```
var client_id = process.env.client_id;
var client_secret = process.env.client_secret;
```

Then 
```
npm start
```

The site will be on [http://localhost:1000](http://localhost:1000/) or whatever the terminal says.


### TO DO
- Unfollow playlist (have some code already but it doesnt do anything to my playlist)

## source
- [Web API Authorization Guide](https://developer.spotify.com/web-api/authorization-guide/)
- [OAuth 2 Simplified](https://aaronparecki.com/oauth-2-simplified/#web-server-apps)
