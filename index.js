var EE = require('events').EventEmitter
var inherits = require('inherits')
var Checkpointer = require('pouchdb-checkpointer')
var uuid = require('pouchdb-utils').uuid

inherits(Replicator, EE)

function Replicator(db) {
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

function createError(err) {
  if (err instanceof Error) {
    return err
  }

  return new Error(`Sync error ${err}`)
}

function sync (syncer, opts) {
  opts = opts || {}
  var db = this
  // TODO: how to generate ids?
  var repId = opts.repId || 'my-replication-id'
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

  var pendingBatch = {
    changes: [],
    seq: 0,
    docs: []
  }
  var batches = []

  function initCheckpointer() {
    /*
     * PouchDB checkpointer writes the checkpoint to target first
     * We're misusing the checkpointer a little bit,
     * so we pass our source as target, and pretend our source is read-only
     * that way we can use the PouchDB checkpointer out of the box
     */
    checkpointer =
      checkpointer ||
      new Checkpointer('sync-to-anything', db, `_local/${repId}`, returnValue)
    checkpointer.readOnlySource = true
  }

  function completeReplication (fatalError) {
    result.status = result.status || 'complete'
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

  function getChange (change) {
    return db.get(change.id)
  }

  function getBatchDocs () {
    return Promise.all(currentBatch.changes.map(getChange))
  }

  function writeDocs(docs) {
    if (!docs.length) {
      return Promise.resolve()
    }
    return syncer(docs)
  }

  function finishBatch () {
    var last_seq = currentBatch.seq
    return checkpointer.writeCheckpoint(last_seq, session)
      .then(function () {
        currentBatch = undefined
      })
  }

  function startNextBatch () {
    if (currentBatch) {
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
    // TODO: cancel when replication is aborted
    var changes = db.changes(changesOpts)
    changes.on('change', onChange)
    changes.then(onChangesComplete)
  }

  function startChanges () {
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
