var EE = require('events').EventEmitter
var inherits = require('inherits')
var generateId = require('pouchdb-generate-replication-id')
var Checkpointer = require('pouchdb-checkpointer')
var uuid = require('pouchdb-utils').uuid
var clone = require('pouchdb-utils').clone

inherits(Replicator, EE)

function Replicator (db) {
  EE.call(this)
  var replicator = this
  var promise = new Promise(function (fullfill, reject) {
    replicator.once('complete', fullfill)
    replicator.once('error', reject)
  })

  this.then = function then (resolve, reject) {
    return promise.then(resolve, reject)
  }

  this.cancel = function cancel () {
    replicator.cancelled = true
  }

  return this
}

function createError (err) {
  if (err instanceof Error) {
    return err
  }

  return new Error('Sync error: ' + err)
}

function sync (syncer, opts) {
  opts = opts || {}
  var db = this
  // this is mandatory, 2 different versions, later one to fit standard.js
  var repId = opts.sync_id || opts.syncId
  var result = {
    ok: true
  }
  var returnValue = new Replicator(db, result)
  var batch_size = opts.batch_size || 100
  var changesOpts = {}
  var currentBatch
  var session = uuid()
  var checkpointer
  var changesPending = false
  var changesCompleted = false
  var replicationCompleted = false

  if(!repId) {
    completeReplication('No replication id was provided')
    return returnValue
  }

  var pendingBatch = {
    changes: [],
    seq: 0,
    docs: []
  }
  var batches = []

  function initCheckpointer () {
    /*
     * PouchDB checkpointer writes the checkpoint to target first
     * We're misusing the checkpointer a little bit,
     * so we pass our source as target, and pretend our source is read-only
     * that way we can use the PouchDB checkpointer out of the box
     */
    checkpointer =
      checkpointer ||
      new Checkpointer('sync-to-anything', db, '_local/' + repId, returnValue)
    checkpointer.readOnlySource = true
  }

  function completeReplication (fatalError) {
    if (replicationCompleted) {
      return
    }

    result.status = result.status || 'complete'
    replicationCompleted = true

    if (returnValue.cancelled) {
      result.status = 'cancelled'
    }

    if (fatalError) {
      fatalError = createError(fatalError)
      fatalError.result = result
      returnValue.emit('error', fatalError)
    } else {
      returnValue.emit('complete', result)
    }

    returnValue.removeAllListeners()
  }

  function abortReplication (err) {
    if (replicationCompleted) {
      return
    }

    result.ok = false
    result.status = 'aborting'
    batches = []
    pendingBatch = {
      changes: [],
      seq: 0,
      docs: []
    }

    completeReplication(err)
  }

  function getBatchDocs () {
    var ids = currentBatch.changes.map(function (change) {
      return change.id
    })

    return db.allDocs({ include_docs: true, keys: ids })
      .then(function (res) {
        return res.rows.map(function (item) {
          return item.doc
        })
      })
  }

  function writeDocs (docs) {
    if (returnValue.cancelled) {
      return completeReplication()
    }

    if (!docs.length) {
      return Promise.resolve()
    }
    return syncer(docs)
  }

  function finishBatch () {
    var last_seq = currentBatch.seq
    result.last_seq = last_seq
    // This one is slightly simplified,
    // will be called on every finish batch
    // In PouchDB they look up if any docs have been synced
    returnValue.emit('change', clone(result))

    return checkpointer.writeCheckpoint(last_seq, session)
      .then(function () {
        currentBatch = undefined
      })
  }

  function startNextBatch () {
    if (returnValue.cancelled || currentBatch) {
      return
    }

    if (batches.length === 0) {
      return processPendingBatch()
    }

    currentBatch = batches.shift()

    getBatchDocs()
      .then(writeDocs)
      .then(finishBatch)
      .then(startNextBatch)
      .catch(abortReplication)
  }

  function processPendingBatch () {
    if (pendingBatch.changes.length === 0) {
      if (batches.length === 0 && !currentBatch) {
        if (changesCompleted) {
          completeReplication()
        }
      }
      return
    }

    batches.push(pendingBatch)
    pendingBatch = {
      changes: [],
      seq: 0,
      docs: []
    }

    startNextBatch()
  }

  function onChange (change) {
    if (returnValue.cancelled) {
      return completeReplication()
    }

    pendingBatch.seq = change.seq
    pendingBatch.changes.push(change)
  }

  function onChangesComplete (changes) {
    changesPending = false

    changesOpts.since = changes.last_seq

    if (changes.results.length > 0) {
      getChanges()
      processPendingBatch()
    } else {
      changesCompleted = true
      processPendingBatch()
    }
  }

  function getChanges () {
    changesPending = true

    if (returnValue.cancelled) {
      return completeReplication()
    }

    var changes = db.changes(changesOpts)
    function abortChanges () {
      changes.cancel()
    }

    function removeListener () {
      returnValue.removeListener('cancel', abortChanges)
    }

    returnValue.once('cancel', abortChanges)
    changes.on('change', onChange)
    changes.then(removeListener, removeListener)
    changes.then(onChangesComplete)
  }

  function startChanges () {
    if (returnValue.cancelled) {
      return completeReplication()
    }

    checkpointer.getCheckpoint()
      .then(function (checkpoint) {
        changesOpts = {
          since: checkpoint,
          limit: batch_size,
          style: 'main_only', // only get winning revisions
          return_docs: true
        }

        getChanges()
      })
  }

  initCheckpointer()
  startChanges()

  return returnValue
}

module.exports = {
  syncToAnything: sync
}
