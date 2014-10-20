# solrjs

Simple Solr Client for Node

The client provides provide simple access to the SOLR HTTP API for querying, get (realtime get or via search), and updates. 

Additional, the include rql module allows SOLR queries to be generated from RQL Queries and to use the RQL Query builder for chained
query contruction

## Installation

	> npm install solrjs

## Example Usage

	var solr = require("solrjs");

	var client = new solr("http://localhost:8983/solr",{});

	client.query("q=*:*").then(function(results){
		console.log("Results: ", results);
	},function(err){
		console.error("Error in Query: ", err);
	});

## Using the Query Builder
	var Query = require("solrjs/rql");

	// from an rql string
	var q = new Query("?eq(foo,bar)&sort(-foo)").toSolr();

	// using the builder
	var q = new Query().eq('foo','bar').sort('-foo').toSolr();

	client.query(q).then(function(results){
		console.log("Results: ", results);
	});


## Client API

- query
- get
- update
	
