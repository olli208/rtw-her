(function() {
    var socket = io();
    var music = [];

    document.querySelectorAll('.unfollow').forEach(function(e) {
        e.addEventListener('click' , unfollow)
    })

    socket.on('playlists' ,function(data) {
        var playlistNames = document.querySelector('.playlistnames');
        music = data;
        var items = music.playlists.items;

        playlistNames.innerHTML = '';
        // loop to get names of a playlist
        // aswell as user and id of playlist
        for (var key in items) {
            // skip loop if the property is from prototype
            if (!items.hasOwnProperty(key)) continue;

            var li = document.createElement('li');
            var img = document.createElement('img');
            li.className = "albumName";
            img.className = "albumImage";
            img.setAttribute("src", items[key].images[0].url);

            li.innerHTML =
                '<a class="getTracks" href="/playlists/' + items[key].id + '/' + items[key].owner.id + '">'
                + '<h3>' + items[key].name + '</h3>'
                + '<img class="albumImage" src=' + items[key].images[0].url + '>'
                + '</a>'
                + '<button class="unfollow" id="/' + items[key].id + '/' + items[key].owner.id + '>UNFOLLOW PLAYLIST</a>';
            playlistNames.appendChild(li);
        }
    });

    function unfollow(e) {
        var select = e.target.parentNode.querySelector('a')
        var playlistID = select.href.split("/")[4]
        var user = select.href.split("/")[5]
        console.log(playlistID , user)

        var request = new window.XMLHttpRequest();

        request.open("DELETE", "http://localhost:1000/" + playlistID + '/' + user, true);
        request.onload = function() {
            if (request.status >= 200 && request.status < 400) {
              // Success!
              console.log(request)
            } else {
              // No succes
              console.log("We reached our target server, but it returned an error");
            }
        };

        request.onerror = function () {
            // There was a connection error of some sort
            console.log('FATAL ERRORRRRRR')
        };

        request.send();
    }

    socket.on('tracks', function(data) {
        console.log('D3')
        var genres = [];
        data.genres[0].forEach(function (e) {
            e.map(function (x) {
                genres.push(x);
                return genres;
            })
        });

        var cleanGenres = {};
        for (var i = 0; i < genres.length; i++) {
            var num = genres[i];
            cleanGenres[num] = cleanGenres[num] ? cleanGenres[num] + 1 : 1;
        }

        var arr = [];

        Object.keys(cleanGenres).forEach(function(key) {
            obj = {
                [key]: cleanGenres[key]
            };
            arr.push(obj);
        });

        var newArr = {
            children: arr
        };

        bubbleGraph(newArr);
    });

    function bubbleGraph(data) {
        var diameter = 200;
        var extra = 200;

        var canvas = d3.select('.genres').append('svg')
            .attr('height', '140vh')
            .attr('width', '100%')
            .append('g')
            .attr('transform' , 'translate(50 , 50)');

        var pack = d3.layout.pack()
            .size([1000, 1000])
            .padding(1.5)
            .value(function(d) { return Object.values(d)[0] });

        var nodes = pack.nodes(data);

        var node = canvas.selectAll('.node')
            .data(nodes)
            .enter()
            .append('g')
                .attr('class' , 'node')
                .attr('transform' , function(d) {
                    return 'translate(' + d.x + ',' + d.y + ')';
                });

        node.append('circle')
            .attr('r' , function(d,i) {
                return d.r;
            })
            .attr('fill' , '#7c25f8')
            .attr('opacity' , 0.25);

        node.append('text')
            .text(function(d) {
                delete d['children'];
                delete d['depth'];
                delete d['value'];
                delete d['y'];
                delete d['x'];
                delete d['r'];
                return Object.keys(d)[0];
            })
            .style('fill', '#fff')
            .attr('font-family' , "roboto, sans-serif")
            .attr('x' , -14)
            .attr('font-size' , '0.9em');
    }

    document.querySelector('.refresh').addEventListener('click' , function (){
      window.location.reload(true);
    })
})();