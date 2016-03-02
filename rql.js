var debug = require('debug')('solrjs:rql')
var request = require('request');
var EventEmitter = require('events').EventEmitter;
var util=require("util");
var defer = require("promised-io/promise").defer;
var when= require("promised-io/promise").when;
var RQLQuery= require("rql/query").Query;
var parser = require("rql/parser");

RQLQuery.prototype.infinity = 9999999999
RQLQuery.prototype.toSolr = function(opts){
	opts=opts||{}
    var normalized = this.normalize({
            primaryKey: '_id',
            map: {
                    ge: 'gte',
                    le: 'lte'
            },
            known: ['lt','lte','gt','gte','ne','in','nin','not','mod','all','size','exists','type','elemMatch'],
    });
	debug("normalized: ", normalized);

	var sq;
	debug("this.name: ", this.name);
	debug("this.args: ", this.args);
	var sq=(this.name === "and" ?
		serializeArgs(this.args, " AND ") :
		queryToSolr(this))

	if (!sq) { sq="*:*"; }

	if (normalized.limit) {
		var l = (normalized.limit===Infinity)?(opts.defaultLimit||this.infinity):normalized.limit;
		if (l > opts.maxRequestLimit) { l = opts.maxRequestLimit; }
		sq += "&rows=" + l;
	}

	if (normalized.skip) {
		sq += "&start=" + normalized.skip;
	}

	if (normalized.select && (normalized.select.length>0)) {
		sq += "&fl=" + normalized.select.join(",");
	}

        if (normalized.sortObj){
                var so = {}
                for (prop in normalized.sortObj){
                        so[prop] = (normalized.sortObj[prop]>0)?"asc":"desc";
                }
		sq += "&sort=" + Object.keys(so).map(function(prop){
			return prop + " " + so[prop];
		}).join(", ");
        }

	if (normalized.facets && (normalized.facets.length>0)) {
		sq += "&facet=true"
		normalized.facets.forEach(function(facet){
			if (facet instanceof Array){
				sq += "&facet." + facet[0] + "=" + facet[1];
			}else{
				sq += "&facet.field=" + facet;	
			}	
		});
	}

	if (normalized.groupings && (normalized.groupings.length>0)) {
		sq += "&group=true"
		normalized.groupings.forEach(function(group){
			if (group instanceof Array){
				sq += "&group." + group[0] + "=" + group[1];
			}else{
				sq += "&group.field=" + group;	
			}	
		});
	}

	if (normalized.json){
		Object.keys(normalized.json).forEach(function(k){
			sq += "&json." + k + "=" + normalized.json[k];
		});
	}


	return "&q="+sq;
}

RQLQuery.prototype.normalize = function(options){
        options = options || {};
        options.primaryKey = options.primaryKey || 'id';
        options.map = options.map || {};
        var result = {
                original: this,
                sort: [],
                limit: [Infinity, 0, Infinity],
                skip: 0,
                limit: Infinity,
                select: [],
                values: false,
		facets: [],
		groupings: [],
		json: {},
		fq: []
        };
        var plusMinus = {
                // [plus, minus]
                sort: [1, -1],
                select: [1, 0]
        };
        function normal(func, args){
                // cache some parameters
                if (func === 'sort' || func === 'select') {
                        result[func] = args;
                        var pm = plusMinus[func];
                        result[func+'Arr'] = result[func].map(function(x){
                                if (x instanceof Array) x = x.join('.');
                                var o = {};
                                var a = /([-+]*)(.+)/.exec(x);
                                o[a[2]] = pm[(a[1].charAt(0) === '-')*1];
                                return o;
                        });
                        result[func+'Obj'] = {};
                        result[func].forEach(function(x){
                                if (x instanceof Array) x = x.join('.');
                                var a = /([-+]*)(.+)/.exec(x);
                                result[func+'Obj'][a[2]] = pm[(a[1].charAt(0) === '-')*1];
                        });
                } else if (func === 'limit') {
                        // validate limit() args to be numbers, with sane defaults
                        var limit = args;
                        result.skip = +limit[1] || 0;
                        limit = +limit[0] || 0;
                        if (options.hardLimit && limit > options.hardLimit)
                                limit = options.hardLimit;
                        result.limit = limit;
                        result.needCount = true;
                } else if (func === 'values') {
                        // N.B. values() just signals we want array of what we select()
                        result.values = true;
                } else if (func === 'eq') {
                        // cache primary key equality -- useful to distinguish between .get(id) and .query(query)
                        var t = typeof args[1];
                        //if ((args[0] instanceof Array ? args[0][args[0].length-1] : args[0]) === options.primaryKey && ['string','number'].indexOf(t) >= 0) {
                        if (args[0] === options.primaryKey && ('string' === t || 'number' === t)) {
                                result.pk = String(args[1]);
                        }
                }else if (func == "facet"){
			result.facets = result.facets.concat(args);	
		} else if (func == "group"){
			result.groupings= result.groupings.concat(args);	
		} else if (func == "json"){
			result.json[args[0]]="";
			for(var i=1;i<args.length;i++){
				result.json[args[0]]= result.json[args[0]] + args[i];
			}
		}



                // cache search conditions
                //if (options.known[func])
                // map some functions
                //if (options.map[func]) {
                 //       func = options.map[func];
                //}
        }
        this.walk(normal);
        return result;
};

function encodeString(s) {
	if (typeof s === "string") {
		s = encodeURIComponent(s);

		if (s.match(/[\(\)]/)) {
			s = s.replace("(","%28").replace(")","%29");
		};

		s = s.replace(/\%3A/g,":");

		s = s.replace(/\%22/g,'"');

		s = s.replace(/\\+/g,"%2B");

		//console.log("REPLACED: ", s);
	
		if (s.charAt(0)=='"' && s.charAt(s.length-1)=='"'){
			//console.log("Use quotes here");
			s = '"' + s.slice(1,s.length-1).replace('"',"%22") + '"'
		}else{
			s = s.replace('"',"%22");
		}	


	}
	return s;
}

var encodeValue = exports.encodeValue = function(val) {
	//console.log("ENOCDE VALUE: ", val);
	var encoded;
	if (val === null) val = 'null';

	if (val && val !== parser.converters["default"]('' + (
		(val.toISOString)? val.toISOString():val.toString()
	))) {
		var type = typeof val;
		if(val instanceof RegExp){
			// TODO: control whether to we want simpler glob() style
			val = val.toString();
			var i = val.lastIndexOf('/');
			type = val.substring(i).indexOf('i') >= 0 ? "re" : "RE";
			val = encodeString(val.substring(1, i));
			encoded = true;
		}
		if(type === "object" && val && val.getTime){
			type = "epoch";
			val = val.getTime();
			encoded = true;
		}
		if(type === "string") {
			val = encodeString(val);
			encoded = true;
		}
		val = [type, val].join(":");
	}

	if (!encoded && typeof val === "string") val = encodeString(val);

	/*
	if (val && typeof val == 'string') {
		val = val.replace("%2B","+").replace("+","\\\+");
	}
	*/

	//console.log("ENCODED VAL: ", val);
	return val;
};

function serializeArgs(array, delimiter){
        debug("serializeArgs Array: ", array, delimiter);
        var results = [];
        for(var i = 0, l = array.length; i < l; i++){
		if (array[i]) {
			var x = queryToSolr(array[i]);
			if (x) {
                		results.push(queryToSolr(array[i]));
			}
		}
        }
        return results.join(delimiter);
}

function queryToSolr(part,options) {
	options = options || {}
	if (part instanceof Array) {
		return '(' + serializeArgs(part, ",")+')';
	}

	if (part && part.name && part.args && _handlerMap[part.name]) {
		return _handlerMap[part.name](part,options);
	}

	return exports.encodeValue(part);
};

module.exports =  RQLQuery;


var handlers = [ 
		["and", function(query, options){
			var parts=[]
			query.args.forEach(function(a){
				var p = queryToSolr(a,options);
				if (p){
					parts.push(p);
				}
			});
			parts = parts.filter(function(p){
				return !!p;
			});

			if (parts.length==1) {
				return parts[0]
			}
			return "(" + parts.join(" AND ") + ")"
		}],	

		["or", function(query, options){
			var parts=[]
			query.args.forEach(function(a){
				parts.push(queryToSolr(a,options));
			});

			parts = parts.filter(function(p){
				return !!p;
			});

			if (parts.length==1) {
				return parts[0]
			}
		
			return "(" + parts.join(" OR ") + ")";
		}],

		["eq", function(query, options){
			var parts = [query.args[0]]
			parts.push(queryToSolr(query.args[1],options));
			var val = decodeURIComponent(parts[1]);
			var field = parts[0];

			if (val.charAt(0)=='"'){
				return parts.join(":");
			}else{
				var vals = val.split(" ");
				
				return vals.map(function(v){
					return field + ":" + encodeURIComponent(v);
				}).join(" AND ");
			}
		}],
		["ne", function(query, options){
			var parts = [query.args[0]]
			parts.push(queryToSolr(query.args[1],options));

                        var val = decodeURIComponent(parts[1]);
                        var field = parts[0];

                        if (val.charAt(0)=='"'){
                                return "-" + parts.join(":");
                        }else{
                                var vals = val.split(/\s+/);
                                
                                return vals.map(function(v){
                                        return "-" + field + ":" + encodeURIComponent(v)
                                }).join(" AND ");
                        }

		}],
	
		["exists", function(query, options){
			return "-" + query.args[0] + ":[* TO *]";
		}],

		["match", function(query, options){
			return query.args.join(":/")+"/";
		}],
		["ge", function(query, options){
			return query.args[0] + ":{" + query.args[1] + " TO *}";
		}],
		["gt", function(query, options){
			return query.args[0] + ":[" + query.args[1] + " TO *]";
		}],
		["le", function(query, options){
			return query.args[0] + ":{* TO " + query.args[1] + "}";
		}],
		["lt", function(query, options){
			return query.args[0] + ":[* TO " + query.args[1] + "]";
		}],

		["between", function(query, options){
			return query.args[0] + ":[" + queyr.args[1] + " TO " + query.args[2] + "]";
		}],

		["field", function(query, options){
			return "(_val_:" + query.args[0] + ")";
		}],

		["qf", function(query, options){
			if (!options.qf){options.qf=[]}
			options.qf.push(queryToSolr(query.args[0],options));
		}],

		["fq", function(query, options){
			if (!options.fq){options.fq=[]}
			options.fq.push(queryToSolr(query.args[0],options));
		}],

		["not", function(query, options){
			return "NOT " + queryToSolr(query.args[0],options);
		}],

		["in", function(query, options){
			return "(" + query.args[0] + ":(" + query.args[1].join(" OR ") + "))";
		}],

		["keyword", function(query,options){
			return query.args[0];
		}],

		["distinct", function(query, options){
			if (!options.distinct){
				options.distinct=[]
			}

			options.distinct.push(query.args);
		}],

		["json", function(query,options){
			if (!options.json){
				options.json={}
			}
			
			options.json[query.args[0]] = "";

			for (var i=0; i<query.args.length;i++){
				options.json[query.args[0]] = 	options.json[query.args[0]] + query.args[i];
			}
			
		}],

		["facet", function(query, options){
			//var parts = ["facet=true"];
			
//			query.args[0].forEach(function(field){
//					parts.push("facet.field=" + field);
//			});
//			parts.push("sort=" + query.args[1]);
			if (!options.facets){
				options.facets=[];
			}	

			function existingFacetProps(tprop){
				for (i=0; i < options.facets.length; ++i){
					if (options.facets[i]['field'] == tprop){
						return true;
					}
				}
				return false;
			}
			query.args.forEach(function(facet){
				var facetProp = facet[0];
				var facetVal = facet[1];
	
				if (facetProp == "sort"){
					var dir =  (facetVal.charAt(0)=="+")?"ASC":"DESC";
					facetVal = facetVal.substr(1) + " " + dir;
			
				}
				if (facetVal instanceof Array){
					facetVal = facetVal.join(",");
				}	
				var f = {field: facetProp,value: facetVal}
				options.facets.push(f);
			});
			if (!existingFacetProps('mincount')){
				options.facets.push({field: "mincount", value: 1});
			}
			if (!existingFacetProps('limit')){
				options.facets.push({field: "limit", value: 500});
			}
		}],

		["group", function(query, options){
			//var parts = ["group=true"];
			
//			query.args[0].forEach(function(field){
//					parts.push("group.field=" + field);
//			});
//			parts.push("sort=" + query.args[1]);
			if (!options.groupings){
				options.groupings=[];
			}	

			function existingGroupingsProps(tprop){
				for (i=0; i < options.groupings.length; ++i){
					if (options.groupings[i]['field'] == tprop){
						return true;
					}
				}
				return false;
			}
			query.args.forEach(function(group){
				var groupProp = group[0];
				var groupVal = group[1];
	
				if (groupProp == "sort"){
					var dir =  (groupVal.charAt(0)=="+")?"ASC":"DESC";
					groupVal = groupVal.substr(1) + " " + dir;
			
				}
				if (groupVal instanceof Array){
					groupVal = groupVal.join(",");
				}	
				var f = {field: groupProp,value: groupVal}
				options.groupings.push(f);
			});
			if (!existingGroupingsProps('mincount')){
				options.groupings.push({field: "mincount", value: 1});
			}
			if (!existingGroupingsProps('limit')){
				options.groupings.push({field: "limit", value: 500});
			}
		}],

		["cursor", function(query,options){
			return;
		}],

		["values", function(query, options){
			options.values = query.args[0];
			return;
		}],

		["select", function(query, options){
			return;
		}],
		["sort", function(query, options){
			return;
		}],
		["limit", function(query, options){
			return;
		}]

]	
var _handlerMap={}
handlers.forEach(function(h){
	_handlerMap[h[0]]=h[1];
});

