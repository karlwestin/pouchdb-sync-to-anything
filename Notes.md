What to do:

- Get all the documents out, in batches
- Post documents to passed in 'sync' method
- 'sync' is supposed to return a promise when its done


Testing strategies:
----
Stretch goal:
  - support most possible options on PouchDB.replicate
  - support the possible events on PouchDB.replicate

// - Fix replicationId!!!
- Documentation
- there's currently 2 options - sync_id and batch_size, anything else?
// - VERY IMPORTANT - test on an updated document!!

