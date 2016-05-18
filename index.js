var debug = require("debug")("solrjs");
var request = require('request');
var EventEmitter = require('events').EventEmitter;
var util=require("util");
var declare = require("dojo-declare/declare");
var defer = require("promised-io/promise").defer;
var when= require("promised-io/promise").when;
var Readable = require('event-stream').readable;

var limitre = /(&rows=)(\d*)/;
var startre= /(&start=)(\d*)/;




var client = module.exports =  declare([EventEmitter], {
	constructor: function(url, options){
		debug("Instantiate SOLRjs Client at " + url);
		this.url = url;
		this.options = options;
	},

	streamChunkSize: 10,
	maxStreamSize:250000,
	_streamQuery: function(query,stream,callback,currentCount,totalReqLimit,cursorMark){

		console.log("_streamQuery currentCount: ", currentCount, "total: ", totalReqLimit);
		if (!cursorMark){
			cursorMark="*";
		}

		var rowsmatch = query.match(limitre);

		if (totalReqLimit>rowsmatch){
			query = query.replace(limitre,"&rows=" + this.streamChunkSize);
		}

		var _self=this;
	    var qbody = query + "&start=0&wt=json&cursorMark=" + cursorMark;
	    var url = this.url+ "/select";
	  	console.log("QUERY: ", qbody);
	    request({
	    	url:url,
	    	method: "POST",
	    	headers: {
				accept: "application/json",
				'content-type':"application/x-www-form-urlencoded"
			},
			body: qbody,
			json: true
	    }, function(err,res,data){
	    		// console.log("Data: ", data)
	            if (cursorMark=="*"){
	                    var header = {response:{}}
	                    if (data.responseHeader) {
	                            header.responseHeader = data.responseHeader;
	                    }

	                    if (data.response){
		                    Object.keys(data.response).forEach(function(key){
		                            if (key=="docs") { return; }
		                            header.response[key]=data.response[key];
		                    });

		                    stream.emit("data",header);
		                }else{
		                	console.log("No Response Body");
		                	stream.emit("end");
		                	callback()

		                }
	//                      console.log("PUSH INTO STREAM: ", header);
	            }

	            if (data.response && (data.response.numFound < totalReqLimit)){

	            		
	            }

	            if (data.nextCursorMark){
	                  //  console.log("Got Next CursorMark: ", data.nextCursorMark);
	                    if (data.response.docs){
	                            data.response.docs.forEach(function(doc){
	                            //      console.log("PUSH DATA INTO STREAM: ", doc);
	                                    if (currentCount++ < totalReqLimit) {
	                                    	    stream.emit("data",doc);
	                                    }

	                            });
	                          //  console.log("More than total?", currentCount<totalReqLimit);
	                            if (currentCount < totalReqLimit) {
	                                    _self._streamQuery(query,stream,callback,currentCount,totalReqLimit,data.nextCursorMark);
	                            }else{
	                           // 		console.log("END STREAM")
	                                    stream.emit("end");
	                                    callback();
	                            }
	                    }else{
	                      //      console.log("NO DOCS: ",data);
	                            stream.emit('end');
	                            callback();
	                    }

	            }else{
	                 //   console.log("No Next CursorMark");
	                    if (data.response.docs){
	                            data.response.docs.forEach(function(doc){
	                                  //  console.log("PUSH DATA INTO STREAM: ", doc);
	                                    stream.emit("data",doc);
	                            });
	                            stream.emit('end');
	                            callback();
	                    }else{
	                          //  console.log("NO DOCS: ",data);
	                            stream.emit('end');
	                            callback();
	                    }
	            }
	    });
	},


	stream: function(query,options){
		var def = new defer();
		var _self=this;


		var limitMatch = query.match(limitre);
		var totalReqLimit=this.maxStreamSize;

		if (limitMatch){
		       // console.log("limitMatch: ", limitMatch);
		        var totalReqLimit=limitMatch[2];
		}

		//console.log("TOTAL REQUEST LIMIT: ", totalReqLimit)

		var es = new Readable(function(count,callback){
			_self._streamQuery(query,this,callback,0,totalReqLimit);
		});

		def.resolve({stream: es});

		return def.promise;
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
		var prop = "id";
		if ((id instanceof Array) && (id.length>0)){
			if (id.length==1){
				id = encodeURIComponent(id[0]);
			}else{
				prop = "ids";
				id = id.map(function(i){
					return encodeURIComponent(i);
				}).join(",");
			}
		}else{
			id = encodeURIComponent(id);
		}
		debug(this.url + "/get?"+prop+"=" + id);
		var req = request({
			url: this.url + "/get?"+prop+"=" + id,
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
