'use strict';
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.argv[2]);
db.exec('PRAGMA journal_mode=WAL; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
process.send({locked:true});
process.once('message',message=>setTimeout(()=>{db.close();process.exit(0);},message.releaseAfterMs));
process.once('disconnect',()=>{try{db.close();}finally{process.exit(0);}});
