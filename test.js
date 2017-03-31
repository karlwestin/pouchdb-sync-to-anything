var plugin = require('./index')
var PouchDB = require('pouchdb')
var test = require('tape')

PouchDB.plugin(require('pouchdb-adapter-memory'))
PouchDB.plugin(plugin)

function setup () {
  var name = 'Anything_' + Math.random().toString().slice(2)
  var db = new PouchDB(name, { adapter: 'memory' })

  return db
}

function addDocs(db, count) {
  var prefix = Math.random().toString().slice(2)
  var prs = []
  for (var i = 0; i < count; i++) {
    prs.push(db.put({ _id: `item_${prefix}_${i}`, item: i }))
  }
  return Promise.all(prs)
}

function DocCheck () {
  var checked = []
  return function notSyncedBefore (docs) {
    var newIds = docs.map(function (doc) { return doc._id })
    var intersection = newIds.reduce(function(sum, id) {
      return sum || checked.indexOf(id) !== -1
    }, false)
    checked = checked.concat(newIds)
    return !intersection
  }
}

test('defines a name', function (t) {
  var db = setup()
  t.ok(db.syncToAnything, 'defines a syncToAnything function')

  db.destroy()
  t.end()
})

test('doesn\'t call the sync function if there are no docs', function (t) {
  var db = setup()
  var replication = db.syncToAnything(function (docs) {
    t.fail('Sync function should not be called!')
  }, { sync_id: 'test1' })

  replication.then(function () {
    t.pass('finished replication')
    db.destroy()
    t.end()
  })
})

test('calls the sync function with the docs when there are docs', function (t) {
  var db = setup()
  var callCount = 0
  addDocs(db, 5)
    .then(function () {
      return db.syncToAnything(function (docs) {
        callCount++
        t.equals(docs.length, 5, 'receives the docs')
      }, { sync_id: 'test2' })
    })
    .then(function () {
        t.equals(callCount, 1, 'Sync function got called')
        db.destroy()
        t.end()
    })
})

test('picks up 2nd replication where the first ended', function (t) {
  var db = setup()
  var callCount2 = 0
  var callCount1 = 0
  var notSyncedBefore = new DocCheck()

  addDocs(db, 5)
    .then(function () {
      return db.syncToAnything(function (docs) {
        callCount1++
        t.ok(notSyncedBefore(docs), 'docs in the batch has not been synced before')
        t.equals(docs.length, 5, 'receives first batch of docs')
      }, { sync_id: 'test3' })
    })
    .then(addDocs.bind(null, db, 3))
    .then(function () {
      return db.syncToAnything(function (docs) {
        callCount2++
        t.ok(notSyncedBefore(docs), 'docs in the batch has not been synced before')
        t.equals(docs.length, 3, 'receives second batch of docs')
      }, { sync_id: 'test3' })
    })
    .then(function () {
      db.destroy()
      t.equals(callCount1, 1, 'calls 1st sync function once')
      t.equals(callCount2, 1, 'only calls 2nd sync function once')
      t.end()
    })
})

test('updated document gets synced again', function (t) {
  var db = setup()
  var docToUpdate
  var called = false
  addDocs(db, 2)
    .then(function () {
      return db.syncToAnything(function (docs) {
        docToUpdate = docs[0]
        return Promise.resolve()
      }, { sync_id: 'test4' })
    })
    .then(function () {
      docToUpdate.extra = true
      return db.put(docToUpdate)
    })
    .then(function () {
      return db.syncToAnything(function (docs) {
        called = true
        t.equals(docs.length, 1, 'the updated doc got called')
        t.equals(docs[0]._id, docToUpdate._id, 'it is the right doc')
        t.equals(docs[0]._rev.substr(0, 1), '2', 'the updated doc is revision 2')
        return Promise.resolve()
      }, { sync_id: 'test4' })
    })
    .then(function () {
      t.ok(called, 'sync function called on 2nd sync')
      db.destroy()
      t.end()
    })
})

test('a document that\'s been updated several times only gets passed to \'sync\' once', function (t) {
  var db = setup()
  var docToUpdate
  var callCount = 0
  addDocs(db, 2)
    .then(function () {
      return db.syncToAnything(function (docs) {
        docToUpdate = docs[0]
        return Promise.resolve()
      }, { sync_id: 'test5' })
    })
    .then(function () {
      docToUpdate.extra = true
      return db.put(docToUpdate)
    })
    .then(function (res) {
      docToUpdate.somethingElse = 1001
      docToUpdate._rev = res.rev
      return db.put(docToUpdate)
    })
    .then(function () {
      return db.syncToAnything(function (docs) {
        callCount++
        t.equals(docs.length, 1, 'the updated doc got called')
        t.equals(docs[0]._id, docToUpdate._id, 'it is the right doc')
        t.equals(docs[0]._rev.substr(0, 1), '3', 'the updated doc is revision 3')
        return Promise.resolve()
      }, { sync_id: 'test5' })
    })
    .then(function () {
      t.equals(callCount, 1, 'only one call to sync function called on 2nd sync')
      db.destroy()
      t.end()
    })
})

test('batches large sync tasks', function (t) {
  var db = setup()
  var callCount = 0
  var batch_size = 5
  var notSyncedBefore = new DocCheck()

  addDocs(db, 11)
    .then(function () {
      return db.syncToAnything(function (docs) {
        t.ok(docs.length <= batch_size && docs.length > 0, 'limits docs to 5, never empty')
        t.ok(notSyncedBefore(docs), 'docs in the batch has not been synced before')
        return Promise.resolve()
      }, {
        batch_size: batch_size,
        sync_id: 'test6'
      })
    })
    .then(function () {
      db.destroy()
      t.end()
    })
})

/*
 * I'm a little unsure about this test,
 * PouchDB passes it but i don't really see it supported in the code
 * it works with 100 docs but not with 5
 */
test('a document written while syncing is included', function (t) {
  var db = setup()
  var callCount = 0
  var batch_size = 10
  var syncedDocs = 0

  addDocs(db, 100)
    .then(function () {
      return db.syncToAnything(function (docs) {
        syncedDocs += docs.length
        callCount++

        if (callCount === 1) {
          // We add a doc in the middle of the sync
          return addDocs(db, 1)
        }

        return Promise.resolve()
      }, {
        batch_size: batch_size,
        sync_id: 'test7'
      })
    })
    .then(function () {
      t.equals(syncedDocs, 101, 'included the doc that was added during sync')
      db.destroy()
      t.end()
    })
})

test('Emits a \'Change\' event on every batch written', function (t) {
  var db = setup()
  var batch_size = 5
  var callCount = 0
  var changeCount = 0
  var lastChange = 0

  addDocs(db, 30)
    .then(function () {
      var replication = db.syncToAnything(function (docs) {
        callCount++
        return Promise.resolve()
      }, {
        sync_id: 'test8'
      })

      replication.on('change', function (change) {
        t.ok(change.last_seq >= lastChange, 'updates change last_seq')
        t.ok(change.last_seq > 0, 'updates change last_seq 2')
        lastChange = change.last_seq
        changeCount++
      })

      return replication
    })
    .then(function () {
      t.ok(changeCount > 0, 'change has been called')
      t.equals(changeCount, callCount, 'change has been called as many times as sync func')

      db.destroy()
      t.end()
    })
})

test('Emits a result in the end', function (t) {
  var db = setup()

  addDocs(db, 16)
    .then(function () {
      return db.syncToAnything(function () {
        return Promise.resolve()
      }, { sync_id: 'test9' })
    })
    .then(function (result) {
      t.equals(result.status, 'complete', 'status is set to "complete"')

      db.destroy()
      t.end()
    })
})

test('Cancels a sync', function (t) {
  var db = setup()
  var batch_size = 5
  var callCount = 0

  addDocs(db, 30)
    .then(function () {
      var replication = db.syncToAnything(function (docs) {
        callCount++
        if (callCount == 2) {
          return replication.cancel()
        }

        return Promise.resolve()
      }, { batch_size: batch_size, sync_id: 'test10' })

      return replication
    })
    .then(function (result) {
      t.equals(result.status, 'cancelled', 'writes cancelled status')
      t.ok(result.last_seq > 0, 'last_seq is recorded as > 0')
      t.equals(callCount, 2, 'sync function not called any more after cancelling')

      db.destroy()
      t.end()
    })
})

test('Error Handling: Picks up where it left off if sync fails', function (t) {
  var db = setup()

  var batch_size = 5
  var notSyncedBefore = new DocCheck()

  addDocs(db, 10)
    .then(function () {
      var callCount = 0
      return db.syncToAnything(function (docs) {
        callCount++
        if (callCount === 2) {
          t.ok(notSyncedBefore(docs), 'docs in the batch has not been synced before')
          return Promise.reject('write error')
        }

        return Promise.resolve()
      }, {
        batch_size: batch_size,
        sync_id: 'test11'
      })
      .then(function () {
        t.fail('first replication should fail')
      })
      .catch(function (err) {
        t.equals(err.result.status, 'aborting', 'sets status to failed')
        t.equals(callCount, 2, 'failed on 2nd call')
      })
    })
    .then(function () {
      var callCount = 0
      return db.syncToAnything(function (docs) {
        if (callCount === 0) {
          t.notOk(notSyncedBefore(docs), 'first set of docs should have been attempted before')
        }

        callCount++
      }, { sync_id: 'test11' })
    })
    .then(function (result) {
      t.equals(result.status, 'complete', 'sets status to success')
      db.destroy()
      t.end()
    })
})
