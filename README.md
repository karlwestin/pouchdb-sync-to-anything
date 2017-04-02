Sync PouchDB to Anything
=====

This is a plugin that lets you use CouchDBs replication algorithm with checkpointing, resuming, etc, but provide your own function to write the documents. This can be used to sequentially write updates to a REST API,

How to use
----

```javascript
var PouchDB = require('pouchdb')
PouchDB.plugin(require('pouchdb-sync-to-anything')

var myDb = new PouchDB('exampleDB')

myDb.syncToAnything(function (docs) {
  // Sync function receives a document batch
  // Should return a promise

  // Example:
  return $.ajax({
    url: 'http://example.com/my-rest-endpoint',
    data: JSON.stringify(docs),
    method: 'POST'
  })
}, {
  sync_id: 'talkingToMyRestAPI',
  batch_size: 10
})
```

### Argumnets

#### Syncer (function)

A function which you use for writing whatever you need to write the documents to. **Should return a promise**. The function will be passed **an array of documents** that is minimum 1 document (never called empty) and maximum `batch_size` documents.

#### Options (object)

- `sync_id` or `syncId` (string) **required** used as a checkpoint name. Change this to something else and the replication will start over from 0.
- `batch_size`(number) the number of documents passed in to the `syncer` function.

The CouchDB protocol for not-CouchDB:
-----

This is a partial implementation of the [CouchDB replication protocol](http://docs.couchdb.org/en/2.0.0/replication/protocol.html). It allows you to use PouchDB's tools to save replication checkpoints for syncing with your API. Using those checkpoints, we can start the next replication from the last good checkpoint.

### How it works

Every write you make to a PouchDB/CouchDB instance has a `sequence number`. This is the base for the replication protocol, we use it to read every change that was made sequentially from the database.

1. Using the `sync_id` passed in from the user, read the last sync checkpoint (will be 0 if we never synced before with that id).

2. Read the changes feed from the PouchDB, limiting the number of changes to `batch_size`.

3. Call the user provided sync function, passing in the documents from the changes batch. The sync function should return a promise that fails if the write failed.

4. If the sync promise resolves, write a checkpoint of the last sequence numbers from the written batch

5. Go back to 1

Good to know/Caveats:
-----

* Using this works best for **one way data-flows** only. If you're interested in a 2-way data flow, consider syncing data from the server to a different PouchDB instance, and write changes that are to be sent to the server separately.

* A document is only sent to the sync function once per sync cycle. If you create a document, hit your sync function, update the document twice, and then hit sync again, it will be passed to the sync function once in the first sync call, and once in the second sync call.

