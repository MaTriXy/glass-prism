/* Prism Entry Point
 * A Node.js framework for Google Glass Mirror API applications
 */

// include standard node libraries
var http = require('http');
var url = require("url");
var fs = require('fs');

// google api stuff
var googleapis = require('googleapis');
var oauth2Client;

// will be set to the results of API discovery
var mirror = null;

// dot templates for the cards
var dot = require('dot');
var cards = {};

// load all cards and turn into templates
var files = fs.readdirSync("cards/");
for (var i = 0; i < files.length; i++) {
	cards[files[i].replace('.html','')] = dot.template(fs.readFileSync("cards/"+files[i]))
}

// user card storage
var user_card_ids = {};
var client_tokens = [];

var sessionhash = Math.random() * 1e8;

// read the connected users information from disk
try {
	var filedata = fs.readFileSync(".clienttokens.json");
	if (filedata) {
		client_tokens = JSON.parse(filedata.toString());
		oauth2Client.credentials = client_tokens[0];
	}
} catch(e) {
	console.log("Info: failed to load .clienttokens.json, using blank array");
}

exports.init = function(config) {
	oauth2Client = new googleapis.OAuth2Client(config.client_id, config.client_secret, config.redirect_dir);

	googleapis.discover('mirror','v1').execute(function(err,client) {
		if (err) {
			console.warn("ERR: " + err.toString());
			return;
		}
		mirror = client.mirror;

		http.createServer(httpHandler).listen(config.port);
	});
}

	
function httpHandler(req,res) {
	var u = url.parse(req.url, true)
	var s = u.pathname.split("/");
	var page = s[s.length-1];

	if (page == "subscription") {
		var postBody = "";
		req.on("data",function(data) {
			postBody += data;
			if (postBody.length > 1024 * 1024) {
				postBody = null;
				req.end();
			}
		});
		req.on("end", function(data) {
			try {
				var d = JSON.parse(postBody);
				console.log(d);

				/*
				if (d.verifyToken != sessionhash) {
					console.log("Bad hash!");
					res.end();
					return;
				}
				*/

				if (!client_tokens[d.userToken]) {
					console.log("Bad user token");
					res.end();
					return;
				}
				oauth2Client.credentials = client_tokens[d.userToken];
				if (d.itemId) {
					apiclient.mirror.timeline.get({
						id: d.itemId
					}).withAuthClient(oauth2Client).execute(function(err,data) {
						console.log(err);
						console.log(data);

						//data.text
					});
				}
				res.end(200);
			} catch (e) {
				res.end();
			}
		});
	}
	
	if (page == "oauth2callback") {
		oauth2Client.getToken(u.query.code, function(err,tokens) {
			if (err) {
				console.log(err);
				res.writeHead(500);
				res.write("Uh oh: The token login failed. Chances are you loaded a page that was already loaded. Try going back and pressing the 'get it on glass' button again.");
				res.end();
			} else {
				var index = client_tokens.push(tokens) - 1;

				fs.writeFile(".clienttokens.json", JSON.stringify(client_tokens,null,5));

				client_tokens.push(tokens);

				getSystemLoadInfo();

				oauth2Client.credentials = tokens;

				// add subscriptions
				apiclient.mirror.subscriptions.insert({
					"callbackUrl": config.subscription_callback,
					"collection": "timeline",
					"operation": [], // empty set = all
					"userToken": index,
					"verifyToken": sessionhash
				}).withAuthClient(oauth2Client).execute(function(err,data) {
					if (err) {
						console.log(err);
					}
				});

				// add contact interface
				apiclient.mirror.contacts.insert({
					"id": "gtop_contact_provider_"+config.source_id,
					"displayName": "gtop: " + config.hostname,
					"speakableName": config.speakableName,
					"imageUrls": [config.contactIcon],
					"priority": 7,
					"acceptCommands": [
						{"type":"POST_AN_UPDATE"}
					]
				}).withAuthClient(oauth2Client).execute(function(err,data) {
					if (err)
						console.log(err);
				});

				res.writeHead(302, { "Location": "success" });
				res.end();
			}
		});
		return;
	}

	if (page == "success") {
		res.writeHead(200, { 'Content-type': 'text/html' });
		fs.createReadStream("pages/success.html").pipe(res);
		return;
	}
	
	if (page == "authorize") {
		var uri = oauth2Client.generateAuthUrl({
			access_type: 'offline',
			approval_prompt: 'force',
			scope: 'https://www.googleapis.com/auth/glass.timeline'
		});
		res.writeHead(302, { "Location": uri });
		res.end();
		return;
	}
	
	// nothing else, so just show default
	res.writeHead(200, { 'Content-type': 'text/html' });
	fs.createReadStream("pages/index.html").pipe(res);
};

/* updateAllCards
 * Update cards for all users by id
 */
exports.updateAllCards = function(options) {
	for (var i = 0; i < client_tokens.length; i++)
		exports.updateCard({ tokens: client_tokens[i], card: options.card, pinned: options.pinned, id: options.id });
}

/* updateCard
 * Update a single card
 */
exports.updateCard = function(options,callback) {
	oauth2Client.credentials = options.tokens;

	mirror.timeline.list({ "sourceItemId": options.id, "isPinned": options.pinned || true })
	.withAuthClient(oauth2Client)
	.execute(function(err,data) {
		var apiCall;
		if (err) {
			console.log(err);
			return;
		}
		if (data && data.items.length > 0) {
			apiCall = mirror.timeline.patch({"id": data.items[0].id }, {"html": options.card});
		} else {
			apiCall = mirror.timeline.insert({
				"html": options.card,
				"menuItems": [
					{"action":"REPLY"},
					{"action":"TOGGLE_PINNED"},
					{"action":"DELETE"}
				],
				"sourceItemId": config.id
			});
		}

		exports.mirrorCall(apiCall, options.tokens, callback);
	});
}

exports.mirrorCall = function(call, tokens, callback) {
	oauth2Client.credentials = tokens;
	call.withAuthClient(oauth2Client).execute(callback);
}

