What to do:

- Get all the documents out, in batches
- Post documents to passed in 'sync' method
- 'sync' is supposed to return a promise when its done


Testing strategies:
----
- Prep a DB with a few docs
- Sync, check that the expected docs gets passed in to sync function

- Test2:
  - fail sync via sync function, check that doc passes

Stretch goal:
  - support most possible options on PouchDB.replicate
  - support the possible events on PouchDB.replicate
