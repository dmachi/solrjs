var debug = require("debug")("solrjs");
var request = require('request');
var EventEmitter = require('events').EventEmitter;
var util=require("util");
var declare = require("dojo-declare/declare");
var defer = require("promised-io/promise").defer;
var when= require("promised-io/promise").when;

var client = module.exports =  declare([EventEmitter], {
	constructor: function(url, options){
		debug("Instantiate SOLRjs Client at " + url);
		this.url = url;
		this.options = options;
	},
	
	query: function(query,options) {
		var def = new defer();

//		var qbody = encodeURIComponent(query + "&wt=json");
		qbody = query += "&wt=json";
		debug("Query Body: ", qbody);

		var req = request({
			url: this.url + "/select",
			method: "POST",
			headers: {
				accept: "application/json",
				'content-type':"application/x-www-form-urlencoded"
			},
			body: qbody,
			json: true
		}, function(error, response, body){
			if (error) {
				return def.reject(error);
			}
			def.resolve(body);
		});
	
		return def.promise;
	},

	get: function(id){
		var def = new defer();

		var req = request({
			url: this.url + "/get?id=" + encodeURIComponent(id),
			method: "GET",
			headers: {
				accept: "application/json",
			},
			json: true
		}, function(error, response, body){
			if (error) {
				return def.reject(error);
			}
			def.resolve(body);
		});
	
		return def.promise;
	
	},
	getSchema: function(){
		var def = new defer();
		// debug("getSchema()", this.url + "/schema?wt=json");
		var req = request({
			url: this.url + "/schema",
			method: "GET",
			headers: {
				accept: "application/json",
			},
			json: true
		}, function(error, response, body){
			if (error) {
				console.error("Error Retreiving Schema: ", error);
				return def.reject(error);
			}
			// debug("Schema Body: ", body);
			def.resolve(body);
		});
	
		return def.promise;
	
	}



});
